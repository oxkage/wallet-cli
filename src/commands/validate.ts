import { Command } from "commander";
import chalk from "chalk";
import { getSeedPhraseOrThrow, loadWalletFileFromEnvOrThrow, getOptionalWalletFilePath } from "../lib/wallets";
import { loadPlan } from "../lib/plan/load";
import { buildContext } from "../lib/ops/context";
import { executePlan } from "../lib/ops/execute";
import { getOp } from "../lib/ops/registry";
import { safeLog } from "../lib/redact";

export function validateCommand(): Command {
  return new Command("validate")
    .description("Validate wallet configuration (.env, optional wallet file) and/or a plan JSON")
    .argument("[plan]", "Optional plan JSON to validate (file path or '-' for stdin)")
    .action(async (planArg?: string) => {
      // Always run the existing env check
      getSeedPhraseOrThrow();
      const configuredFile = getOptionalWalletFilePath();
      if (!configuredFile) {
        console.log(chalk.green("Validation ok. SEED_PHRASE is configured and valid. No wallet file configured."));
      } else {
        const data = loadWalletFileFromEnvOrThrow();
        const solanaCount = data.wallets.solana.length;
        const evmCount = data.wallets.evm.length;
        const total = solanaCount + evmCount;
        const errors: string[] = [];
        if (solanaCount !== data.metadata.solana_count) errors.push(`solana_count mismatch metadata=${data.metadata.solana_count} actual=${solanaCount}`);
        if (evmCount !== data.metadata.evm_count) errors.push(`evm_count mismatch metadata=${data.metadata.evm_count} actual=${evmCount}`);
        if (total !== data.metadata.total_wallets) errors.push(`total_wallets mismatch metadata=${data.metadata.total_wallets} actual=${total}`);

        if (errors.length > 0) {
          console.log(chalk.red("Validation failed:"));
          for (const e of errors) console.log(`- ${e}`);
          process.exitCode = 1;
          return;
        }
        console.log(chalk.green(`Validation ok. seed=ok total=${total} evm=${evmCount} solana=${solanaCount}`));
      }

      // If a plan was provided, also validate it
      if (planArg) {
        const plan = await loadPlan(planArg);
        const errors: string[] = [];
        // Check all op types are registered
        for (const op of plan.operations) {
          const def = getOp(op.type);
          if (!def) {
            errors.push(`op ${op.id}: unknown type "${op.type}"`);
            continue;
          }
          // Per-op schema check
          const parsed = def.schema.safeParse({ ...op });
          if (!parsed.success) {
            errors.push(`op ${op.id} (${op.type}): ${parsed.error.issues.map((i) => i.message).join("; ")}`);
          }
        }
        if (errors.length > 0) {
          console.log(chalk.red("Plan validation failed:"));
          for (const e of errors) console.log(`- ${e}`);
          process.exitCode = 1;
          return;
        }
        console.log(chalk.green(`Plan ok. ${plan.operations.length} operations, chain=${plan.chain}`));

        // Simulate (dry-run) the plan
        try {
          const ctx = await buildContext(plan, /* cliDryRun */ true);
          const result = await executePlan(plan, ctx);
          safeLog({ validation: "simulated", result });
        } catch (e) {
          console.log(chalk.yellow(`Simulation skipped: ${(e as Error).message}`));
        }
      }
    });
}
