import { test } from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { ERC721_ABI } from "../../../../src/lib/abi/builtin";
import { getOp } from "../../../../src/lib/ops/registry";

// Side-effect imports register the ops into the module-scoped registry.
import "../../../../src/lib/ops/builtin/erc721Transfer";
import "../../../../src/lib/ops/builtin/erc721Approve";

const iface = new ethers.Interface(ERC721_ABI);

// --- Calldata correctness using the bundled ABI directly ---

test("erc721: safeTransferFrom(from,to,tokenId) selector is 0x42842e0e", () => {
  const from = "0x000000000000000000000000000000000000000A";
  const to = "0x000000000000000000000000000000000000000B";
  const data = iface.encodeFunctionData("safeTransferFrom(address,address,uint256)", [from, to, 1234n]);
  assert.equal(data.slice(0, 10), "0x42842e0e");
  // tokenId 1234 = 0x4d2, right-aligned in the last 32 bytes
  assert.equal(data.slice(-64), "0".repeat(61) + "4d2");
});

test("erc721: transferFrom(from,to,tokenId) selector is 0x23b872dd", () => {
  const from = "0x000000000000000000000000000000000000000A";
  const to = "0x000000000000000000000000000000000000000B";
  const data = iface.encodeFunctionData("transferFrom", [from, to, 1n]);
  assert.equal(data.slice(0, 10), "0x23b872dd");
});

test("erc721: approve(to,tokenId) selector is 0x095ea7b3", () => {
  const spender = "0x1111111111111111111111111111111111111111";
  const data = iface.encodeFunctionData("approve", [spender, 7n]);
  assert.equal(data.slice(0, 10), "0x095ea7b3");
  assert.equal(data.slice(-64), "0".repeat(63) + "7");
});

test("erc721: setApprovalForAll(operator,approved) selector is 0xa22cb465", () => {
  const operator = "0x1111111111111111111111111111111111111111";
  const dataTrue = iface.encodeFunctionData("setApprovalForAll", [operator, true]);
  assert.equal(dataTrue.slice(0, 10), "0xa22cb465");
  // approved=true → last byte 01
  assert.equal(dataTrue.slice(-2), "01");
  const dataFalse = iface.encodeFunctionData("setApprovalForAll", [operator, false]);
  assert.equal(dataFalse.slice(-64), "0".repeat(64));
});

test("erc721: large tokenId beyond 2^53 survives as a string → bigint", () => {
  const big = "123456789012345678901234567890";
  const data = iface.encodeFunctionData("approve", ["0x1111111111111111111111111111111111111111", BigInt(big)]);
  // Decode it back and confirm exact value preserved
  const [, decodedId] = iface.decodeFunctionData("approve", data);
  assert.equal(decodedId.toString(), big);
});

// --- Registry / schema ---

test("ops: erc721-transfer is registered and schema validates", () => {
  const op = getOp("erc721-transfer");
  assert.ok(op, "erc721-transfer should be registered");
  const ok = op!.schema.safeParse({
    id: "x",
    contract: "0x000000000000000000000000000000000000000B",
    tokenId: "1234",
    to: "0x000000000000000000000000000000000000000C",
  });
  assert.equal(ok.success, true, JSON.stringify(ok.error?.issues));
  // bad address rejected
  const bad = op!.schema.safeParse({
    id: "x",
    contract: "0x000000000000000000000000000000000000000B",
    tokenId: "1234",
    to: "not-an-address",
  });
  assert.equal(bad.success, false);
  // non-integer tokenId rejected
  const bad2 = op!.schema.safeParse({
    id: "x",
    contract: "0x000000000000000000000000000000000000000B",
    tokenId: "12.5",
    to: "0x000000000000000000000000000000000000000C",
  });
  assert.equal(bad2.success, false);
});

test("ops: erc721-approve schema accepts collection-wide (all) and single (tokenId)", () => {
  const op = getOp("erc721-approve");
  assert.ok(op, "erc721-approve should be registered");
  const wide = op!.schema.safeParse({
    id: "x",
    contract: "0x000000000000000000000000000000000000000B",
    spender: "0x000000000000000000000000000000000000000C",
    all: true,
  });
  assert.equal(wide.success, true, JSON.stringify(wide.error?.issues));
  const single = op!.schema.safeParse({
    id: "x",
    contract: "0x000000000000000000000000000000000000000B",
    spender: "0x000000000000000000000000000000000000000C",
    tokenId: "99",
  });
  assert.equal(single.success, true, JSON.stringify(single.error?.issues));
});

test("ops: both erc721 examples parse against their own schema", () => {
  for (const type of ["erc721-transfer", "erc721-approve"]) {
    const op = getOp(type);
    assert.ok(op, `${type} should be registered`);
    const parsed = op!.schema.safeParse(op!.example);
    assert.equal(parsed.success, true, `example for ${type}: ${JSON.stringify(parsed.error?.issues)}`);
  }
});
