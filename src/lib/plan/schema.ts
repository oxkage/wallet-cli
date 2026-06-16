import { z } from "zod";

/**
 * Universal value parser for any numeric amount field in a plan.
 *
 * Accepted formats:
 *   "1.5"         natural units, scaled by `decimals`  (e.g. "1.5" with decimals=6 → 1500000)
 *   "wei:1234"    explicit wei (only valid for native, decimals ignored)
 *   "usd:1.50"    convert at current USD price of `symbol`
 *   "raw:1234"    explicit base units (no decimal conversion)
 *   "all"         full balance minus gas estimate (native only; requires `getBalance`)
 *   "unlimited"   MaxUint256 (only valid for approvals)
 */

export type ValueContext = {
  decimals: number;
  symbol: string;                  // e.g. "ETH" for native, "USDC" for token
  getUsdPrice?: (symbol: string) => Promise<number | null>;
  getBalance?: (address: string) => Promise<bigint>;
  reserveGas?: (address: string) => Promise<bigint>;
};

const VALUE_PATTERN = /^(wei|usd|raw):(\d+(?:\.\d+)?)$/;

export async function parseValue(input: string, ctx: ValueContext): Promise<bigint> {
  if (typeof input !== "string") throw new Error(`Value must be a string, got: ${typeof input}`);

  if (input === "unlimited") {
    return (1n << 256n) - 1n; // MaxUint256
  }

  const explicitMatch = VALUE_PATTERN.exec(input);
  if (explicitMatch) {
    const [, kind, num] = explicitMatch;
    if (kind === "wei") {
      if (!/^\d+$/.test(num)) throw new Error(`Invalid wei amount: ${input}`);
      return BigInt(num);
    }
    if (kind === "raw") {
      if (!/^\d+$/.test(num)) throw new Error(`Invalid raw amount: ${input}`);
      return BigInt(num);
    }
    if (kind === "usd") {
      if (!ctx.getUsdPrice) throw new Error("usd: value requires getUsdPrice in context");
      const price = await ctx.getUsdPrice(ctx.symbol);
      if (price === null) throw new Error(`No USD price available for ${ctx.symbol}`);
      // amount_usd / price = amount_in_symbol  → scale by decimals
      const usdScaled = decimalToBigInt(num, 18);
      const priceScaled = decimalToBigInt(String(price), 18);
      const symbolScaled = (usdScaled * 10n ** BigInt(ctx.decimals)) / priceScaled;
      return symbolScaled;
    }
  }

  if (input === "all") {
    if (!ctx.getBalance) throw new Error('"all" value requires getBalance in context');
    if (!ctx.reserveGas) throw new Error('"all" value requires reserveGas in context');
    // Caller must provide address via a separate channel; this throws by default.
    // Op implementations that support "all" must resolve the address first.
    throw new Error('"all" value resolution not yet implemented at parser level; op must resolve');
  }

  // Natural units: "1.5" → 1.5 * 10^decimals
  if (/^\d+(\.\d+)?$/.test(input)) {
    return decimalToBigInt(input, ctx.decimals);
  }

  throw new Error(`Unrecognized value format: ${input}`);
}

export function decimalToBigInt(value: string, scale: number): bigint {
  const [whole, frac = ""] = value.split(".");
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(frac)) {
    throw new Error(`Invalid decimal: ${value}`);
  }
  const fracPadded = (frac + "0".repeat(scale)).slice(0, scale);
  return BigInt(whole) * 10n ** BigInt(scale) + BigInt(fracPadded || "0");
}

export function formatValue(wei: bigint, decimals: number, precision = 6): string {
  const neg = wei < 0n;
  const abs = neg ? -wei : wei;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;
  if (frac === 0n) return (neg ? "-" : "") + whole.toString();
  let fracStr = frac.toString().padStart(decimals, "0");
  fracStr = fracStr.replace(/0+$/, "");
  if (fracStr.length > precision) fracStr = fracStr.slice(0, precision);
  return (neg ? "-" : "") + `${whole}.${fracStr}`;
}

// --- Plan schema ---

const addressSchema = z.string().refine(
  (v) => /^0x[a-fA-F0-9]{40}$/.test(v),
  "must be a 0x-prefixed 40-hex EVM address"
);

const planOptionsSchema = z
  .object({
    // Max wallets executed in parallel. Ops from the SAME wallet always run
    // sequentially (nonce ordering); only DISTINCT wallets parallelize.
    // Default 1 = strictly sequential (historical behavior).
    batchSize: z.coerce.number().int().min(1).max(50).default(1),
    // Throttle (ms) applied BETWEEN ops within the same wallet's group.
    delayMs: z.coerce.number().int().min(0).max(60000).default(0),
    skipDust: z.string().regex(/^\d+(\.\d+)?$/).optional(),
    simulate: z.boolean().default(true),
    stopOnError: z.boolean().default(false),
    dryRun: z.boolean().optional(),
  })
  .optional();

// Op schemas are registered in the ops registry. Plan schema validates
// the structure and passes each op's full params through to the registry.
const planOperationBaseSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
  })
  .passthrough();

export const planSchema = z.object({
  version: z.literal(1),
  name: z.string().optional(),
  chain: z.string().min(1),
  defaultFrom: addressSchema.optional(),
  defaultFromIndex: z.coerce.number().int().min(0).max(100000).optional(),
  operations: z.array(planOperationBaseSchema).min(1),
  options: planOptionsSchema.optional(),
});

export type Plan = z.infer<typeof planSchema>;
export type PlanOperation = z.infer<typeof planOperationBaseSchema>;
export type PlanOptions = z.infer<typeof planOptionsSchema>;
