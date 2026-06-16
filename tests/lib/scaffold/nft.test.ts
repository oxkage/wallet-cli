import { test } from "node:test";
import assert from "node:assert/strict";
import { generateSweepNftPlan } from "../../../src/lib/scaffold/sweepNft";
import { generateDistributeNftPlan } from "../../../src/lib/scaffold/distributeNft";

const COLLECTION = "0x00000000000000000000000000000000c0ffee00";
const DEST = "0x000000000000000000000000000000000000beef";
const R1 = "0x0000000000000000000000000000000000001111";
const R2 = "0x0000000000000000000000000000000000002222";
const R3 = "0x0000000000000000000000000000000000003333";

// ---------- sweep-nft ----------

test("sweep-nft: one erc721-transfer op per owned token, preserving wallet index", () => {
  const plan = generateSweepNftPlan({
    chain: "Base",
    contract: COLLECTION,
    to: DEST,
    ownership: [
      { index: 0, address: R1, tokenIds: ["1", "2"] },
      { index: 3, address: R2, tokenIds: ["7"] },
    ],
  });
  assert.equal(plan.operations.length, 3);
  assert.equal(plan.chain, "Base");
  const op0 = plan.operations[0] as any;
  assert.equal(op0.type, "erc721-transfer");
  assert.equal(op0.contract, COLLECTION);
  assert.equal(op0.tokenId, "1");
  assert.equal(op0.to, DEST);
  assert.equal(op0.fromIndex, 0);
  // safe field omitted by default (op defaults to safeTransferFrom)
  assert.equal(op0.safe, undefined);
  // index preserved on the second wallet's token
  const op2 = plan.operations[2] as any;
  assert.equal(op2.fromIndex, 3);
  assert.equal(op2.tokenId, "7");
});

test("sweep-nft: --unsafe sets safe:false on every op", () => {
  const plan = generateSweepNftPlan({
    chain: "Base",
    contract: COLLECTION,
    to: DEST,
    ownership: [{ index: 0, address: R1, tokenIds: ["1"] }],
    unsafe: true,
  });
  assert.equal((plan.operations[0] as any).safe, false);
});

test("sweep-nft: zero owned tokens throws a clear error", () => {
  assert.throws(
    () =>
      generateSweepNftPlan({
        chain: "Base",
        contract: COLLECTION,
        to: DEST,
        ownership: [{ index: 0, address: R1, tokenIds: [] }],
      }),
    /produced 0 operations/
  );
});

test("sweep-nft: bad contract / destination addresses rejected", () => {
  assert.throws(
    () => generateSweepNftPlan({ chain: "Base", contract: "0xnope", to: DEST, ownership: [] }),
    /contract must be/
  );
  assert.throws(
    () => generateSweepNftPlan({ chain: "Base", contract: COLLECTION, to: "0xnope", ownership: [] }),
    /to must be/
  );
});

// ---------- distribute-nft ----------

test("distribute-nft: round-robin deals tokenIds across recipients", () => {
  const plan = generateDistributeNftPlan({
    chain: "Base",
    from: 0,
    contract: COLLECTION,
    tokenIds: ["10", "11", "12", "13"],
    recipients: [R1, R2, R3],
  });
  assert.equal(plan.operations.length, 4);
  const tos = plan.operations.map((o) => (o as any).to);
  // round-robin: R1, R2, R3, R1
  assert.deepEqual(tos, [R1, R2, R3, R1]);
  const ids = plan.operations.map((o) => (o as any).tokenId);
  assert.deepEqual(ids, ["10", "11", "12", "13"]);
  // from index propagated as fromIndex
  assert.equal((plan.operations[0] as any).fromIndex, 0);
});

test("distribute-nft: from as 0x address uses 'from' field not fromIndex", () => {
  const plan = generateDistributeNftPlan({
    chain: "Base",
    from: R1,
    contract: COLLECTION,
    tokenIds: ["1"],
    recipients: [R2],
  });
  const op = plan.operations[0] as any;
  assert.equal(op.from, R1);
  assert.equal(op.fromIndex, undefined);
});

test("distribute-nft: more recipients than tokens — extra recipients simply get none", () => {
  const plan = generateDistributeNftPlan({
    chain: "Base",
    from: 0,
    contract: COLLECTION,
    tokenIds: ["1"],
    recipients: [R1, R2, R3],
  });
  assert.equal(plan.operations.length, 1);
  assert.equal((plan.operations[0] as any).to, R1);
});

test("distribute-nft: empty tokenIds or recipients throws", () => {
  assert.throws(
    () => generateDistributeNftPlan({ chain: "Base", from: 0, contract: COLLECTION, tokenIds: [], recipients: [R1] }),
    /tokenIds must be a non-empty array/
  );
  assert.throws(
    () => generateDistributeNftPlan({ chain: "Base", from: 0, contract: COLLECTION, tokenIds: ["1"], recipients: [] }),
    /recipients must be a non-empty array/
  );
});

test("distribute-nft: invalid recipient address rejected", () => {
  assert.throws(
    () =>
      generateDistributeNftPlan({
        chain: "Base",
        from: 0,
        contract: COLLECTION,
        tokenIds: ["1"],
        recipients: ["0xnope"],
      }),
    /recipient\[0\] invalid/
  );
});

test("distribute-nft: hex tokenId accepted, junk rejected", () => {
  const ok = generateDistributeNftPlan({
    chain: "Base",
    from: 0,
    contract: COLLECTION,
    tokenIds: ["0x1a"],
    recipients: [R1],
  });
  assert.equal((ok.operations[0] as any).tokenId, "0x1a");
  assert.throws(
    () =>
      generateDistributeNftPlan({
        chain: "Base",
        from: 0,
        contract: COLLECTION,
        tokenIds: ["xyz"],
        recipients: [R1],
      }),
    /must be a decimal or 0x-hex integer/
  );
});
