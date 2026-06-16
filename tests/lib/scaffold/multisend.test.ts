import { test } from "node:test";
import assert from "node:assert/strict";
import { generateMultisendPlan } from "../../../src/lib/scaffold/multisend";
import { planSchema } from "../../../src/lib/plan/schema";

const SENDER = "0x000000000000000000000000000000000000a11c";
const A = "0x000000000000000000000000000000000000000A";
const B = "0x000000000000000000000000000000000000000B";
const C = "0x000000000000000000000000000000000000000C";

test("multisend: address from, two native recipients → 2 native-send ops", () => {
  const plan = generateMultisendPlan({
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
  assert.equal(plan.operations[1].type, "native-send");
  assert.equal((plan.operations[1] as any).value, "0.2");
  assert.equal(plan.defaultFrom, SENDER);
  assert.equal(plan.defaultFromIndex, undefined);
});

test("multisend: fromIndex produces defaultFromIndex, no per-op from", () => {
  const plan = generateMultisendPlan({
    chain: "Base",
    from: 7,
    recipients: [{ address: A, amount: "0.1" }],
  });
  assert.equal(plan.defaultFromIndex, 7);
  assert.equal(plan.defaultFrom, undefined);
  for (const op of plan.operations) {
    assert.equal((op as any).from, undefined);
    assert.equal((op as any).fromIndex, undefined);
  }
});

test("multisend: explicit 'native' token behaves same as undefined", () => {
  const plan = generateMultisendPlan({
    chain: "Base",
    from: SENDER,
    recipients: [
      { address: A, amount: "1.0", token: "native" },
      { address: B, amount: "2.0" },
    ],
  });
  assert.equal(plan.operations.length, 2);
  for (const op of plan.operations) {
    assert.equal(op.type, "native-send");
  }
});

test("multisend: token symbol produces erc20-transfer", () => {
  const plan = generateMultisendPlan({
    chain: "Base",
    from: SENDER,
    recipients: [
      { address: A, amount: "100", token: "USDC" },
      { address: B, amount: "0.5", token: "WETH" },
    ],
  });
  assert.equal(plan.operations[0].type, "erc20-transfer");
  assert.equal((plan.operations[0] as any).token, "USDC");
  assert.equal((plan.operations[0] as any).amount, "100");
  assert.equal(plan.operations[1].type, "erc20-transfer");
  assert.equal((plan.operations[1] as any).token, "WETH");
});

test("multisend: universal value formats pass through", () => {
  const plan = generateMultisendPlan({
    chain: "Base",
    from: SENDER,
    recipients: [
      { address: A, amount: "0.1" },
      { address: B, amount: "usd:1.50" },
      { address: C, amount: "wei:1000000" },
    ],
  });
  assert.equal((plan.operations[0] as any).value, "0.1");
  assert.equal((plan.operations[1] as any).value, "usd:1.50");
  assert.equal((plan.operations[2] as any).value, "wei:1000000");
});

test("multisend: rejects empty recipients", () => {
  assert.throws(
    () =>
      generateMultisendPlan({
        chain: "Base",
        from: SENDER,
        recipients: [],
      }),
    /non-empty array/
  );
});

test("multisend: rejects invalid address in recipient", () => {
  assert.throws(
    () =>
      generateMultisendPlan({
        chain: "Base",
        from: SENDER,
        recipients: [{ address: "not-an-address", amount: "0.1" }],
      }),
    /0x-prefixed/
  );
});

test("multisend: rejects empty amount", () => {
  assert.throws(
    () =>
      generateMultisendPlan({
        chain: "Base",
        from: SENDER,
        recipients: [{ address: A, amount: "" }],
      }),
    /amount is required/
  );
});

test("multisend: rejects invalid from address", () => {
  assert.throws(
    () =>
      generateMultisendPlan({
        chain: "Base",
        from: "0xbad",
        recipients: [{ address: A, amount: "0.1" }],
      }),
    /from must be a 0x-prefixed/
  );
});

test("multisend: rejects negative from index", () => {
  assert.throws(
    () =>
      generateMultisendPlan({
        chain: "Base",
        from: -1,
        recipients: [{ address: A, amount: "0.1" }],
      }),
    /non-negative integer/
  );
});

test("multisend: ids are unique", () => {
  const plan = generateMultisendPlan({
    chain: "Base",
    from: SENDER,
    recipients: [
      { address: A, amount: "0.1" },
      { address: B, amount: "0.2" },
      { address: C, amount: "0.3" },
    ],
  });
  const ids = new Set(plan.operations.map((o) => o.id));
  assert.equal(ids.size, plan.operations.length);
});

test("multisend: generated plan passes the planSchema", () => {
  const plan = generateMultisendPlan({
    chain: "Base",
    from: SENDER,
    recipients: [
      { address: A, amount: "0.1", token: "USDC" },
      { address: B, amount: "0.2" },
    ],
  });
  const r = planSchema.safeParse(plan);
  assert.equal(r.success, true, JSON.stringify(r.error?.issues));
});
