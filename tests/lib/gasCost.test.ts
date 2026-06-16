import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gasFeeWei,
  weiToNativeString,
  gasFeeUsd,
  nativeSymbolForChain,
} from "../../src/lib/gasCost";

test("gasFeeWei: gasUsed × effectiveGasPrice", () => {
  // 21000 gas × 6_000_000 wei/gas = 126_000_000_000 wei
  assert.equal(gasFeeWei("21000", "6000000"), 126_000_000_000n);
});

test("gasFeeWei: returns null when either field missing", () => {
  assert.equal(gasFeeWei(undefined, "6000000"), null);
  assert.equal(gasFeeWei("21000", undefined), null);
  assert.equal(gasFeeWei(undefined, undefined), null);
});

test("gasFeeWei: returns null on non-numeric input", () => {
  assert.equal(gasFeeWei("abc", "6000000"), null);
});

test("weiToNativeString: 18-decimal conversion, trims trailing zeros", () => {
  // 1 ETH
  assert.equal(weiToNativeString(10n ** 18n), "1");
  // 0.5 ETH
  assert.equal(weiToNativeString(5n * 10n ** 17n), "0.5");
  // small fee: 126_000_000_000 wei = 0.000000126 ETH → trimmed to 8 frac → 0.00000012
  assert.equal(weiToNativeString(126_000_000_000n), "0.00000012");
});

test("weiToNativeString: zero", () => {
  assert.equal(weiToNativeString(0n), "0");
});

test("weiToNativeString: respects maxFrac", () => {
  // 0.123456789 ETH at maxFrac=4 → 0.1234
  assert.equal(weiToNativeString(123456789n * 10n ** 9n, 4), "0.1234");
});

test("gasFeeUsd: wei × price / 1e18", () => {
  // 0.00001877 ETH (18773702662071 wei) × $1800 ≈ $0.0338
  const usd = gasFeeUsd(18773702662071n, 1800);
  assert.ok(Math.abs(usd - 0.03379) < 0.001, `got ${usd}`);
});

test("nativeSymbolForChain: ETH L2s default to ETH", () => {
  assert.equal(nativeSymbolForChain(8453), "ETH"); // Base
  assert.equal(nativeSymbolForChain("42161"), "ETH"); // Arbitrum
  assert.equal(nativeSymbolForChain(1), "ETH"); // Ethereum
});

test("nativeSymbolForChain: non-ETH chains map correctly", () => {
  assert.equal(nativeSymbolForChain(137), "POL"); // Polygon
  assert.equal(nativeSymbolForChain(56), "BNB"); // BSC
  assert.equal(nativeSymbolForChain(43114), "AVAX"); // Avalanche
});

test("nativeSymbolForChain: unknown chain defaults to ETH", () => {
  assert.equal(nativeSymbolForChain(999999), "ETH");
});
