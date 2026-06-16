import { Command } from "commander";
import Table from "cli-table3";
import { z } from "zod";
import { deriveEvmWalletRange } from "../lib/wallets";

const schema = z.object({
  chain: z.literal("evm").default("evm"),
  from: z.coerce.number().int().min(0),
  to: z.coerce.number().int().min(0),
  format: z.enum(["json", "table"]).default("json")
});

export function exportCommand(): Command {
  return new Command("export")
    .description("Export public wallet fields only (EVM)")
    .requiredOption("--from <index>")
    .requiredOption("--to <index>")
    .option("--chain <evm>", "Wallet chain (EVM only)", "evm")
    .option("--format <json|table>", "Output format", "json")
    .action((opts) => {
      const parsed = schema.parse(opts);
      if (parsed.to < parsed.from) throw new Error("--to must be >= --from");

      const wallets = deriveEvmWalletRange(parsed.from, parsed.to).map((w) => ({
        index: w.index,
        path: w.path,
        address: w.address
      }));

      if (parsed.format === "json") {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(wallets, null, 2));
        return;
      }

      const table = new Table({ head: ["Index", "Path", "Address"] });
      for (const w of wallets) table.push(Object.values(w));
      // eslint-disable-next-line no-console
      console.log(table.toString());
    });
}
