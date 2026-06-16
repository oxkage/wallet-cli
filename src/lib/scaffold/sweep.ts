import type { Plan, PlanOperation } from "../plan/schema";

/**
 * Sweep: for each wallet in [fromIdx, toIdx] (excluding `skip`), send each
 * requested asset in `include` to `to`.
 *
 * - "native" → emits a `native-send` op
 * - any other string → emits an `erc20-transfer` op (token symbol)
 *
 * Amounts default to "all" (full balance minus gas for native, full balance
 * for ERC-20s). The user is expected to edit the resulting plan JSON if
 * they want fixed amounts; that's why `scaffold` is sugar and `run` is the
 * point of no return.
 */

export type SweepAsset = "native" | string;

export type SweepOpts = {
  chain: string;
  fromIdx: number;
  toIdx: number;
  to: string;                          // destination 0x...
  include: SweepAsset[];               // e.g. ["native", "USDC"]
  skip?: number[];                     // wallet indices to skip
  name?: string;                       // optional plan name
  options?: Plan["options"];
};

const OP_TYPE_NATIVE = "native-send";
const OP_TYPE_ERC20 = "erc20-transfer";
const NATIVE = "native";

export function generateSweepPlan(opts: SweepOpts): Plan {
  validateIndices(opts.fromIdx, opts.toIdx);
  validateAddress(opts.to, "to");
  if (!Array.isArray(opts.include) || opts.include.length === 0) {
    throw new Error("include must be a non-empty array (e.g. ['native', 'USDC'])");
  }

  const skipSet = new Set((opts.skip ?? []).map((n) => Number(n)));
  const assets = opts.include.map((a) => String(a).trim()).filter((a) => a.length > 0);
  if (assets.length === 0) {
    throw new Error("include contains no non-empty entries");
  }

  const operations: PlanOperation[] = [];
  let counter = 0;

  for (let i = opts.fromIdx; i <= opts.toIdx; i += 1) {
    if (skipSet.has(i)) continue;

    for (const asset of assets) {
      const isNative = asset.toLowerCase() === NATIVE;
      const id = `sweep-${counter++}`;

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
          token: asset,
          to: opts.to,
          amount: "all",
        });
      }
    }
  }

  if (operations.length === 0) {
    throw new Error(
      `Sweep produced 0 operations: fromIdx=${opts.fromIdx} toIdx=${opts.toIdx} skip=[${[...skipSet].join(",")}]`
    );
  }

  return {
    version: 1,
    name: opts.name ?? "sweep",
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
