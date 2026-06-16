import { ethers } from "ethers";
import { getAlchemyKey, alchemyRpcUrl } from "../../config/alchemy";

/**
 * NFT ownership enumeration.
 *
 * Plain ERC-721 has no "list the tokenIds owned by X" call, so we need an
 * external source of truth. Two strategies, in priority order:
 *
 *  1. Alchemy NFT API (`getNFTsForOwner` filtered by contract) — universal,
 *     works for ANY ERC-721 regardless of whether it implements Enumerable.
 *     This is the primary path. Requires ALCHEMY_API_KEY.
 *
 *  2. ERC721Enumerable on-chain (`balanceOf` + `tokenOfOwnerByIndex`) — a
 *     fallback used only when no Alchemy key is set. Works ONLY if the
 *     collection implements the Enumerable extension; many do not.
 *
 * The result is a deterministic, ascending-sorted list of tokenIds per wallet.
 */

export interface NftOwnership {
  index: number; // wallet derivation index
  address: string; // owner address
  tokenIds: string[]; // decimal-string tokenIds owned, ascending
}

export interface EnumerateOpts {
  chainId: number;
  contract: string; // NFT collection (0x address)
  wallets: { index: number; address: string }[];
  /** Force a strategy. Default: auto (alchemy if key present, else enumerable). */
  strategy?: "alchemy" | "enumerable" | "auto";
  /** RPC URL for the enumerable fallback. */
  rpcUrl?: string;
  /** Max concurrent owner reads. Default 3 (Alchemy-friendly). */
  concurrency?: number;
}

const ERC721_ENUM_IFACE = new ethers.Interface([
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
]);

/** Bounded-concurrency map (same pattern as scan.ts). */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const n = Math.max(1, Math.min(limit, items.length || 1));
  async function worker(): Promise<void> {
    while (true) {
      const i = cursor;
      cursor += 1;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

function sortTokenIdsAsc(ids: string[]): string[] {
  return [...ids].sort((a, b) => {
    const da = BigInt(a);
    const db = BigInt(b);
    return da < db ? -1 : da > db ? 1 : 0;
  });
}

/**
 * Build the Alchemy NFT API base URL from the same slug used for RPC.
 * RPC:  https://<slug>.g.alchemy.com/v2/<KEY>
 * NFT:  https://<slug>.g.alchemy.com/nft/v3/<KEY>
 */
function alchemyNftBase(chainId: number): string | null {
  const key = getAlchemyKey();
  if (!key) return null;
  const rpc = alchemyRpcUrl(chainId);
  if (!rpc) return null;
  return rpc.replace(`/v2/${key}`, `/nft/v3/${key}`);
}

async function enumerateViaAlchemy(
  base: string,
  contract: string,
  owner: string
): Promise<string[]> {
  const tokenIds: string[] = [];
  let pageKey: string | undefined;
  // Page through all NFTs of this contract held by the owner.
  do {
    const params = new URLSearchParams({
      owner,
      withMetadata: "false",
      pageSize: "100",
    });
    params.append("contractAddresses[]", contract);
    if (pageKey) params.set("pageKey", pageKey);
    const url = `${base}/getNFTsForOwner?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Alchemy NFT API ${res.status} for owner ${owner}: ${body.slice(0, 200)}`
      );
    }
    const json: any = await res.json();
    for (const nft of json.ownedNfts ?? []) {
      // Defensive: contract filter is server-side, but double-check.
      const addr = nft?.contract?.address;
      if (addr && addr.toLowerCase() !== contract.toLowerCase()) continue;
      if (nft?.tokenId != null) {
        // Alchemy returns decimal tokenId strings; normalize via BigInt.
        tokenIds.push(BigInt(nft.tokenId).toString());
      }
    }
    pageKey = json.pageKey;
  } while (pageKey);
  return sortTokenIdsAsc(tokenIds);
}

async function enumerateViaEnumerable(
  provider: ethers.JsonRpcProvider,
  contract: string,
  owner: string
): Promise<string[]> {
  const balData = ERC721_ENUM_IFACE.encodeFunctionData("balanceOf", [owner]);
  let count: bigint;
  try {
    const balRes = await provider.call({ to: contract, data: balData });
    count = BigInt(balRes);
  } catch (e: any) {
    throw new Error(
      `enumerable fallback: balanceOf failed on ${contract} — collection may not exist on this chain (${e?.shortMessage ?? e?.message ?? e})`
    );
  }
  const ids: string[] = [];
  for (let i = 0n; i < count; i += 1n) {
    const data = ERC721_ENUM_IFACE.encodeFunctionData("tokenOfOwnerByIndex", [owner, i]);
    try {
      const res = await provider.call({ to: contract, data });
      ids.push(BigInt(res).toString());
    } catch (e: any) {
      throw new Error(
        `enumerable fallback: tokenOfOwnerByIndex(${owner}, ${i}) reverted — ` +
          `collection ${contract} likely does NOT implement ERC721Enumerable. ` +
          `Set ALCHEMY_API_KEY to use the universal NFT API instead.`
      );
    }
  }
  return sortTokenIdsAsc(ids);
}

export async function enumerateOwnership(opts: EnumerateOpts): Promise<NftOwnership[]> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(opts.contract)) {
    throw new Error(`contract must be a 0x-prefixed 40-hex EVM address, got: ${opts.contract}`);
  }

  const strategy = opts.strategy ?? "auto";
  const nftBase = alchemyNftBase(opts.chainId);

  const useAlchemy =
    strategy === "alchemy" || (strategy === "auto" && nftBase !== null);

  if (strategy === "alchemy" && !nftBase) {
    throw new Error(
      "strategy 'alchemy' requested but ALCHEMY_API_KEY is not set (or chain has no Alchemy slug)."
    );
  }

  let provider: ethers.JsonRpcProvider | null = null;
  if (!useAlchemy) {
    if (!opts.rpcUrl) {
      throw new Error(
        "enumerable fallback needs an rpcUrl, and no Alchemy key is set. " +
          "Set ALCHEMY_API_KEY (recommended) or pass rpcUrl."
      );
    }
    provider = new ethers.JsonRpcProvider(opts.rpcUrl);
  }

  const rows = await mapLimit(opts.wallets, opts.concurrency ?? 3, async (w) => {
    const tokenIds = useAlchemy
      ? await enumerateViaAlchemy(nftBase as string, opts.contract, w.address)
      : await enumerateViaEnumerable(provider as ethers.JsonRpcProvider, opts.contract, w.address);
    return { index: w.index, address: w.address, tokenIds };
  });

  return rows;
}
