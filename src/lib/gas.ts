import { ethers } from "ethers";

export type GasMode = "slow" | "normal" | "fast" | { maxGwei: number };

export type ResolvedFees = {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  mode: GasMode;
  baseFeePerGas: bigint | null;
};

// Tip multipliers per mode. Network-provided tip is multiplied; fallback tip is absolute.
const MODE_TIP_MULTIPLIER: Record<"slow" | "normal" | "fast", number> = {
  slow: 0.8,
  normal: 1.0,
  fast: 1.8,
};

const FALLBACK_TIP_GWEI: Record<"slow" | "normal" | "fast", string> = {
  slow: "0.05",
  normal: "0.1",
  fast: "0.5",
};

function isModeObject(m: GasMode): m is { maxGwei: number } {
  return typeof m === "object" && m !== null && "maxGwei" in m;
}

/**
 * Resolve EIP-1559 fees for the current chain state.
 *
 * Modes:
 *   "slow"   → low tip, ~80% of network tip (or 0.05 gwei fallback)
 *   "normal" → network tip (or 0.1 gwei fallback) — matches tx send's prior behavior
 *   "fast"   → ~1.8x network tip (or 0.5 gwei fallback)
 *   { maxGwei } → use that value as maxPriorityFeePerGas (explicit override)
 *
 * maxFeePerGas is always `baseFee*2 + priorityTip` to absorb 1 block of base-fee drift.
 */
export async function resolveFees(
  provider: ethers.JsonRpcProvider,
  mode: GasMode = "normal"
): Promise<ResolvedFees> {
  const feeData = await provider.getFeeData();
  let baseFee: bigint | null = null;
  let maxPriorityFeePerGas: bigint;

  if (isModeObject(mode)) {
    maxPriorityFeePerGas = ethers.parseUnits(String(mode.maxGwei), "gwei");
  } else {
    const netTip = feeData.maxPriorityFeePerGas ?? ethers.parseUnits(FALLBACK_TIP_GWEI[mode], "gwei");
    const multiplier = MODE_TIP_MULTIPLIER[mode];
    maxPriorityFeePerGas = (netTip * BigInt(Math.round(multiplier * 100))) / 100n;
  }

  if (feeData.maxFeePerGas) {
    baseFee = (feeData.maxFeePerGas - (feeData.maxPriorityFeePerGas ?? 0n)) || null;
    return { maxFeePerGas: feeData.maxFeePerGas, maxPriorityFeePerGas, mode, baseFeePerGas: baseFee };
  }

  const latest = await provider.getBlock("latest");
  baseFee = latest?.baseFeePerGas ?? null;
  if (baseFee === null) {
    // Pre-EIP-1559 or unknown: just use priority as total
    return { maxFeePerGas: maxPriorityFeePerGas, maxPriorityFeePerGas, mode, baseFeePerGas: null };
  }
  const maxFeePerGas = baseFee * 2n + maxPriorityFeePerGas;
  return { maxFeePerGas, maxPriorityFeePerGas, mode, baseFeePerGas: baseFee };
}

/**
 * Estimate gas for a tx, with a 20% safety buffer.
 */
export async function estimateGasWithBuffer(
  provider: ethers.JsonRpcProvider,
  req: ethers.TransactionRequest,
  bufferPct = 20
): Promise<bigint> {
  const estimated = await provider.estimateGas(req);
  return (estimated * BigInt(100 + bufferPct)) / 100n;
}
