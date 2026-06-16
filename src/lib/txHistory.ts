import fs from "node:fs";
import { z } from "zod";
import { PATHS } from "./paths";
import { ensureDir } from "./backup";

/**
 * Append-only JSONL log of every successful on-chain action.
 * Lives at .burnerctl/tx-history.jsonl
 *
 * Phase 1: tx.ts logs successful sends. Phase 5 adds the `history` command to query.
 */

const txStatusSchema = z.enum(["submitted", "success", "reverted", "failed", "dry-run"]);

const txEntrySchema = z.object({
  ts: z.string(),
  plan: z.string().optional(),
  opId: z.string().optional(),
  chain: z.string(),
  chainId: z.union([z.number(), z.string()]),
  op: z.string(),                              // "native-send" | "sweep-native" | "erc20-transfer" | ...
  from: z.string(),
  fromIndex: z.number().int().nonnegative().optional(),
  to: z.string().optional(),
  token: z.string().optional(),
  amount: z.string().optional(),
  valueWei: z.string().optional(),
  hash: z.string().optional(),
  blockNumber: z.number().int().optional(),
  gasUsed: z.string().optional(),
  effectiveGasPrice: z.string().optional(),
  status: txStatusSchema,
  error: z.object({ code: z.string(), message: z.string() }).optional(),
  note: z.string().optional(),
});

export type TxEntry = z.infer<typeof txEntrySchema>;
export type TxStatus = z.infer<typeof txStatusSchema>;

function readAll(): TxEntry[] {
  const file = PATHS.txHistoryFile;
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, "utf8");
  const out: TxEntry[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(txEntrySchema.parse(JSON.parse(trimmed)));
    } catch {
      // skip malformed lines silently — log is append-only, never break callers
    }
  }
  return out;
}

function append(entry: TxEntry): void {
  ensureDir(PATHS.localConfigDir);
  fs.appendFileSync(PATHS.txHistoryFile, JSON.stringify(entry) + "\n");
}

export function logTx(entry: Omit<TxEntry, "ts"> & { ts?: string }): void {
  append({ ts: new Date().toISOString(), ...entry } as TxEntry);
}

export type TxQuery = {
  chain?: string;
  status?: TxStatus;
  since?: string;                  // ISO date
  until?: string;
  plan?: string;
  opId?: string;
  hash?: string;
  limit?: number;
};

export function queryTx(filter: TxQuery = {}): TxEntry[] {
  const all = readAll();
  const since = filter.since ? new Date(filter.since).getTime() : -Infinity;
  const until = filter.until ? new Date(filter.until).getTime() : Infinity;
  const limit = filter.limit ?? 100;

  const filtered = all.filter((e) => {
    const t = new Date(e.ts).getTime();
    if (t < since || t > until) return false;
    if (filter.chain && e.chain !== filter.chain) return false;
    if (filter.status && e.status !== filter.status) return false;
    if (filter.plan && e.plan !== filter.plan) return false;
    if (filter.opId && e.opId !== filter.opId) return false;
    if (filter.hash && e.hash !== filter.hash) return false;
    return true;
  });

  // Newest first
  filtered.sort((a, b) => b.ts.localeCompare(a.ts));
  return filtered.slice(0, limit);
}

export function tailTx(n = 20): TxEntry[] {
  return queryTx({ limit: n });
}
