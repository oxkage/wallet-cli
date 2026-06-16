import fs from "node:fs";
import { z } from "zod";
import { backupFileIfExists, ensureDir } from "./backup";
import { PATHS } from "./paths";
import { deriveEvmWalletRange } from "./wallets";

export type WalletChain = "evm" | "solana";

const walletIndexEntrySchema = z
  .object({
    chain: z.enum(["evm", "solana"]),
    index: z.number().int().nonnegative(),
    path: z.string(),
    label: z.string(),
    address: z.string().optional(),
    publicKey: z.string().optional()
  })
  .superRefine((entry, ctx) => {
    if (entry.chain === "evm" && !entry.address) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "evm entry missing address" });
    }
    if (entry.chain === "solana" && !entry.publicKey) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "solana entry missing publicKey" });
    }
  });

const walletIndexMapSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  source: z.object({
    mode: z.enum(["env"]),
    fromIndex: z.number().int().nonnegative(),
    toIndex: z.number().int().nonnegative()
  }),
  entries: z.record(walletIndexEntrySchema)
});

export type WalletIndexEntry = z.infer<typeof walletIndexEntrySchema>;
export type WalletIndexMap = z.infer<typeof walletIndexMapSchema>;

export function saveWalletIndexMap(chain: "evm" | "solana" | "both" = "both", from = 0, to = 199): WalletIndexMap {
  if (chain === "solana" || chain === "both") {
    throw new Error("Solana indexing is not available in SEED_PHRASE-only mode. Use --chain evm.");
  }

  const entries: Record<string, WalletIndexEntry> = {};
  for (const w of deriveEvmWalletRange(from, to)) {
    entries[w.address.toLowerCase()] = {
      chain: "evm",
      index: w.index,
      path: w.path,
      label: `evm:${w.index}`,
      address: w.address
    };
  }

  const indexMap: WalletIndexMap = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: {
      mode: "env",
      fromIndex: from,
      toIndex: to
    },
    entries
  };

  ensureDir(PATHS.localConfigDir);
  backupFileIfExists(PATHS.walletIndexFile);
  fs.writeFileSync(PATHS.walletIndexFile, `${JSON.stringify(indexMap, null, 2)}\n`, "utf8");

  return indexMap;
}

export function loadWalletIndexMap(): WalletIndexMap | null {
  if (!fs.existsSync(PATHS.walletIndexFile)) return null;
  const raw = fs.readFileSync(PATHS.walletIndexFile, "utf8");
  const parsed = JSON.parse(raw);
  return walletIndexMapSchema.parse(parsed);
}

export function resolveWalletAddress(addrOrPubkey: string, chain: "evm" | "solana" | "both" = "both"): WalletIndexEntry | null {
  const key = addrOrPubkey.trim().toLowerCase();
  if (!key) throw new Error("Address/publicKey is empty");

  if (chain === "solana" || chain === "both") {
    throw new Error("Address resolution currently supports EVM only in SEED_PHRASE mode. Use --chain evm.");
  }

  let indexMap = loadWalletIndexMap();
  if (!indexMap) {
    indexMap = saveWalletIndexMap("evm");
  }

  const entry = indexMap.entries[key] ?? null;
  if (!entry) return null;
  return entry.chain === chain ? entry : null;
}
