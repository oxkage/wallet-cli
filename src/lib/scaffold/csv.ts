import type { Plan, PlanOperation } from "../plan/schema";

/**
 * CSV scaffold: turn a recipient list into a Plan.
 *
 * CSV format (one recipient per line):
 *
 *     address,amount[,token][,chain]
 *
 * The header row is optional and auto-detected (if the first non-comment
 * line's first cell is "address" — case-insensitive — we skip it).
 *
 * Lines starting with '#' (after optional leading whitespace) are
 * comments and ignored. Inline '# comments' at end of line are also
 * stripped before parsing.
 *
 * `token` column:
 *   - "native" (or empty) → emits a `native-send` op
 *   - any other string    → emits an `erc20-transfer` op (token symbol)
 *
 * `chain` column:
 *   - present and non-empty → that row belongs to that chain
 *   - absent / empty        → uses the plan's default chain
 *
 * Per-row chain overrides only work if every row agrees on the resulting
 * plan — i.e. a single Plan can only target one chain. If your CSV
 * mixes chains, the CLI writes one plan file per chain.
 */

export type RecipientSpec = {
  address: string;
  amount: string;
  token?: string;       // "native" or token symbol; undefined → native
  chain?: string;       // undefined → use plan default
};

export type GeneratePlanFromCsvOpts = {
  chain: string;                  // default chain for rows with no chain column
  from?: string | number;         // 0x address or non-negative integer index
  recipients: RecipientSpec[];
  name?: string;
  options?: Plan["options"];
};

const OP_TYPE_NATIVE = "native-send";
const OP_TYPE_ERC20 = "erc20-transfer";
const NATIVE = "native";

/**
 * Parse CSV content into a list of RecipientSpec. Does not validate
 * chain or from — that's the caller's job.
 *
 * Splits on commas, trims cells, ignores blank lines and lines starting
 * with '#'. Strips inline trailing comments after '#'.
 */
export function parseRecipientsCsv(content: string): RecipientSpec[] {
  if (typeof content !== "string") {
    throw new Error("CSV content must be a string");
  }

  // Normalize newlines, drop BOM
  const normalized = content.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const rawLines = normalized.split("\n");

  // First pass: strip comments + blank lines, track header detection.
  const cleanLines: string[] = [];
  for (const raw of rawLines) {
    let line = raw;
    // Drop inline comments: split on the first unquoted '#'
    const hashIdx = findUnquotedHash(line);
    if (hashIdx >= 0) line = line.slice(0, hashIdx);
    line = line.trim();
    if (line.length === 0) continue;
    if (line.startsWith("#")) continue;
    cleanLines.push(line);
  }

  if (cleanLines.length === 0) return [];

  // Auto-detect header: first cell == "address" (case-insensitive)
  let startIdx = 0;
  const firstCells = splitCsvLine(cleanLines[0]).map((c) => c.trim().toLowerCase());
  if (firstCells[0] === "address") {
    startIdx = 1;
  }

  const out: RecipientSpec[] = [];
  for (let i = startIdx; i < cleanLines.length; i += 1) {
    const line = cleanLines[i];
    const cells = splitCsvLine(line).map((c) => c.trim());
    if (cells.length < 2 || cells[0].length === 0) {
      throw new Error(`CSV parse error on line ${i + 1}: expected at least 2 columns, got ${cells.length}: "${line}"`);
    }

    const address = cells[0];
    const amount = cells[1];
    const token = cells[2] && cells[2].length > 0 ? cells[2] : undefined;
    const chain = cells[3] && cells[3].length > 0 ? cells[3] : undefined;

    out.push({ address, amount, token, chain });
  }

  return out;
}

/**
 * Generate a single Plan from a flat list of recipients, all on the
 * provided default chain. If a recipient carries a `chain` field that
 * differs from the default, an error is thrown — for multi-chain CSVs
 * the CLI uses `groupRecipientsByChain` and emits one plan per chain.
 */
