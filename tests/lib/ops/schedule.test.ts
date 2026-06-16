import { test } from "node:test";
import assert from "node:assert/strict";
import { groupByFrom, runScheduled, type SchedulableOp } from "../../../src/lib/ops/schedule";

function items(froms: (string | undefined)[]): SchedulableOp<number>[] {
  return froms.map((from, index) => ({ op: index, from, index }));
}

test("groupByFrom groups by address, preserves within-group order", () => {
  const groups = groupByFrom(items(["0xA", "0xB", "0xA", "0xB", "0xA"]));
  assert.equal(groups.length, 2);
  // Group order follows first-appearance
  assert.deepEqual(groups[0].map((i) => i.index), [0, 2, 4]); // 0xA
  assert.deepEqual(groups[1].map((i) => i.index), [1, 3]); // 0xB
});

test("groupByFrom is case-insensitive on address", () => {
  const groups = groupByFrom(items(["0xAbC", "0xabc", "0xABC"]));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].length, 3);
});

test("undefined froms group together", () => {
  const groups = groupByFrom(items([undefined, undefined]));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].length, 2);
});

test("runScheduled returns results in ORIGINAL plan order", async () => {
  const results = await runScheduled<number, string>(
    items(["0xA", "0xB", "0xA", "0xC"]),
    4,
    false,
    { runOp: async ({ op }) => `r${op}` }
  );
  assert.deepEqual(results, ["r0", "r1", "r2", "r3"]);
});

test("same-wallet ops run STRICTLY sequentially (nonce safety)", async () => {
  // All ops share one address → must never overlap.
  let inFlight = 0;
  let maxInFlight = 0;
  const order: number[] = [];
  await runScheduled<number, void>(items(["0xA", "0xA", "0xA", "0xA"]), 8, false, {
    runOp: async ({ op }) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      order.push(op);
      inFlight -= 1;
    },
  });
  assert.equal(maxInFlight, 1, "same-wallet ops must not run concurrently");
  assert.deepEqual(order, [0, 1, 2, 3], "same-wallet ops must run in plan order");
});

test("different-wallet ops run CONCURRENTLY up to the limit", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  // 4 distinct wallets, concurrency 4 → all 4 should overlap.
  await runScheduled<number, void>(items(["0xA", "0xB", "0xC", "0xD"]), 4, false, {
    runOp: async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight -= 1;
    },
  });
  assert.equal(maxInFlight, 4, "distinct wallets should run in parallel");
});

test("concurrency limit is respected", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  // 6 distinct wallets, concurrency 2 → never more than 2 at once.
  await runScheduled<number, void>(
    items(["0xA", "0xB", "0xC", "0xD", "0xE", "0xF"]),
    2,
    false,
    {
      runOp: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
      },
    }
  );
  assert.equal(maxInFlight, 2);
});

test("concurrency 1 reproduces strictly sequential behavior", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const order: number[] = [];
  await runScheduled<number, void>(items(["0xA", "0xB", "0xC"]), 1, false, {
    runOp: async ({ op }) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 3));
      order.push(op);
      inFlight -= 1;
    },
  });
  assert.equal(maxInFlight, 1);
  assert.deepEqual(order, [0, 1, 2]);
});

test("stopOnError skips not-yet-started groups", async () => {
  const ran: number[] = [];
  const results = await runScheduled<number, { ok: boolean }>(
    items(["0xA", "0xB", "0xC", "0xD"]),
    1, // sequential so failure ordering is deterministic
    true,
    {
      runOp: async ({ op }) => {
        ran.push(op);
        return { ok: op !== 1 }; // op index 1 fails
      },
      isFailure: (r) => !r.ok,
    }
  );
  // op 0 ok, op 1 fails → 2 and 3 never run
  assert.deepEqual(ran, [0, 1]);
  assert.equal(results[0]?.ok, true);
  assert.equal(results[1]?.ok, false);
  assert.equal(results[2], undefined, "op after failure should not run");
  assert.equal(results[3], undefined);
});

test("onResult fires once per completed op", async () => {
  let count = 0;
  await runScheduled<number, number>(items(["0xA", "0xB", "0xC"]), 3, false, {
    runOp: async ({ op }) => op,
    onResult: () => {
      count += 1;
    },
  });
  assert.equal(count, 3);
});

test("delayMs applies between ops in the same group only", async () => {
  const t0 = Date.now();
  await runScheduled<number, void>(items(["0xA", "0xA", "0xA"]), 1, false, {
    delayMs: 20,
    runOp: async () => {},
  });
  const elapsed = Date.now() - t0;
  // 3 ops in one group → 2 inter-op delays of 20ms = ~40ms minimum
  assert.ok(elapsed >= 35, `expected >=35ms of delay, got ${elapsed}ms`);
});

test("empty op list yields empty results", async () => {
  const results = await runScheduled<number, string>([], 4, false, {
    runOp: async () => "x",
  });
  assert.deepEqual(results, []);
});
