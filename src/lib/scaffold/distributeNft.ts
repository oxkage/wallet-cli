import type { Plan, PlanOperation } from "../plan/schema";

/**
 * Distribute NFTs: spread a source wallet's owned tokenIds of one collection
 * across many recipient addresses. Unlike fungible distribute (which splits a
 * divisible amount), NFTs are indivisible — so we ALLOCATE distinct tokenIds
 * to recipients deterministically.
 *
 * Allocation = round-robin in input order: tokenIds[0]→recipients[0],
 * tokenIds[1]→recipients[1], … wrapping around. This is deterministic and
 * gives the most even spread possible when counts don't divide evenly. The
 * source's tokenIds come from `enumerateOwnership` (Alchemy NFT API or
 * Enumerable fallback); pass them in sorted for reproducible plans.
 *
 * Emits one `erc721-transfer` op per tokenId. Pure: tokenIds + recipients in →
 * plan out, no network.
 */

export interface DistributeNftOpts {
  chain: string;
  /** Source holding the NFTs: 0x address or derivation index. */
  from: string | number;
  contract: string; // NFT collection address
  /** tokenIds to distribute (decimal strings), from the source's holdings. */
  tokenIds: string[];
  /** Recipient addresses; tokenIds are dealt round-robin across these. */
  recipients: string[];
  name?: string;
  options?: Plan["options"];
  /** If true, emit plain transferFrom (safe:false) instead of safeTransferFrom. */
  unsafe?: boolean;
}

export function generateDistributeNftPlan(opts: DistributeNftOpts): Plan {
  validateAddress(opts.contract, "contract");
  if (!Array.isArray(opts.tokenIds) || opts.tokenIds.length === 0) {
    throw new Error("tokenIds must be a non-empty array");
  }
  if (!Array.isArray(opts.recipients) || opts.recipients.length === 0) {
    throw new Error("recipients must be a non-empty array");
  }
  opts.recipients.forEach((r, i) => {
    if (!/^0x[a-fA-F0-9]{40}$/.test(r)) {
      throw new Error(`recipient[${i}] invalid: ${r}`);
    }
  });
  opts.tokenIds.forEach((t, i) => {
    if (!/^(0x[0-9a-fA-F]+|\d+)$/.test(String(t))) {
      throw new Error(`tokenId[${i}] must be a decimal or 0x-hex integer, got: ${t}`);
    }
  });

  const fromField = resolveFromField(opts.from);

  const operations: PlanOperation[] = [];
  for (let i = 0; i < opts.tokenIds.length; i += 1) {
    const tokenId = String(opts.tokenIds[i]);
    const to = opts.recipients[i % opts.recipients.length]; // round-robin
    const op: Record<string, unknown> = {
      id: `distnft-${i}`,
      type: "erc721-transfer",
      ...fromField,
      contract: opts.contract,
      tokenId,
      to,
    };
    if (opts.unsafe) op.safe = false;
    operations.push(op as unknown as PlanOperation);
  }

  return {
    version: 1,
    name: opts.name ?? "distribute-nft",
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

function validateAddress(value: string, fieldName: string): void {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`${fieldName} must be a 0x-prefixed 40-hex EVM address, got: ${value}`);
  }
}
