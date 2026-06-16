import { test } from "node:test";
import assert from "node:assert/strict";
import { generateCollectPlan } from "../../../src/lib/scaffold/collect";
import { planSchema } from "../../../src/lib/plan/schema";

const DEST = "0x000000000000000000000000000000000000dEaD";

test("collect: native token, range 0..4 → 5 native-send ops", () => {
  const plan = generateCollectPlan({
    chain: "Base",
    token: "native",
    fromIdx: 0,
    toIdx: 4,
    to: DEST,
  });
  assert.equal(plan.operations.length, 5);
  for (let i = 0; i < 5; i += 1) {
    const op = plan.operations[i];
    assert.equal(op.type, "native-send");
    assert.equal((op as any).fromIndex, i);
    assert.equal((op as any).to, DEST);
    assert.equal((op as any).value, "all");
  }
});

test("collect: token symbol → erc20-transfer with that token", () => {
  const plan = generateCollectPlan({
    chain: "Base",
    token: "USDC",
    fromIdx: 0,
    toIdx: 2,
    to: DEST,
  });
  assert.equal(plan.operations.length, 3);
  for (const op of plan.operations) {
    assert.equal(op.type, "erc20-transfer");
    assert.equal((op as any).token, "USDC");
    assert.equal((op as any).amount, "all");
  }
});

test("collect: skip is respected", () => {
  const plan = generateCollectPlan({
    chain: "Base",
    token: "USDC",
    fromIdx: 0,
    toIdx: 9,
    to: DEST,
    skip: [1, 3, 8],
  });
  assert.equal(plan.operations.length, 7);
  const fromIndices = plan.operations.map((o) => (o as any).fromIndex);
  assert.deepEqual(fromIndices, [0, 2, 4, 5, 6, 7, 9]);
});

test("collect: empty token string throws", () => {
  assert.throws(
    () =>
      generateCollectPlan({
        chain: "Base",
        token: "",
        fromIdx: 0,
        toIdx: 1,
        to: DEST,
      }),
    /token is required/
  );
});

test("collect: invalid destination throws", () => {
  assert.throws(
    () =>
      generateCollectPlan({
        chain: "Base",
        token: "USDC",
        fromIdx: 0,
        toIdx: 1,
        to: "garbage",
      }),
    /to must be a 0x-prefixed/
  );
});

test("collect: skips all → throws (no ops)", () => {
  assert.throws(
    () =>
      generateCollectPlan({
        chain: "Base",
        token: "USDC",
        fromIdx: 0,
        toIdx: 2,
        to: DEST,
        skip: [0, 1, 2],
      }),
    /produced 0 operations/
  );
});

test("collect: generated plan passes the planSchema", () => {
  const plan = generateCollectPlan({
    chain: "Base",
    token: "USDC",
    fromIdx: 0,
    toIdx: 2,
    to: DEST,
  });
  const r = planSchema.safeParse(plan);
  assert.equal(r.success, true, JSON.stringify(r.error?.issues));
});
