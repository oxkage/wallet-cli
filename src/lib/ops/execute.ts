import { ethers } from "ethers";
import type { Plan } from "../plan/schema";
import type { OpContext } from "./context";
import { getOp } from "./registry";
import { deriveEvmWalletAtIndex } from "../wallets";
import { runScheduled, type SchedulableOp } from "./schedule";
import "./builtin/nativeSend";
import "./builtin/rawTx";
import "./builtin/erc20Transfer";
import "./builtin/erc20Approve";
import "./builtin/erc721Transfer";
import "./builtin/erc721Approve";
import "./builtin/contractCall";

export type OpResult = {
  id: string;
  type: string;
  ok: boolean;
  mode: "dry-run" | "submitted" | "skipped" | "error";
  hash?: string;
  blockNumber?: number;
  gasUsed?: string;
  effectiveGasPrice?: string;
  error?: { code: string; message: string };
  meta?: Record<string, unknown>;
};

export type PlanResult = {
  plan: string;
  ok: boolean;
  mode: "dry-run" | "broadcast";
  chain: string;
  chainId: number | string;
  startedAt: string;
  finishedAt: string;
  results: OpResult[];
  summary: {
    total: number;
    succeeded: number;
    failed: number;
    skipped: number;
    dryRun: number;
  };
};

/** Progress callback: invoked as each op settles, in completion order. */
export type ProgressFn = (
  result: OpResult,
  progress: { done: number; total: number }
) => void;

type PlanOp = Plan["operations"][number];

/** An op with its sender resolved once, up front (no per-loop dynamic import). */
type ResolvedOp = {
  op: PlanOp;
  from: string | undefined;
  fromIndex?: number;
};

/**
 * Resolve every op's `from` address in a single typed pre-pass.
 * Precedence: explicit op.from → op.fromIndex → plan default.
 */
function resolveSenders(plan: Plan, defaultFrom: string | undefined): ResolvedOp[] {
  return plan.operations.map((op) => {
    const opAny = op as PlanOp & { from?: string; fromIndex?: number };
    if (opAny.from) return { op, from: opAny.from };
    if (opAny.fromIndex !== undefined) {
      const derived = deriveEvmWalletAtIndex(opAny.fromIndex);
      return { op, from: derived.address, fromIndex: opAny.fromIndex };
    }
    return { op, from: defaultFrom };
  });
}

export async function executePlan(
  plan: Plan,
  ctx: OpContext,
  onProgress?: ProgressFn
): Promise<PlanResult> {
  const startedAt = new Date().toISOString();

  const defaultFromAddress = await resolvePlanDefaultFrom(plan, ctx);
  const resolved = resolveSenders(plan, defaultFromAddress);

  const items: SchedulableOp<ResolvedOp>[] = resolved.map((r, index) => ({
    op: r,
    from: r.from,
    index,
  }));

  const total = items.length;
  let done = 0;
  const concurrency = plan.options?.batchSize ?? 1;

  const settled = await runScheduled<ResolvedOp, OpResult>(
    items,
    concurrency,
    ctx.stopOnError,
    {
      delayMs: plan.options?.delayMs,
      runOp: async ({ op: resolvedOp }) => runSingleOp(plan, ctx, resolvedOp),
      isFailure: (r) => !r.ok,
      onResult: (r) => {
        done += 1;
        onProgress?.(r, { done, total });
      },
    }
  );

  // Reassemble in original plan order; any unstarted (stopOnError) slots are
  // reported as skipped so the summary stays honest.
  const results: OpResult[] = resolved.map((r, i) => {
    const s = settled[i];
    if (s) return s;
    return {
      id: r.op.id,
      type: r.op.type,
      ok: false,
      mode: "skipped",
      error: { code: "NOT_RUN", message: "Skipped after an earlier failure (stopOnError)" },
    };
  });

  const finishedAt = new Date().toISOString();
  const summary = summarize(results);

  return {
    plan: plan.name ?? "(unnamed)",
    ok: summary.failed === 0,
    mode: ctx.dryRun ? "dry-run" : "broadcast",
    chain: ctx.chain.name,
    chainId: ctx.chain.chainId,
    startedAt,
    finishedAt,
    results,
    summary,
  };
}

/** Build + execute a single op. Never throws — encodes failure in OpResult. */
async function runSingleOp(plan: Plan, ctx: OpContext, resolvedOp: ResolvedOp): Promise<OpResult> {
  const { op, from } = resolvedOp;
  const def = getOp(op.type);
  if (!def) {
    return {
      id: op.id,
      type: op.type,
      ok: false,
      mode: "error",
      error: { code: "UNKNOWN_OP_TYPE", message: `Unknown op type: ${op.type}` },
    };
  }

  try {
    const opInput = { ...op, from };
    const params = def.schema.parse(opInput);
    const built = await def.build(params, ctx);
    return await executeOp(plan, ctx, op.id, op.type, built);
  } catch (e) {
    return {
      id: op.id,
      type: op.type,
      ok: false,
      mode: "error",
      error: { code: "BUILD_ERROR", message: (e as Error).message },
    };
  }
}

