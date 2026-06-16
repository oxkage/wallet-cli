import fs from "node:fs";
import { z } from "zod";
import { DEFAULT_CHAINS } from "../config/chains";
import { alchemyRpcUrl } from "../config/alchemy";
import type { Chain } from "../types/chains";
import { backupFileIfExists, ensureDir } from "./backup";
import { PATHS } from "./paths";

const chainOverrideSchema = z.object({
  disabled: z.array(z.string()).default([])
});

type ChainOverride = z.infer<typeof chainOverrideSchema>;

function readOverride(): ChainOverride {
  if (!fs.existsSync(PATHS.chainOverrideFile)) return { disabled: [] };
  const parsed = JSON.parse(fs.readFileSync(PATHS.chainOverrideFile, "utf8"));
  return chainOverrideSchema.parse(parsed);
}

function writeOverride(next: ChainOverride): string | null {
  ensureDir(PATHS.localConfigDir);
  const backupPath = backupFileIfExists(PATHS.chainOverrideFile);
  fs.writeFileSync(PATHS.chainOverrideFile, JSON.stringify(next, null, 2));
  return backupPath;
}

function keyOf(chain: Chain): string {
  return `${chain.name.toLowerCase()}::${String(chain.chainId).toLowerCase()}`;
}

export function getChainsWithOverrides(): Chain[] {
  const override = readOverride();
  const disabledSet = new Set(override.disabled.map((x) => x.toLowerCase()));

  return DEFAULT_CHAINS.map((c) => {
    // Prefer an Alchemy endpoint when ALCHEMY_API_KEY is set and the chain is
    // supported; otherwise keep the bundled public RPC as fallback.
    const rpcUrl = alchemyRpcUrl(c.chainId) ?? c.rpcUrl;
    return { ...c, rpcUrl, enabled: !disabledSet.has(keyOf(c)) };
  });
}

export function findChain(input: string, chains: Chain[]): Chain | undefined {
  const needle = input.trim().toLowerCase();
  return chains.find((c) => c.name.toLowerCase() === needle || String(c.chainId).toLowerCase() === needle);
}

export function setChainEnabled(input: string, enabled: boolean): { chain: Chain; backupPath: string | null } {
  const chains = getChainsWithOverrides();
  const chain = findChain(input, chains);
  if (!chain) {
    throw new Error(`Chain not found: ${input}`);
  }

  const currentOverride = readOverride();
  const key = keyOf(chain);
  const set = new Set(currentOverride.disabled.map((x) => x.toLowerCase()));
  if (enabled) set.delete(key);
  else set.add(key);

  const backupPath = writeOverride({ disabled: [...set] });
  return { chain, backupPath };
}
