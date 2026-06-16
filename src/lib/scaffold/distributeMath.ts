/**
 * Distribution split math — PURE, deterministic, integer-only.
 *
 * This is the calculation the agent must NOT do in its head. Given a total
 * amount (in base units: wei or token base units) and a recipient count, it
 * computes exactly how much each recipient gets, preserving the invariant:
 *
 *     sum(amounts) === total           (equal, jitter)
 *     sum(amounts) === perWallet*count (fixed)
 *
 * All arithmetic is BigInt — no floats, no rounding drift, no lost wei.
 */

export type SplitStrategy = "equal" | "jitter" | "fixed";

export interface DistributeMathOpts {
  strategy: SplitStrategy;
  /** Recipient count. Must be >= 1. */
  count: number;
  /** Total base units to split (equal / jitter). Ignored for fixed. */
  total?: bigint;
  /** Per-recipient base units (fixed strategy only). */
  perWallet?: bigint;
  /** Jitter strategy: ± percentage variation, 0–95. Default 20. */
  jitterPct?: number;
  /** Optional seed for deterministic jitter (tests / reproducibility). */
  seed?: number;
}

export interface DistributeResult {
  amounts: bigint[];
  /** Total actually allocated. For equal/jitter == input total; for fixed == perWallet*count. */
  allocated: bigint;
  strategy: SplitStrategy;
}

/** Deterministic PRNG (mulberry32) so jitter is reproducible when seeded. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function computeDistribution(opts: DistributeMathOpts): DistributeResult {
  const { strategy, count } = opts;
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`count must be a positive integer, got: ${count}`);
  }

  if (strategy === "fixed") {
    const per = opts.perWallet;
    if (per === undefined) throw new Error("fixed strategy requires perWallet");
    if (per <= 0n) throw new Error(`perWallet must be > 0, got: ${per}`);
    const amounts = new Array<bigint>(count).fill(per);
    return { amounts, allocated: per * BigInt(count), strategy };
  }

  const total = opts.total;
  if (total === undefined) throw new Error(`${strategy} strategy requires total`);
  if (total <= 0n) throw new Error(`total must be > 0, got: ${total}`);
  const n = BigInt(count);

  if (strategy === "equal") {
    const base = total / n;
    if (base <= 0n) {
      throw new Error(`total (${total}) too small to split across ${count} recipients`);
    }
    const remainder = total - base * n;
    // Spread the remainder one base-unit at a time across the first R recipients.
    // Preserves the exact total — no wei is lost or invented.
    const amounts = Array.from({ length: count }, (_, i) =>
      i < Number(remainder) ? base + 1n : base
    );
    return { amounts, allocated: total, strategy };
  }

  // jitter: equal base, perturbed ±jitterPct, with the LAST recipient acting as
  // the balancer so the sum stays exactly `total`.
  const jitterPct = opts.jitterPct ?? 20;
  if (jitterPct < 0 || jitterPct > 95) {
    throw new Error(`jitterPct must be 0–95, got: ${jitterPct}`);
  }
  const base = total / n;
  if (base <= 0n) {
    throw new Error(`total (${total}) too small to split across ${count} recipients`);
  }
  if (count === 1) {
    return { amounts: [total], allocated: total, strategy };
  }

  const rng = mulberry32(opts.seed ?? 0x9e3779b9);
  const amounts: bigint[] = [];
  let allocatedSoFar = 0n;

  // Jitter all but the last; scale the delta by basis points for integer math.
  for (let i = 0; i < count - 1; i += 1) {
    // factor in [-jitterPct, +jitterPct] percent, as integer basis points
    const bps = Math.round((rng() * 2 - 1) * jitterPct * 100); // ±jitterPct%, in bps
    const delta = (base * BigInt(bps)) / 10000n;
    let amt = base + delta;
    if (amt < 0n) amt = 0n;
    amounts.push(amt);
    allocatedSoFar += amt;
  }

  const balancer = total - allocatedSoFar;
  if (balancer < 0n) {
    throw new Error(
      `jitter ${jitterPct}% overshot the total across ${count} recipients; ` +
        `lower --jitter or use --split equal`
    );
  }
  amounts.push(balancer);
  return { amounts, allocated: total, strategy };
}
