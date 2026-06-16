import { test } from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { ERC20_ABI } from "../../../../src/lib/abi/builtin";
import { listOps, getOp } from "../../../../src/lib/ops/registry";
import { parseValue } from "../../../../src/lib/plan/schema";

// Importing the side-effect modules registers all builtin ops into the
// module-scoped registry. ES module hoisting ensures imports run before
// the test body, so we just rely on each test file being isolated.
import "../../../../src/lib/ops/builtin/nativeSend";
import "../../../../src/lib/ops/builtin/rawTx";
import "../../../../src/lib/ops/builtin/erc20Transfer";
import "../../../../src/lib/ops/builtin/erc20Approve";
import "../../../../src/lib/ops/builtin/contractCall";

// --- Calldata correctness using the bundled ABI directly ---

function encodeTransfer(recipient: string, amount: bigint): string {
  const iface = new ethers.Interface(ERC20_ABI);
  return iface.encodeFunctionData("transfer", [recipient, amount]);
}

function encodeApprove(spender: string, amount: bigint): string {
  const iface = new ethers.Interface(ERC20_ABI);
  return iface.encodeFunctionData("approve", [spender, amount]);
}

test("erc20: transfer(0xB, 1_000_000) → known calldata", () => {
  // Selector for transfer(address,uint256) is 0xa9059cbb
  const recipient = "0x000000000000000000000000000000000000000B";
  const data = encodeTransfer(recipient, 1_000_000n);
  // ethers lowercases addresses inside encoded calldata
  const expectedRecipient =
    "0".repeat(24) + recipient.slice(2).toLowerCase();
  // Pad amount to 32 bytes
  const expectedAmount = "0".repeat(64 - (1_000_000n).toString(16).length) + (1_000_000n).toString(16);
  assert.equal(
    data,
    "0xa9059cbb" + expectedRecipient + expectedAmount
  );
});

test("erc20: transfer(0xB, 100_000_000) for 100 USDC (6 decimals) → 0x...0005f5e100", () => {
  // 100 USDC = 100 * 10^6 = 100_000_000 = 0x5f5e100
  const recipient = "0x000000000000000000000000000000000000000B";
  const data = encodeTransfer(recipient, 100_000_000n);
  const expectedAmount = "0000000000000000000000000000000000000000000000000000000005f5e100";
  assert.equal(
    data.slice(2, 10),
    "a9059cbb",
    "selector should match transfer(address,uint256)"
  );
  assert.equal(data.slice(10 + 64), expectedAmount);
});

test("erc20: approve(0xROUTER, MaxUint256) → 0x...ffffffff...ff (32 bytes of 0xff)", () => {
  // 0x095ea7b3 = approve(address,uint256)
  const spender = "0x1111111111111111111111111111111111111111";
  const max = (1n << 256n) - 1n;
  const data = encodeApprove(spender, max);
  assert.equal(data.slice(0, 10), "0x095ea7b3");
  // Last 32 bytes are all 0xff
  assert.equal(
    data.slice(10 + 64),
    "f".repeat(64),
    "max uint256 should be 32 bytes of 0xff"
  );
});

test("erc20: amount parsing '100' for 6-decimal token → 100_000_000", async () => {
  const v = await parseValue("100", { decimals: 6, symbol: "USDC" });
  assert.equal(v, 100_000_000n);
});

test("erc20: amount parsing 'unlimited' for 6-decimal token → MaxUint256", async () => {
  const v = await parseValue("unlimited", { decimals: 6, symbol: "USDC" });
  assert.equal(v, (1n << 256n) - 1n);
});

// --- Registry registration ---

test("ops: all 5 builtin ops are registered", () => {
  const types = listOps().map((o) => o.type).sort();
  assert.deepEqual(types, [
    "contract-call",
    "erc20-approve",
    "erc20-transfer",
    "native-send",
    "raw-tx",
  ]);
});

test("ops: erc20-transfer schema accepts valid input and rejects bad addresses", () => {
  const op = getOp("erc20-transfer");
  assert.ok(op, "erc20-transfer should be registered");
  const ok = op!.schema.safeParse({
    id: "x",
    token: "USDC",
    to: "0x000000000000000000000000000000000000000B",
    amount: "100",
  });
  assert.equal(ok.success, true, JSON.stringify(ok.error?.issues));
  const bad = op!.schema.safeParse({
    id: "x",
    token: "USDC",
    to: "not-an-address",
    amount: "100",
  });
  assert.equal(bad.success, false);
});

test("ops: erc20-approve schema accepts 'unlimited'", () => {
  const op = getOp("erc20-approve");
  assert.ok(op, "erc20-approve should be registered");
  const ok = op!.schema.safeParse({
    id: "x",
    token: "USDC",
    spender: "0x0000000000000000000000000000000000000abc",
    amount: "unlimited",
  });
  assert.equal(ok.success, true, JSON.stringify(ok.error?.issues));
});

test("ops: contract-call schema accepts built-in alias and inline JSON", () => {
  const op = getOp("contract-call");
  assert.ok(op, "contract-call should be registered");
  const ok1 = op!.schema.safeParse({
    id: "x",
    to: "0x000000000000000000000000000000000000000B",
    abi: "erc20",
    fn: "transfer(address,uint256)",
    args: ["0x000000000000000000000000000000000000000C", "1000000"],
    value: "0",
  });
  assert.equal(ok1.success, true, JSON.stringify(ok1.error?.issues));
  // Inline JSON ABI also accepted
  const ok2 = op!.schema.safeParse({
    id: "y",
    to: "0x000000000000000000000000000000000000000B",
    abi: '[{"type":"function","name":"ping","stateMutability":"nonpayable","inputs":[],"outputs":[]}]',
    fn: "ping()",
    args: [],
  });
  assert.equal(ok2.success, true, JSON.stringify(ok2.error?.issues));
});

test("ops: every registered op parses the example plan it advertises", () => {
  for (const op of listOps() as Array<{ type: string; schema: { safeParse: (x: unknown) => { success: boolean; error?: { issues?: unknown } } }; example: unknown }>) {
    const parsed = op.schema.safeParse(op.example);
    assert.equal(
      parsed.success,
      true,
      `example for ${op.type} should parse: ${JSON.stringify(parsed.error?.issues)}`
    );
  }
});
