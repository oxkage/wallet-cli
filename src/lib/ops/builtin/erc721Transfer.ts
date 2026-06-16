import { z } from "zod";
import { ethers } from "ethers";
import { registerOp, type OpDefinition } from "../registry";
import { ERC721_ABI } from "../../abi/builtin";
import { resolveChainForOp } from "../chainResolve";

const addressSchema = z.string().refine(
  (v) => /^0x[a-fA-F0-9]{40}$/.test(v),
  "must be a 0x-prefixed 40-hex EVM address"
);

// tokenId as a string only — JSON numbers lose precision above 2^53 and NFT
// ids routinely exceed that. Accept a decimal or 0x-hex integer string.
const tokenIdSchema = z
  .string()
  .refine((v) => /^(0x[0-9a-fA-F]+|\d+)$/.test(v), "tokenId must be a decimal or 0x-hex integer string");

const paramsSchema = z.object({
  id: z.string().min(1),
  from: z.string().optional(),
  fromIndex: z.coerce.number().int().min(0).optional(),
  contract: addressSchema, // the NFT collection address
  tokenId: tokenIdSchema,
  to: addressSchema,
  // ERC-721 safeTransferFrom invokes onERC721Received on contract recipients.
  // Defaults to true (safe) in build(). Set false to use plain transferFrom
  // (e.g. when the recipient is a contract without the receiver hook).
  safe: z.boolean().optional(),
});

type Params = z.infer<typeof paramsSchema>;

async function build(params: Params, ctx: any) {
  const chain = resolveChainForOp(ctx, "erc721-transfer");

  const fromAddress = params.from;
  if (!fromAddress) throw new Error("erc721-transfer: missing from address (internal: should be resolved by execute loop)");

  const tokenId = BigInt(params.tokenId);
  const iface = new ethers.Interface(ERC721_ABI);

  // Verify the signer actually owns the token before building the tx. This
  // catches the most common NFT-transfer mistake (wrong wallet / wrong id)
  // offline-ish, before spending gas on a guaranteed revert.
  try {
    const ownerData = iface.encodeFunctionData("ownerOf", [tokenId]);
    const ownerResult = await ctx.provider.call({ to: params.contract, data: ownerData });
    const [owner] = iface.decodeFunctionResult("ownerOf", ownerResult);
    if (String(owner).toLowerCase() !== fromAddress.toLowerCase()) {
      throw new Error(
        `erc721-transfer: ${fromAddress} does not own tokenId ${tokenId} of ${params.contract} on ${chain.name} (current owner: ${owner})`
      );
    }
  } catch (e: any) {
    // A revert on ownerOf usually means the token doesn't exist on this chain.
    if (e?.message?.startsWith("erc721-transfer:")) throw e;
    throw new Error(
      `erc721-transfer: could not read ownerOf(${tokenId}) on ${params.contract} (${chain.name}). ` +
        `Verify the contract address, tokenId, and chain. Underlying: ${e?.shortMessage ?? e?.message ?? e}`
    );
  }

  const signer = await ctx.resolveSigner(fromAddress);

  // safe defaults to true (use safeTransferFrom) when omitted.
  const useSafe = params.safe ?? true;
  const fn = useSafe ? "safeTransferFrom" : "transferFrom";
  const calldata = iface.encodeFunctionData(fn, [fromAddress, params.to, tokenId]);

  const tx: any = {
    to: params.contract,
    value: 0n,
    data: calldata,
    // ERC-721 transfers vary widely (receiver hooks, enumerable updates).
    // 120k is a safe ceiling for the common case; the node will refund unused.
    gasLimit: 120_000n,
    maxFeePerGas: ctx.fees.maxFeePerGas,
    maxPriorityFeePerGas: ctx.fees.maxPriorityFeePerGas,
  };

  return {
    signer,
    tx,
    meta: {
      op: "erc721-transfer",
      to: params.contract,
      valueWei: "0",
      token: `#${tokenId}`,
      amount: "1",
      note: `${fn} NFT #${tokenId} of ${params.contract} → ${params.to} (calldata=${calldata.slice(0, 10)}...)`,
    },
  };
}

export const erc721TransferDef: OpDefinition<Params> = registerOp({
  type: "erc721-transfer",
  summary:
    "Transfer an ERC-721 NFT (contract + tokenId) to an address. Verifies ownership first. Uses safeTransferFrom by default; set safe:false for plain transferFrom.",
  schema: paramsSchema,
  example: {
    id: "nft-1",
    type: "erc721-transfer",
    contract: "0x0000000000000000000000000000000000C0FFEE",
    tokenId: "1234",
    to: "0x000000000000000000000000000000000000BEEf",
  },
  build,
  describe: () => ({
    type: "erc721-transfer",
    summary: "Transfer an ERC-721 NFT to an address (verifies ownership)",
    schema: paramsSchema._def,
    example: {
      id: "nft-1",
      type: "erc721-transfer",
      contract: "0x0000000000000000000000000000000000C0FFEE",
      tokenId: "1234",
      to: "0x000000000000000000000000000000000000BEEf",
      safe: true,
    },
  }),
});
