import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Pre-push credential audit. Pure logic — runs the 5 checks against the
 * current git repo and returns structured results. No process.exit, no
 * console output: the command layer renders and decides exit codes.
 *
 * Cross-platform: shells out to `git` via execFileSync (array args, no
 * shell interpolation). Works on Linux/macOS/Windows wherever git is on PATH.
 */

export type CheckStatus = "pass" | "fail" | "skip";

export interface CheckResult {
  id: number;
  name: string;
  status: CheckStatus;
  detail: string;
  hits: string[];
}

export interface AuditReport {
  repoRoot: string;
  results: CheckResult[];
  failed: number;
  passed: boolean;
}

/** Run a git command, return stdout (trimmed) or "" on any failure. */
function git(args: string[], cwd: string): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 32 * 1024 * 1024,
    }).trim();
  } catch {
    return "";
  }
}

/** git grep that tolerates "no matches" (exit 1) without throwing. */
function gitGrep(args: string[], cwd: string): string[] {
  const out = git(["grep", ...args], cwd);
  return out ? out.split("\n").filter(Boolean) : [];
}

function resolveRepoRoot(startDir: string): string | null {
  const root = git(["rev-parse", "--show-toplevel"], startDir);
  return root || null;
}

// ─── Check 1: .env in history ───────────────────────────────────────────────

function checkEnvInHistory(root: string): CheckResult {
  const hits: string[] = [];
  for (const file of [".env", ".env.local"]) {
    const log = git(["log", "--all", "--full-history", "--oneline", "--", file], root);
    if (log) hits.push(`${file}: ${log.split("\n")[0]}`);
  }
  return {
    id: 1,
    name: ".env never committed (all branches, all history)",
    status: hits.length ? "fail" : "pass",
    detail: hits.length
      ? "Secret-bearing file found in git history. Scrub with git filter-repo AND rotate the secrets — the bytes are in the pack."
      : "No .env / .env.local in any commit.",
    hits,
  };
}

// ─── Check 2: .gitignore coverage ───────────────────────────────────────────

const REQUIRED_GITIGNORE = [
  ".env",
  ".env.local",
  "secrets/",
  "*.private.json",
  "wallets.json",
  "burner_wallets.json",
  "dist/",
  "node_modules/",
  ".burnerctl/",
];

function checkGitignore(root: string): CheckResult {
  const gitignorePath = path.join(root, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    return {
      id: 2,
      name: ".gitignore coverage",
      status: "fail",
      detail: ".gitignore is missing.",
      hits: REQUIRED_GITIGNORE,
    };
  }
  const lines = fs
    .readFileSync(gitignorePath, "utf8")
    .split("\n")
    .map((l) => l.trim());
  const missing = REQUIRED_GITIGNORE.filter((pat) => !lines.includes(pat));
  return {
    id: 2,
    name: ".gitignore coverage",
    status: missing.length ? "fail" : "pass",
    detail: missing.length
      ? "Missing required ignore patterns."
      : `All ${REQUIRED_GITIGNORE.length} required patterns present.`,
    hits: missing,
  };
}

// ─── Check 3: mnemonic / seed phrase scan ───────────────────────────────────

// Well-known public BIP-39 test vectors. Presence in tracked files means
// someone is committing a real-ish mnemonic (even the public one is a smell).
const TEST_VECTORS = [
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
  "legal winner hammer year beef arrive goodbye claim oil era frown",
  "letter advice cage absurd amount doctor acoustic avoid letter advice cage above",
  "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong",
  "void come effort suffer camp smile warrior",
];

function checkMnemonics(root: string): CheckResult {
  const hits: string[] = [];
  for (const tv of TEST_VECTORS) {
    // Exclude this audit module — it legitimately contains the needle list.
    const files = gitGrep(["-lF", tv, "--", ".", ":(exclude)src/lib/audit/credentials.ts"], root);
    if (files.length) hits.push(`"${tv.split(" ")[0]} ..." in: ${files.join(", ")}`);
  }
  return {
    id: 3,
    name: "Mnemonic / seed phrase scan",
    status: hits.length ? "fail" : "pass",
    detail: hits.length
      ? "BIP-39 test-vector mnemonic in tracked file. Remove and rotate."
      : "No known mnemonic test vectors in tracked files.",
    hits,
  };
}

