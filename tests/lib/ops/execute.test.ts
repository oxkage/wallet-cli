import { test } from "node:test";
import assert from "node:assert/strict";
import { executePlan, type OpResult } from "../../../src/lib/ops/execute";
import { planSchema, type Plan } from "../../../src/lib/plan/schema";

/**
 * Build a mock OpContext that runs entirely offline in dry-run mode.
 * `build()` for native-send only touches resolveSigner / fees / provider.getBalance
 * (the latter only for value="all", which we avoid). gasLimit is preset to 21000n
 * so estimateGas is never called.
 */
function mockCtx(overrides: Partial<any> = {}): any {
  const concurrentTracker = overrides.__tracker;
  return {
    chain: { name: "TestNet", chainId: 1337, type: "evm" },
    provider: {
      async getBalance() {
        return 10n ** 18n;
      },
      async estimateGas() {
        return 21000n;
      },
      async call() {
        return "0x";
      },
    },
    fees: { maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n },
    async resolveSigner(address: string) {
      return { address, wallet: {} as any, index: 0, path: "m/44'/60'/0'/0/0" };
    },
    async reserveNonce() {
      if (concurrentTracker) concurrentTracker.enter();
      // simulate a little async work so overlap is observable
      await new Promise((r) => setTimeout(r, 5));
      if (concurrentTracker) concurrentTracker.exit();
      return 0;
    },
    releaseNonce() {},
    confirmNonce() {},
    async getUsdPrice() {
      return 2000;
    },
    async getNativeBalance() {
      return 10n ** 18n;
    },
    async getTokenBalance() {
      return 10n ** 6n;
    },
    log() {},
    simulate: false,
    dryRun: true,
    stopOnError: false,
    ...overrides,
  };
}

function makePlan(ops: Array<{ id: string; from: string; to: string }>, batchSize = 1): Plan {
  return planSchema.parse({
    version: 1,
    name: "test-plan",
    chain: "TestNet",
    operations: ops.map((o) => ({
      id: o.id,
      type: "native-send",
      from: o.from,
      to: o.to,
      value: "0.001",
    })),
    options: { batchSize, simulate: false },
  });
}

const A = "0x000000000000000000000000000000000000000A";
const B = "0x000000000000000000000000000000000000000B";
const C = "0x000000000000000000000000000000000000000C";
const DEST = "0x000000000000000000000000000000000000dEaD";

test("executePlan runs all ops in dry-run and returns original order", async () => {
  const plan = makePlan([
    { id: "op-1", from: A, to: DEST },
    { id: "op-2", from: B, to: DEST },
    { id: "op-3", from: C, to: DEST },
  ]);
  const result = await executePlan(plan, mockCtx());
  assert.equal(result.ok, true);
  assert.deepEqual(result.results.map((r) => r.id), ["op-1", "op-2", "op-3"]);
  assert.equal(result.summary.dryRun, 3);
  assert.equal(result.mode, "dry-run");
});

test("progress callback fires once per op with monotonic done counter", async () => {
  const plan = makePlan([
    { id: "op-1", from: A, to: DEST },
    { id: "op-2", from: B, to: DEST },
  ]);
  const seen: Array<{ id: string; done: number; total: number }> = [];
  await executePlan(plan, mockCtx(), (r: OpResult, p) => {
    seen.push({ id: r.id, done: p.done, total: p.total });
  });
  assert.equal(seen.length, 2);
  assert.deepEqual(seen.map((s) => s.done), [1, 2]);
  assert.ok(seen.every((s) => s.total === 2));
});

test("batchSize>1 with distinct wallets runs ops concurrently", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const tracker = {
    enter() {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
    },
    exit() {
      inFlight -= 1;
    },
  };
  const plan = makePlan(
    [
      { id: "op-1", from: A, to: DEST },
      { id: "op-2", from: B, to: DEST },
      { id: "op-3", from: C, to: DEST },
    ],
    3 // batchSize
  );
  await executePlan(plan, mockCtx({ __tracker: tracker }));
  assert.ok(maxInFlight >= 2, `expected concurrency >=2, got ${maxInFlight}`);
});

test("batchSize default (1) keeps single-wallet ops sequential", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const tracker = {
    enter() {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
    },
    exit() {
      inFlight -= 1;
    },
  };
  // Same wallet → must stay sequential even if batchSize were >1
  const plan = makePlan(
    [
      { id: "op-1", from: A, to: DEST },
      { id: "op-2", from: A, to: DEST },
    ],
    5
  );
  await executePlan(plan, mockCtx({ __tracker: tracker }));
  assert.equal(maxInFlight, 1, "same-wallet ops must never overlap");
});

test("unknown op type is reported, not thrown", async () => {
  const plan = planSchema.parse({
    version: 1,
    chain: "TestNet",
    operations: [{ id: "bad", type: "does-not-exist", from: A }],
  });
  const result = await executePlan(plan, mockCtx());
  assert.equal(result.ok, false);
  assert.equal(result.results[0].mode, "error");
  assert.equal(result.results[0].error?.code, "UNKNOWN_OP_TYPE");
});

test("stopOnError halts and marks remaining ops skipped (NOT_RUN)", async () => {
  // op-2 has an invalid value that fails at build time.
  const plan = planSchema.parse({
    version: 1,
    chain: "TestNet",
    operations: [
      { id: "op-1", type: "native-send", from: A, to: DEST, value: "0.001" },
      { id: "op-2", type: "native-send", from: A, to: DEST, value: "garbage" },
      { id: "op-3", type: "native-send", from: A, to: DEST, value: "0.001" },
    ],
    options: { batchSize: 1, simulate: false },
  });
  const result = await executePlan(plan, mockCtx({ stopOnError: true }));
  assert.equal(result.results[0].ok, true);
  assert.equal(result.results[1].mode, "error");
  assert.equal(result.results[2].mode, "skipped");
  assert.equal(result.results[2].error?.code, "NOT_RUN");
});
