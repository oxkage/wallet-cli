import { test } from "node:test";
import assert from "node:assert/strict";
import { enumerateOwnership } from "../../../src/lib/nft/ownership";

const COLLECTION = "0x00000000000000000000000000000000c0ffee00";
const OWNER = "0x000000000000000000000000000000000000beef";

test("enumerate: invalid contract address rejected", async () => {
  await assert.rejects(
    () => enumerateOwnership({ chainId: 8453, contract: "0xnope", wallets: [] }),
    /contract must be a 0x-prefixed 40-hex/
  );
});

test("enumerate: strategy 'alchemy' without key throws a clear error", async () => {
  const prev = process.env.ALCHEMY_API_KEY;
  delete process.env.ALCHEMY_API_KEY;
  try {
    await assert.rejects(
      () =>
        enumerateOwnership({
          chainId: 8453,
          contract: COLLECTION,
          wallets: [{ index: 0, address: OWNER }],
          strategy: "alchemy",
        }),
      /ALCHEMY_API_KEY is not set/
    );
  } finally {
    if (prev !== undefined) process.env.ALCHEMY_API_KEY = prev;
  }
});

test("enumerate: 'auto' with no key and no rpcUrl asks for a key or rpc", async () => {
  const prev = process.env.ALCHEMY_API_KEY;
  delete process.env.ALCHEMY_API_KEY;
  try {
    await assert.rejects(
      () =>
        enumerateOwnership({
          chainId: 8453,
          contract: COLLECTION,
          wallets: [{ index: 0, address: OWNER }],
          strategy: "auto",
        }),
      /enumerable fallback needs an rpcUrl/
    );
  } finally {
    if (prev !== undefined) process.env.ALCHEMY_API_KEY = prev;
  }
});

// Live integration test against the Alchemy NFT API. Skips automatically when
// no key is configured so CI / no-key environments stay green. Run it for real
// by setting ALCHEMY_API_KEY in .env, then `npm test`.
test("enumerate: live Alchemy NFT API returns owned tokenIds (skips without key)", async (t) => {
  const key = process.env.ALCHEMY_API_KEY?.trim();
  if (!key) {
    t.skip("ALCHEMY_API_KEY not set — skipping live NFT API test");
    return;
  }
  // vitalik.eth holds many ENS NFTs on Ethereum mainnet. The ENS base
  // registrar (ERC-721) is a stable public test vector.
  const ENS_REGISTRAR = "0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85";
  const VITALIK = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
  const rows = await enumerateOwnership({
    chainId: 1,
    contract: ENS_REGISTRAR,
    wallets: [{ index: 0, address: VITALIK }],
    strategy: "alchemy",
  });
  assert.equal(rows.length, 1);
  assert.ok(Array.isArray(rows[0].tokenIds), "tokenIds should be an array");
  // Every returned id must be a decimal-string integer, sorted ascending.
  for (const id of rows[0].tokenIds) {
    assert.match(id, /^\d+$/, `tokenId ${id} should be a decimal string`);
  }
  const asBig = rows[0].tokenIds.map((x) => BigInt(x));
  for (let i = 1; i < asBig.length; i += 1) {
    assert.ok(asBig[i - 1] <= asBig[i], "tokenIds should be ascending");
  }
});
