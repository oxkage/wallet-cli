import { getUsdPrice } from "./usd";

/**
 * Gas-cost computation for history display.
 *
 * Every EVM tx receipt gives us gasUsed (units) and effectiveGasPrice (wei per
 * unit). The fee paid in native currency is simply gasUsed × effectiveGasPrice,
 * denominated in wei (18 decimals on every EVM chain). USD value = native ×
 * spot price of the chain's native token.
 */

/** chainId → native gas token symbol. Defaults to ETH (all the ETH L2s). */
const NATIVE_SYMBOL: Record<string, string> = {
  "1": "ETH",
  "8453": "ETH", // Base
  "42161": "ETH", // Arbitrum
  "10": "ETH", // Optimism
  "534352": "ETH", // Scroll
  "59144": "ETH", // Linea
  "81457": "ETH", // Blast
  "34443": "ETH", // Mode
  "7777777": "ETH", // Zora
  "324": "ETH", // zkSync Era
  "137": "POL", // Polygon (MATIC→POL)
  "56": "BNB", // BSC
  "43114": "AVAX", // Avalanche
  "250": "FTM", // Fantom
  "100": "XDAI", // Gnosis
  "42220": "CELO", // Celo
  "1284": "GLMR", // Moonbeam
  "25": "CRO", // Cronos
  "1088": "METIS", // Metis
  "5000": "MNT", // Mantle
};

/** Resolve the native gas-token symbol for a chainId (string or number). */
export function nativeSymbolForChain(chainId: string | number): string {
  return NATIVE_SYMBOL[String(chainId)] ?? "ETH";
}

/**
 * Fee in wei for a tx. Returns null when either field is missing (e.g. dry-run
 * or pre-confirmation entries that never got a receipt).
 */
export function gasFeeWei(gasUsed?: string, effectiveGasPrice?: string): bigint | null {
  if (!gasUsed || !effectiveGasPrice) return null;
  try {
    return BigInt(gasUsed) * BigInt(effectiveGasPrice);
  } catch {
    return null;
  }
}

/** Format wei as a native-unit decimal string (18 decimals), trimmed. */
export function weiToNativeString(wei: bigint, maxFrac = 8): string {
  const negative = wei < 0n;
  const abs = negative ? -wei : wei;
  const whole = abs / 10n ** 18n;
  const frac = abs % 10n ** 18n;
  let fracStr = frac.toString().padStart(18, "0").slice(0, maxFrac).replace(/0+$/, "");
  const out = fracStr.length > 0 ? `${whole}.${fracStr}` : `${whole}`;
  return negative ? `-${out}` : out;
}

/** USD value of a wei fee at a given native-token spot price. */
export function gasFeeUsd(wei: bigint, nativePriceUsd: number): number {
  // wei / 1e18 × price. Use Number for display-level precision (fees are small).
  return (Number(wei) / 1e18) * nativePriceUsd;
}

/**
 * Fetch the spot USD price for a set of native symbols (deduped). Returns a map
 * symbol→price; entries are omitted when the price is unavailable (the usd
 * helper currently supports ETH/BTC, others resolve to null).
 */
export async function fetchNativePrices(symbols: string[]): Promise<Record<string, number>> {
  const unique = [...new Set(symbols)];
  const out: Record<string, number> = {};
  await Promise.all(
    unique.map(async (sym) => {
      const price = await getUsdPrice(sym);
      if (price !== null) out[sym] = price;
    })
  );
  return out;
}
