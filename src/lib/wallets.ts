import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";
import { z } from "zod";
import { PATHS } from "./paths";

const evmWalletSchema = z.object({
  index: z.number().int().nonnegative(),
  path: z.string(),
  address: z.string(),
  privateKey: z.string().optional()
});

export const burnerWalletSchema = z.object({
  mnemonic: z.string(),
  metadata: z.object({
    total_wallets: z.number().int().nonnegative(),
    evm_count: z.number().int().nonnegative(),
    updated_at: z.string()
  }),
  wallets: z.object({
    evm: z.array(evmWalletSchema)
  })
});

export type BurnerWalletFile = z.infer<typeof burnerWalletSchema>;

function resolveWalletFilePath(inputPath: string): string {
  return path.isAbsolute(inputPath) ? inputPath : path.resolve(PATHS.workspaceRoot, inputPath);
}

export function getOptionalWalletFilePath(): string | null {
  const configured = process.env.BURNER_WALLETS_FILE?.trim();
  if (!configured) return null;
  return resolveWalletFilePath(configured);
}

export function loadWalletFileFromEnvOrThrow(): BurnerWalletFile {
  const filePath = getOptionalWalletFilePath();
  if (!filePath) {
    throw new Error("No wallet file configured. Set BURNER_WALLETS_FILE or use SEED_PHRASE-based commands.");
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`Configured wallet file not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);
  return burnerWalletSchema.parse(parsed);
}

export function getSeedPhraseOrThrow(): string {
  const phrase = process.env.SEED_PHRASE?.trim();
  if (!phrase) throw new Error("SEED_PHRASE is required in .env for mnemonic-based operations.");
  if (!ethers.Mnemonic.isValidMnemonic(phrase)) throw new Error("SEED_PHRASE is invalid.");
  return phrase;
}

export function deriveEvmWalletAtIndex(index: number): { index: number; path: string; address: string; privateKey: string } {
  if (!Number.isInteger(index) || index < 0) throw new Error(`Invalid derivation index: ${index}`);
  const phrase = getSeedPhraseOrThrow();
  const path = `m/44'/60'/0'/0/${index}`;
  const wallet = ethers.HDNodeWallet.fromPhrase(phrase, undefined, path);
  return { index, path, address: wallet.address, privateKey: wallet.privateKey };
}

export function deriveEvmWalletRange(from: number, to: number): Array<{ index: number; path: string; address: string; privateKey: string }> {
  if (to < from) throw new Error("Invalid range: to < from");
  const out: Array<{ index: number; path: string; address: string; privateKey: string }> = [];
  for (let i = from; i <= to; i += 1) out.push(deriveEvmWalletAtIndex(i));
  return out;
}

export function findDerivedEvmWalletByAddress(address: string, maxIndex = 200): { index: number; path: string; address: string; privateKey: string } {
  const normalized = address.trim().toLowerCase();
  if (!ethers.isAddress(normalized)) throw new Error(`Invalid EVM address: ${address}`);

  for (let i = 0; i <= maxIndex; i += 1) {
    const wallet = deriveEvmWalletAtIndex(i);
    if (wallet.address.toLowerCase() === normalized) return wallet;
  }

  throw new Error(`Address not found from SEED_PHRASE derivation range 0..${maxIndex}. Increase search limit if needed.`);
}
