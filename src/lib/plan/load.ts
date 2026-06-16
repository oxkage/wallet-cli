import fs from "node:fs/promises";
import path from "node:path";
import { planSchema, type Plan } from "./schema";

/**
 * Load a plan from a file path or stdin.
 *
 *   loadPlan("/path/to/plan.json")   → reads file
 *   loadPlan()                       → reads stdin
 *   loadPlan("-")                    → reads stdin (explicit)
 */

export async function loadPlan(source?: string): Promise<Plan> {
  const raw = await readSource(source);
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Plan is not valid JSON: ${(e as Error).message}`);
  }
  const plan = planSchema.parse(json);
  return plan;
}

async function readSource(source?: string): Promise<string> {
  if (source && source !== "-") {
    const abs = path.resolve(source);
    return fs.readFile(abs, "utf-8");
  }
  // stdin
  return readStdin();
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new Error("No plan source provided. Pass a file path or pipe JSON via stdin.");
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  if (chunks.length === 0) {
    throw new Error("stdin is empty; expected JSON plan");
  }
  return Buffer.concat(chunks).toString("utf-8");
}

export function tryLoadPlanFromFile(filePath: string): Promise<Plan> {
  return loadPlan(filePath);
}
