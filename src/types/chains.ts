export type Chain = {
  name: string;
  chainId: number | string;
  type: "evm" | "solana";
  rpcUrl: string;
  explorer?: string;
  enabled: boolean;
};
