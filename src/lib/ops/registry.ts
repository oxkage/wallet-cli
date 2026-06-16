import type { z } from "zod";
import type { ethers } from "ethers";
import type { ResolvedSigner } from "../signer";
import type { OpContext } from "./context";

/**
 * An op definition: "given my params + ctx, build an unsigned tx to sign+send".
 *
 * The execute loop handles nonce, sign, broadcast, wait, log.
 * The op just builds the tx and provides metadata for logging.
 */

export type OpBuildResult = {
  signer: ResolvedSigner;
  tx: Omit<ethers.TransactionRequest, "nonce" | "from">;
  meta: {
    op: string;                      // matches op type, used for tx history
    to?: string;
    valueWei?: string;
    token?: string;
    amount?: string;
    note?: string;
  };
};

export type OpDefinition<P = any> = {
  type: string;
  summary: string;
  schema: z.ZodType<P>;
  example: Record<string, unknown>;
  build: (params: P, ctx: OpContext) => Promise<OpBuildResult>;
  describe: () => { type: string; summary: string; schema: unknown; example: unknown };
};

const registry = new Map<string, OpDefinition>();

export function registerOp<P>(def: OpDefinition<P>): OpDefinition<P> {
  if (registry.has(def.type)) {
    throw new Error(`Op type already registered: ${def.type}`);
  }
  registry.set(def.type, def as OpDefinition);
  return def;
}

export function getOp(type: string): OpDefinition | undefined {
  return registry.get(type);
}

export function listOps(): OpDefinition[] {
  return [...registry.values()].sort((a, b) => a.type.localeCompare(b.type));
}

export function clearOps(): void {
  registry.clear();
}
