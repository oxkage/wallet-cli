import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import chalk from "chalk";
import Table from "cli-table3";
import { z } from "zod";
import { findChain, getChainsWithOverrides } from "../lib/chainState";
import { generateSweepPlan } from "../lib/scaffold/sweep";
import { generateMultisendPlan } from "../lib/scaffold/multisend";
import { generateCollectPlan } from "../lib/scaffold/collect";
import { generateDistributePlan } from "../lib/scaffold/distribute";
import { computeDistribution, type SplitStrategy } from "../lib/scaffold/distributeMath";
import { scanBalances } from "../lib/scan/scan";
import { findToken } from "../lib/tokens";
import { ethers } from "ethers";
import {
  generatePlanFromCsv,
  groupRecipientsByChain,
  parseRecipientsCsv,
} from "../lib/scaffold/csv";
import { safeLog } from "../lib/redact";

const chainArg = z.string().min(1);
const addressArg = z.string().refine(
  (v) => /^0x[a-fA-F0-9]{40}$/.test(v),
  "must be a 0x-prefixed 40-hex EVM address"
);
const indexArg = z.coerce.number().int().min(0);

function findChainOrThrow(input: string) {
  const chains = getChainsWithOverrides();
  const chain = findChain(input, chains);
  if (!chain) {
    throw new Error(`Chain not found: ${input}. Run 'wallet-cli chains list' to see available chains.`);
  }
  if (chain.type !== "evm") {
    throw new Error(`Chain ${chain.name} is not EVM (Solana plans are not scaffolded yet)`);
  }
  return chain;
}

function writePlan(plan: object, outPath?: string): { written: string } {
  const json = JSON.stringify(plan, null, 2);
  if (!outPath) {
    // stdout: no chalk, no banner — just the JSON.
    process.stdout.write(json + "\n");
    return { written: "<stdout>" };
  }
  const abs = path.resolve(outPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, json + "\n", "utf-8");
  return { written: abs };
}

function summarizePlan(plan: { chain: string; operations: Array<{ type: string }> }) {
  const table = new Table({ head: ["Chain", "Total ops", "native-send", "erc20-transfer"] });
  const nativeCount = plan.operations.filter((o) => o.type === "native-send").length;
  const erc20Count = plan.operations.filter((o) => o.type === "erc20-transfer").length;
  table.push([plan.chain, String(plan.operations.length), String(nativeCount), String(erc20Count)]);
  return table.toString();
}

