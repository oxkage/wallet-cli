import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { alchemyRpcUrl, getAlchemyKey, ALCHEMY_SLUGS } from "../../src/config/alchemy";

const ORIGINAL = process.env.ALCHEMY_API_KEY;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.ALCHEMY_API_KEY;
  else process.env.ALCHEMY_API_KEY = ORIGINAL;
});

test("getAlchemyKey: returns null when unset or blank", () => {
  delete process.env.ALCHEMY_API_KEY;
  assert.equal(getAlchemyKey(), null);
  process.env.ALCHEMY_API_KEY = "   ";
  assert.equal(getAlchemyKey(), null);
});

test("getAlchemyKey: trims and returns the key", () => {
  process.env.ALCHEMY_API_KEY = "  abc123  ";
  assert.equal(getAlchemyKey(), "abc123");
});

test("alchemyRpcUrl: null without a key (falls back to public RPC)", () => {
  delete process.env.ALCHEMY_API_KEY;
  assert.equal(alchemyRpcUrl(1), null);
});

test("alchemyRpcUrl: builds the correct endpoint for supported chains", () => {
  process.env.ALCHEMY_API_KEY = "KEY";
  assert.equal(alchemyRpcUrl(1), "https://eth-mainnet.g.alchemy.com/v2/KEY");
  assert.equal(alchemyRpcUrl(8453), "https://base-mainnet.g.alchemy.com/v2/KEY");
  assert.equal(alchemyRpcUrl(42161), "https://arb-mainnet.g.alchemy.com/v2/KEY");
});

test("alchemyRpcUrl: null for unsupported chain even with a key", () => {
  process.env.ALCHEMY_API_KEY = "KEY";
  // 369 = PulseChain, not in ALCHEMY_SLUGS → fall back to public RPC
  assert.equal(alchemyRpcUrl(369), null);
});

test("alchemyRpcUrl: unknown string chainId falls back to null", () => {
  process.env.ALCHEMY_API_KEY = "KEY";
  // String chainIds are still supported by the lookup; unmapped ones → null.
  assert.equal(alchemyRpcUrl("not-a-real-network"), null);
});

test("ALCHEMY_SLUGS: every slug is lowercase and mainnet/testnet-suffixed", () => {
  for (const [chainId, slug] of Object.entries(ALCHEMY_SLUGS)) {
    assert.equal(slug, slug.toLowerCase(), `${chainId} slug must be lowercase`);
    assert.match(slug, /-(mainnet|testnet)$/, `${chainId} slug should end in -mainnet/-testnet`);
  }
});
