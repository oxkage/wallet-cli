import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { PATHS } from "./paths";
import { ensureDir } from "./backup";

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 min

const cacheEntrySchema = z.object({
  price: z.number().positive(),
  fetchedAt: z.string(),
});

const priceCacheSchema = z.object({
  version: z.literal(1),
  ttlMs: z.number().int().positive().default(DEFAULT_TTL_MS),
  prices: z.record(z.string().toUpperCase(), cacheEntrySchema),
});

type PriceCache = z.infer<typeof priceCacheSchema>;

function readCache(): PriceCache {
  const file = PATHS.priceCacheFile;
  if (!fs.existsSync(file)) return { version: 1, ttlMs: DEFAULT_TTL_MS, prices: {} };
  try {
    const raw = fs.readFileSync(file, "utf8");
    return priceCacheSchema.parse(JSON.parse(raw));
  } catch {
    return { version: 1, ttlMs: DEFAULT_TTL_MS, prices: {} };
  }
}

function writeCache(cache: PriceCache): void {
  ensureDir(PATHS.localConfigDir);
  fs.writeFileSync(PATHS.priceCacheFile, JSON.stringify(cache, null, 2));
}

function isFresh(entry: { fetchedAt: string }, ttlMs: number): boolean {
  const age = Date.now() - new Date(entry.fetchedAt).getTime();
  return age < ttlMs;
}

// --- Providers (Phase 1: ETH only via Coinbase; others return null) ---

async function fetchCoinbase(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(`https://api.coinbase.com/v2/prices/${symbol}-USD/spot`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: { amount?: string } };
    const amount = json?.data?.amount;
    return amount ? parseFloat(amount) : null;
  } catch {
    return null;
  }
}

const COINBASE_SYMBOLS = new Set(["ETH", "BTC"]);

async function fetchFromProvider(symbol: string): Promise<number | null> {
  const upper = symbol.toUpperCase();
  if (COINBASE_SYMBOLS.has(upper)) return fetchCoinbase(upper);
  // Phase 1 stub: only ETH and BTC supported via provider. Tokens will be added in Phase 3.
  return null;
}

// --- Public API ---

/**
 * Get the current USD price for a symbol. Returns null on failure (network or unsupported).
 * Cached to disk with TTL.
 */
export async function getUsdPrice(symbol: string, opts: { ttlMs?: number; noCache?: boolean } = {}): Promise<number | null> {
  const upper = symbol.toUpperCase();
  const cache = readCache();
  const ttl = opts.ttlMs ?? cache.ttlMs;

  if (!opts.noCache) {
    const hit = cache.prices[upper];
    if (hit && isFresh(hit, ttl)) return hit.price;
  }

  const price = await fetchFromProvider(upper);
  if (price === null) {
    // Return stale cache if we have it (offline mode)
    return cache.prices[upper]?.price ?? null;
  }

  cache.prices[upper] = { price, fetchedAt: new Date().toISOString() };
  writeCache(cache);
  return price;
}

/**
 * Backward-compatible: returns ETH/USD price as a string with full precision (Coinbase format).
 * Used by the existing tx send flow which parses it as a decimal.
 */
export async function getEthUsdPriceString(): Promise<string> {
  const price = await getUsdPrice("ETH", { noCache: true });
  if (price === null) throw new Error("Failed price fetch: no ETH/USD response");
  return price.toString();
}

// --- Decimal math helpers (used by value/amount parsing in plan runtime) ---

export function decimalToBigInt(value: string, scale: number): bigint {
  const [whole, frac = ""] = value.split(".");
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(frac)) {
    throw new Error(`Invalid decimal: ${value}`);
  }
  const fracPadded = (frac + "0".repeat(scale)).slice(0, scale);
  return BigInt(whole) * 10n ** BigInt(scale) + BigInt(fracPadded || "0");
}
