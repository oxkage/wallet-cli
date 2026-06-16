import type { Plan, PlanOperation } from "../plan/schema";

/**
 * Distribute: send computed amounts from ONE source wallet to each wallet in
 * a target index range. Amounts are pre-computed (base units) by
 * distributeMath — this generator is pure: it just maps amounts → ops.
 *
 * - token = "native" → emits `native-send` ops (value = "raw:<baseUnits>")
 * - any other symbol → emits `erc20-transfer` ops (amount = "raw:<baseUnits>")
 *
 * Using "raw:N" guarantees the executor sends EXACTLY the computed base units,
 * with no decimal re-scaling — the math lib already did all the arithmetic.
 */

export type DistributeTarget = { index: number; address: string };

export type DistributeOpts = {
  chain: string;
  /** Source: 0x address or derivation index. */
  from: string | number;
  /** Target wallets (index for op id + resolved address), skips already applied. */
  targets: DistributeTarget[];
  /** Per-target base-unit amounts. Must align 1:1 with targets. */
  amounts: bigint[];
  /** "native" or a token symbol. */
  token: "native" | string;
  name?: string;
  options?: Plan["options"];
};

const OP_TYPE_NATIVE = "native-send";
const OP_TYPE_ERC20 = "erc20-transfer";
const NATIVE = "native";

export function generateDistributePlan(opts: DistributeOpts): Plan {
  if (!Array.isArray(opts.targets) || opts.targets.length === 0) {
    throw new Error("targets must be a non-empty array");
  }
  if (opts.amounts.length !== opts.targets.length) {
    throw new Error(
      `amounts (${opts.amounts.length}) must align 1:1 with targets (${opts.targets.length})`
    );
  }
  if (typeof opts.token !== "string" || opts.token.length === 0) {
    throw new Error("token is required ('native' or symbol)");
  }

  const fromField = resolveFromField(opts.from);
  const isNative = opts.token.toLowerCase() === NATIVE;

  const operations: PlanOperation[] = [];
  for (let i = 0; i < opts.targets.length; i += 1) {
    const target = opts.targets[i];
    const amount = opts.amounts[i];
    if (amount <= 0n) continue; // skip dust-only / zero allocations
    if (!/^0x[a-fA-F0-9]{40}$/.test(target.address)) {
      throw new Error(`target address invalid for index ${target.index}: ${target.address}`);
    }
    const to = target.address;
    const id = `dist-${target.index}`;

    if (isNative) {
      operations.push({ id, type: OP_TYPE_NATIVE, ...fromField, to, value: `raw:${amount.toString()}` });
    } else {
      operations.push({
        id,
        type: OP_TYPE_ERC20,
        ...fromField,
        token: opts.token,
        to,
        amount: `raw:${amount.toString()}`,
      });
    }
  }

  if (operations.length === 0) {
    throw new Error("Distribute produced 0 operations (all amounts were zero)");
  }

  return {
    version: 1,
    name: opts.name ?? `distribute-${opts.token}`,
    chain: opts.chain,
    operations,
    options: opts.options,
  };
}

/** Source field: either {from: "0x.."} or {fromIndex: N}. */
function resolveFromField(from: string | number): { from: string } | { fromIndex: number } {
  if (typeof from === "number") {
    if (!Number.isInteger(from) || from < 0) {
      throw new Error(`from index must be a non-negative integer, got: ${from}`);
    }
    return { fromIndex: from };
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(from)) {
    throw new Error(`from must be a 0x address or wallet index, got: ${from}`);
  }
  return { from };
}
