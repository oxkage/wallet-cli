import { ethers } from "ethers";
import { deriveEvmWalletRange } from "../wallets";
import { findToken } from "../tokens";

/**
 * Batch balance scanner. Reads native + (optional) ERC-20 balances for every
 * wallet in a derivation range, with bounded concurrency. This is the FACTUAL
 * input for sweep/distribute decisions — the agent reads these numbers from
 * chain state instead of guessing them.
 *
 * Output is base-units (string) + human-readable, plus per-asset totals.
 */

const ERC20_BALANCE_IFACE = new ethers.Interface([
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

export interface ScanAssetBalance {
  asset: string; // "native" or token symbol
  address?: string; // token contract (omitted for native)
  decimals: number;
  raw: string; // base units
  formatted: string; // human-readable
}

export interface ScanWalletRow {
  index: number;
  address: string;
  balances: ScanAssetBalance[];
}

export interface ScanResult {
  chain: string;
  chainId: number;
  fromIndex: number;
  toIndex: number;
  assets: string[];
  wallets: ScanWalletRow[];
  totals: Record<string, { raw: string; formatted: string; decimals: number }>;
  nonZeroCount: number;
}

export interface ScanOpts {
  chainName: string;
  chainId: number;
  rpcUrl: string;
  fromIndex: number;
  toIndex: number;
  /** Assets to read: "native" and/or token symbols/addresses. */
  include: string[];
  /** Max concurrent wallet reads. Default 5 (public-RPC friendly). */
  concurrency?: number;
  /** Include wallets whose balances are all zero. Default false. */
  showZero?: boolean;
}

type ResolvedAsset =
  | { kind: "native"; symbol: string; decimals: number }
  | { kind: "erc20"; symbol: string; address: string; decimals: number };

function resolveAssets(chainId: number, include: string[]): ResolvedAsset[] {
  const out: ResolvedAsset[] = [];
  for (const raw of include) {
    const ref = raw.trim();
    if (ref.length === 0) continue;
    if (ref.toLowerCase() === "native") {
      out.push({ kind: "native", symbol: "native", decimals: 18 });
      continue;
    }
    const token = findToken(chainId, ref);
    if (!token) {
      throw new Error(
        `Token "${ref}" not found on chainId ${chainId}. Register it or use its 0x address.`
      );
    }
    out.push({ kind: "erc20", symbol: token.symbol, address: token.address, decimals: token.decimals });
  }
  if (out.length === 0) throw new Error("include resolved to no assets");
  return out;
}

async function readNative(provider: ethers.JsonRpcProvider, address: string): Promise<bigint> {
  return provider.getBalance(address);
}

async function readErc20(
  provider: ethers.JsonRpcProvider,
  token: string,
  holder: string
): Promise<bigint> {
  const data = ERC20_BALANCE_IFACE.encodeFunctionData("balanceOf", [holder]);
  const result = await provider.call({ to: token, data });
  return BigInt(result);
}

/** Bounded-concurrency map (same pattern as the op scheduler, kept local). */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const n = Math.max(1, Math.min(limit, items.length || 1));
  async function worker(): Promise<void> {
    while (true) {
      const i = cursor;
      cursor += 1;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

export async function scanBalances(opts: ScanOpts): Promise<ScanResult> {
  if (opts.toIndex < opts.fromIndex) throw new Error("toIndex must be >= fromIndex");
  const provider = new ethers.JsonRpcProvider(opts.rpcUrl);
  const assets = resolveAssets(opts.chainId, opts.include);
  const wallets = deriveEvmWalletRange(opts.fromIndex, opts.toIndex);

  const rows = await mapLimit(wallets, opts.concurrency ?? 5, async (w) => {
    const balances: ScanAssetBalance[] = [];
    for (const a of assets) {
      const raw =
        a.kind === "native"
          ? await readNative(provider, w.address)
          : await readErc20(provider, a.address, w.address);
      balances.push({
        asset: a.symbol,
        address: a.kind === "erc20" ? a.address : undefined,
        decimals: a.decimals,
        raw: raw.toString(),
        formatted: ethers.formatUnits(raw, a.decimals),
      });
    }
    return { index: w.index, address: w.address, balances };
  });

  // Totals per asset
  const totals: ScanResult["totals"] = {};
  for (const a of assets) {
    let sum = 0n;
    for (const row of rows) {
      const b = row.balances.find((x) => x.asset === a.symbol);
      if (b) sum += BigInt(b.raw);
    }
    totals[a.symbol] = { raw: sum.toString(), formatted: ethers.formatUnits(sum, a.decimals), decimals: a.decimals };
  }

  const filtered = opts.showZero
    ? rows
    : rows.filter((r) => r.balances.some((b) => BigInt(b.raw) > 0n));

  return {
    chain: opts.chainName,
    chainId: opts.chainId,
    fromIndex: opts.fromIndex,
    toIndex: opts.toIndex,
    assets: assets.map((a) => a.symbol),
    wallets: filtered,
    totals,
    nonZeroCount: filtered.length,
  };
}
