import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ZodTypeAny } from "zod";
import { ethers } from "ethers";
import { registerOp, type OpDefinition } from "../registry";
import { BUILTIN_ABIS } from "../../abi/builtin";
import { resolveChainForOp } from "../chainResolve";

const addressSchema = z.string().refine(
  (v) => /^0x[a-fA-F0-9]{40}$/.test(v),
  "must be a 0x-prefixed 40-hex EVM address"
);

const paramsSchema = z.object({
  id: z.string().min(1),
  from: z.string().optional(),
  fromIndex: z.coerce.number().int().min(0).optional(),
  to: addressSchema,
  abi: z.string().min(1),          // alias ("erc20"/"erc721"/"permit2"), file path, or inline JSON
  fn: z.string().min(1),            // e.g. "transfer(address,uint256)"
  args: z.array(z.string()).default([]),
  value: z.string().regex(/^(0|wei:\d+)$/).default("0"),
});

type Params = z.infer<typeof paramsSchema>;

/**
 * Resolve the `abi` field into an ethers Interface.
 *
 * Resolution order:
 *   1. Alias match against BUILTIN_ABIS (case-insensitive)
 *   2. Path on disk (absolute, or relative to cwd) — read file and JSON.parse
 *   3. Inline JSON — JSON.parse the string itself
 */
function resolveAbiString(input: string): string {
  const alias = input.trim().toLowerCase();
  if (BUILTIN_ABIS[alias]) return BUILTIN_ABIS[alias];

  // Heuristic: if it looks like a file path (contains "/" or "\" or ends with
  // .json), try to read it. We deliberately do this BEFORE JSON.parse so a
  // literal JSON array that happens to contain "/" doesn't get misread.
  const looksLikePath =
    input.includes("/") ||
    input.includes("\\") ||
    /\.json$/i.test(input.trim());

  if (looksLikePath) {
    const resolved = path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);
    if (!fs.existsSync(resolved)) {
      throw new Error(
        `abi: not a known alias (${Object.keys(BUILTIN_ABIS).join(", ")}), and file does not exist at ${resolved}`
      );
    }
    const raw = fs.readFileSync(resolved, "utf8");
    // Validate that the file contents parse as ABI JSON. Return the raw text
    // (ethers.Interface will parse it again, but this catches errors early).
    JSON.parse(raw);
    return raw;
  }

  // Otherwise, treat the input itself as inline JSON.
  JSON.parse(input); // validate
  return input;
}

async function build(params: Params, ctx: any) {
  // ctx is unused for chain-specific lookups here, but we touch it to keep
  // the helper chain consistent with other ops.
  resolveChainForOp(ctx, "contract-call");

  const fromAddress = params.from;
  if (!fromAddress) throw new Error("contract-call: missing from address (internal: should be resolved by execute loop)");
  const signer = await ctx.resolveSigner(fromAddress);

  const abiSource = resolveAbiString(params.abi);
  const iface = new ethers.Interface(abiSource);

  // Coerce args from string to the ethers expected JS values.
  // ethers.Interface.encodeFunctionData will accept strings for the common
  // scalar/address types and BigInt for ints, but it can be picky. We do
  // minimal coercion here; users must pre-format ints as BigInt-compatible
  // strings ("1000000") and addresses as-is.
  const args = params.args.map((a) => coerceArg(a));

  const calldata = iface.encodeFunctionData(params.fn, args);

  const valueWei = params.value === "0" ? 0n : BigInt(params.value.slice(4));

  const tx: any = {
    to: params.to,
    value: valueWei,
    data: calldata,
    gasLimit: undefined, // let execute loop estimate
    maxFeePerGas: ctx.fees.maxFeePerGas,
    maxPriorityFeePerGas: ctx.fees.maxPriorityFeePerGas,
  };

  return {
    signer,
    tx,
    meta: {
      op: "contract-call",
      to: params.to,
      valueWei: valueWei.toString(),
      note: `fn=${params.fn} args=${JSON.stringify(params.args)} (calldata=${calldata.slice(0, 10)}...)`,
    },
  };
}

function coerceArg(s: string): unknown {
  // Pure-decimal or "wei:N" / "raw:N" → BigInt
  if (/^-?\d+$/.test(s)) return BigInt(s);
  if (/^wei:(\d+)$/.test(s)) return BigInt(RegExp.$1);
  if (/^raw:(\d+)$/.test(s)) return BigInt(RegExp.$1);
  // Booleans
  if (s === "true") return true;
  if (s === "false") return false;
  // Hex bytes
  if (/^0x[0-9a-fA-F]*$/.test(s)) return s;
  // Otherwise: string
  return s;
}

export const contractCallDef: OpDefinition<Params> = registerOp<Params>({
  type: "contract-call",
  summary:
    "Call any contract function using an inline ABI, an ABI file path, or a built-in alias (erc20/erc721/permit2).",
  schema: paramsSchema as unknown as ZodTypeAny as OpDefinition<Params>["schema"],
  example: {
    id: "call-1",
    type: "contract-call",
    to: "0x000000000000000000000000000000000000dEaD",
    abi: "erc20",
    fn: "transfer(address,uint256)",
    args: ["0x000000000000000000000000000000000000BEEf", "1000000"],
    value: "0",
  },
  build,
  describe: () => ({
    type: "contract-call",
    summary: "Generic contract call with arbitrary ABI",
    schema: paramsSchema._def,
    example: {
      id: "call-1",
      type: "contract-call",
      to: "0xTOKEN",
      abi: "erc20",
      fn: "transfer(address,uint256)",
      args: ["0xRECIPIENT", "1000000"],
      value: "0",
    },
  }),
});
