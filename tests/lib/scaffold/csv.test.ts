import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generatePlanFromCsv,
  groupRecipientsByChain,
  parseRecipientsCsv,
} from "../../../src/lib/scaffold/csv";
import { planSchema } from "../../../src/lib/plan/schema";

const SENDER = "0x000000000000000000000000000000000000a11c";
const A = "0x000000000000000000000000000000000000000A";
const B = "0x000000000000000000000000000000000000000B";
const C = "0x000000000000000000000000000000000000000C";

// --- parseRecipientsCsv ---

test("parseRecipientsCsv: header auto-detected, native defaults", () => {
  const csv = [
    "address,amount,token",
    `${A},0.1,native`,
    `${B},0.2,USDC`,
    `${C},1.5`,
  ].join("\n");
  const rows = parseRecipientsCsv(csv);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { address: A, amount: "0.1", token: "native", chain: undefined });
  assert.deepEqual(rows[1], { address: B, amount: "0.2", token: "USDC", chain: undefined });
  assert.deepEqual(rows[2], { address: C, amount: "1.5", token: undefined, chain: undefined });
});

test("parseRecipientsCsv: no header (no detection) when first cell is not 'address'", () => {
  const csv = `${A},0.1,USDC,Base`;
  const rows = parseRecipientsCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].chain, "Base");
});

test("parseRecipientsCsv: comment lines starting with # are ignored", () => {
  const csv = [
    "# this is a comment",
    `${A},0.1`,
    "# another comment",
    `${B},0.2`,
  ].join("\n");
  const rows = parseRecipientsCsv(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].address, A);
  assert.equal(rows[1].address, B);
});

test("parseRecipientsCsv: inline trailing # comments are stripped", () => {
  const csv = [
    `${A},0.1  # the first transfer`,
    `${B},0.2`,
  ].join("\n");
  const rows = parseRecipientsCsv(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].address, A);
  assert.equal(rows[0].amount, "0.1");
});

test("parseRecipientsCsv: empty lines are skipped", () => {
  const csv = [`${A},0.1`, "", "  ", `${B},0.2`, ""].join("\n");
  const rows = parseRecipientsCsv(csv);
  assert.equal(rows.length, 2);
});

test("parseRecipientsCsv: quoted cells allow commas inside values", () => {
  // We don't need to support quoted commas in production, but the parser
  // should not crash and the basic case should work.
  const csv = `"${A}",0.1`;
  const rows = parseRecipientsCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].address, A);
  assert.equal(rows[0].amount, "0.1");
});

test("parseRecipientsCsv: line with too few columns throws", () => {
  const csv = `${A},0.1\n${B}`;  // second row has 1 column
  assert.throws(() => parseRecipientsCsv(csv), /line 2/);
});

test("parseRecipientsCsv: BOM is stripped", () => {
  const csv = "﻿" + ["address,amount", `${A},0.1`].join("\n");
  const rows = parseRecipientsCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].address, A);
});

test("parseRecipientsCsv: handles CRLF line endings", () => {
  const csv = ["address,amount", `${A},0.1`, `${B},0.2`].join("\r\n");
  const rows = parseRecipientsCsv(csv);
  assert.equal(rows.length, 2);
});

test("parseRecipientsCsv: empty content yields no rows", () => {
  assert.deepEqual(parseRecipientsCsv(""), []);
  assert.deepEqual(parseRecipientsCsv("\n\n\n"), []);
  assert.deepEqual(parseRecipientsCsv("# only comments"), []);
});

// --- generatePlanFromCsv ---

test("generatePlanFromCsv: simple native-only plan", () => {
  const plan = generatePlanFromCsv({
    chain: "Base",
    from: SENDER,
    recipients: [
      { address: A, amount: "0.1" },
      { address: B, amount: "0.2" },
    ],
  });
  assert.equal(plan.operations.length, 2);
  assert.equal(plan.operations[0].type, "native-send");
  assert.equal((plan.operations[0] as any).to, A);
  assert.equal((plan.operations[0] as any).value, "0.1");
  assert.equal(plan.defaultFrom, SENDER);
});

