import { test } from "node:test";
import assert from "node:assert/strict";
import { generateCallRangePlan } from "../../../src/lib/scaffold/callRange";

const CONTRACT = "0x00000000000000000000000000000000c0ffee00";
const MINT_ABI = JSON.stringify([
  {
    name: "mint",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "a", type: "uint256" },
      { name: "b", type: "uint256" },
    ],
    outputs: [],
  },
]);

test("call-range: one contract-call op per index, fixed args on every op", () => {
  const plan = generateCallRangePlan({
    chain: "Base",
    to: CONTRACT,
    abi: MINT_ABI,
    fn: "mint(uint256,uint256)",
    args: ["0", "1"],
    fromIdx: 1,
    toIdx: 99,
  });
  assert.equal(plan.operations.length, 99);
  const first = plan.operations[0] as any;
  assert.equal(first.id, "call-1");
  assert.equal(first.type, "contract-call");
  assert.equal(first.fromIndex, 1);
  assert.equal(first.to, CONTRACT);
  assert.equal(first.fn, "mint(uint256,uint256)");
  assert.deepEqual(first.args, ["0", "1"]);
  assert.equal(first.value, "0");
  const last = plan.operations[98] as any;
  assert.equal(last.fromIndex, 99);
  assert.deepEqual(last.args, ["0", "1"]); // identical fixed args
});

test("call-range: --skip removes indices from the range", () => {
  const plan = generateCallRangePlan({
    chain: "Base",
    to: CONTRACT,
    abi: MINT_ABI,
    fn: "mint(uint256,uint256)",
    args: ["0", "1"],
    fromIdx: 1,
    toIdx: 5,
    skip: [2, 4],
  });
  assert.equal(plan.operations.length, 3);
  assert.deepEqual(plan.operations.map((o) => (o as any).fromIndex), [1, 3, 5]);
});

test("call-range: paid mint sets per-call value", () => {
  const plan = generateCallRangePlan({
    chain: "Base",
    to: CONTRACT,
    abi: MINT_ABI,
    fn: "mint(uint256,uint256)",
    args: ["0", "1"],
    fromIdx: 1,
    toIdx: 2,
    value: "wei:1000000000000000",
  });
  assert.equal((plan.operations[0] as any).value, "wei:1000000000000000");
});

test("call-range: zero-arg fn accepted with empty args", () => {
  const abi = JSON.stringify([
    { name: "claim", type: "function", stateMutability: "nonpayable", inputs: [], outputs: [] },
  ]);
  const plan = generateCallRangePlan({
    chain: "Base",
    to: CONTRACT,
    abi,
    fn: "claim()",
    args: [],
    fromIdx: 0,
    toIdx: 1,
  });
  assert.equal(plan.operations.length, 2);
  assert.deepEqual((plan.operations[0] as any).args, []);
});

// --- validation (fail fast, once, not N times) ---

test("call-range: arg count mismatch throws up front", () => {
  assert.throws(
    () =>
      generateCallRangePlan({
        chain: "Base",
        to: CONTRACT,
        abi: MINT_ABI,
        fn: "mint(uint256,uint256)",
        args: ["0"],
        fromIdx: 1,
        toIdx: 3,
      }),
    /expects 2 arg\(s\), got 1/
  );
});

test("call-range: fn not in ABI throws", () => {
  assert.throws(
    () =>
      generateCallRangePlan({
        chain: "Base",
        to: CONTRACT,
        abi: MINT_ABI,
        fn: "burn(uint256)",
        args: ["0"],
        fromIdx: 1,
        toIdx: 3,
      }),
    /not found in the provided ABI/
  );
});

test("call-range: non-encodable arg throws (bad uint)", () => {
  assert.throws(
    () =>
      generateCallRangePlan({
        chain: "Base",
        to: CONTRACT,
        abi: MINT_ABI,
        fn: "mint(uint256,uint256)",
        args: ["notanumber", "1"],
        fromIdx: 1,
        toIdx: 3,
      }),
    /do not encode/
  );
});

test("call-range: toIdx < fromIdx throws", () => {
  assert.throws(
    () =>
      generateCallRangePlan({
        chain: "Base",
        to: CONTRACT,
        abi: MINT_ABI,
        fn: "mint(uint256,uint256)",
        args: ["0", "1"],
        fromIdx: 10,
        toIdx: 5,
      }),
    /must be >= fromIdx/
  );
});

test("call-range: bad value format throws", () => {
  assert.throws(
    () =>
      generateCallRangePlan({
        chain: "Base",
        to: CONTRACT,
        abi: MINT_ABI,
        fn: "mint(uint256,uint256)",
        args: ["0", "1"],
        fromIdx: 1,
        toIdx: 2,
        value: "0.5",
      }),
    /value must be/
  );
});

test("call-range: empty range after skips throws", () => {
  assert.throws(
    () =>
      generateCallRangePlan({
        chain: "Base",
        to: CONTRACT,
        abi: MINT_ABI,
        fn: "mint(uint256,uint256)",
        args: ["0", "1"],
        fromIdx: 1,
        toIdx: 2,
        skip: [1, 2],
      }),
    /produced 0 operations/
  );
});

test("call-range: builtin ABI alias (erc721) resolves", () => {
  const plan = generateCallRangePlan({
    chain: "Base",
    to: CONTRACT,
    abi: "erc721",
    fn: "setApprovalForAll(address,bool)",
    args: ["0x000000000000000000000000000000000000beef", "true"],
    fromIdx: 0,
    toIdx: 1,
  });
  assert.equal(plan.operations.length, 2);
});
