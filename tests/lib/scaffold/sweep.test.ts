import { test } from "node:test";
import assert from "node:assert/strict";
import { generateSweepPlan } from "../../../src/lib/scaffold/sweep";
import { planSchema } from "../../../src/lib/plan/schema";

const DEST = "0x000000000000000000000000000000000000dEaD";

test("sweep: single asset native produces one op per wallet in range", () => {
  const plan = generateSweepPlan({
    chain: "Base",
    fromIdx: 0,
    toIdx: 4,
    to: DEST,
    include: ["native"],
  });
  assert.equal(plan.version, 1);
  assert.equal(plan.chain, "Base");
  assert.equal(plan.operations.length, 5);
  for (let i = 0; i < 5; i += 1) {
    const op = plan.operations[i];
    assert.equal(op.type, "native-send");
    assert.equal((op as any).fromIndex, i);
    assert.equal((op as any).to, DEST);
    assert.equal((op as any).value, "all");
  }
});

test("sweep: native + USDC produces 2 ops per wallet (5 wallets → 10 ops)", () => {
  const plan = generateSweepPlan({
    chain: "Base",
    fromIdx: 0,
    toIdx: 4,
    to: DEST,
    include: ["native", "USDC"],
  });
  assert.equal(plan.operations.length, 10);
  const nativeOps = plan.operations.filter((o) => o.type === "native-send");
  const erc20Ops = plan.operations.filter((o) => o.type === "erc20-transfer");
  assert.equal(nativeOps.length, 5);
  assert.equal(erc20Ops.length, 5);
  for (const op of erc20Ops) {
    assert.equal((op as any).token, "USDC");
    assert.equal((op as any).amount, "all");
  }
});

test("sweep: skip omits the listed indices", () => {
  const plan = generateSweepPlan({
    chain: "Base",
    fromIdx: 0,
    toIdx: 9,
    to: DEST,
    include: ["native"],
    skip: [2, 5, 7],
  });
  assert.equal(plan.operations.length, 7);  // 10 - 3
  const fromIndices = plan.operations.map((o) => (o as any).fromIndex);
  assert.deepEqual(fromIndices, [0, 1, 3, 4, 6, 8, 9]);
});

test("sweep: skips all → throws (no ops)", () => {
  assert.throws(
    () =>
      generateSweepPlan({
        chain: "Base",
        fromIdx: 0,
        toIdx: 2,
        to: DEST,
        include: ["native"],
        skip: [0, 1, 2],
      }),
    /produced 0 operations/
  );
});

test("sweep: token is case-sensitive (USDC vs usdc)", () => {
  const plan = generateSweepPlan({
    chain: "Base",
    fromIdx: 0,
    toIdx: 0,
    to: DEST,
    include: ["native", "USDC", "usdc"],
  });
  // 1 wallet × 3 entries = 3 ops; the lowercase "usdc" is treated as an
  // ERC-20 symbol (not the native alias), which is the documented contract.
  assert.equal(plan.operations.length, 3);
  assert.equal(plan.operations[0].type, "native-send");
  assert.equal((plan.operations[1] as any).token, "USDC");
  assert.equal((plan.operations[2] as any).token, "usdc");
});

test("sweep: rejects invalid destination", () => {
  assert.throws(
    () =>
      generateSweepPlan({
        chain: "Base",
        fromIdx: 0,
        toIdx: 1,
        to: "not-an-address",
        include: ["native"],
      }),
    /to must be a 0x-prefixed/
  );
});

test("sweep: rejects negative or inverted indices", () => {
  assert.throws(
    () =>
      generateSweepPlan({
        chain: "Base",
        fromIdx: -1,
        toIdx: 5,
        to: DEST,
        include: ["native"],
      }),
    /non-negative integer/
  );
  assert.throws(
    () =>
      generateSweepPlan({
        chain: "Base",
        fromIdx: 5,
        toIdx: 2,
        to: DEST,
        include: ["native"],
      }),
    /must be >= fromIdx/
  );
});

test("sweep: rejects empty include list", () => {
  assert.throws(
    () =>
      generateSweepPlan({
        chain: "Base",
        fromIdx: 0,
        toIdx: 1,
        to: DEST,
        include: [],
      }),
    /non-empty array/
  );
});

test("sweep: fromIndex is set per-op (no plan-level defaultFromIndex)", () => {
  const plan = generateSweepPlan({
    chain: "Base",
    fromIdx: 0,
    toIdx: 2,
    to: DEST,
    include: ["native"],
  });
  assert.equal(plan.defaultFrom, undefined);
  assert.equal(plan.defaultFromIndex, undefined);
  for (const op of plan.operations) {
    assert.notEqual((op as any).fromIndex, undefined);
  }
});

test("sweep: ids are unique", () => {
  const plan = generateSweepPlan({
    chain: "Base",
    fromIdx: 0,
    toIdx: 9,
    to: DEST,
    include: ["native", "USDC"],
  });
  const ids = new Set(plan.operations.map((o) => o.id));
  assert.equal(ids.size, plan.operations.length);
});

test("sweep: generated plan passes the planSchema", () => {
  const plan = generateSweepPlan({
    chain: "Base",
    fromIdx: 0,
    toIdx: 2,
    to: DEST,
    include: ["native", "USDC"],
  });
  const r = planSchema.safeParse(plan);
  assert.equal(r.success, true, JSON.stringify(r.error?.issues));
});
