import { z } from "zod";
import { ethers } from "ethers";
import { registerOp, type OpDefinition } from "../registry";
import { ERC20_ABI } from "../../abi/builtin";
import { findToken } from "../../tokens";
import { parseValue, formatValue } from "../../plan/schema";
import { resolveChainForOp } from "../chainResolve";

const addressSchema = z.string().refine(
  (v) => /^0x[a-fA-F0-9]{40}$/.test(v),
  "must be a 0x-prefixed 40-hex EVM address"
);

const paramsSchema = z.object({
  id: z.string().min(1),
  from: z.string().optional(),
  fromIndex: z.coerce.number().int().min(0).optional(),
  token: z.string().min(1), // symbol OR 0x address
  spender: addressSchema,
  amount: z.string().min(1), // universal value format; "unlimited" → MaxUint256
});

type Params = z.infer<typeof paramsSchema>;

async function build(params: Params, ctx: any) {
  const chain = resolveChainForOp(ctx, "erc20-approve");
  const token = findToken(chain.chainId as number, params.token);
  if (!token) {
    throw new Error(
      `Token not found for chain ${chain.name} (chainId=${chain.chainId}): ${params.token}. ` +
        `Add it via: wallet-cli collect-tokens add --chain ${chain.name} --address 0x.. --symbol .. --decimals N`
    );
  }
  if (!token.enabled) {
    throw new Error(
      `Token ${token.symbol} on ${chain.name} is disabled. Enable with: wallet-cli collect-tokens enable --chain ${chain.name} --symbol ${token.symbol}`
    );
  }

  const fromAddress = params.from;
  if (!fromAddress) throw new Error("erc20-approve: missing from address (internal: should be resolved by execute loop)");
  const signer = await ctx.resolveSigner(fromAddress);

  let amountBaseUnits: bigint;
  if (params.amount === "all") {
    amountBaseUnits = await ctx.getTokenBalance(token.address, fromAddress);
  } else {
    amountBaseUnits = await parseValue(params.amount, {
      decimals: token.decimals,
      symbol: token.symbol,
      getUsdPrice: ctx.getUsdPrice,
    });
  }

  const iface = new ethers.Interface(ERC20_ABI);
  const calldata = iface.encodeFunctionData("approve", [params.spender, amountBaseUnits]);

  const tx: any = {
    to: token.address,
    value: 0n,
    data: calldata,
    gasLimit: 65_000n,
    maxFeePerGas: ctx.fees.maxFeePerGas,
    maxPriorityFeePerGas: ctx.fees.maxPriorityFeePerGas,
  };

  const isUnlimited = amountBaseUnits === (1n << 256n) - 1n;
  const amountDisplay = isUnlimited
    ? "unlimited"
    : formatValue(amountBaseUnits, token.decimals);

  return {
    signer,
    tx,
    meta: {
      op: "erc20-approve",
      to: token.address,
      valueWei: "0",
      token: token.symbol,
      amount: amountDisplay,
      note: `approve ${amountDisplay} ${token.symbol} → spender ${params.spender} (token=${token.address}, calldata=${calldata.slice(0, 10)}...)`,
    },
  };
}

export const erc20ApproveDef: OpDefinition<Params> = registerOp({
  type: "erc20-approve",
  summary: "Approve a spender to move ERC-20 tokens from your wallet. Use 'unlimited' for MaxUint256.",
  schema: paramsSchema,
  example: {
    id: "approve-1",
    type: "erc20-approve",
    token: "USDC",
    spender: "0x0000000000000000000000000000000000c0FFee",
    amount: "unlimited",
  },
  build,
  describe: () => ({
    type: "erc20-approve",
    summary: "Approve a spender for an ERC-20 amount",
    schema: paramsSchema._def,
    example: {
      id: "approve-1",
      type: "erc20-approve",
      token: "USDC",
      spender: "0xROUTER",
      amount: "unlimited",
    },
  }),
});
