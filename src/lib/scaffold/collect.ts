import type { Plan, PlanOperation } from "../plan/schema";

/**
 * Collect: same shape as sweep, but for a single token across the wallet
 * range. Use this when you want a focused drain of one asset to a
 * destination, e.g. "collect all USDC from wallets 0..199 into 0xDEST".
 *
 * - token = "native" → emits `native-send` ops
 * - any other string → emits `erc20-transfer` ops
 */

export type CollectOpts = {
  chain: string;
  token: "native" | string;
  fromIdx: number;
  toIdx: number;
  to: string;
  skip?: number[];
  name?: string;
  options?: Plan["options"];
};

const OP_TYPE_NATIVE = "native-send";
const OP_TYPE_ERC20 = "erc20-transfer";
const NATIVE = "native";

export function generateCollectPlan(opts: CollectOpts): Plan {
  validateIndices(opts.fromIdx, opts.toIdx);
  validateAddress(opts.to, "to");
  if (typeof opts.token !== "string" || opts.token.length === 0) {
    throw new Error("token is required ('native' or symbol)");
  }

  const skipSet = new Set((opts.skip ?? []).map((n) => Number(n)));
  const isNative = opts.token.toLowerCase() === NATIVE;

  const operations: PlanOperation[] = [];
  for (let i = opts.fromIdx; i <= opts.toIdx; i += 1) {
    if (skipSet.has(i)) continue;
    const id = `collect-${i}`;

    if (isNative) {
      operations.push({
        id,
        type: OP_TYPE_NATIVE,
        fromIndex: i,
        to: opts.to,
        value: "all",
      });
    } else {
      operations.push({
        id,
        type: OP_TYPE_ERC20,
        fromIndex: i,
        token: opts.token,
        to: opts.to,
        amount: "all",
      });
    }
  }

  if (operations.length === 0) {
    throw new Error(
      `Collect produced 0 operations: fromIdx=${opts.fromIdx} toIdx=${opts.toIdx} skip=[${[...skipSet].join(",")}]`
    );
  }

  return {
    version: 1,
    name: opts.name ?? `collect-${opts.token}`,
    chain: opts.chain,
    operations,
    options: opts.options,
  };
}

function validateIndices(fromIdx: number, toIdx: number): void {
  if (!Number.isInteger(fromIdx) || fromIdx < 0) {
    throw new Error(`fromIdx must be a non-negative integer, got: ${fromIdx}`);
  }
  if (!Number.isInteger(toIdx) || toIdx < 0) {
    throw new Error(`toIdx must be a non-negative integer, got: ${toIdx}`);
  }
  if (toIdx < fromIdx) {
    throw new Error(`toIdx (${toIdx}) must be >= fromIdx (${fromIdx})`);
  }
}

function validateAddress(value: string, fieldName: string): void {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`${fieldName} must be a 0x-prefixed 40-hex EVM address, got: ${value}`);
  }
}
