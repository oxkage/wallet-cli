import { ethers } from "ethers";
import type { Chain } from "../../types/chains";
import { findChain, getChainsWithOverrides } from "../chainState";
import { resolveConnectedSigner, type ResolvedSigner } from "../signer";
import { resolveFees, type ResolvedFees } from "../gas";
import { getUsdPrice } from "../usd";
import * as nonceLib from "../nonce";
import { logTx, type TxEntry } from "../txHistory";
import type { Plan } from "../plan/schema";

/**
 * Per-op execution context. Built once per plan, shared by all ops.
 * Provides everything an op needs: chain info, provider, signer resolver,
 * gas oracle, nonce manager, history logger, and dry-run/simulate flags.
 */
export type OpContext = {
  planName?: string;
  chain: Chain;
  provider: ethers.JsonRpcProvider;
  fees: ResolvedFees;
  resolveSigner: (address: string) => Promise<ResolvedSigner>;
  reserveNonce: (address: string) => Promise<number>;
  releaseNonce: (address: string, n: number) => void;
  confirmNonce: (address: string, n: number) => void;
  getUsdPrice: (symbol: string) => Promise<number | null>;
  getNativeBalance: (address: string) => Promise<bigint>;
  getTokenBalance: (tokenAddress: string, holder: string) => Promise<bigint>;
  log: (entry: Omit<TxEntry, "ts" | "chain" | "chainId">) => void;
  simulate: boolean;
  dryRun: boolean;
  stopOnError: boolean;
};

export async function buildContext(plan: Plan, cliDryRun: boolean): Promise<OpContext> {
  const enabledChains = getChainsWithOverrides().filter((c) => c.enabled);
  const chain = findChain(plan.chain, enabledChains);
  if (!chain) throw new Error(`Chain not found or disabled: ${plan.chain}`);

  const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
  const fees = await resolveFees(provider, "normal");

  const erc20Iface = new ethers.Interface([
    "function balanceOf(address account) view returns (uint256)",
  ]);

  return {
    planName: plan.name,
    chain,
    provider,
    fees,
    async resolveSigner(address: string) {
      return resolveConnectedSigner(address, provider, 1000);
    },
    async reserveNonce(address: string) {
      return nonceLib.next(provider, address);
    },
    releaseNonce(address: string, n: number) {
      nonceLib.release(address, n);
    },
    confirmNonce(address: string, n: number) {
      nonceLib.confirm(address, n);
    },
    getUsdPrice: (sym: string) => getUsdPrice(sym),
    async getNativeBalance(address: string) {
      return provider.getBalance(address);
    },
    async getTokenBalance(tokenAddress: string, holder: string) {
      const data = erc20Iface.encodeFunctionData("balanceOf", [holder]);
      const result = await provider.call({ to: tokenAddress, data });
      return BigInt(result);
    },
    log(entry) {
      logTx({
        plan: plan.name,
        chain: chain.name,
        chainId: chain.chainId as number,
        ...entry,
      });
    },
    simulate: plan.options?.simulate ?? true,
    dryRun: plan.options?.dryRun ?? cliDryRun,
    stopOnError: plan.options?.stopOnError ?? false,
  };
}
