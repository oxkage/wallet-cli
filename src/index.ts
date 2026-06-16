#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { chainsCommand } from "./commands/chains";
import { validateCommand } from "./commands/validate";
import { exportCommand } from "./commands/export";
import { txCommand } from "./commands/tx";
import { walletCommand } from "./commands/wallet";
import { balanceCommand } from "./commands/balance";
import { runCommand } from "./commands/run";
import { opsCommand } from "./commands/ops";
import { historyCommand } from "./commands/history";
import { scaffoldCommand } from "./commands/scaffold";
import { collectTokensCommand } from "./commands/collectTokens";
import { auditCommand } from "./commands/audit";
import { scanCommand } from "./commands/scan";
import { redactText } from "./lib/redact";
import fs from "node:fs";
import path from "node:path";

// Read version from package.json so it stays in sync with `npm version`.
const pkg = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")
) as { version: string };

const program = new Command();
program.name("wallet-cli").description("Wallet CLI for burner workflow").version(pkg.version);

program.addCommand(chainsCommand());
program.addCommand(validateCommand());
program.addCommand(exportCommand());
program.addCommand(walletCommand());
program.addCommand(txCommand());
program.addCommand(balanceCommand());
program.addCommand(runCommand());
program.addCommand(opsCommand());
program.addCommand(historyCommand());
program.addCommand(scaffoldCommand());
program.addCommand(collectTokensCommand());
program.addCommand(auditCommand());
program.addCommand(scanCommand());

program.exitOverride();

(async () => {
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // eslint-disable-next-line no-console
    console.error(redactText(`Error: ${message}`));
    process.exit(1);
  }
})();
