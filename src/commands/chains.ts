import { Command } from "commander";
import chalk from "chalk";
import Table from "cli-table3";
import { z } from "zod";
import { findChain, getChainsWithOverrides, setChainEnabled } from "../lib/chainState";
import { postJsonRpc } from "../lib/rpc";

const timeoutSchema = z.coerce.number().int().positive().max(120000);

async function testEvmRpc(rpcUrl: string, timeoutMs: number): Promise<string> {
  const blockHex = await postJsonRpc(rpcUrl, "eth_blockNumber", [], timeoutMs);
  return `ok block=${parseInt(String(blockHex), 16)}`;
}

export function chainsCommand(): Command {
  const cmd = new Command("chains").description("Manage chain registry and RPC checks");

  cmd
    .command("list")
    .description("List chains and enabled status")
    .action(() => {
      const chains = getChainsWithOverrides();
      const table = new Table({ head: ["Name", "ChainId", "Type", "Enabled", "RPC"] });
      for (const c of chains) {
        table.push([c.name, String(c.chainId), c.type, c.enabled ? chalk.green("yes") : chalk.red("no"), c.rpcUrl]);
      }
      console.log(table.toString());
    });

  cmd
    .command("enable")
    .argument("<nameOrChainId>")
    .description("Enable chain")
    .action((nameOrChainId: string) => {
      const { chain, backupPath } = setChainEnabled(nameOrChainId, true);
      console.log(chalk.green(`Enabled ${chain.name}.`));
      if (backupPath) console.log(chalk.gray(`Backup: ${backupPath}`));
    });

  cmd
    .command("disable")
    .argument("<nameOrChainId>")
    .description("Disable chain")
    .action((nameOrChainId: string) => {
      const { chain, backupPath } = setChainEnabled(nameOrChainId, false);
      console.log(chalk.yellow(`Disabled ${chain.name}.`));
      if (backupPath) console.log(chalk.gray(`Backup: ${backupPath}`));
    });

  cmd
    .command("test-rpc")
    .description("Test chain RPC endpoints")
    .option("--chain <nameOrChainId>")
    .option("--timeout <ms>", "RPC timeout in ms", "10000")
    .action(async (opts: { chain?: string; timeout: string }) => {
      const timeoutMs = timeoutSchema.parse(opts.timeout);
      const chains = getChainsWithOverrides().filter((c) => c.enabled);
      const selected = opts.chain ? [findChain(opts.chain, chains)].filter(Boolean) : chains;
      const table = new Table({ head: ["Name", "Status"] });

      for (const c of selected) {
        if (!c) continue;
        try {
          const status = await testEvmRpc(c.rpcUrl, timeoutMs);
          table.push([c.name, chalk.green(status)]);
        } catch (error) {
          table.push([c.name, chalk.red(`fail ${(error as Error).message}`)]);
        }
      }

      console.log(table.toString());
    });

  return cmd;
}
