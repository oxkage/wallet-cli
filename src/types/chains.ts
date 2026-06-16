export type Chain = {
  name: string;
  chainId: number | string;
  type: "evm";
  rpcUrl: string;
  explorer?: string;
  enabled: boolean;
};
