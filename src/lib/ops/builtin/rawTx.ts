import { z } from "zod";
import type { ZodTypeAny } from "zod";
import { registerOp, type OpDefinition } from "../registry";

const paramsSchema = z.object({
  id: z.string().min(1),
  from: z.string().optional(),
  fromIndex: z.coerce.number().int().min(0).optional(),
  to: z.string().refine((v) => /^0x[a-fA-F0-9]{40}$/.test(v), "invalid to address"),
  data: z.string().regex(/^0x[0-9a-fA-F]+$/, "data must be 0x-prefixed hex with at least one byte"),
  value: z.string().regex(/^(0|wei:\d+)$/, "value must be '0' or 'wei:N' for raw-tx").default("0"),
  gasLimit: z.string().regex(/^\d+$/).optional(),
});

type Params = z.infer<typeof paramsSchema>;

async function build(params: Params, ctx: any) {
  const fromAddress = params.from ?? throwMissingFrom();
  const signer = await ctx.resolveSigner(fromAddress);

  const valueWei = params.value === "0" ? 0n : BigInt(params.value.slice(4));

  const tx: any = {
    to: params.to,
    value: valueWei,
    data: params.data,
    gasLimit: params.gasLimit ? BigInt(params.gasLimit) : undefined,
    maxFeePerGas: ctx.fees.maxFeePerGas,
    maxPriorityFeePerGas: ctx.fees.maxPriorityFeePerGas,
  };

  return {
    signer,
    tx,
    meta: {
      op: "raw-tx",
      to: params.to,
      valueWei: valueWei.toString(),
      note: `data=${params.data.slice(0, 18)}${params.data.length > 18 ? "..." : ""} (${(params.data.length - 2) / 2} bytes)`,
    },
  };
}

function throwMissingFrom(): never {
  throw new Error("raw-tx op requires from: 0x...");
}

export const rawTxDef: OpDefinition<Params> = registerOp<Params>({
  type: "raw-tx",
  summary: "Sign and broadcast a fully manual EIP-1559 tx with raw calldata",
  schema: paramsSchema as unknown as ZodTypeAny as OpDefinition<Params>["schema"],
  example: {
    id: "raw-1",
    type: "raw-tx",
    from: "0x0000000000000000000000000000000000c0FFee",
    to: "0x000000000000000000000000000000000000dEaD",
    data: "0xa9059cbb000000000000000000000000000000000000000000000000000000000000dEaD00000000000000000000000000000000000000000000000000000000000f4240",
    value: "0",
  },
  build,
  describe: () => ({
    type: "raw-tx",
    summary: "Raw EIP-1559 tx with calldata",
    schema: paramsSchema._def,
    example: { id: "raw-1", type: "raw-tx", to: "0x000000000000000000000000000000000000dEaD", data: "0x", value: "0" },
  }),
});