export function scaffoldCommand(): Command {
  const cmd = new Command("scaffold")
    .description("Generate plan JSON files (sugar for the most common plans — never broadcasts)");

  // --- sweep ---
  cmd
    .command("sweep")
    .description("Generate a sweep plan: send each asset from each wallet in [fromIdx, toIdx] to a destination")
    .requiredOption("--chain <nameOrChainId>", "Chain name or chainId")
    .requiredOption("--from-idx <N>", "First wallet index (inclusive)", (v) => indexArg.parse(v))
    .requiredOption("--to-idx <N>", "Last wallet index (inclusive)", (v) => indexArg.parse(v))
    .requiredOption("--to <address>", "Destination 0x address")
    .requiredOption("--include <list>", "Comma-separated assets: native and/or token symbols (e.g. 'native,USDC')")
    .option("--skip <list>", "Comma-separated wallet indices to skip (e.g. '0,5,12')", (v: string) => v.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n)))
    .option("--name <name>", "Plan name", "sweep")
    .option("--out <file>", "Output plan JSON file (default: stdout)")
    .action((opts: {
      chain: string;
      fromIdx: number;
      toIdx: number;
      to: string;
      include: string;
      skip?: number[];
      name: string;
      out?: string;
    }) => {
      const chain = findChainOrThrow(chainArg.parse(opts.chain));
      const to = addressArg.parse(opts.to);
      const include = opts.include.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
      if (include.length === 0) throw new Error("--include must list at least one asset (e.g. 'native' or 'native,USDC')");

      const plan = generateSweepPlan({
        chain: chain.name,
        fromIdx: opts.fromIdx,
        toIdx: opts.toIdx,
        to,
        include,
        skip: opts.skip,
        name: opts.name,
      });
      const { written } = writePlan(plan, opts.out);
      if (opts.out) {
        console.error(chalk.green(`✔ Wrote plan with ${plan.operations.length} ops to ${written}`));
        console.error(summarizePlan(plan));
      }
    });

  // --- multisend ---
  cmd
    .command("multisend")
    .description("Generate a multisend plan: one op per recipient, all from a single sender")
    .requiredOption("--chain <nameOrChainId>", "Chain name or chainId")
    .requiredOption("--from <addrOrIdx>", "Sender 0x... address or wallet index")
    .requiredOption("--recipients <list>", "Comma-separated 'address:amount' pairs (amount supports plain numbers, wei:N, raw:N, usd:N)")
    .option("--name <name>", "Plan name", "multisend")
    .option("--out <file>", "Output plan JSON file (default: stdout)")
    .action((opts: { chain: string; from: string; recipients: string; name: string; out?: string }) => {
      const chain = findChainOrThrow(chainArg.parse(opts.chain));
      const recipients = parseRecipientsList(opts.recipients);
      const from = parseFromArg(opts.from);

      const plan = generateMultisendPlan({
        chain: chain.name,
        from,
        recipients,
        name: opts.name,
      });
      const { written } = writePlan(plan, opts.out);
      if (opts.out) {
        console.error(chalk.green(`✔ Wrote plan with ${plan.operations.length} ops to ${written}`));
        console.error(summarizePlan(plan));
      }
    });

  // --- collect ---
  cmd
    .command("collect")
    .description("Generate a collect plan: drain a single asset from each wallet in [fromIdx, toIdx] to a destination")
    .requiredOption("--chain <nameOrChainId>", "Chain name or chainId")
    .requiredOption("--token <nativeOrSymbol>", "Asset to collect: 'native' or a token symbol (e.g. USDC)")
    .requiredOption("--from-idx <N>", "First wallet index (inclusive)", (v) => indexArg.parse(v))
    .requiredOption("--to-idx <N>", "Last wallet index (inclusive)", (v) => indexArg.parse(v))
    .requiredOption("--to <address>", "Destination 0x address")
    .option("--skip <list>", "Comma-separated wallet indices to skip", (v: string) => v.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n)))
    .option("--name <name>", "Plan name", "collect")
    .option("--out <file>", "Output plan JSON file (default: stdout)")
    .action((opts: {
      chain: string;
      token: string;
      fromIdx: number;
      toIdx: number;
      to: string;
      skip?: number[];
      name: string;
      out?: string;
    }) => {
      const chain = findChainOrThrow(chainArg.parse(opts.chain));
      const to = addressArg.parse(opts.to);
      const token = opts.token.trim();
      if (token.length === 0) throw new Error("--token is required");

      const plan = generateCollectPlan({
        chain: chain.name,
        token,
        fromIdx: opts.fromIdx,
        toIdx: opts.toIdx,
        to,
        skip: opts.skip,
        name: opts.name,
      });
      const { written } = writePlan(plan, opts.out);
      if (opts.out) {
        console.error(chalk.green(`✔ Wrote plan with ${plan.operations.length} ops to ${written}`));
        console.error(summarizePlan(plan));
      }
    });

  // --- csv ---
  cmd
    .command("csv")
    .description("Generate a plan from a CSV of recipients: address,amount[,token][,chain] per row")
    .argument("<file>", "Path to CSV file (use '-' to read from stdin)")
    .option("--chain <nameOrChainId>", "Default chain for rows with no chain column (required if any row is missing it)")
    .option("--from <addrOrIdx>", "Sender 0x... address or wallet index (optional: omitted = per-op from required)")
    .option("--name <name>", "Plan name", "csv-multisend")
    .option("--out <file>", "Output plan JSON file (default: stdout). If the CSV spans multiple chains, files are written with the chain name appended.")
    .action(async (file: string, opts: { chain?: string; from?: string; name: string; out?: string }) => {
      const content = await readCsvSource(file);
      const recipients = parseRecipientsCsv(content);
      if (recipients.length === 0) {
        throw new Error(`CSV at ${file} produced 0 recipients`);
      }

      // Determine effective chains across rows
      const chainsInUse = new Set<string>();
      for (const r of recipients) {
        chainsInUse.add((r.chain && r.chain.length > 0 ? r.chain : opts.chain ?? "").trim());
      }
      chainsInUse.delete("");  // blank if no default and row has no chain

      if (chainsInUse.size === 0) {
        throw new Error("No chain determined: provide --chain or include a 'chain' column on every row");
      }

      if (chainsInUse.size > 1) {
        // Multi-chain CSV: write one plan per chain. Out file gets a suffix.
        if (!opts.chain && recipients.some((r) => !r.chain)) {
          throw new Error("Multi-chain CSV detected. Provide --chain for rows that omit the chain column, or set a chain on every row.");
        }
        const baseDefault = opts.chain;
        const from = opts.from ? parseFromArg(opts.from) : undefined;
        const groups = groupRecipientsByChain(recipients, baseDefault!);
        for (const g of groups) {
          const plan = generatePlanFromCsv({
            chain: g.chain,
            from,
            recipients: g.recipients,
            name: `${opts.name}-${slugify(g.chain)}`,
          });
          const outPath = expandOutPathForChain(opts.out, g.chain);
          const { written } = writePlan(plan, outPath);
          if (outPath) {
            console.error(chalk.green(`✔ Wrote plan with ${plan.operations.length} ops to ${written}`));
            console.error(summarizePlan(plan));
          }
        }
        return;
      }

      // Single-chain path
      const chainName = [...chainsInUse][0];
      const chain = findChainOrThrow(chainName);
      const from = opts.from ? parseFromArg(opts.from) : undefined;
      const plan = generatePlanFromCsv({
        chain: chain.name,
        from,
        recipients,
        name: opts.name,
      });
      const { written } = writePlan(plan, opts.out);
      if (opts.out) {
        console.error(chalk.green(`✔ Wrote plan with ${plan.operations.length} ops to ${written}`));
        console.error(summarizePlan(plan));
      }
    });

  // --- distribute ---
  cmd
    .command("distribute")
    .description("Generate a distribute plan: split an amount from ONE source across a target index range. The TOOL computes per-wallet amounts (no LLM math).")
    .requiredOption("--chain <nameOrChainId>", "Chain name or chainId")
    .requiredOption("--from <addrOrIdx>", "Source 0x... address or wallet index")
    .requiredOption("--to-idx <N>", "First target wallet index (inclusive)", (v) => indexArg.parse(v))
    .requiredOption("--to-idx-end <N>", "Last target wallet index (inclusive)", (v) => indexArg.parse(v))
    .option("--token <nativeOrSymbol>", "Asset to distribute: 'native' or token symbol", "native")
    .option("--amount <value>", "Total to split: a number, 'raw:N', or 'all' (live source balance)", "all")
    .option("--split <equal|jitter|fixed>", "Split strategy", "equal")
    .option("--per <value>", "Per-wallet amount (fixed strategy): number or 'raw:N'")
    .option("--jitter <pct>", "Jitter percent for 'jitter' split (0-95)", (v) => Number(v))
    .option("--reserve-gas <value>", "Native amount to leave in source (e.g. '0.01'); only applies to 'all' on native")
    .option("--reserve-gas-per-tx", "When set with native 'all', reserve estimated gas for every distribute tx", false)
    .option("--seed <N>", "Deterministic seed for jitter", (v) => Number(v))
    .option("--skip <list>", "Comma-separated target indices to skip", (v: string) => v.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n)))
    .option("--name <name>", "Plan name", "distribute")
    .option("--out <file>", "Output plan JSON file (default: stdout)")
    .action(async (opts: {
      chain: string;
      from: string;
      toIdx: number;
      toIdxEnd: number;
      token: string;
      amount: string;
      split: string;
      per?: string;
      jitter?: number;
      reserveGas?: string;
      reserveGasPerTx?: boolean;
      seed?: number;
      skip?: number[];
      name: string;
      out?: string;
    }) => {
      const chain = findChainOrThrow(chainArg.parse(opts.chain));
      const from = parseFromArg(opts.from);
      const token = opts.token.trim() || "native";
      const isNative = token.toLowerCase() === "native";
      const strategy = opts.split as SplitStrategy;
      if (!["equal", "jitter", "fixed"].includes(strategy)) {
        throw new Error(`--split must be equal|jitter|fixed, got: ${opts.split}`);
      }

      // Target index list (range minus skips)
      if (opts.toIdxEnd < opts.toIdx) throw new Error("--to-idx-end must be >= --to-idx");
      const skipSet = new Set((opts.skip ?? []).map(Number));
      const targetIndices: number[] = [];
      for (let i = opts.toIdx; i <= opts.toIdxEnd; i += 1) {
        if (!skipSet.has(i)) targetIndices.push(i);
      }
      if (targetIndices.length === 0) throw new Error("Distribute produced 0 targets after skips");
      const targets = targetIndices.map((index) => ({
        index,
        address: deriveSourceAddress(index),
      }));

      // Decimals for the asset
      const decimals = isNative
        ? 18
        : (() => {
            const t = findToken(chain.chainId as number, token);
            if (!t) throw new Error(`Token "${token}" not found on ${chain.name}`);
            return t.decimals;
          })();

      // --- Resolve the spendable total (in base units) ---
      let total: bigint | undefined;
      let perWallet: bigint | undefined;

      if (strategy === "fixed") {
        if (!opts.per) throw new Error("--split fixed requires --per <amount>");
        perWallet = parseAmountToBase(opts.per, decimals);
      } else {
        total = await resolveTotalBase({
          amountArg: opts.amount,
          decimals,
          isNative,
          chain,
          from,
          token,
          targetCount: targetIndices.length,
          reserveGas: opts.reserveGas,
          reserveGasPerTx: opts.reserveGasPerTx ?? false,
        });
      }

      // --- THE MATH (deterministic, in code) ---
      const dist = computeDistribution({
        strategy,
        count: targetIndices.length,
        total,
        perWallet,
        jitterPct: opts.jitter,
        seed: opts.seed,
      });

      const plan = generateDistributePlan({
        chain: chain.name,
        from,
        targets,
        amounts: dist.amounts,
        token,
        name: opts.name,
      });

      const { written } = writePlan(plan, opts.out);
      if (opts.out) {
        console.error(chalk.green(`✔ Wrote distribute plan: ${plan.operations.length} ops, ${strategy} split`));
        console.error(chalk.dim(`  Allocated: ${ethers.formatUnits(dist.allocated, decimals)} ${isNative ? "native" : token}`));
        console.error(summarizePlan(plan));
      }
    });

  return cmd;
}

