import { z } from "zod";
import { ethers } from "ethers";
import { registerOp, type OpDefinition } from "../registry";
import { decimalToBigInt, formatValue } from "../../plan/schema";

const paramsSchema = z.object({
  id: z.string().min(1),
  from: z.string().optional(),                  // 0x... (inherits plan.defaultFrom)
  fromIndex: z.coerce.number().int().min(0).optional(),
  to: z.string().refine((v) => /^0x[a-fA-F0-9]{40}$/.test(v), "invalid to address"),
  value: z.string().min(1),                      // universal value format
  gasPriceMode: z.enum(["slow", "normal", "fast"]).optional(),
  data: z.string().regex(/^0x[0-9a-fA-F]*$/).optional(),
});

type Params = z.infer<typeof paramsSchema>;

async function build(params: Params, ctx: any) {
  const fromAddress = params.from ?? resolveFromParam(ctx, params.fromIndex);
  const signer = await ctx.resolveSigner(fromAddress);
  const provider = ctx.provider;

  // Parse value
  const valueWei = await parseNativeValue(params.value, signer.address, ctx);

  const tx: any = {
    to: params.to,
    value: valueWei,
    data: params.data,
    gasLimit: 21000n,  // will be re-estimated by execute loop
    maxFeePerGas: ctx.fees.maxFeePerGas,
    maxPriorityFeePerGas: ctx.fees.maxPriorityFeePerGas,
  };

  return {
    signer,
    tx,
    meta: {
      op: "native-send",
      to: params.to,
      valueWei: valueWei.toString(),
      note: `value=${params.value} (${formatValue(valueWei, 18)} ETH)`,
    },
  };
}

async function parseNativeValue(input: string, address: string, ctx: any): Promise<bigint> {
  // "all" → full balance minus gas estimate
  if (input === "all") {
    const balance = await ctx.provider.getBalance(address);
    const gasEstimate = 21000n * ctx.fees.maxFeePerGas;
    if (balance <= gasEstimate) throw new Error(`Balance too low to cover gas: have ${balance}, need ${gasEstimate}`);
    return balance - gasEstimate;
  }

  // "wei:N" → explicit
  const weiMatch = /^wei:(\d+)$/.exec(input);
  if (weiMatch) return BigInt(weiMatch[1]);

  // "usd:N" → convert via ETH price
  const usdMatch = /^usd:(\d+(?:\.\d+)?)$/.exec(input);
  if (usdMatch) {
    const price = await ctx.getUsdPrice("ETH");
    if (price === null) throw new Error("No ETH/USD price available");
    const usdScaled = decimalToBigInt(usdMatch[1], 18);
    const priceScaled = decimalToBigInt(String(price), 18);
    return (usdScaled * 10n ** 18n) / priceScaled;
  }

  // "raw:N" → wei directly
  const rawMatch = /^raw:(\d+)$/.exec(input);
  if (rawMatch) return BigInt(rawMatch[1]);

  // plain decimal "1.5" → 1.5 * 10^18
  if (/^\d+(\.\d+)?$/.test(input)) {
    return decimalToBigInt(input, 18);
  }

  throw new Error(`Unrecognized value format: ${input}`);
}

function resolveFromParam(ctx: any, fromIndex?: number): string {
  // This is called only if params.from is missing. The execute loop should
  // have already resolved defaultFrom / defaultFromIndex from the plan level.
  // We throw here to surface the bug clearly.
  throw new Error(
    `native-send op missing 'from' and no plan-level defaultFrom. ` +
      `Provide from: "0x..." on the op or defaultFrom on the plan.`
  );
}

export const nativeSendDef: OpDefinition<Params> = registerOp({
  type: "native-send",
  summary: "Send the chain's native gas token (ETH/MATIC/etc.) from one wallet to another",
  schema: paramsSchema,
  example: {
    id: "send-1",
    type: "native-send",
    to: "0x000000000000000000000000000000000000dEaD",
    value: "0.01",
  },
  build,
  describe: () => ({
    type: "native-send",
    summary: "Send the chain's native gas token",
    schema: paramsSchema._def,
    example: { id: "send-1", type: "native-send", to: "0x000000000000000000000000000000000000dEaD", value: "0.01" },
  }),
});
