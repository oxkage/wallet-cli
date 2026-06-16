import { ethers } from "ethers";
import { findDerivedEvmWalletByAddress } from "./wallets";

export type ResolvedSigner = {
  address: string;
  privateKey: string;
  index: number;
  path: string;
  wallet: ethers.HDNodeWallet;
};

/**
 * Resolve a signer from `--from <address>` by searching the SEED_PHRASE derivation range.
 * Returns an ethers HDNodeWallet ready to be connected to a provider.
 */
export function resolveSigner(fromAddress: string, maxIndex = 200): ResolvedSigner {
  const derived = findDerivedEvmWalletByAddress(fromAddress, maxIndex);
  // Re-derive through ethers to get a Wallet (not a bare node) so .sendTransaction works.
  const phrase = process.env.SEED_PHRASE?.trim();
  if (!phrase) throw new Error("SEED_PHRASE is required in .env");
  const wallet = ethers.HDNodeWallet.fromPhrase(phrase, undefined, derived.path);
  return {
    address: derived.address,
    privateKey: derived.privateKey,
    index: derived.index,
    path: derived.path,
    wallet,
  };
}

/**
 * Resolve and connect the signer to a provider in one call.
 */
export function resolveConnectedSigner(
  fromAddress: string,
  provider: ethers.JsonRpcProvider,
  maxIndex = 200
): ResolvedSigner {
  const signer = resolveSigner(fromAddress, maxIndex);
  const connected = signer.wallet.connect(provider) as ethers.HDNodeWallet;
  return { ...signer, wallet: connected };
}