async function resolvePlanDefaultFrom(plan: Plan, _ctx: OpContext): Promise<string | undefined> {
  if (plan.defaultFrom) return plan.defaultFrom;
  if (plan.defaultFromIndex !== undefined) {
    return deriveEvmWalletAtIndex(plan.defaultFromIndex).address;
  }
  return undefined;
}

type BuiltOp = {
  signer: { address: string; wallet: ethers.HDNodeWallet; index: number; path: string };
  tx: any;
  meta: { op: string; to?: string; valueWei?: string; token?: string; amount?: string; note?: string };
};

async function executeOp(
  plan: Plan,
  ctx: OpContext,
  opId: string,
  opType: string,
  built: BuiltOp
): Promise<OpResult> {
  const nonceVal = await ctx.reserveNonce(built.signer.address);
  const fullTx: ethers.TransactionRequest = {
    ...built.tx,
    from: built.signer.address,
    nonce: nonceVal,
  };

  // Estimate gas if not set
  let gasLimit: bigint;
  if (fullTx.gasLimit !== undefined && fullTx.gasLimit !== null) {
    gasLimit = BigInt(fullTx.gasLimit.toString());
  } else {
    gasLimit = await ctx.provider.estimateGas(fullTx);
  }
  fullTx.gasLimit = gasLimit;

  // Simulate
  if (ctx.simulate && !ctx.dryRun) {
    try {
      await ctx.provider.call(fullTx);
    } catch (e) {
      ctx.releaseNonce(built.signer.address, nonceVal);
      return {
        id: opId,
        type: opType,
        ok: false,
        mode: "skipped",
        error: { code: "REVERT", message: (e as Error).message },
        meta: built.meta as Record<string, unknown>,
      };
    }
  }

  if (ctx.dryRun) {
    ctx.releaseNonce(built.signer.address, nonceVal);
    // Log dry-run attempt
    ctx.log({
      plan: plan.name,
      opId,
      op: built.meta.op,
      from: built.signer.address,
      fromIndex: built.signer.index,
      to: built.meta.to,
      valueWei: built.meta.valueWei,
      token: built.meta.token,
      amount: built.meta.amount,
      status: "dry-run",
      note: built.meta.note,
    });
    return {
      id: opId,
      type: opType,
      ok: true,
      mode: "dry-run",
      meta: {
        ...built.meta,
        nonce: nonceVal,
        gasLimit: gasLimit.toString(),
        maxFeePerGas: ctx.fees.maxFeePerGas.toString(),
        maxPriorityFeePerGas: ctx.fees.maxPriorityFeePerGas.toString(),
      },
    };
  }

  // Broadcast
  const connected = built.signer.wallet.connect(ctx.provider) as ethers.HDNodeWallet;
  const response = await connected.sendTransaction(fullTx);
  const receipt = await response.wait();

  if (receipt && receipt.status === 1) {
    ctx.confirmNonce(built.signer.address, nonceVal);
  } else {
    ctx.releaseNonce(built.signer.address, nonceVal);
  }

  ctx.log({
    plan: plan.name,
    opId,
    op: built.meta.op,
    from: built.signer.address,
    fromIndex: built.signer.index,
    to: built.meta.to,
    valueWei: built.meta.valueWei,
    token: built.meta.token,
    amount: built.meta.amount,
    hash: response.hash,
    blockNumber: receipt?.blockNumber,
    gasUsed: receipt?.gasUsed.toString(),
    effectiveGasPrice: receipt?.gasPrice ? receipt.gasPrice.toString() : undefined,
    status: receipt?.status === 1 ? "success" : "reverted",
    note: built.meta.note,
  });

  return {
    id: opId,
    type: opType,
    ok: receipt?.status === 1,
    mode: "submitted",
    hash: response.hash,
    blockNumber: receipt?.blockNumber,
    gasUsed: receipt?.gasUsed.toString(),
    effectiveGasPrice: receipt?.gasPrice ? receipt.gasPrice.toString() : undefined,
    meta: built.meta as Record<string, unknown>,
  };
}

function summarize(results: OpResult[]) {
  return {
    total: results.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok && r.mode === "error").length,
    skipped: results.filter((r) => r.mode === "skipped").length,
    dryRun: results.filter((r) => r.mode === "dry-run").length,
  };
}
