import { ethers } from "ethers";
import type { Plan, PlanOperation } from "../plan/schema";
import { BUILTIN_ABIS } from "../abi/builtin";

/**
 * call-range: broadcast the SAME contract call from every wallet in an index
 * range [fromIdx, toIdx]. One `contract-call` op per index, all with identical
 * target/fn/args. The canonical use is batch minting/claiming/registering from
 * many burner wallets (e.g. mint(0,1) from idx 1..99).
 *
 * Pure: range + fixed args in → plan out, no network. The fn signature and
 * args are validated up front (encoded once with ethers) so a bad ABI/fn/arg
 * fails here instead of 99 times at run time.
 *
 * Gas/native funding is a SEPARATE concern: fund the range first with
 * `scaffold distribute` (native), then run this plan.
 */

export interface CallRangeOpts {
  chain: string;
  to: string; // contract address
  abi?: string; // OPTIONAL — alias/path/inline JSON. Omit to derive from fn signature.
  fn: string; // full signature e.g. "mint(uint256,uint256)" — required when abi omitted
  args: string[]; // fixed args applied to EVERY call
  fromIdx: number;
  toIdx: number;
  /** Per-call native value (e.g. paid mint). "0" or "wei:N". Default "0". */
  value?: string;
  /** Wallet indices to skip within the range. */
  skip?: number[];
  name?: string;
  options?: Partial<NonNullable<Plan["options"]>>;
}

export function generateCallRangePlan(opts: CallRangeOpts): Plan {
  validateAddress(opts.to, "to");
  if (!Number.isInteger(opts.fromIdx) || opts.fromIdx < 0) {
    throw new Error(`fromIdx must be a non-negative integer, got: ${opts.fromIdx}`);
  }
  if (!Number.isInteger(opts.toIdx) || opts.toIdx < 0) {
    throw new Error(`toIdx must be a non-negative integer, got: ${opts.toIdx}`);
  }
  if (opts.toIdx < opts.fromIdx) {
    throw new Error(`toIdx (${opts.toIdx}) must be >= fromIdx (${opts.fromIdx})`);
  }

  const value = (opts.value ?? "0").trim();
  if (!/^(0|wei:\d+)$/.test(value)) {
    throw new Error(`value must be "0" or "wei:N", got: ${value}`);
  }

  // Validate the call ONCE up front: resolve the ABI, find the fn, encode the
  // args. If anything is wrong (bad signature, wrong arg count/type), fail here
  // with a clear message rather than emitting N broken ops.
  validateCall(opts.abi, opts.fn, opts.args);

  const skipSet = new Set((opts.skip ?? []).map(Number));
  const operations: PlanOperation[] = [];
  for (let i = opts.fromIdx; i <= opts.toIdx; i += 1) {
    if (skipSet.has(i)) continue;
    const op: Record<string, unknown> = {
      id: `call-${i}`,
      type: "contract-call",
      fromIndex: i,
      to: opts.to,
      fn: opts.fn,
      args: opts.args,
      value,
    };
    // Only attach abi when explicitly provided — otherwise the op derives the
    // Interface from the fn signature (no ABI needed).
    if (opts.abi !== undefined && opts.abi.trim().length > 0) {
      op.abi = opts.abi;
    }
    operations.push(op as unknown as PlanOperation);
  }

  if (operations.length === 0) {
    throw new Error(
      `call-range produced 0 operations: range [${opts.fromIdx}, ${opts.toIdx}] is empty after skips.`
    );
  }

  return {
    version: 1,
    name: opts.name ?? "call-range",
    chain: opts.chain,
    operations,
    options: opts.options as unknown as Plan["options"],
  };
}

/** Resolve ABI → Interface, locate fn, encode args. Throws on any mismatch.
 * When `abi` is undefined, the Interface is derived from `fn` as a
 * human-readable signature (no ABI required). */
function validateCall(abi: string | undefined, fn: string, args: string[]): void {
  // No ABI: derive the fragment from the signature itself, then encode.
  if (abi === undefined || abi.trim().length === 0) {
    if (!/\(.*\)/.test(fn)) {
      throw new Error(
        `fn "${fn}" is a bare name but no abi was given. Pass a full signature like "mint(uint256,uint256)", or provide --abi.`
      );
    }
    let iface: ethers.Interface;
    try {
      iface = new ethers.Interface([`function ${fn}`]);
    } catch (e: any) {
      throw new Error(`could not parse fn signature "${fn}": ${e?.shortMessage ?? e?.message ?? e}`);
    }
    const fragment = iface.getFunction(fn.includes("(") ? fn.slice(0, fn.indexOf("(")) : fn);
    if (fragment && args.length !== fragment.inputs.length) {
      throw new Error(
        `fn "${fn}" expects ${fragment.inputs.length} arg(s), got ${args.length}: [${args.join(", ")}]`
      );
    }
    try {
      iface.encodeFunctionData(fn, args);
    } catch (e: any) {
      throw new Error(`args do not encode against "${fn}": ${e?.shortMessage ?? e?.message ?? e}`);
    }
    return;
  }

  const alias = abi.trim().toLowerCase();
  let abiJson: string;
  if (BUILTIN_ABIS[alias]) {
    abiJson = BUILTIN_ABIS[alias];
  } else {
    // Inline JSON or path. For pure validation we only handle inline/alias;
    // a file path is resolved by the op at run time. If it looks like a path,
    // skip deep validation (can't read files in a pure generator reliably).
    const looksLikePath = abi.includes("/") || abi.includes("\\") || /\.json$/i.test(abi.trim());
    if (looksLikePath) {
      // Still validate fn signature shape and arg count against the signature.
      validateFnSignatureShape(fn, args);
      return;
    }
    abiJson = abi; // inline JSON
  }

  let iface: ethers.Interface;
  try {
    iface = new ethers.Interface(abiJson);
  } catch (e: any) {
    throw new Error(`abi is not valid: ${e?.message ?? e}`);
  }

  let fragment;
  try {
    fragment = iface.getFunction(fn);
  } catch {
    fragment = null;
  }
  if (!fragment) {
    throw new Error(
      `fn "${fn}" not found in the provided ABI. Use a full signature like "mint(uint256,uint256)".`
    );
  }
  if (args.length !== fragment.inputs.length) {
    throw new Error(
      `fn "${fn}" expects ${fragment.inputs.length} arg(s), got ${args.length}: [${args.join(", ")}]`
    );
  }
  try {
    iface.encodeFunctionData(fragment, args);
  } catch (e: any) {
    throw new Error(`args do not encode against "${fn}": ${e?.shortMessage ?? e?.message ?? e}`);
  }
}

/** When the ABI is a file path we can't read here, at least sanity-check the
 * fn signature shape and that arg count matches the param list in the sig. */
function validateFnSignatureShape(fn: string, args: string[]): void {
  const m = /^[A-Za-z_$][A-Za-z0-9_$]*\(([^)]*)\)$/.exec(fn.trim());
  if (!m) {
    throw new Error(
      `fn "${fn}" is not a full signature. Use e.g. "mint(uint256,uint256)" so args can be checked.`
    );
  }
  const params = m[1].trim().length === 0 ? [] : m[1].split(",").map((s) => s.trim());
  if (args.length !== params.length) {
    throw new Error(
      `fn "${fn}" expects ${params.length} arg(s), got ${args.length}: [${args.join(", ")}]`
    );
  }
}

function validateAddress(value: string, fieldName: string): void {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`${fieldName} must be a 0x-prefixed 40-hex EVM address, got: ${value}`);
  }
}
