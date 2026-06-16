import type { Plan, PlanOperation } from "../plan/schema";

/**
 * Multisend: emit one op per recipient, all from a single `from` wallet
 * (address or fromIndex). Token defaults to 'native' which produces a
 * `native-send` op; any other string produces an `erc20-transfer` op.
 *
 * The `from` may be provided as:
 *   - 0x... address  → set plan.defaultFrom, no per-op from needed
 *   - integer        → set plan.defaultFromIndex, no per-op from needed
 *
 * This keeps the resulting plan compact and the execute-loop happy
 * (it resolves the default once at plan level).
 */

export type MultisendRecipient = {
  address: string;
  amount: string;                // universal value format
  token?: "native" | string;     // default: 'native'
};

export type MultisendOpts = {
  chain: string;
  from: string | number;
  recipients: MultisendRecipient[];
  name?: string;
  options?: Plan["options"];
};

const OP_TYPE_NATIVE = "native-send";
const OP_TYPE_ERC20 = "erc20-transfer";
const NATIVE = "native";

export function generateMultisendPlan(opts: MultisendOpts): Plan {
  if (!Array.isArray(opts.recipients) || opts.recipients.length === 0) {
    throw new Error("recipients must be a non-empty array");
  }
  if (typeof opts.chain !== "string" || opts.chain.length === 0) {
    throw new Error("chain is required");
  }

  const planBase: Pick<Plan, "version" | "name" | "chain"> = {
    version: 1,
    name: opts.name ?? "multisend",
    chain: opts.chain,
  };

  // Resolve `from` into plan-level default + ops
  const fromIsAddress = typeof opts.from === "string";
  const fromIsIndex = typeof opts.from === "number";

  if (!fromIsAddress && !fromIsIndex) {
    throw new Error("from must be a 0x address or non-negative integer index");
  }

  if (fromIsAddress) {
    validateAddress(opts.from as string, "from");
  } else {
    const idx = opts.from as number;
    if (!Number.isInteger(idx) || idx < 0) {
      throw new Error(`from index must be a non-negative integer, got: ${idx}`);
    }
  }

  const operations: PlanOperation[] = [];
  for (let i = 0; i < opts.recipients.length; i += 1) {
    const r = opts.recipients[i];
    validateAddress(r.address, `recipients[${i}].address`);
    if (typeof r.amount !== "string" || r.amount.length === 0) {
      throw new Error(`recipients[${i}].amount is required (universal value format)`);
    }

    const isNative = !r.token || r.token.toLowerCase() === NATIVE;
    const id = `multi-${i}`;

    if (isNative) {
      operations.push({
        id,
        type: OP_TYPE_NATIVE,
        to: r.address,
        value: r.amount,
      });
    } else {
      operations.push({
        id,
        type: OP_TYPE_ERC20,
        token: r.token as string,
        to: r.address,
        amount: r.amount,
      });
    }
  }

  const plan: Plan = { ...planBase, operations };
  if (fromIsAddress) {
    plan.defaultFrom = opts.from as string;
  } else {
    plan.defaultFromIndex = opts.from as number;
  }
  if (opts.options) plan.options = opts.options;

  return plan;
}

function validateAddress(value: string, fieldName: string): void {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`${fieldName} must be a 0x-prefixed 40-hex EVM address, got: ${value}`);
  }
}