// --- distribute helpers ---

/** Parse a number / raw:N into base units. Rejects "all" (resolved earlier). */
function parseAmountToBase(input: string, decimals: number): bigint {
  const v = input.trim();
  const rawMatch = /^raw:(\d+)$/.exec(v);
  if (rawMatch) return BigInt(rawMatch[1]);
  if (/^\d+(\.\d+)?$/.test(v)) return ethers.parseUnits(v, decimals);
  throw new Error(`Invalid amount "${input}": expected a number or 'raw:N'`);
}

/**
 * Resolve the total base units to distribute. When amount === "all", reads the
 * source's LIVE balance from chain and subtracts any gas reserve — so the agent
 * never has to know or guess the balance.
 */
async function resolveTotalBase(args: {
  amountArg: string;
  decimals: number;
  isNative: boolean;
  chain: { name: string; chainId: number | string; rpcUrl: string };
  from: string | number;
  token: string;
  targetCount: number;
  reserveGas?: string;
  reserveGasPerTx: boolean;
}): Promise<bigint> {
  if (args.amountArg.trim() !== "all") {
    return parseAmountToBase(args.amountArg, args.decimals);
  }

  // Resolve source address
  const sourceAddress =
    typeof args.from === "string"
      ? args.from
      : deriveSourceAddress(args.from);

  const provider = new ethers.JsonRpcProvider(args.chain.rpcUrl);
  let balance: bigint;
  if (args.isNative) {
    balance = await provider.getBalance(sourceAddress);
  } else {
    const t = findToken(args.chain.chainId as number, args.token);
    if (!t) throw new Error(`Token "${args.token}" not found on ${args.chain.name}`);
    const iface = new ethers.Interface(["function balanceOf(address) view returns (uint256)"]);
    const data = iface.encodeFunctionData("balanceOf", [sourceAddress]);
    balance = BigInt(await provider.call({ to: t.address, data }));
  }

  // Gas reserve only applies to native "all"
  let reserve = 0n;
  if (args.isNative) {
    if (args.reserveGas) reserve += ethers.parseUnits(args.reserveGas.trim(), 18);
    if (args.reserveGasPerTx) {
      const fee = await provider.getFeeData();
      const gasPrice = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
      // 21000 gas per native transfer × number of distribute txs
      reserve += 21000n * gasPrice * BigInt(args.targetCount);
    }
  }

  const spendable = balance - reserve;
  if (spendable <= 0n) {
    throw new Error(
      `Source balance (${ethers.formatUnits(balance, args.decimals)}) too low after gas reserve ` +
        `(${ethers.formatUnits(reserve, args.decimals)})`
    );
  }
  return spendable;
}

