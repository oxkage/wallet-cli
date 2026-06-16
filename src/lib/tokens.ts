import fs from "node:fs";
import { z } from "zod";
import { backupFileIfExists, ensureDir } from "./backup";
import { PATHS } from "./paths";

/**
 * ERC-20 token registry.
 *
 * Default token list ships in code (DEFAULT_TOKENS) so the CLI works
 * out-of-the-box on the seeded chains. Users can add/remove tokens
 * per chain via collect-tokens add/remove — those deltas live in
 * PATHS.tokensOverrideFile (.burnerctl/tokens.override.json) and
 * overlay the defaults.
 *
 * The enabled flag is always a runtime property; it lives in the
 * override file (the schema above is the shape of the on-disk file).
 */

export type Token = {
  chainId: number;
  address: string;
  symbol: string;
  decimals: number;
  enabled: boolean;
};

const tokenSchema = z.object({
  chainId: z.number().int().positive(),
  address: z.string().refine((v) => /^0x[a-fA-F0-9]{40}$/.test(v), "invalid EVM address"),
  symbol: z.string().min(1).max(16),
  decimals: z.number().int().min(0).max(36),
  enabled: z.boolean().default(true),
});

const tokenOverrideSchema = z.object({
  version: z.literal(1),
  // A token in the override is identified by (chainId, symbol).
  // address is authoritative for add/remove. enabled is authoritative
  // for enable/disable and overrides the default's enabled flag.
  tokens: z
    .array(
      z.object({
        chainId: z.number().int().positive(),
        address: z.string().refine((v) => /^0x[a-fA-F0-9]{40}$/.test(v), "invalid EVM address"),
        symbol: z.string().min(1).max(16),
        decimals: z.number().int().min(0).max(36),
        enabled: z.boolean(),
      })
    )
    .default([]),
});

export type TokenOverride = z.infer<typeof tokenOverrideSchema>;

