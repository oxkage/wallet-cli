import { Command } from "commander";
import { ethers } from "ethers";
import { z } from "zod";
import Table from "cli-table3";
import { findChain, getChainsWithOverrides } from "../lib/chainState";
import { deriveEvmWalletRange } from "../lib/wallets";
import { safeLog } from "../lib/redact";

const balanceSchema = z.object({
  chain: z.string().min(1),
  from: z.coerce.number().int().min(0).default(0),
  to: z.coerce.number().int().min(0).default(199),
  format: z.enum(["json", "table"]).default("table"),
  showZero: z.boolean().default(false),
  // Optional: fetch ETH price for USD conversion
  showUsd: z.boolean().default(false),
});

async function fetchEthUsdPrice(): Promise<number | null> {
  try {
    const res = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot", {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: { amount?: string } };
    const amount = json?.data?.amount;
    return amount ? parseFloat(amount) : null;
  } catch {
    return null;
  }
}

async function getEvmBalance(
  provider: ethers.JsonRpcProvider,
  address: string
): Promise<bigint> {
  const balance = await provider.getBalance(address);
  return balance;
}

export function balanceCommand(): Command {
  const balance = new Command("balance").description(
    "Check native token balances for wallets across chains"
  );

  balance
    .requiredOption("--chain <nameOrChainId>")
    .option("--from <index>", "Start derivation index", "0")
    .option("--to <index>", "End derivation index", "199")
    .option("--format <json|table>", "Output format", "table")
    .option("--show-zero", "Include wallets with zero balance", false)
    .option("--show-usd", "Show USD conversion (EVM chains only)", false)
    .action(async (opts) => {
      const parsed = balanceSchema.parse(opts);
      if (parsed.to < parsed.from) {
        throw new Error("--to must be >= --from");
      }

      const enabledChains = getChainsWithOverrides().filter((c) => c.enabled);
      const chain = findChain(parsed.chain, enabledChains);
      if (!chain) {
        throw new Error(`Enabled chain not found: ${parsed.chain}`);
      }

      if (chain.type !== "evm") {
        throw new Error(`Chain ${chain.name} is not EVM (only EVM supported for now)`);
      }

      const wallets = deriveEvmWalletRange(parsed.from, parsed.to);
      const provider = new ethers.JsonRpcProvider(chain.rpcUrl);

      // Fetch ETH price if USD conversion requested
      let ethUsd: number | null = null;
      if (parsed.showUsd) {
        ethUsd = await fetchEthUsdPrice();
        if (ethUsd === null) {
          safeLog({ warning: "USD price fetch failed, showing ETH only" });
        }
      }

      // Fetch balances in parallel with rate limiting
      const results: Array<{
        index: number;
        address: string;
        balanceWei: bigint;
        balanceEth: number;
      }> = [];

      // Simple sequential for now to avoid rate limits
      for (const wallet of wallets) {
        try {
          const balanceWei = await getEvmBalance(provider, wallet.address);
          const balanceEth = parseFloat(ethers.formatEther(balanceWei));
          results.push({
            index: wallet.index,
            address: wallet.address,
            balanceWei,
            balanceEth,
          });
        } catch (error) {
          safeLog({
            error: `Failed to fetch balance for ${wallet.address}`,
            message: (error as Error).message,
          });
          // Push with zero balance on error? Or skip?
          results.push({
            index: wallet.index,
            address: wallet.address,
            balanceWei: 0n,
            balanceEth: 0,
          });
        }
        // Small delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      // Filter out zero balances if not requested
      const filteredResults = parsed.showZero
        ? results
        : results.filter((r) => r.balanceWei > 0n);

      if (parsed.format === "json") {
        const output = filteredResults.map((r) => ({
          index: r.index,
          address: r.address,
          balance_wei: r.balanceWei.toString(),
          balance_eth: r.balanceEth,
          balance_usd: ethUsd ? r.balanceEth * ethUsd : null,
        }));
        console.log(JSON.stringify(output, null, 2));
        return;
      }

      // Table format
      const table = new Table({
        head: ethUsd
          ? ["Index", "Address", "Balance (ETH)", "USD"]
          : ["Index", "Address", "Balance (ETH)"],
      });

      let totalEth = 0;
      let totalUsd = 0;

      for (const r of filteredResults) {
        const usdValue = ethUsd ? r.balanceEth * ethUsd : null;
        totalEth += r.balanceEth;
        if (usdValue) totalUsd += usdValue;

        const addressShort =
          r.address.substring(0, 10) + "..." + r.address.substring(r.address.length - 8);

        const row = [r.index.toString(), addressShort, r.balanceEth.toFixed(6)];
        if (ethUsd) {
          row.push(usdValue?.toFixed(2) || "N/A");
        }
        table.push(row);
      }

      console.log(`\nChain: ${chain.name} (${chain.chainId})`);
      console.log(`RPC: ${chain.rpcUrl}`);
      console.log(`Wallets: ${parsed.from} to ${parsed.to} (${wallets.length} total)`);
      console.log(`Non-zero wallets: ${filteredResults.length}\n`);
      console.log(table.toString());

      if (filteredResults.length > 0) {
        console.log(`\nTotal balance: ${totalEth.toFixed(6)} ETH`);
        if (ethUsd) {
          console.log(`Total USD: $${totalUsd.toFixed(2)}`);
        }
      }

      // Log summary for programmatic use
      safeLog({
        action: "balance.check",
        chain: chain.name,
        chainId: chain.chainId,
        fromIndex: parsed.from,
        toIndex: parsed.to,
        totalWallets: wallets.length,
        nonZeroWallets: filteredResults.length,
        totalEth,
        totalUsd: ethUsd ? totalUsd : undefined,
        success: true,
      });
    });

  return balance;
}