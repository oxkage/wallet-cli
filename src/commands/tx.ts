import { Command } from "commander";
import { ethers } from "ethers";
import { findChain, getChainsWithOverrides } from "../lib/chainState";
import { safeLog } from "../lib/redact";
import { resolveSigner } from "../lib/signer";
import { getEthUsdPriceString } from "../lib/usd";
import { loadPlan } from "../lib/plan/load";
import { buildContext } from "../lib/ops/context";
import { executePlan } from "../lib/ops/execute";

/**
 * Legacy `tx send` command. Kept for back-compat with existing scripts.
 *
 * Internally it just builds a 1-op plan and calls the same executePlan()
 * runtime as `wallet-cli run` — so behavior, history, nonce management,
 * dry-run semantics, and gas estimation are all unified.
 */
export function txCommand(): Command {
  const tx = new Command("tx").description("Transaction utilities (legacy — use `run` for new flows)");

  tx
    .command("send")
    .description("Send native EVM transfer by USD amount. Wraps the runtime plan executor.")
    .requiredOption("--chain <nameOrChainId>")
    .requiredOption("--from <address>")
    .requiredOption("--to <address>")
    .requiredOption("--usd <amount>")
    .option("--dry-run", "Estimate and print summary without sending", false)
    .option("--yes", "Required to actually send transaction", false)
    .option("--search-limit <n>", "Max derivation index to scan for --from", "200")
    .action(async (opts: { chain: string; from: string; to: string; usd: string; dryRun: boolean; yes: boolean; searchLimit: string }) => {
      if (!opts.dryRun && !opts.yes) {
        throw new Error("Refusing to send without --yes. Use --dry-run to preview.");
      }

      const enabledChains = getChainsWithOverrides().filter((c) => c.enabled);
      const chain = findChain(opts.chain, enabledChains);
      if (!chain) throw new Error(`Enabled chain not found: ${opts.chain}`);
      if (chain.type !== "evm") throw new Error(`Chain ${chain.name} is not EVM`);
      if (!ethers.isAddress(opts.from)) throw new Error(`Invalid --from address: ${opts.from}`);
      if (!ethers.isAddress(opts.to)) throw new Error(`Invalid --to address: ${opts.to}`);
      if (!/^\d+(\.\d+)?$/.test(opts.usd)) throw new Error(`--usd must be a positive decimal`);
      if (Number(opts.usd) <= 0) throw new Error(`--usd must be > 0`);

      // Resolve signer so we can warn if --from doesn't match the SEED_PHRASE
      const signerSource = resolveSigner(opts.from, Number(opts.searchLimit));

      // Build a 1-op plan
      const planObj = {
        version: 1,
        name: `tx-send-${Date.now()}`,
        chain: chain.name,
        operations: [
          {
            id: "send-1",
            type: "native-send",
            from: signerSource.address,
            to: opts.to,
            value: `usd:${opts.usd}`,
          },
        ],
        options: { dryRun: opts.dryRun },
      };

      const ethUsd = await getEthUsdPriceString();
      const ctx = await buildContext(planObj as any, /* cliDryRun */ !opts.yes);
      const result = await executePlan(planObj as any, ctx);

      // Emit a short summary on top of the canonical PlanResult so legacy
      // callers parsing the old shape don't break.
      safeLog({
        legacy: true,
        mode: result.mode,
        ok: result.ok,
        plan: result.plan,
        ethUsd,
        results: result.results,
      });
      if (!result.ok) process.exitCode = 1;
    });

  return tx;
}
