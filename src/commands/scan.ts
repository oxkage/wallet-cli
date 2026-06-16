import { Command } from "commander";
import chalk from "chalk";
import Table from "cli-table3";
import { z } from "zod";
import { findChain, getChainsWithOverrides } from "../lib/chainState";
import { scanBalances } from "../lib/scan/scan";
import { safeLog } from "../lib/redact";

const optsSchema = z.object({
  chain: z.string().min(1),
  from: z.coerce.number().int().min(0).default(0),
  to: z.coerce.number().int().min(0).default(199),
  include: z.string().min(1).default("native"),
  concurrency: z.coerce.number().int().min(1).max(20).default(5),
  showZero: z.boolean().default(false),
  json: z.boolean().default(false),
});

export function scanCommand(): Command {
  return new Command("scan")
    .description("Batch-read native + token balances across a wallet index range (the factual input for sweep/distribute)")
    .requiredOption("--chain <nameOrChainId>", "Chain name or chainId")
    .option("--from <index>", "Start derivation index (inclusive)", "0")
    .option("--to <index>", "End derivation index (inclusive)", "199")
    .option("--include <list>", "Comma-separated assets: 'native' and/or token symbols (e.g. 'native,USDC')", "native")
    .option("--concurrency <N>", "Max parallel wallet reads (default 5)", "5")
    .option("--show-zero", "Include wallets with all-zero balances", false)
    .option("--json", "Emit structured JSON (machine-readable)", false)
    .action(async (raw) => {
      const opts = optsSchema.parse(raw);
      if (opts.to < opts.from) throw new Error("--to must be >= --from");

      const chains = getChainsWithOverrides().filter((c) => c.enabled);
      const chain = findChain(opts.chain, chains);
      if (!chain) throw new Error(`Enabled chain not found: ${opts.chain}`);
      if (chain.type !== "evm") throw new Error(`Chain ${chain.name} is not EVM`);

      const include = opts.include.split(",").map((s) => s.trim()).filter(Boolean);

      const result = await scanBalances({
        chainName: chain.name,
        chainId: chain.chainId as number,
        rpcUrl: chain.rpcUrl,
        fromIndex: opts.from,
        toIndex: opts.to,
        include,
        concurrency: opts.concurrency,
        showZero: opts.showZero,
      });

      if (opts.json) {
        // safeLog redacts; scan output is public addresses + balances, but keep
        // the same channel for consistency with other commands.
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      const table = new Table({ head: ["Idx", "Address", ...result.assets] });
      for (const w of result.wallets) {
        const short = w.address.slice(0, 10) + "…" + w.address.slice(-6);
        const cells = result.assets.map((a) => {
          const b = w.balances.find((x) => x.asset === a);
          return b ? Number(b.formatted).toFixed(6) : "0";
        });
        table.push([String(w.index), short, ...cells]);
      }

      console.log(`\n${chalk.bold(chain.name)} (${chain.chainId}) · idx ${opts.from}–${opts.to} · ${result.nonZeroCount} non-zero\n`);
      console.log(table.toString());
      console.log(chalk.dim("\nTotals:"));
      for (const a of result.assets) {
        const t = result.totals[a];
        console.log(`  ${chalk.bold(a)}: ${Number(t.formatted).toFixed(6)} ${chalk.dim(`(raw ${t.raw})`)}`);
      }

      safeLog({
        action: "scan",
        chain: chain.name,
        chainId: chain.chainId,
        fromIndex: opts.from,
        toIndex: opts.to,
        assets: result.assets,
        nonZeroCount: result.nonZeroCount,
        totals: result.totals,
      });
    });
}
