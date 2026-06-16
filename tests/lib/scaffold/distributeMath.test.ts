import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDistribution } from "../../../src/lib/scaffold/distributeMath";

test("equal split: sum equals total exactly (even division)", () => {
  const r = computeDistribution({ strategy: "equal", count: 4, total: 1000n });
  assert.deepEqual(r.amounts, [250n, 250n, 250n, 250n]);
  assert.equal(sum(r.amounts), 1000n);
  assert.equal(r.allocated, 1000n);
});

test("equal split: remainder distributed to first wallets, total preserved", () => {
  // 1003 / 4 = 250 r3 → first 3 get +1
  const r = computeDistribution({ strategy: "equal", count: 4, total: 1003n });
  assert.deepEqual(r.amounts, [251n, 251n, 251n, 250n]);
  assert.equal(sum(r.amounts), 1003n, "no wei lost or invented");
});

test("equal split: large realistic wei amount preserves total", () => {
  const total = 1_234_567_890_123_456_789n; // ~1.23 ETH in wei
  const r = computeDistribution({ strategy: "equal", count: 7, total });
  assert.equal(sum(r.amounts), total);
});

test("equal split: single recipient gets everything", () => {
  const r = computeDistribution({ strategy: "equal", count: 1, total: 999n });
  assert.deepEqual(r.amounts, [999n]);
});

test("equal split: throws when total too small to split", () => {
  assert.throws(() => computeDistribution({ strategy: "equal", count: 5, total: 3n }), /too small/);
});

test("fixed split: each recipient gets perWallet, allocated = per*count", () => {
  const r = computeDistribution({ strategy: "fixed", count: 3, perWallet: 500n });
  assert.deepEqual(r.amounts, [500n, 500n, 500n]);
  assert.equal(r.allocated, 1500n);
});

test("fixed split: requires perWallet", () => {
  assert.throws(() => computeDistribution({ strategy: "fixed", count: 3 }), /requires perWallet/);
});

test("fixed split: rejects non-positive perWallet", () => {
  assert.throws(() => computeDistribution({ strategy: "fixed", count: 3, perWallet: 0n }), /> 0/);
});

test("jitter split: sum equals total exactly (balancer absorbs drift)", () => {
  const total = 1_000_000_000_000_000_000n; // 1 ETH
  const r = computeDistribution({ strategy: "jitter", count: 10, total, jitterPct: 25, seed: 42 });
  assert.equal(sum(r.amounts), total, "jitter must preserve the exact total");
  assert.equal(r.amounts.length, 10);
});

test("jitter split: deterministic with the same seed", () => {
  const a = computeDistribution({ strategy: "jitter", count: 8, total: 10_000n, jitterPct: 30, seed: 7 });
  const b = computeDistribution({ strategy: "jitter", count: 8, total: 10_000n, jitterPct: 30, seed: 7 });
  assert.deepEqual(a.amounts, b.amounts);
});

test("jitter split: different seeds produce different distributions", () => {
  const a = computeDistribution({ strategy: "jitter", count: 8, total: 10_000n, jitterPct: 30, seed: 1 });
  const b = computeDistribution({ strategy: "jitter", count: 8, total: 10_000n, jitterPct: 30, seed: 2 });
  assert.notDeepEqual(a.amounts, b.amounts);
});

test("jitter split: amounts actually vary (not all equal)", () => {
  const r = computeDistribution({ strategy: "jitter", count: 12, total: 120_000n, jitterPct: 40, seed: 99 });
  const unique = new Set(r.amounts.map((x) => x.toString()));
  assert.ok(unique.size > 1, "jitter should produce varied amounts");
  assert.equal(sum(r.amounts), 120_000n);
});

test("jitter split: zero jitter behaves like equal-ish but still sums to total", () => {
  const r = computeDistribution({ strategy: "jitter", count: 5, total: 5005n, jitterPct: 0, seed: 3 });
  assert.equal(sum(r.amounts), 5005n);
});

test("jitter split: rejects out-of-range jitterPct", () => {
  assert.throws(() => computeDistribution({ strategy: "jitter", count: 5, total: 1000n, jitterPct: 99 }), /0–95/);
});

test("invalid count is rejected", () => {
  assert.throws(() => computeDistribution({ strategy: "equal", count: 0, total: 100n }), /positive integer/);
});

test("equal/jitter require a total", () => {
  assert.throws(() => computeDistribution({ strategy: "equal", count: 3 }), /requires total/);
});

function sum(xs: bigint[]): bigint {
  return xs.reduce((a, b) => a + b, 0n);
}
