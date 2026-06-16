/**
 * Bounded-concurrency scheduler for plan operations.
 *
 * Correctness rule: ops from the SAME wallet (`from` address) MUST run
 * sequentially to preserve nonce ordering. Ops from DIFFERENT wallets are
 * independent and may run concurrently.
 *
 * Strategy: group ops by resolved `from` address. Run each group's ops
 * sequentially (in original plan order). Run up to `concurrency` groups in
 * parallel. This is exactly what the per-address nonce manager guarantees:
 * one sequential writer per address.
 *
 * `concurrency = 1` reproduces the original strictly-sequential behavior
 * (the historical default — zero behavior change for existing plans).
 */

export interface SchedulableOp<T> {
  /** The op payload (whatever the caller wants to run). */
  op: T;
  /** Resolved sender address — the grouping key. Undefined groups together. */
  from: string | undefined;
  /** Original index in the plan, for stable ordering and reporting. */
  index: number;
}

export interface ScheduleHooks<T, R> {
  /** Run a single op. Must not throw — return a result that encodes failure. */
  runOp: (item: SchedulableOp<T>) => Promise<R>;
  /** Called after each op settles, in completion order. */
  onResult?: (result: R, item: SchedulableOp<T>) => void;
  /** Return true if this result should halt scheduling of not-yet-started ops. */
  isFailure?: (result: R) => boolean;
  /** Optional throttle (ms) applied BETWEEN ops within the same group. */
  delayMs?: number;
}

/** Group ops by `from` address, preserving original order within each group. */
export function groupByFrom<T>(items: SchedulableOp<T>[]): SchedulableOp<T>[][] {
  const groups = new Map<string, SchedulableOp<T>[]>();
  const order: string[] = [];
  for (const item of items) {
    const key = (item.from ?? "__default__").toLowerCase();
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = [];
      groups.set(key, bucket);
      order.push(key);
    }
    bucket.push(item);
  }
  return order.map((k) => groups.get(k)!);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Execute grouped ops with bounded concurrency.
 *
 * Returns results indexed by the op's ORIGINAL plan position (so callers can
 * reassemble plan order regardless of completion order).
 *
 * When `stopOnError` is true (via isFailure returning true), groups that have
 * not yet STARTED are skipped; groups already in flight are allowed to drain.
 */
export async function runScheduled<T, R>(
  items: SchedulableOp<T>[],
  concurrency: number,
  stopOnError: boolean,
  hooks: ScheduleHooks<T, R>
): Promise<(R | undefined)[]> {
  const results: (R | undefined)[] = new Array(items.length);
  const groups = groupByFrom(items);
  const limit = Math.max(1, Math.min(concurrency || 1, groups.length || 1));

  let aborted = false;
  let cursor = 0;

  async function runGroup(group: SchedulableOp<T>[]): Promise<void> {
    for (let i = 0; i < group.length; i += 1) {
      if (aborted) {
        // Skipped due to an earlier failure (stopOnError).
        return;
      }
      if (i > 0 && hooks.delayMs) await sleep(hooks.delayMs);

      const item = group[i];
      const result = await hooks.runOp(item);
      results[item.index] = result;
      hooks.onResult?.(result, item);

      if (stopOnError && hooks.isFailure?.(result)) {
        aborted = true;
        return;
      }
    }
  }

  async function worker(): Promise<void> {
    while (true) {
      if (aborted) return;
      const idx = cursor;
      cursor += 1;
      if (idx >= groups.length) return;
      await runGroup(groups[idx]);
    }
  }

  const workers = Array.from({ length: limit }, () => worker());
  await Promise.all(workers);

  return results;
}
