import { Command } from "commander";
import chalk from "chalk";
import { runCredentialAudit, type CheckResult } from "../lib/audit/credentials";

function renderCheck(r: CheckResult): void {
  const icon =
    r.status === "pass" ? chalk.green("OK  ") : r.status === "fail" ? chalk.red("FAIL") : chalk.yellow("SKIP");
  console.log(`${icon} ${r.id}. ${r.name}`);
  console.log(`     ${chalk.dim(r.detail)}`);
  if (r.status === "fail" && r.hits.length) {
    for (const h of r.hits) console.log(chalk.red(`       - ${h}`));
  }
}

export function auditCommand(): Command {
  return new Command("audit")
    .description("Pre-push credential scan: .env history, .gitignore, mnemonics, private-key shapes, RPC auth")
    .option("--strict", "Exit 1 if any check fails (for pre-push hooks)", false)
    .option("--quiet", "Only print failures and the summary line", false)
    .option("--json", "Emit the report as JSON (implies --quiet)", false)
    .action((opts: { strict?: boolean; quiet?: boolean; json?: boolean }) => {
      const report = runCredentialAudit();

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
        if (opts.strict && !report.passed) process.exitCode = 1;
        return;
      }

      if (!opts.quiet) {
        console.log(chalk.bold(`\nCredential audit — ${report.repoRoot}\n`));
      }

      for (const r of report.results) {
        if (opts.quiet && r.status !== "fail") continue;
        renderCheck(r);
      }

      console.log(chalk.dim("\n════════════════════════════════════════"));
      if (report.passed) {
        console.log(chalk.green("AUDIT PASSED: all checks clean. Safe to push."));
      } else {
        console.log(chalk.red(`AUDIT FAILED: ${report.failed} check(s) failed.`));
        console.log(chalk.yellow("Do NOT push until resolved — scrub the flagged files and rotate any exposed secret."));
        if (opts.strict) process.exitCode = 1;
      }
    });
}