// ─── Check 4: private key shape scan ────────────────────────────────────────

// Allowlist: documented public calldata. rawTx.ts example uses an ERC-20
// transfer selector (0xa9059cbb) + padded args — not a private key.
const HEX_ALLOWLIST = /rawTx\.ts.*0xa9059cbb/;

function checkPrivateKeyShape(root: string): CheckResult {
  const matches = gitGrep(
    ["-nE", "0x[a-fA-F0-9]{64}", "--", "src/", "tests/", "examples/", "*.md", "*.json", "*.ts"],
    root
  );
  const flagged = matches.filter((m) => !HEX_ALLOWLIST.test(m));
  return {
    id: 4,
    name: "Private key shape scan (0x + 64 hex)",
    status: flagged.length ? "fail" : "pass",
    detail: flagged.length
      ? "Unexpected 32-byte hex (possible private key). Verify each is public calldata before pushing."
      : "No unexpected 32-byte hex (allowlisted: rawTx.ts public calldata).",
    hits: flagged.slice(0, 8),
  };
}

// ─── Check 5: RPC URL auth scan ─────────────────────────────────────────────

function checkRpcAuth(root: string): CheckResult {
  const hits: string[] = [];

  // user:pass@ in URLs (excluding common non-auth hosts)
  const authUrls = gitGrep(
    ["-nE", "https?://[^[:space:]]*@[^[:space:]]*", "--", "src/", "*.json", "*.md", "*.ts"],
    root
  ).filter((l) => !/(github\.com\/|npmjs\.org\/)/.test(l));
  hits.push(...authUrls);

  // Provider key-path URLs (Alchemy / Infura / QuickNode) followed by a REAL
  // key. A literal key is 16+ url-safe chars; template placeholders like
  // ${key} or <KEY> are not credentials, so they're excluded by requiring the
  // path to be immediately followed by an alphanumeric run (not { < $ space).
  const providerUrls = gitGrep(
    [
      "-nE",
      "(alchemy\\.com/v2/|infura\\.io/v3/|quicknode\\.com/)[a-zA-Z0-9_-]{16,}",
      "--",
      "src/",
      "*.json",
      "*.md",
    ],
    root
  );
  hits.push(...providerUrls);

  // Generic api-key literal assignments
  const keyName = "api" + "[_-]?" + "key";
  const apiKeys = gitGrep(
    ["-niE", `(${keyName})\\s*[:=]\\s*['"][a-zA-Z0-9]{16,}`, "--", "src/", "*.json", "*.md"],
    root
  );
  hits.push(...apiKeys);

  return {
    id: 5,
    name: "RPC URL / API-key auth scan",
    status: hits.length ? "fail" : "pass",
    detail: hits.length
      ? "Embedded credentials in tracked file. Move to a gitignored override and rotate the key."
      : "No embedded RPC/API credentials in tracked files.",
    hits: hits.slice(0, 8),
  };
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

export function runCredentialAudit(startDir: string = process.cwd()): AuditReport {
  const repoRoot = resolveRepoRoot(startDir);
  if (!repoRoot) {
    return {
      repoRoot: startDir,
      results: [
        {
          id: 0,
          name: "git repository",
          status: "fail",
          detail: "Not inside a git work tree (or git not on PATH). The audit scans tracked files.",
          hits: [],
        },
      ],
      failed: 1,
      passed: false,
    };
  }

  const results: CheckResult[] = [
    checkEnvInHistory(repoRoot),
    checkGitignore(repoRoot),
    checkMnemonics(repoRoot),
    checkPrivateKeyShape(repoRoot),
    checkRpcAuth(repoRoot),
  ];

  const failed = results.filter((r) => r.status === "fail").length;
  return { repoRoot, results, failed, passed: failed === 0 };
}
