import { test } from "node:test";
import assert from "node:assert/strict";
import { planSchema } from "../../../src/lib/plan/schema";

test("planSchema: minimal valid plan", () => {
  const r = planSchema.safeParse({
    version: 1,
    chain: "Base",
    operations: [{ id: "1", type: "native-send" }],
  });
  assert.equal(r.success, true);
});

test("planSchema: rejects missing version", () => {
  const r = planSchema.safeParse({
    chain: "Base",
    operations: [{ id: "1", type: "native-send" }],
  });
  assert.equal(r.success, false);
});

test("planSchema: rejects wrong version", () => {
  const r = planSchema.safeParse({
    version: 2,
    chain: "Base",
    operations: [{ id: "1", type: "native-send" }],
  });
  assert.equal(r.success, false);
});

test("planSchema: rejects empty operations", () => {
  const r = planSchema.safeParse({
    version: 1,
    chain: "Base",
    operations: [],
  });
  assert.equal(r.success, false);
});

test("planSchema: rejects invalid address in defaultFrom", () => {
  const r = planSchema.safeParse({
    version: 1,
    chain: "Base",
    defaultFrom: "not-an-address",
    operations: [{ id: "1", type: "native-send" }],
  });
  assert.equal(r.success, false);
});

test("planSchema: applies options defaults when options provided", () => {
  const r = planSchema.parse({
    version: 1,
    chain: "Base",
    operations: [{ id: "1", type: "native-send" }],
    options: {},
  });
  assert.equal(r.options?.batchSize, 1);
  assert.equal(r.options?.simulate, true);
  assert.equal(r.options?.stopOnError, false);
});

test("planSchema: options is optional", () => {
  const r = planSchema.parse({
    version: 1,
    chain: "Base",
    operations: [{ id: "1", type: "native-send" }],
  });
  assert.equal(r.options, undefined);
});

test("planSchema: validates options ranges", () => {
  const r = planSchema.safeParse({
    version: 1,
    chain: "Base",
    operations: [{ id: "1", type: "native-send" }],
    options: { batchSize: 100 },  // over max
  });
  assert.equal(r.success, false);
});
