import { Command } from "commander";
import Table from "cli-table3";
import chalk from "chalk";
import { queryTx, tailTx, type TxEntry, type TxStatus } from "../lib/txHistory";
import { safeLog } from "../lib/redact";

const VALID_STATUSES: TxStatus[] = ["submitted", "success", "reverted", "failed", "dry-run"];

export function historyCommand(): Command {
  return new Command("history")
    .description("Query the on-chain action log (.burnerctl/tx-history.jsonl)")
    .option("--chain <name>", "Filter by chain (e.g. Base, Ethereum)")
    .option("--plan <name>", "Filter by plan name")
    .option("--op-id <id>", "Filter by op id within a plan")
    .option("--hash <0x...>", "Look up a specific tx hash")
    .option("--status <status>", `Filter by status: ${VALID_STATUSES.join(" | ")}`)
    .option("--since <isoDate>", "Entries on or after this ISO date (inclusive)")
    .option("--until <isoDate>", "Entries on or before this ISO date (inclusive)")
    .option("--limit <N>", "Max entries to return (default 20)", (v) => Number(v), 20)
    .option("--format <format>", "Output format: json | table (default table)", "table")
    .action((opts: {
      chain?: string;
      plan?: string;
      opId?: string;
      hash?: string;
      status?: string;
      since?: string;
      until?: string;
      limit: number;
      format: string;
    }) => {
      if (opts.status && !VALID_STATUSES.includes(opts.status as TxStatus)) {
        throw new Error(`--status must be one of: ${VALID_STATUSES.join(", ")}`);
      }
      if (opts.format !== "json" && opts.format !== "table") {
        throw new Error(`--format must be 'json' or 'table'`);
      }

      const rows = queryTx({
        chain: opts.chain,
        plan: opts.plan,
        opId: opts.opId,
        hash: opts.hash,
        status: opts.status as TxStatus | undefined,
        since: opts.since,
        until: opts.until,
        limit: opts.limit,
      });

      if (rows.length === 0) {
        if (opts.format === "json") {
          safeLog({ count: 0, entries: [] });
        } else {
          console.log(chalk.dim("No matching entries."));
        }
        return;
      }

      if (opts.format === "json") {
        safeLog({ count: rows.length, entries: rows });
        return;
      }

      const table = new Table({
        head: ["ts", "plan/op", "chain", "type", "from", "to/token", "amount", "status", "hash"].map(
          (h) => chalk.bold(h)
        ),
        colWidths: [22, 28, 10, 14, 14, 30, 12, 10, 14],
        wordWrap: true,
      });
      for (const r of rows) {
        const planCol = r.plan ? `${r.plan}${r.opId ? "/" + r.opId : ""}` : chalk.dim("(direct)");
        const toCol = r.token ? `${r.token}:${shortAddr(r.to)}` : shortAddr(r.to);
        const amountCol = formatAmountCol(r);
        const hashCol = r.hash ? r.hash.slice(0, 10) + "..." : chalk.dim("-");
        const statusCol = colorStatus(r.status);
        table.push([
          r.ts.replace("T", " ").replace("Z", ""),
          planCol,
          r.chain,
          r.op,
          shortAddr(r.from),
          toCol,
          amountCol,
          statusCol,
          hashCol,
        ]);
      }
      console.log(table.toString());
      console.log(chalk.dim(`\n${rows.length} entr${rows.length === 1 ? "y" : "ies"} (limit ${opts.limit})`));
    });
}

function shortAddr(addr?: string): string {
  if (!addr) return chalk.dim("-");
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatAmountCol(r: TxEntry): string {
  if (r.token && r.amount) return `${r.amount} ${r.token}`;
  if (r.valueWei && r.valueWei !== "0") {
    // Heuristic: show in native units (18 decimals)
    try {
      const wei = BigInt(r.valueWei);
      const native = Number(wei) / 1e18;
      if (native === 0) return "0";
      if (native < 0.0001) return "<0.0001";
      return native.toString();
    } catch {
      return r.valueWei;
    }
  }
  return chalk.dim("-");
}

function colorStatus(s: TxStatus): string {
  switch (s) {
    case "success":
      return chalk.green("success");
    case "submitted":
      return chalk.cyan("submitted");
    case "dry-run":
      return chalk.gray("dry-run");
    case "reverted":
      return chalk.red("reverted");
    case "failed":
      return chalk.red("failed");
  }
}
