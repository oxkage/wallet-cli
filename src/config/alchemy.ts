/**
 * Alchemy RPC resolution.
 *
 * The user sets ONE secret in .env — ALCHEMY_API_KEY — and the script builds
 * per-chain RPC URLs from it. Chains Alchemy serves get an Alchemy endpoint;
 * everything else falls back to the bundled public RPC in config/chains.ts.
 *
 * To add Alchemy support for a new chain: add its chainId → network slug here.
 * The slug is the subdomain in https://<slug>.g.alchemy.com/v2/<KEY>.
 */

/** chainId → Alchemy network slug. Extend as Alchemy adds networks. */
export const ALCHEMY_SLUGS: Record<string, string> = {
  "1": "eth-mainnet",
  "8453": "base-mainnet",
  "42161": "arb-mainnet",
  "10": "opt-mainnet",
  "137": "polygon-mainnet",
  "56": "bnb-mainnet",
  "43114": "avax-mainnet",
  "534352": "scroll-mainnet",
  "5000": "mantle-mainnet",
  "59144": "linea-mainnet",
  "324": "zksync-mainnet",
  "81457": "blast-mainnet",
  "7777777": "zora-mainnet",
  "100": "gnosis-mainnet",
  "2741": "abstract-mainnet",
  "10143": "monad-testnet",
};

/** Read the Alchemy key from env (trimmed). Empty/unset → null. */
export function getAlchemyKey(): string | null {
  const key = process.env.ALCHEMY_API_KEY?.trim();
  return key && key.length > 0 ? key : null;
}

/**
 * Build the Alchemy RPC URL for a chain, or null if Alchemy can't serve it
 * (no key, or no slug mapping → caller falls back to the public RPC).
 */
export function alchemyRpcUrl(chainId: number | string): string | null {
  const key = getAlchemyKey();
  if (!key) return null;
  const slug = ALCHEMY_SLUGS[String(chainId)];
  if (!slug) return null;
  return `https://${slug}.g.alchemy.com/v2/${key}`;
}
