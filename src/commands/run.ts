import { Command } from "commander";
import chalk from "chalk";
import { loadPlan } from "../lib/plan/load";
import { buildContext } from "../lib/ops/context";
import { executePlan, type OpResult } from "../lib/ops/execute";
import { safeLog } from "../lib/redact";

function statusIcon(r: OpResult): string {
  if (r.mode === "error") return chalk.red("✖");
  if (r.mode === "skipped") return chalk.yellow("↷");
  if (r.mode === "dry-run") return chalk.cyan("○");
  return r.ok ? chalk.green("✔") : chalk.red("✖");
}

function progressLine(r: OpResult, done: number, total: number): string {
  const counter = chalk.dim(`[${String(done).padStart(String(total).length)}/${total}]`);
  const id = chalk.bold(r.id);
  const type = chalk.dim(r.type);
  let tail = "";
  if (r.hash) tail = chalk.dim(` ${r.hash.slice(0, 10)}…`);
  else if (r.error) tail = chalk.red(` ${r.error.code}: ${r.error.message.slice(0, 60)}`);
  else if (r.mode === "dry-run") tail = chalk.dim(" (dry-run)");
  return `${counter} ${statusIcon(r)} ${id} ${type}${tail}`;
}

export function runCommand(): Command {
  return new Command("run")
    .description("Execute a plan JSON. Default is dry-run; pass --yes to broadcast.")
    .argument("[plan]", "Path to plan JSON, '-' or omit to read from stdin")
    .option("--yes", "Broadcast txs (default is dry-run)", false)
    .option("--simulate", "eth_call each op before broadcast (default true for broadcast)", true)
    .option("--stop-on-error", "Halt at first failure (default: continue, report all)", false)
    .option("--json", "Emit only the final structured result as JSON (no live progress)", false)
    .action(
      async (
        planArg: string | undefined,
        opts: { yes: boolean; simulate: boolean; stopOnError: boolean; json: boolean }
      ) => {
        const plan = await loadPlan(planArg);
        const ctx = await buildContext(plan, /* cliDryRun */ !opts.yes);
        if (opts.simulate === false) ctx.simulate = false;
        if (opts.stopOnError) ctx.stopOnError = true;

        const concurrency = plan.options?.batchSize ?? 1;
        const total = plan.operations.length;

        if (!opts.json) {
          const mode = ctx.dryRun ? chalk.cyan("dry-run") : chalk.red("BROADCAST");
          const conc = concurrency > 1 ? chalk.dim(` · concurrency ${concurrency}`) : "";
          console.log(
            `\n${chalk.bold(plan.name ?? "(unnamed)")} · ${total} ops · ${plan.chain} · ${mode}${conc}\n`
          );
        }

        const result = await executePlan(
          plan,
          ctx,
          opts.json ? undefined : (r, p) => console.log(progressLine(r, p.done, p.total))
        );

        if (opts.json) {
          safeLog(result);
        } else {
          const s = result.summary;
          console.log(chalk.dim("\n────────────────────────────────────────"));
          const parts = [
            chalk.green(`${s.succeeded} ok`),
            s.failed ? chalk.red(`${s.failed} failed`) : "",
            s.skipped ? chalk.yellow(`${s.skipped} skipped`) : "",
            s.dryRun ? chalk.cyan(`${s.dryRun} dry-run`) : "",
          ].filter(Boolean);
          console.log(`${result.ok ? chalk.green("PLAN OK") : chalk.red("PLAN FAILED")}: ${parts.join(" · ")}`);
        }

        if (!result.ok) process.exitCode = 1;
      }
    );
}