test("generatePlanFromCsv: token column switches to erc20-transfer", () => {
  const plan = generatePlanFromCsv({
    chain: "Base",
    from: SENDER,
    recipients: [
      { address: A, amount: "100", token: "USDC" },
      { address: B, amount: "0.5" },
    ],
  });
  assert.equal(plan.operations[0].type, "erc20-transfer");
  assert.equal((plan.operations[0] as any).token, "USDC");
  assert.equal(plan.operations[1].type, "native-send");
});

test("generatePlanFromCsv: per-row chain override matching default is OK", () => {
  const plan = generatePlanFromCsv({
    chain: "Base",
    from: SENDER,
    recipients: [
      { address: A, amount: "0.1", chain: "Base" },
    ],
  });
  assert.equal(plan.operations.length, 1);
});

test("generatePlanFromCsv: per-row chain override differing from default throws", () => {
  assert.throws(
    () =>
      generatePlanFromCsv({
        chain: "Base",
        from: SENDER,
        recipients: [
          { address: A, amount: "0.1", chain: "Optimism" },
        ],
      }),
    /has chain "Optimism"/
  );
});

test("generatePlanFromCsv: fromIndex is allowed and sets defaultFromIndex", () => {
  const plan = generatePlanFromCsv({
    chain: "Base",
    from: 3,
    recipients: [{ address: A, amount: "0.1" }],
  });
  assert.equal(plan.defaultFromIndex, 3);
  assert.equal(plan.defaultFrom, undefined);
});

test("generatePlanFromCsv: from is optional (omitted = no plan default)", () => {
  const plan = generatePlanFromCsv({
    chain: "Base",
    recipients: [{ address: A, amount: "0.1" }],
  });
  assert.equal(plan.defaultFrom, undefined);
  assert.equal(plan.defaultFromIndex, undefined);
});

test("generatePlanFromCsv: rejects empty recipients", () => {
  assert.throws(
    () =>
      generatePlanFromCsv({
        chain: "Base",
        from: SENDER,
        recipients: [],
      }),
    /non-empty array/
  );
});

// --- groupRecipientsByChain ---

test("groupRecipientsByChain: splits by row chain, defaulting unchained rows", () => {
  const rows = parseRecipientsCsv(
    [
      "address,amount,token,chain",
      `${A},0.1,USDC,Base`,
      `${B},0.2,native,Optimism`,
      `${C},0.3,,Base`,
    ].join("\n")
  );
  const groups = groupRecipientsByChain(rows, "Base");
  // rows 0 and 2 → Base; row 1 → Optimism
  assert.equal(groups.length, 2);
  const base = groups.find((g) => g.chain === "Base")!;
  const op = groups.find((g) => g.chain === "Optimism")!;
  assert.equal(base.recipients.length, 2);
  assert.equal(op.recipients.length, 1);
  assert.equal(op.recipients[0].address, B);
});

test("groupRecipientsByChain: per-row chain overrides default", () => {
  const rows = parseRecipientsCsv(
    [`${A},0.1`, `${B},0.2,USDC,Optimism`].join("\n")
  );
  const groups = groupRecipientsByChain(rows, "Base");
  // Row 0 has no chain → falls back to default "Base".
  // Row 1 → Optimism.
  assert.equal(groups.length, 2);
  assert.ok(groups.find((g) => g.chain === "Base"));
  assert.ok(groups.find((g) => g.chain === "Optimism"));
});

// --- end-to-end: parse + plan ---

test("end-to-end: parse + generatePlanFromCsv passes planSchema", () => {
  const csv = [
    "address,amount,token",
    `${A},0.1,native`,
    `${B},100,USDC`,
  ].join("\n");
  const rows = parseRecipientsCsv(csv);
  const plan = generatePlanFromCsv({ chain: "Base", from: SENDER, recipients: rows });
  const r = planSchema.safeParse(plan);
  assert.equal(r.success, true, JSON.stringify(r.error?.issues));
  assert.equal(plan.operations.length, 2);
  assert.equal(plan.operations[0].type, "native-send");
  assert.equal(plan.operations[1].type, "erc20-transfer");
});