// --- Real mainnet token addresses ---
// Sources: token issuer's official deployment / Etherscan token search.
// USDC: circle.com, USDT: tether.to, WETH: weth.io
const DEFAULT_TOKENS: Omit<Token, "enabled">[] = [
  // Ethereum (1)
  { chainId: 1, address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", decimals: 6 },
  { chainId: 1, address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", symbol: "USDT", decimals: 6 },
  { chainId: 1, address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", symbol: "WETH", decimals: 18 },
  // Base (8453)
  { chainId: 8453, address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC", decimals: 6 },
  { chainId: 8453, address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", symbol: "USDT", decimals: 6 },
  { chainId: 8453, address: "0x4200000000000000000000000000000000000006", symbol: "WETH", decimals: 18 },
  // Arbitrum (42161)
  { chainId: 42161, address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", symbol: "USDC", decimals: 6 },
  { chainId: 42161, address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", symbol: "USDT", decimals: 6 },
  { chainId: 42161, address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", symbol: "WETH", decimals: 18 },
  // Optimism (10)
  { chainId: 10, address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", symbol: "USDC", decimals: 6 },
  { chainId: 10, address: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", symbol: "USDT", decimals: 6 },
  { chainId: 10, address: "0x4200000000000000000000000000000000000006", symbol: "WETH", decimals: 18 },
  // Polygon (137)
  { chainId: 137, address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", symbol: "USDC", decimals: 6 },
  { chainId: 137, address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", symbol: "USDT", decimals: 6 },
  { chainId: 137, address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", symbol: "WETH", decimals: 18 },
  // BSC (56)
  { chainId: 56, address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", symbol: "USDC", decimals: 18 },
  { chainId: 56, address: "0x55d398326f99059fF775485246999027B3197955", symbol: "USDT", decimals: 18 },
  { chainId: 56, address: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8", symbol: "WETH", decimals: 18 },
  // Avalanche (43114)
  { chainId: 43114, address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", symbol: "USDC", decimals: 6 },
  { chainId: 43114, address: "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7", symbol: "USDT", decimals: 6 },
  { chainId: 43114, address: "0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB", symbol: "WETH", decimals: 18 },
  // Gnosis (100)
  { chainId: 100, address: "0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83", symbol: "USDC", decimals: 6 },
  { chainId: 100, address: "0x4ECaBa5870353805a9F068101A04E8a0128b00B2", symbol: "USDT", decimals: 6 },
  { chainId: 100, address: "0x6A023CCd1ff6F2045C3309768eAd9E68F978f6e1", symbol: "WETH", decimals: 18 },
  // Linea (59144)
  { chainId: 59144, address: "0x176211869cA2b568f2A7D4EE941E073a821EE1ff", symbol: "USDC", decimals: 6 },
  { chainId: 59144, address: "0xA219439258ca9da29E9Cc4cE5596924745e12B93", symbol: "USDT", decimals: 6 },
  { chainId: 59144, address: "0xe5D7C2a44FfDDf6b295A15c148167daaAf5Cf34f", symbol: "WETH", decimals: 18 },
  // zkSync Era (324)
  { chainId: 324, address: "0x1d17CBcF0D6D143135aE902365D2E5e2A16538D4", symbol: "USDC", decimals: 6 },
  { chainId: 324, address: "0x493257fD37EDB33551fd94f32fbcC9C5d7D6Ac0d", symbol: "USDT", decimals: 6 },
  { chainId: 324, address: "0x5AEa5775959fBC2557Cc8789bC1bf90A239D9a91", symbol: "WETH", decimals: 18 },
];

// --- Override file I/O ---

function readOverride(): TokenOverride {
  if (!fs.existsSync(PATHS.tokensOverrideFile)) {
    return { version: 1, tokens: [] };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(PATHS.tokensOverrideFile, "utf8"));
    return tokenOverrideSchema.parse(parsed);
  } catch (e) {
    throw new Error(
      `Failed to read tokens override at ${PATHS.tokensOverrideFile}: ${(e as Error).message}`
    );
  }
}

function writeOverride(next: TokenOverride): string | null {
  ensureDir(PATHS.localConfigDir);
  const backupPath = backupFileIfExists(PATHS.tokensOverrideFile);
  fs.writeFileSync(PATHS.tokensOverrideFile, JSON.stringify(next, null, 2));
  return backupPath;
}

// --- Merge: defaults ⊕ override ---

function buildMergedList(): Token[] {
  const override = readOverride();
  // Build a key → override entry map.
  const keyOf = (chainId: number, symbol: string) => `${chainId}::${symbol.toLowerCase()}`;
  const overrideMap = new Map<string, Token>();
  for (const t of override.tokens) {
    overrideMap.set(keyOf(t.chainId, t.symbol), t);
  }

  const out: Token[] = [];
  const seen = new Set<string>();
  for (const def of DEFAULT_TOKENS) {
    const k = keyOf(def.chainId, def.symbol);
    const ov = overrideMap.get(k);
    if (ov) {
      // Override has this (chainId, symbol). Use override's address/decimals
      // (treats override as authoritative for the slot), but honor enabled.
      out.push({
        chainId: ov.chainId,
        address: ov.address,
        symbol: ov.symbol,
        decimals: ov.decimals,
        enabled: ov.enabled,
      });
    } else {
      out.push({ ...def, enabled: true });
    }
    seen.add(k);
  }
  // Any override entries that aren't in defaults (user-added tokens) get appended.
  for (const t of override.tokens) {
    const k = keyOf(t.chainId, t.symbol);
    if (seen.has(k)) continue;
    out.push({
      chainId: t.chainId,
      address: t.address,
      symbol: t.symbol,
      decimals: t.decimals,
      enabled: t.enabled,
    });
  }
  return out;
}

// --- Public API ---

export function listAllTokens(): Token[] {
  return buildMergedList();
}

export function getEnabledTokens(chainId: number): Token[] {
  return buildMergedList().filter((t) => t.chainId === chainId && t.enabled);
}

export function getTokenBySymbol(chainId: number, symbol: string): Token | null {
  const needle = symbol.trim().toLowerCase();
  return (
    buildMergedList().find(
      (t) => t.chainId === chainId && t.symbol.toLowerCase() === needle
    ) ?? null
  );
}

export function getTokenByAddress(chainId: number, address: string): Token | null {
  const needle = address.trim().toLowerCase();
  return (
    buildMergedList().find(
      (t) => t.chainId === chainId && t.address.toLowerCase() === needle
    ) ?? null
  );
}

export function findToken(chainId: number, ref: string): Token | null {
  if (/^0x[a-fA-F0-9]{40}$/.test(ref)) return getTokenByAddress(chainId, ref);
  return getTokenBySymbol(chainId, ref);
}

export function addToken(input: {
  chainId: number;
  address: string;
  symbol: string;
  decimals: number;
}): { token: Token; backupPath: string | null } {
  const candidate: Omit<Token, "enabled"> = {
    chainId: input.chainId,
    address: input.address,
    symbol: input.symbol,
    decimals: input.decimals,
  };
  // Validate
  tokenSchema.parse({ ...candidate, enabled: true });

  const current = readOverride();
  const keyOf = (chainId: number, symbol: string) => `${chainId}::${symbol.toLowerCase()}`;
  const targetKey = keyOf(candidate.chainId, candidate.symbol);

  const filtered = current.tokens.filter(
    (t) => keyOf(t.chainId, t.symbol) !== targetKey
  );
  filtered.push({ ...candidate, enabled: true });

  const backupPath = writeOverride({ version: 1, tokens: filtered });
  return { token: { ...candidate, enabled: true }, backupPath };
}

export function removeToken(chainId: number, symbol: string): {
  removed: Token | null;
  backupPath: string | null;
} {
  const current = readOverride();
  const keyOf = (chainId: number, symbol: string) => `${chainId}::${symbol.toLowerCase()}`;
  const targetKey = keyOf(chainId, symbol);

  const existing = current.tokens.find(
    (t) => keyOf(t.chainId, t.symbol) === targetKey
  );
  // If not in override, it must be a default. To remove a default we add a
  // negative entry (disabled=false is not enough; we tombstone by writing a
  // flag we can detect). Simpler: just add an override with enabled=false
  // and a sentinel. Cleanest approach: have removeToken remove the default
  // by storing an override with enabled=false and tracking it; on rebuild
  // we re-emit defaults with enabled=true. So we need a separate tombstone
  // list. To keep schema simple, treat remove of a default as: copy the
  // default to override with enabled=false (this wins because override
  // entries always win for matching chainId/symbol). If it's already an
  // override, drop it entirely so defaults re-surface if any.
  if (existing) {
    const filtered = current.tokens.filter(
      (t) => keyOf(t.chainId, t.symbol) !== targetKey
    );
    const backupPath = writeOverride({ version: 1, tokens: filtered });
    return { removed: { ...existing }, backupPath };
  }

  // Default token: copy it into the override as disabled.
  const defaults = DEFAULT_TOKENS;
  const def = defaults.find(
    (d) => keyOf(d.chainId, d.symbol) === targetKey
  );
  if (!def) {
    return { removed: null, backupPath: null };
  }
  const next = [
    ...current.tokens,
    { chainId: def.chainId, address: def.address, symbol: def.symbol, decimals: def.decimals, enabled: false },
  ];
  const backupPath = writeOverride({ version: 1, tokens: next });
  return {
    removed: { ...def, enabled: false },
    backupPath,
  };
}

export function setTokenEnabled(
  chainId: number,
  symbol: string,
  enabled: boolean
): { token: Token; backupPath: string | null } {
  const current = readOverride();
  const keyOf = (chainId: number, symbol: string) => `${chainId}::${symbol.toLowerCase()}`;
  const targetKey = keyOf(chainId, symbol);

  // Locate the token: must exist in the merged list.
  const merged = buildMergedList();
  const found = merged.find((t) => keyOf(t.chainId, t.symbol) === targetKey);
  if (!found) {
    throw new Error(`Token not found: chainId=${chainId} symbol=${symbol}`);
  }

  let nextList = current.tokens.filter(
    (t) => keyOf(t.chainId, t.symbol) !== targetKey
  );
  // Add (or replace) override entry with the desired enabled flag, using
  // the merged values for address/decimals/symbol/chainId.
  nextList = [
    ...nextList,
    {
      chainId: found.chainId,
      address: found.address,
      symbol: found.symbol,
      decimals: found.decimals,
      enabled,
    },
  ];

  const backupPath = writeOverride({ version: 1, tokens: nextList });
  return { token: { ...found, enabled }, backupPath };
}

export function enableToken(chainId: number, symbol: string) {
  return setTokenEnabled(chainId, symbol, true);
}

export function disableToken(chainId: number, symbol: string) {
  return setTokenEnabled(chainId, symbol, false);
}
