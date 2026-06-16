import fs from "node:fs";
import path from "node:path";
import { PATHS } from "./paths";

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function backupFileIfExists(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;

  ensureDir(PATHS.backupDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.resolve(PATHS.backupDir, `${path.basename(filePath)}.${stamp}.bak`);
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}
