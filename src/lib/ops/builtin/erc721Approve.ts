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

// Two ERC-721 approval modes:
//  - single token: provide `tokenId`, approves the spender for that one NFT
//  - collection-wide: omit `tokenId` (or set `all:true`), uses setApprovalForAll
// Defaults and the "tokenId OR all" rule are enforced in build() to keep the
// schema's input and output types identical (required by OpDefinition<P>).
const paramsSchema = z.object({
  id: z.string().min(1),
  from: z.string().optional(),
  fromIndex: z.coerce.number().int().min(0).optional(),
  contract: addressSchema, // the NFT collection address
  spender: addressSchema, // operator / approved address
  tokenId: tokenIdSchema.optional(),
  all: z.boolean().optional(), // collection-wide approval
  // For setApprovalForAll: grant (true) or revoke (false). Defaults to grant.
  approved: z.boolean().optional(),
});

type Params = z.infer<typeof paramsSchema>;

async function build(params: Params, ctx: any) {
  const chain = resolveChainForOp(ctx, "erc721-approve");

  if (!params.all && params.tokenId === undefined) {
    throw new Error(
      "erc721-approve: provide either tokenId (single-NFT approve) or all:true (collection-wide setApprovalForAll)"
    );
  }

  const fromAddress = params.from;
  if (!fromAddress) throw new Error("erc721-approve: missing from address (internal: should be resolved by execute loop)");
  const signer = await ctx.resolveSigner(fromAddress);

  const iface = new ethers.Interface(ERC721_ABI);

  const collectionWide = params.all === true || params.tokenId === undefined;
  const approved = params.approved ?? true;

  let calldata: string;
  let note: string;
  let amountDisplay: string;

  if (collectionWide) {
    calldata = iface.encodeFunctionData("setApprovalForAll", [params.spender, approved]);
    const verb = approved ? "grant" : "revoke";
    amountDisplay = approved ? "all" : "none";
    note = `setApprovalForAll ${verb} operator ${params.spender} for ALL of ${params.contract} on ${chain.name} (calldata=${calldata.slice(0, 10)}...)`;
  } else {
    const tokenId = BigInt(params.tokenId as string);
    calldata = iface.encodeFunctionData("approve", [params.spender, tokenId]);
    amountDisplay = `#${tokenId}`;
    note = `approve spender ${params.spender} for NFT #${tokenId} of ${params.contract} on ${chain.name} (calldata=${calldata.slice(0, 10)}...)`;
  }

  const tx: any = {
    to: params.contract,
    value: 0n,
    data: calldata,
    gasLimit: 70_000n,
    maxFeePerGas: ctx.fees.maxFeePerGas,
    maxPriorityFeePerGas: ctx.fees.maxPriorityFeePerGas,
  };

  return {
    signer,
    tx,
    meta: {
      op: "erc721-approve",
      to: params.contract,
      valueWei: "0",
      token: amountDisplay,
      amount: amountDisplay,
      note,
    },
  };
}

export const erc721ApproveDef: OpDefinition<Params> = registerOp({
  type: "erc721-approve",
  summary:
    "Approve a spender for an ERC-721 NFT. Provide tokenId for a single NFT (approve), or all:true for collection-wide (setApprovalForAll). Set approved:false to revoke a collection-wide grant.",
  schema: paramsSchema,
  example: {
    id: "nft-approve-1",
    type: "erc721-approve",
    contract: "0x0000000000000000000000000000000000C0FFEE",
    spender: "0x0000000000000000000000000000000000000ABc",
    all: true,
  },
  build,
  describe: () => ({
    type: "erc721-approve",
    summary: "Approve a spender for one NFT (tokenId) or a whole collection (all:true)",
    schema: paramsSchema._def,
    example: {
      id: "nft-approve-1",
      type: "erc721-approve",
      contract: "0x0000000000000000000000000000000000C0FFEE",
      spender: "0xMARKETPLACE",
      all: true,
      approved: true,
    },
  }),
});