function deriveSourceAddress(index: number): string {
  const { deriveEvmWalletAtIndex } = require("../lib/wallets") as typeof import("../lib/wallets");
  return deriveEvmWalletAtIndex(index).address;
}

function parseRecipientsList(raw: string): Array<{ address: string; amount: string; token?: string }> {
  return raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0).map((pair) => {
    // The pair is 'address:amount'. The address is 0x... so the first
    // colon after the 0x prefix is the delimiter. Amounts may contain
    // additional colons (e.g. usd:1.00, wei:1000) — those must be preserved.
    const idx = pair.indexOf(":");
    if (idx < 0) {
      throw new Error(`Invalid recipient "${pair}": expected 'address:amount'`);
    }
    const address = pair.slice(0, idx).trim();
    const amount = pair.slice(idx + 1).trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      throw new Error(`Invalid recipient address: "${address}"`);
    }
    if (amount.length === 0) {
      throw new Error(`Empty amount in recipient: "${pair}"`);
    }
    return { address, amount, token: "native" };  // multisend CLI is native-only
  });
}

function parseFromArg(value: string): string | number {
  const trimmed = value.trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(trimmed)) return trimmed;
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n < 0) {
      throw new Error(`--from must be a 0x address or non-negative integer, got: ${value}`);
    }
    return n;
  }
  throw new Error(`--from must be a 0x address or non-negative integer, got: ${value}`);
}

async function readCsvSource(file: string): Promise<string> {
  if (file === "-") {
    // stdin
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
    }
    if (chunks.length === 0) throw new Error("stdin is empty; expected CSV content");
    return Buffer.concat(chunks).toString("utf-8");
  }
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) throw new Error(`CSV file not found: ${abs}`);
  return fs.readFileSync(abs, "utf-8");
}

function expandOutPathForChain(outPath: string | undefined, chain: string): string | undefined {
  if (!outPath) return undefined;
  const ext = path.extname(outPath);
  const base = ext ? outPath.slice(0, -ext.length) : outPath;
  return `${base}.${slugify(chain)}${ext}`;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
