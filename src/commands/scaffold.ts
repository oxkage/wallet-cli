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
import { generateSweepNftPlan } from "../lib/scaffold/sweepNft";
import { generateDistributeNftPlan } from "../lib/scaffold/distributeNft";
import { generateCallRangePlan } from "../lib/scaffold/callRange";
import { enumerateOwnership } from "../lib/nft/ownership";
import { deriveEvmWalletRange } from "../lib/wallets";
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

  // --- sweep-nft ---
  cmd
    .command("sweep-nft")
    .description("Generate an NFT sweep plan: transfer every owned tokenId of a collection, from each wallet in [fromIdx, toIdx], to one destination. Ownership is enumerated via the Alchemy NFT API (or ERC721Enumerable fallback).")
    .requiredOption("--chain <nameOrChainId>", "Chain name or chainId")
    .requiredOption("--contract <address>", "NFT collection 0x address")
    .requiredOption("--from-idx <N>", "First wallet index (inclusive)", (v) => indexArg.parse(v))
    .requiredOption("--to-idx <N>", "Last wallet index (inclusive)", (v) => indexArg.parse(v))
    .requiredOption("--to <address>", "Destination 0x address")
    .option("--strategy <alchemy|enumerable|auto>", "Ownership lookup strategy", "auto")
    .option("--unsafe", "Use plain transferFrom instead of safeTransferFrom", false)
    .option("--name <name>", "Plan name", "sweep-nft")
    .option("--out <file>", "Output plan JSON file (default: stdout)")
    .action(async (opts: {
      chain: string;
      contract: string;
      fromIdx: number;
      toIdx: number;
      to: string;
      strategy: string;
      unsafe?: boolean;
      name: string;
      out?: string;
    }) => {
      const chain = findChainOrThrow(chainArg.parse(opts.chain));
      const contract = addressArg.parse(opts.contract);
      const to = addressArg.parse(opts.to);
      if (!["alchemy", "enumerable", "auto"].includes(opts.strategy)) {
        throw new Error(`--strategy must be alchemy|enumerable|auto, got: ${opts.strategy}`);
      }
      const wallets = deriveEvmWalletRange(opts.fromIdx, opts.toIdx).map((w) => ({
        index: w.index,
        address: w.address,
      }));

      const ownership = await enumerateOwnership({
        chainId: chain.chainId as number,
        contract,
        wallets,
        strategy: opts.strategy as "alchemy" | "enumerable" | "auto",
        rpcUrl: chain.rpcUrl,
      });

      const totalTokens = ownership.reduce((n, r) => n + r.tokenIds.length, 0);
      const plan = generateSweepNftPlan({
        chain: chain.name,
        contract,
        to,
        ownership,
        unsafe: opts.unsafe,
        name: opts.name,
      });
      const { written } = writePlan(plan, opts.out);
      if (opts.out) {
        console.error(chalk.green(`✔ Wrote NFT sweep plan: ${plan.operations.length} transfers (${totalTokens} tokens across ${ownership.filter((r) => r.tokenIds.length > 0).length} wallets) to ${written}`));
        console.error(summarizeNftPlan(plan));
      }
    });

  // --- distribute-nft ---
  cmd
    .command("distribute-nft")
    .description("Generate an NFT distribute plan: spread one source wallet's owned tokenIds of a collection across many recipients (round-robin). Ownership enumerated via the Alchemy NFT API (or ERC721Enumerable fallback).")
    .requiredOption("--chain <nameOrChainId>", "Chain name or chainId")
    .requiredOption("--from <addrOrIdx>", "Source 0x... address or wallet index holding the NFTs")
    .requiredOption("--contract <address>", "NFT collection 0x address")
    .requiredOption("--recipients <list>", "Comma-separated recipient 0x addresses")
    .option("--token-ids <list>", "Comma-separated tokenIds to distribute (default: all the source owns)")
    .option("--strategy <alchemy|enumerable|auto>", "Ownership lookup strategy (when --token-ids omitted)", "auto")
    .option("--unsafe", "Use plain transferFrom instead of safeTransferFrom", false)
    .option("--name <name>", "Plan name", "distribute-nft")
    .option("--out <file>", "Output plan JSON file (default: stdout)")
    .action(async (opts: {
      chain: string;
      from: string;
      contract: string;
      recipients: string;
      tokenIds?: string;
      strategy: string;
      unsafe?: boolean;
      name: string;
      out?: string;
    }) => {
      const chain = findChainOrThrow(chainArg.parse(opts.chain));
      const contract = addressArg.parse(opts.contract);
      const from = parseFromArg(opts.from);
      const recipients = opts.recipients.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
      if (recipients.length === 0) throw new Error("--recipients must list at least one 0x address");

      // tokenIds: explicit list, or enumerate the source's holdings.
      let tokenIds: string[];
      if (opts.tokenIds && opts.tokenIds.trim().length > 0) {
        tokenIds = opts.tokenIds.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
      } else {
        const sourceAddress =
          typeof from === "string" ? from : deriveEvmWalletRange(from, from)[0].address;
        if (!["alchemy", "enumerable", "auto"].includes(opts.strategy)) {
          throw new Error(`--strategy must be alchemy|enumerable|auto, got: ${opts.strategy}`);
        }
        const ownership = await enumerateOwnership({
          chainId: chain.chainId as number,
          contract,
          wallets: [{ index: typeof from === "number" ? from : -1, address: sourceAddress }],
          strategy: opts.strategy as "alchemy" | "enumerable" | "auto",
          rpcUrl: chain.rpcUrl,
        });
        tokenIds = ownership[0]?.tokenIds ?? [];
        if (tokenIds.length === 0) {
          throw new Error(
            `Source ${sourceAddress} owns no tokens of ${contract} on ${chain.name}. ` +
              `Nothing to distribute. (Pass --token-ids to override.)`
          );
        }
      }

      const plan = generateDistributeNftPlan({
        chain: chain.name,
        from,
        contract,
        tokenIds,
        recipients,
        unsafe: opts.unsafe,
        name: opts.name,
      });
      const { written } = writePlan(plan, opts.out);
      if (opts.out) {
        console.error(chalk.green(`✔ Wrote NFT distribute plan: ${plan.operations.length} transfers (${tokenIds.length} tokens → ${recipients.length} recipients) to ${written}`));
        console.error(summarizeNftPlan(plan));
      }
    });

  // --- call-range ---
  cmd
    .command("call-range")
    .description("Generate a plan that broadcasts the SAME contract call from every wallet in [fromIdx, toIdx]. Canonical use: batch mint/claim/register with fixed args (e.g. mint(0,1) from idx 1..99). Fund the range first with 'scaffold distribute'.")
    .requiredOption("--chain <nameOrChainId>", "Chain name or chainId")
    .requiredOption("--to <address>", "Contract 0x address to call")
    .requiredOption("--fn <signature>", "Full function signature, e.g. \"mint(uint256,uint256)\". No ABI needed — the signature is enough to encode.")
    .requiredOption("--from-idx <N>", "First wallet index (inclusive)", (v) => indexArg.parse(v))
    .requiredOption("--to-idx <N>", "Last wallet index (inclusive)", (v) => indexArg.parse(v))
    .option("--abi <aliasOrPathOrJson>", "OPTIONAL. Only needed if --fn is a bare name. ABI alias (erc20/erc721/permit2), file path, or inline JSON.")
    .option("--args <list>", "Comma-separated fixed args applied to EVERY call (e.g. '0,1'). Use '' for no args.", "")
    .option("--value <amount>", "Per-call native value: '0' or 'wei:N' (for paid mints)", "0")
    .option("--skip <list>", "Comma-separated wallet indices to skip", (v: string) => v.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n)))
    .option("--parallel <N>", "Broadcast from up to N wallets concurrently (sets plan batchSize). Default 1 = sequential. Different wallets are independent; the per-address nonce manager keeps each wallet's own txs ordered.", (v) => indexArg.parse(v))
    .option("--delay-ms <ms>", "Throttle: wait this many ms between txs (helps stay under RPC rate limits, e.g. Alchemy). Applied within each wallet's sequence.", (v) => indexArg.parse(v))
    .option("--name <name>", "Plan name", "call-range")
    .option("--out <file>", "Output plan JSON file (default: stdout)")
    .action((opts: {
      chain: string;
      to: string;
      fn: string;
      fromIdx: number;
      toIdx: number;
      abi?: string;
      args: string;
      value: string;
      skip?: number[];
      parallel?: number;
      delayMs?: number;
      name: string;
      out?: string;
    }) => {
      const chain = findChainOrThrow(chainArg.parse(opts.chain));
      const to = addressArg.parse(opts.to);
      const args = opts.args.trim().length === 0
        ? []
        : opts.args.split(",").map((s) => s.trim());

      const options =
        opts.parallel !== undefined || opts.delayMs !== undefined
          ? {
              ...(opts.parallel !== undefined ? { batchSize: opts.parallel } : {}),
              ...(opts.delayMs !== undefined ? { delayMs: opts.delayMs } : {}),
            }
          : undefined;

      const plan = generateCallRangePlan({
        chain: chain.name,
        to,
        abi: opts.abi,
        fn: opts.fn,
        args,
        fromIdx: opts.fromIdx,
        toIdx: opts.toIdx,
        value: opts.value,
        skip: opts.skip,
        name: opts.name,
        options,
      });
      const { written } = writePlan(plan, opts.out);
      if (opts.out) {
        const par = opts.parallel ? ` (parallel=${opts.parallel})` : "";
        console.error(chalk.green(`✔ Wrote call-range plan: ${plan.operations.length} calls of ${opts.fn} from idx ${opts.fromIdx}..${opts.toIdx}${par} to ${written}`));
        console.error(summarizeCallRangePlan(plan));
      }
    });

  return cmd;
}

/** call-range summary (counts contract-call ops). */
function summarizeCallRangePlan(plan: { chain: string; operations: Array<{ type: string }> }) {
  const table = new Table({ head: ["Chain", "Total ops", "contract-call"] });
  const callCount = plan.operations.filter((o) => o.type === "contract-call").length;
  table.push([plan.chain, String(plan.operations.length), String(callCount)]);
  return table.toString();
}
function summarizeNftPlan(plan: { chain: string; operations: Array<{ type: string }> }) {
  const table = new Table({ head: ["Chain", "Total ops", "erc721-transfer"] });
  const nftCount = plan.operations.filter((o) => o.type === "erc721-transfer").length;
  table.push([plan.chain, String(plan.operations.length), String(nftCount)]);
  return table.toString();
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
