import { Command } from "commander";
import { z } from "zod";
import { safeLog } from "../lib/redact";
import { resolveWalletAddress, saveWalletIndexMap } from "../lib/walletIndex";

const reindexSchema = z.object({
  chain: z.enum(["evm", "solana", "both"]).default("evm"),
  from: z.coerce.number().int().min(0).default(0),
  to: z.coerce.number().int().min(0).default(199)
});

const resolveSchema = z.object({
  address: z.string().min(1, "--address is required")
});

export function walletCommand(): Command {
  const wallet = new Command("wallet").description("Wallet index and address resolution utilities");

  wallet
    .command("reindex")
    .description("Rebuild .burnerctl/wallet-index.map.json from SEED_PHRASE-derived EVM addresses")
    .option("--chain <evm|solana|both>", "Which wallet chains to include (SEED_PHRASE mode supports evm only)", "evm")
    .option("--from <index>", "Start derivation index", "0")
    .option("--to <index>", "End derivation index", "199")
    .action((opts) => {
      const parsed = reindexSchema.parse(opts);
      if (parsed.to < parsed.from) throw new Error("--to must be >= --from");

      const indexMap = saveWalletIndexMap(parsed.chain, parsed.from, parsed.to);

      safeLog({
        status: "ok",
        action: "wallet.reindex",
        chain: parsed.chain,
        file: ".burnerctl/wallet-index.map.json",
        entries: Object.keys(indexMap.entries).length,
        source: indexMap.source,
        generatedAt: indexMap.generatedAt
      });
    });

  wallet
    .command("resolve")
    .description("Resolve wallet metadata by EVM address")
    .requiredOption("--address <addrOrPubkey>")
    .action((opts) => {
      const parsed = resolveSchema.parse(opts);
      const entry = resolveWalletAddress(parsed.address, "evm");
      if (!entry) throw new Error(`Address not found in wallet index: ${parsed.address}`);

      safeLog({
        status: "ok",
        action: "wallet.resolve",
        query: parsed.address,
        entry
      });
    });

  return wallet;
}
