import { ethers } from "ethers";

/**
 * Per-wallet nonce cache. Prevents nonce-replay when retrying failed sends
 * and lets parallel ops from the same wallet coordinate safely.
 *
 * In-memory only for Phase 1; persistent cache will land in Phase 5.
 *
 * Semantics:
 *   - `peek(addr, provider)` → returns last cached nonce, or fetches from chain
 *   - `next(addr, provider)` → reserves the next nonce for `addr`
 *   - `confirm(addr, n)` → marks nonce as confirmed (call after receipt)
 *   - `release(addr, n)` → rolls back reservation (call on send failure)
 */

type WalletState = {
  // Last nonce we KNOW is confirmed on-chain (from a receipt or chain read)
  confirmed: number | null;
  // Next nonce to use (may be ahead of confirmed when ops are in-flight)
  next: number | null;
  // Last on-chain value (for refresh comparisons)
  onChain: number | null;
  fetchedAt: number;
};

const state = new Map<string, WalletState>();

function key(addr: string): string {
  return addr.toLowerCase();
}

async function readOnChain(provider: ethers.JsonRpcProvider, address: string): Promise<number> {
  return provider.getTransactionCount(address, "pending");
}

export async function peek(
  provider: ethers.JsonRpcProvider,
  address: string
): Promise<number> {
  const k = key(address);
  const existing = state.get(k);
  if (existing && existing.onChain !== null) return existing.onChain;
  const onChain = await readOnChain(provider, address);
  state.set(k, {
    confirmed: existing?.confirmed ?? null,
    next: existing?.next ?? null,
    onChain,
    fetchedAt: Date.now(),
  });
  return onChain;
}

/**
 * Reserve the next nonce for an address. Bumps the in-memory counter; does not touch the chain.
 * If `next` is behind on-chain, sync up first.
 */
export async function next(
  provider: ethers.JsonRpcProvider,
  address: string
): Promise<number> {
  const k = key(address);
  const onChain = await peek(provider, address);
  const existing = state.get(k);
  const startFrom = Math.max(existing?.next ?? -1, onChain);
  const reserved = startFrom;
  state.set(k, {
    confirmed: existing?.confirmed ?? null,
    next: reserved + 1,
    onChain,
    fetchedAt: Date.now(),
  });
  return reserved;
}

export function confirm(address: string, nonce: number): void {
  const k = key(address);
  const existing = state.get(k);
  if (!existing) return;
  const newConfirmed = Math.max(existing.confirmed ?? -1, nonce);
  state.set(k, {
    ...existing,
    confirmed: newConfirmed,
    onChain: Math.max(existing.onChain ?? -1, nonce + 1),
  });
}

export function release(address: string, nonce: number): void {
  const k = key(address);
  const existing = state.get(k);
  if (!existing) return;
  if (existing.next === null || nonce >= existing.next) {
    state.set(k, { ...existing, next: nonce });
  }
}

export function reset(address?: string): void {
  if (address) {
    state.delete(key(address));
  } else {
    state.clear();
  }
}
