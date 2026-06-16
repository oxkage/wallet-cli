import { test } from "node:test";
import assert from "node:assert/strict";
import { parseValue, decimalToBigInt, formatValue } from "../../../src/lib/plan/schema";

test("parseValue: plain decimal scaled by decimals", async () => {
  assert.equal(await parseValue("1.5", { decimals: 18, symbol: "ETH" }), 1_500_000_000_000_000_000n);
  assert.equal(await parseValue("0.01", { decimals: 6, symbol: "USDC" }), 10_000n);
  assert.equal(await parseValue("100", { decimals: 6, symbol: "USDC" }), 100_000_000n);
});

test("parseValue: wei: prefix passes through", async () => {
  assert.equal(await parseValue("wei:12345", { decimals: 18, symbol: "ETH" }), 12_345n);
});

test("parseValue: raw: prefix passes through", async () => {
  assert.equal(await parseValue("raw:1000000", { decimals: 6, symbol: "USDC" }), 1_000_000n);
});

test("parseValue: usd: prefix requires getUsdPrice", async () => {
  await assert.rejects(parseValue("usd:1.00", { decimals: 6, symbol: "USDC" }), /requires getUsdPrice/);
});

test("parseValue: usd: with mocked price", async () => {
  // 1 USD at 1.0 price → 1 USDC (6 decimals) → 1_000_000
  const v = await parseValue("usd:1.00", {
    decimals: 6,
    symbol: "USDC",
    getUsdPrice: async (s) => (s === "USDC" ? 1.0 : null),
  });
  assert.equal(v, 1_000_000n);
});

test("parseValue: unlimited returns MaxUint256", async () => {
  assert.equal(await parseValue("unlimited", { decimals: 0, symbol: "X" }), (1n << 256n) - 1n);
});

test("parseValue: rejects garbage", async () => {
  await assert.rejects(parseValue("abc", { decimals: 18, symbol: "ETH" }), /Unrecognized/);
  await assert.rejects(parseValue("", { decimals: 18, symbol: "ETH" }), /Unrecognized/);
});

test("decimalToBigInt: handles whole, frac, padding, truncation", () => {
  assert.equal(decimalToBigInt("1.5", 18), 1_500_000_000_000_000_000n);
  assert.equal(decimalToBigInt("1", 6), 1_000_000n);
  assert.equal(decimalToBigInt("0.000001", 6), 1n);
  assert.equal(decimalToBigInt("0.0000001", 6), 0n); // truncated
  assert.equal(decimalToBigInt("123.456", 2), 12_345n); // truncated
});

test("formatValue: rounds display only, returns bigint-friendly strings", () => {
  assert.equal(formatValue(1_500_000_000_000_000_000n, 18), "1.5");
  assert.equal(formatValue(10_000n, 6), "0.01");
  assert.equal(formatValue(1_000_000n, 6, 2), "1");  // frac rounded by trim
  assert.equal(formatValue(0n, 18), "0");
  assert.equal(formatValue(1n, 6), "0.000001");
});
