import type { Plan, PlanOperation } from "../plan/schema";
import type { NftOwnership } from "../nft/ownership";

/**
 * NFT sweep: drain every owned tokenId of one collection, from each wallet in
 * a range, to a single destination address. Emits one `erc721-transfer` op per
 * owned token.
 *
 * Ownership (which tokenIds each wallet holds) is resolved upstream by
 * `enumerateOwnership` (Alchemy NFT API or Enumerable fallback). This function
 * is pure: ownership map in → plan out, no network. That keeps the math
 * deterministic and unit-testable, mirroring the fungible sweep/distribute.
 *
 * safeTransferFrom is used by default (set safe:false per-op afterward if a
 * recipient contract lacks the receiver hook). The per-op ownership check in
 * the erc721-transfer op re-verifies on-chain at run time.
 */

export interface SweepNftOpts {
  chain: string;
  contract: string; // NFT collection address
  to: string; // single destination
  ownership: NftOwnership[]; // from enumerateOwnership()
  name?: string;
  options?: Plan["options"];
  /** If true, emit plain transferFrom (safe:false) instead of safeTransferFrom. */
  unsafe?: boolean;
}

export function generateSweepNftPlan(opts: SweepNftOpts): Plan {
  validateAddress(opts.contract, "contract");
  validateAddress(opts.to, "to");
  if (!Array.isArray(opts.ownership)) {
    throw new Error("ownership must be an array (from enumerateOwnership)");
  }

  const operations: PlanOperation[] = [];
  let counter = 0;

  for (const row of opts.ownership) {
    for (const tokenId of row.tokenIds) {
      const op: Record<string, unknown> = {
        id: `sweepnft-${counter++}`,
        type: "erc721-transfer",
        fromIndex: row.index,
        contract: opts.contract,
        tokenId: String(tokenId),
        to: opts.to,
      };
      if (opts.unsafe) op.safe = false;
      operations.push(op as unknown as PlanOperation);
    }
  }

  if (operations.length === 0) {
    throw new Error(
      `NFT sweep produced 0 operations: no wallets in the range own any token of ${opts.contract}. ` +
        `Check the collection address, chain, and wallet range.`
    );
  }

  return {
    version: 1,
    name: opts.name ?? "sweep-nft",
    chain: opts.chain,
    operations,
    options: opts.options,
  };
}

function validateAddress(value: string, fieldName: string): void {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`${fieldName} must be a 0x-prefixed 40-hex EVM address, got: ${value}`);
  }
}
