import { test } from "node:test";
import assert from "node:assert/strict";
import { generateDistributePlan } from "../../../src/lib/scaffold/distribute";
import { planSchema } from "../../../src/lib/plan/schema";

const SRC = "0x000000000000000000000000000000000000bEEF";

// Deterministic fake target addresses (no SEED_PHRASE needed — the generator
// is pure and accepts resolved {index,address} targets).
function targets(indices: number[]): Array<{ index: number; address: string }> {
  return indices.map((index) => ({
    index,
    address: "0x" + index.toString(16).padStart(40, "0"),
  }));
}

test("distribute: native emits native-send ops with raw values", () => {
  const plan = generateDistributePlan({
    chain: "Base",
    from: SRC,
    targets: targets([1, 2, 3]),
    amounts: [100n, 200n, 300n],
    token: "native",
  });
  assert.equal(plan.operations.length, 3);
  assert.equal(plan.operations[0].type, "native-send");
  assert.equal((plan.operations[0] as any).value, "raw:100");
  assert.equal((plan.operations[0] as any).from, SRC);
});

test("distribute: token emits erc20-transfer ops with raw amounts", () => {
  const plan = generateDistributePlan({
    chain: "Base",
    from: 5,
    targets: targets([10, 11]),
    amounts: [1_000_000n, 2_000_000n],
    token: "USDC",
  });
  assert.equal(plan.operations[0].type, "erc20-transfer");
  assert.equal((plan.operations[0] as any).token, "USDC");
  assert.equal((plan.operations[0] as any).amount, "raw:1000000");
  assert.equal((plan.operations[0] as any).fromIndex, 5);
});

test("distribute: skips zero-amount allocations", () => {
  const plan = generateDistributePlan({
    chain: "Base",
    from: SRC,
    targets: targets([1, 2, 3]),
    amounts: [100n, 0n, 300n],
    token: "native",
  });
  assert.equal(plan.operations.length, 2, "zero allocation should be skipped");
  assert.deepEqual(plan.operations.map((o) => o.id), ["dist-1", "dist-3"]);
});

test("distribute: rejects amount/target length mismatch", () => {
  assert.throws(
    () =>
      generateDistributePlan({
        chain: "Base",
        from: SRC,
        targets: targets([1, 2, 3]),
        amounts: [100n, 200n],
        token: "native",
      }),
    /align 1:1/
  );
});

test("distribute: rejects empty targets", () => {
  assert.throws(
    () => generateDistributePlan({ chain: "Base", from: SRC, targets: [], amounts: [], token: "native" }),
    /non-empty/
  );
});

test("distribute: throws if all amounts are zero", () => {
  assert.throws(
    () =>
      generateDistributePlan({
        chain: "Base",
        from: SRC,
        targets: targets([1, 2]),
        amounts: [0n, 0n],
        token: "native",
      }),
    /0 operations/
  );
});

test("distribute: generated plan passes the planSchema", () => {
  const plan = generateDistributePlan({
    chain: "Base",
    from: SRC,
    targets: targets([1, 2, 3]),
    amounts: [100n, 200n, 300n],
    token: "native",
  });
  const parsed = planSchema.parse(plan);
  assert.equal(parsed.operations.length, 3);
});

test("distribute: ids are unique", () => {
  const plan = generateDistributePlan({
    chain: "Base",
    from: SRC,
    targets: targets([1, 2, 3, 4, 5]),
    amounts: [1n, 2n, 3n, 4n, 5n],
    token: "native",
  });
  const ids = plan.operations.map((o) => o.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("distribute: rejects invalid from", () => {
  assert.throws(
    () => generateDistributePlan({ chain: "Base", from: "0xnotanaddress", targets: targets([1]), amounts: [1n], token: "native" }),
    /0x address or wallet index/
  );
});
