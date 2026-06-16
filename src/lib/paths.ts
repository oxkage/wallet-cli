import path from "node:path";

// Workspace root resolves relative to this file's location (dist/lib → repo root).
// BURNER_WALLETS_FILE in .env (if relative) is resolved against this root.
const workspaceRoot = path.resolve(__dirname, "../../..");

export const PATHS = {
  workspaceRoot,
  localConfigDir: path.resolve(workspaceRoot, ".burnerctl"),
  chainOverrideFile: path.resolve(workspaceRoot, ".burnerctl/chains.override.json"),
  walletIndexFile: path.resolve(workspaceRoot, ".burnerctl/wallet-index.map.json"),
  backupDir: path.resolve(workspaceRoot, ".burnerctl/backups"),
  // Phase 1 additions
  txHistoryFile: path.resolve(workspaceRoot, ".burnerctl/tx-history.jsonl"),
  priceCacheFile: path.resolve(workspaceRoot, ".burnerctl/price-cache.json"),
  // Phase 3 additions
  tokensOverrideFile: path.resolve(workspaceRoot, ".burnerctl/tokens.override.json"),
};