export function generatePlanFromCsv(opts: GeneratePlanFromCsvOpts): Plan {
  if (!Array.isArray(opts.recipients) || opts.recipients.length === 0) {
    throw new Error("recipients must be a non-empty array");
  }
  if (typeof opts.chain !== "string" || opts.chain.length === 0) {
    throw new Error("chain is required");
  }

  // Validate that no recipient has a conflicting chain.
  for (let i = 0; i < opts.recipients.length; i += 1) {
    const r = opts.recipients[i];
    if (r.chain && r.chain !== opts.chain) {
      throw new Error(
        `recipients[${i}] has chain "${r.chain}" but plan chain is "${opts.chain}". ` +
          `For multi-chain CSVs the CLI emits one plan per chain; do not call generatePlanFromCsv directly.`
      );
    }
    validateAddress(r.address, `recipients[${i}].address`);
    if (typeof r.amount !== "string" || r.amount.length === 0) {
      throw new Error(`recipients[${i}].amount is required`);
    }
  }

  const plan: Plan = {
    version: 1,
    name: opts.name ?? "csv-multisend",
    chain: opts.chain,
    operations: [],
  };

  if (opts.from !== undefined) {
    if (typeof opts.from === "string") {
      validateAddress(opts.from, "from");
      plan.defaultFrom = opts.from;
    } else {
      if (!Number.isInteger(opts.from) || opts.from < 0) {
        throw new Error(`from index must be a non-negative integer, got: ${opts.from}`);
      }
      plan.defaultFromIndex = opts.from;
    }
  }

  const operations: PlanOperation[] = [];
  for (let i = 0; i < opts.recipients.length; i += 1) {
    const r = opts.recipients[i];
    const isNative = !r.token || r.token.toLowerCase() === NATIVE;
    const id = `csv-${i}`;

    if (isNative) {
      operations.push({
        id,
        type: OP_TYPE_NATIVE,
        to: r.address,
        value: r.amount,
      });
    } else {
      operations.push({
        id,
        type: OP_TYPE_ERC20,
        token: r.token as string,
        to: r.address,
        amount: r.amount,
      });
    }
  }

  plan.operations = operations;
  if (opts.options) plan.options = opts.options;
  return plan;
}

/**
 * Helper for multi-chain CSVs. Groups recipients by their effective
 * chain (using `defaultChain` when the row's chain is empty) and
 * returns an ordered list of (chain, recipients) pairs, one per chain.
 */
export function groupRecipientsByChain(
  recipients: RecipientSpec[],
  defaultChain: string
): Array<{ chain: string; recipients: RecipientSpec[] }> {
  const byChain = new Map<string, RecipientSpec[]>();
  for (const r of recipients) {
    const chain = (r.chain && r.chain.length > 0 ? r.chain : defaultChain).trim();
    if (!byChain.has(chain)) byChain.set(chain, []);
    byChain.get(chain)!.push({ ...r, chain: undefined });  // clear so generatePlanFromCsv doesn't error
  }
  return [...byChain.entries()].map(([chain, list]) => ({ chain, recipients: list }));
}

// --- internal helpers ---

/**
 * Find the index of the first unquoted '#' character. CSV does not
 * support quoted strings in this implementation (no double-quote
 * escapes), so '#' is always a comment marker. This still handles the
 * common case of '#' appearing inside addresses (e.g. "0x...#0") by
 * only treating it as a comment if it appears outside any quoted region.
 *
 * For our purposes: we only need to strip trailing comments. A '#' that
 * is preceded by whitespace starts a trailing comment.
 */
function findUnquotedHash(line: string): number {
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      // Skip over the quoted region
      i += 1;
      while (i < line.length && line[i] !== '"') i += 1;
      continue;
    }
    if (ch === "#" && (i === 0 || /\s/.test(line[i - 1]))) {
      return i;
    }
  }
  return -1;
}

/**
 * Split a single CSV line on commas. We don't support escaped quotes
 * (no double-quote doubling) but we do allow cells to be enclosed in
 * double-quotes so a comma inside the value doesn't split it. This is
 * the lightest weight parser that covers the spec.
 */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      // Toggle quoted state. We don't unescape "" → " (no spec need).
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      cells.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  cells.push(cur);
  return cells;
}

function validateAddress(value: string, fieldName: string): void {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`${fieldName} must be a 0x-prefixed 40-hex EVM address, got: ${value}`);
  }
}
