import type { Chain } from "../../types/chains";

/**
 * Helper for ops to grab the chain from the OpContext.
 * We type the context as `any` in op build functions for simplicity, but
 * this wrapper documents the expected field and produces a useful error
 * if the context is somehow malformed.
 */
export function resolveChainForOp(ctx: any, opType: string): Chain {
  const chain = ctx?.chain as Chain | undefined;
  if (!chain) {
    throw new Error(`${opType}: missing chain on OpContext (internal bug)`);
  }
  return chain;
}
