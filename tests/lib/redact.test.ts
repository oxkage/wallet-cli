import { test } from "node:test";
import assert from "node:assert/strict";
import { redactText, safeLog } from "../../src/lib/redact";

test("redactText redacts secret values in known key contexts", () => {
  const input = `privateKey: "0xdeadbeef" secretKey: "abc" seed: "s" phrase: "x y"`;
  const out = redactText(input);
  assert.match(out, /privateKey:\s*"\[REDACTED\]"/);
  assert.match(out, /secretKey:\s*"\[REDACTED\]"/);
  assert.match(out, /seed:\s*"\[REDACTED\]"/);
  assert.match(out, /phrase:\s*"\[REDACTED\]"/);
});

test("redactText does NOT redact token symbols (public data)", () => {
  // Token symbols are public — listing "USDC" in a plan or log should not be
  // hidden. This was a real bug: the old code had "token" in the keys list
  // which matched the KEY name, redacting every value as a "secret".
  const input = `token: "USDC" token: "USDT" token: "WETH"`;
  const out = redactText(input);
  assert.match(out, /token:\s*"USDC"/);
  assert.match(out, /token:\s*"USDT"/);
  assert.match(out, /token:\s*"WETH"/);
});

test("redactText does NOT redact addresses (public data)", () => {
  // 40-hex addresses (20 bytes) are too short to trigger the 64-hex redaction.
  // EIP-55 checksummed addresses should be preserved as-is.
  const input = `from: 0x000000000000000000000000000000000000dEaD to: 0x0000000000000000000000000000000000CaFee2`;
  const out = redactText(input);
  assert.match(out, /0x000000000000000000000000000000000000dEaD/);
  assert.match(out, /0x0000000000000000000000000000000000CaFee2/);
});

test("redactText redacts 64-hex strings (defense in depth, broad heuristic)", () => {
  // The 64-hex regex is intentionally broad — better to over-redact than
  // under-redact. The label is [REDACTED_HEX] (not [REDACTED_PRIVATE_KEY])
  // to be honest about what it caught. 64 hex = 32 bytes = plausibly a
  // private key, signed message, calldata word, or storage slot.
  const input = `key: 0x${"a".repeat(64)}`;
  const out = redactText(input);
  assert.match(out, /\[REDACTED_HEX\]/);
  assert.doesNotMatch(out, /0x[aaaa]{16}/);
});

test("redactText preserves short hex (function selectors)", () => {
  // 8 hex chars = function selector (e.g. 0xa9059cbb = transfer(address,uint256))
  const input = `selector: 0xa9059cbb`;
  const out = redactText(input);
  assert.match(out, /selector: 0xa9059cbb/);
});

test("redactText handles JSON-shaped mixed input", () => {
  const input = JSON.stringify({
    token: "USDC",
    privateKey: "0xabcdef",
    note: "transfer 0.0001 USDC",
    calldata: "0xa9059cbb" + "0".repeat(56), // 8 hex selector + 56 padding = 64 hex total
  });
  const out = redactText(input);
  // Token is public — preserved
  assert.match(out, /"token":"USDC"/);
  // privateKey value is hidden
  assert.match(out, /"privateKey":"\[REDACTED\]"/);
  // The 64-hex calldata is over-redacted as [REDACTED_HEX] (defense in depth)
  assert.match(out, /\[REDACTED_HEX\]/);
});

test("safeLog writes redacted output to stdout", () => {
  const original = console.log;
  let captured = "";
  console.log = (msg: string) => {
    captured = msg;
  };
  try {
    safeLog({ token: "USDC", privateKey: "secret" });
  } finally {
    console.log = original;
  }
  // Public token symbol is preserved
  assert.match(captured, /"token":\s*"USDC"/);
  // Secret value is redacted
  assert.match(captured, /"privateKey":\s*"\[REDACTED\]"/);
});
