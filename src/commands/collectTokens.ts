import { Command } from "commander";
import chalk from "chalk";
import Table from "cli-table3";
import { z } from "zod";
import {
  addToken,
  disableToken,
  enableToken,
  listAllTokens,
  removeToken,
  type Token,
} from "../lib/tokens";
import { findChain, getChainsWithOverrides } from "../lib/chainState";
import { getUsdPrice } from "../lib/usd";
import { safeLog } from "../lib/redact";

const chainArg = z.string().min(1);
const addressArg = z.string().refine(
  (v) => /^0x[a-fA-F0-9]{40}$/.test(v),
  "must be a 0x-prefixed 40-hex EVM address"
);
const symbolArg = z.string().min(1).max(16);
const decimalsArg = z.coerce.number().int().min(0).max(36);

function findChainOrThrow(input: string) {
  const chains = getChainsWithOverrides();
  const chain = findChain(input, chains);
  if (!chain) {
    throw new Error(`Chain not found: ${input}`);
  }
  return chain;
}

async function priceForSymbol(symbol: string): Promise<string> {
  try {
    const p = await getUsdPrice(symbol);
    return p === null ? "-" : `$${p.toFixed(4)}`;
  } catch {
    return "-";
  }
}

async function renderTable(tokens: Token[]): Promise<string> {
  const table = new Table({ head: ["Chain", "ChainId", "Symbol", "Decimals", "Enabled", "Address", "Price"] });
  for (const t of tokens) {
    table.push([
      chainNameForId(t.chainId) ?? "?",
      String(t.chainId),
      t.symbol,
      String(t.decimals),
      t.enabled ? chalk.green("yes") : chalk.red("no"),
      t.address,
      await priceForSymbol(t.symbol),
    ]);
  }
  return table.toString();
}

function chainNameForId(chainId: number): string | null {
  const c = getChainsWithOverrides().find((c: { chainId: number | string }) => c.chainId === chainId);
  return c?.name ?? null;
}

function renderJson(tokens: Token[]): string {
  return JSON.stringify(tokens, null, 2);
}

export function collectTokensCommand(): Command {
  const cmd = new Command("collect-tokens").description("Manage the per-chain ERC-20 token registry");

  cmd
    .command("list")
    .description("List tokens in the registry (defaults + overrides)")
    .option("--chain <nameOrChainId>", "Filter by chain name or chainId")
    .option("--format <fmt>", "Output format: table or json", "table")
    .action(async (opts: { chain?: string; format: string }) => {
      const fmt = opts.format === "json" ? "json" : "table";
      let tokens = listAllTokens();
      if (opts.chain) {
        const chain = findChainOrThrow(opts.chain);
        tokens = tokens.filter((t) => t.chainId === chain.chainId);
      }
      if (fmt === "json") {
        safeLog(JSON.parse(renderJson(tokens)));
      } else {
        console.log(await renderTable(tokens));
      }
    });

  cmd
    .command("add")
    .description("Add a new token to the registry (writes to .burnerctl/tokens.override.json)")
    .requiredOption("--chain <nameOrChainId>", "Chain name or chainId")
    .requiredOption("--address <0x..>", "Token contract address")
    .requiredOption("--symbol <SYM>", "Token symbol (e.g. USDC)")
    .requiredOption("--decimals <N>", "Token decimals (e.g. 6 for USDC, 18 for WETH)")
    .action((opts: { chain: string; address: string; symbol: string; decimals: string }) => {
      const chain = findChainOrThrow(chainArg.parse(opts.chain));
      const address = addressArg.parse(opts.address);
      const symbol = symbolArg.parse(opts.symbol);
      const decimals = decimalsArg.parse(opts.decimals);
      const { token, backupPath } = addToken({ chainId: chain.chainId as number, address, symbol, decimals });
      console.log(chalk.green(`Added ${token.symbol} on ${chain.name} (${token.address}).`));
      if (backupPath) console.log(chalk.gray(`Backup: ${backupPath}`));
    });

  cmd
    .command("remove")
    .description("Remove a token from the registry (disables it if it's a default; deletes if it's an override entry)")
    .requiredOption("--chain <nameOrChainId>", "Chain name or chainId")
    .requiredOption("--symbol <SYM>", "Token symbol")
    .action((opts: { chain: string; symbol: string }) => {
      const chain = findChainOrThrow(chainArg.parse(opts.chain));
      const symbol = symbolArg.parse(opts.symbol);
      const { removed, backupPath } = removeToken(chain.chainId as number, symbol);
      if (!removed) {
        throw new Error(`Token not found: chainId=${chain.chainId} symbol=${symbol}`);
      }
      console.log(chalk.yellow(`Removed ${removed.symbol} on ${chain.name} (${removed.address}).`));
      if (backupPath) console.log(chalk.gray(`Backup: ${backupPath}`));
    });

  cmd
    .command("enable")
    .description("Re-enable a token (defaults are enabled; use this after a previous remove)")
    .requiredOption("--chain <nameOrChainId>", "Chain name or chainId")
    .requiredOption("--symbol <SYM>", "Token symbol")
    .action((opts: { chain: string; symbol: string }) => {
      const chain = findChainOrThrow(chainArg.parse(opts.chain));
      const symbol = symbolArg.parse(opts.symbol);
      const { token, backupPath } = enableToken(chain.chainId as number, symbol);
      console.log(chalk.green(`Enabled ${token.symbol} on ${chain.name}.`));
      if (backupPath) console.log(chalk.gray(`Backup: ${backupPath}`));
    });

  cmd
    .command("disable")
    .description("Disable a token in the registry (it stays listed but won't resolve for ops)")
    .requiredOption("--chain <nameOrChainId>", "Chain name or chainId")
    .requiredOption("--symbol <SYM>", "Token symbol")
    .action((opts: { chain: string; symbol: string }) => {
      const chain = findChainOrThrow(chainArg.parse(opts.chain));
      const symbol = symbolArg.parse(opts.symbol);
      const { token, backupPath } = disableToken(chain.chainId as number, symbol);
      console.log(chalk.yellow(`Disabled ${token.symbol} on ${chain.name}.`));
      if (backupPath) console.log(chalk.gray(`Backup: ${backupPath}`));
    });

  return cmd;
}
