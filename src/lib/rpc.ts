import { PATHS } from "./paths";
import { ensureDir } from "./backup";

export type JsonRpcOptions = {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  fallbackUrls?: string[];
};

export type JsonRpcError = {
  code: number;
  message: string;
};

export class JsonRpcCallError extends Error {
  readonly code: number;
  readonly httpStatus?: number;
  readonly rpcUrl: string;
  constructor(message: string, code: number, rpcUrl: string, httpStatus?: number) {
    super(message);
    this.name = "JsonRpcCallError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.rpcUrl = rpcUrl;
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function attempt(
  rpcUrl: string,
  method: string,
  params: unknown[],
  timeoutMs: number
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new JsonRpcCallError(`http_${res.status}`, -32000, rpcUrl, res.status);
    }
    const json = (await res.json()) as { result?: unknown; error?: JsonRpcError };
    if (json.error) {
      throw new JsonRpcCallError(
        json.error.message || "rpc_error",
        json.error.code ?? -32603,
        rpcUrl
      );
    }
    return json.result;
  } catch (err) {
    if (err instanceof JsonRpcCallError) throw err;
    if ((err as Error).name === "AbortError") {
      throw new JsonRpcCallError("timeout", -32000, rpcUrl);
    }
    throw new JsonRpcCallError((err as Error).message || "network_error", -32000, rpcUrl);
  } finally {
    clearTimeout(timer);
  }
}

function isRetryable(err: unknown): boolean {
  if (!(err instanceof JsonRpcCallError)) return false;
  if (err.httpStatus && err.httpStatus >= 500) return true;
  if (err.message === "timeout") return true;
  if (err.message === "network_error") return true;
  // Common transient EVM codes
  if ([-32005, -32603, -32000].includes(err.code)) return true;
  return false;
}

/**
 * Post a JSON-RPC request to a single endpoint with timeout + retry.
 * Preserved signature for backward compatibility with chains.ts.
 */
export async function postJsonRpc(
  rpcUrl: string,
  method: string,
  params: unknown[],
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<unknown> {
  return attempt(rpcUrl, method, params, timeoutMs);
}

/**
 * Post with retries (same URL) and optional fallback URLs.
 * Tries fallback URLs only after same-URL retries are exhausted.
 */
export async function postJsonRpcResilient(
  primaryUrl: string,
  method: string,
  params: unknown[],
  opts: JsonRpcOptions = {}
): Promise<unknown> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = opts.retries ?? DEFAULT_RETRIES;
  const retryDelayMs = opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const urls = [primaryUrl, ...(opts.fallbackUrls ?? [])];

  let lastErr: unknown;
  for (const url of urls) {
    for (let attemptIdx = 0; attemptIdx <= retries; attemptIdx += 1) {
      try {
        return await attempt(url, method, params, timeoutMs);
      } catch (err) {
        lastErr = err;
        const retryable = isRetryable(err);
        const isLastAttempt = attemptIdx === retries;
        if (!retryable || isLastAttempt) break;
        await sleep(retryDelayMs * (attemptIdx + 1));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("rpc_failed");
}
