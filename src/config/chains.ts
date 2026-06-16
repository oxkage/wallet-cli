import type { Chain } from "../types/chains";

export const DEFAULT_CHAINS: Chain[] = [
  { name: "Ethereum", chainId: 1, type: "evm", rpcUrl: "https://ethereum-rpc.publicnode.com", explorer: "https://etherscan.io", enabled: true },
  { name: "Base", chainId: 8453, type: "evm", rpcUrl: "https://base-rpc.publicnode.com", explorer: "https://basescan.org", enabled: true },
  { name: "Arbitrum", chainId: 42161, type: "evm", rpcUrl: "https://arbitrum-one-rpc.publicnode.com", explorer: "https://arbiscan.io", enabled: true },
  { name: "Optimism", chainId: 10, type: "evm", rpcUrl: "https://optimism-rpc.publicnode.com", explorer: "https://optimistic.etherscan.io", enabled: true },
  { name: "Polygon", chainId: 137, type: "evm", rpcUrl: "https://polygon-bor-rpc.publicnode.com", explorer: "https://polygonscan.com", enabled: true },
  { name: "BSC", chainId: 56, type: "evm", rpcUrl: "https://bsc-rpc.publicnode.com", explorer: "https://bscscan.com", enabled: true },
  { name: "Avalanche", chainId: 43114, type: "evm", rpcUrl: "https://avalanche-c-chain-rpc.publicnode.com", explorer: "https://snowtrace.io", enabled: true },
  { name: "Fantom", chainId: 250, type: "evm", rpcUrl: "https://fantom-rpc.publicnode.com", explorer: "https://ftmscan.com", enabled: true },
  { name: "Scroll", chainId: 534352, type: "evm", rpcUrl: "https://scroll-rpc.publicnode.com", explorer: "https://scrollscan.com", enabled: true },
  { name: "Mantle", chainId: 5000, type: "evm", rpcUrl: "https://rpc.mantle.xyz", explorer: "https://mantlescan.xyz", enabled: true },
  { name: "Linea", chainId: 59144, type: "evm", rpcUrl: "https://linea-rpc.publicnode.com", explorer: "https://lineascan.build", enabled: true },
  { name: "zkSync Era", chainId: 324, type: "evm", rpcUrl: "https://zksync-era-rpc.publicnode.com", explorer: "https://explorer.zksync.io", enabled: true },
  { name: "Blast", chainId: 81457, type: "evm", rpcUrl: "https://rpc.blast.io", explorer: "https://blastscan.io", enabled: true },
  { name: "Mode", chainId: 34443, type: "evm", rpcUrl: "https://mainnet.mode.network", explorer: "https://modescan.io", enabled: true },
  { name: "Zora", chainId: 7777777, type: "evm", rpcUrl: "https://rpc.zora.energy", explorer: "https://explorer.zora.energy", enabled: true },
  { name: "Gnosis", chainId: 100, type: "evm", rpcUrl: "https://gnosis-rpc.publicnode.com", explorer: "https://gnosisscan.io", enabled: true },
  { name: "Celo", chainId: 42220, type: "evm", rpcUrl: "https://forno.celo.org", explorer: "https://celoscan.io", enabled: true },
  { name: "Moonbeam", chainId: 1284, type: "evm", rpcUrl: "https://rpc.api.moonbeam.network", explorer: "https://moonscan.io", enabled: true },
  { name: "Cronos", chainId: 25, type: "evm", rpcUrl: "https://evm.cronos.org", explorer: "https://cronoscan.com", enabled: true },
  { name: "Metis", chainId: 1088, type: "evm", rpcUrl: "https://andromeda.metis.io/?owner=1088", explorer: "https://explorer.metis.io", enabled: true },
  { name: "Aurora", chainId: 1313161554, type: "evm", rpcUrl: "https://mainnet.aurora.dev", explorer: "https://explorer.aurora.dev", enabled: true },
  { name: "Monad", chainId: 10143, type: "evm", rpcUrl: "https://testnet-rpc.monad.xyz", explorer: "https://testnet.monadexplorer.com", enabled: true },
  { name: "PulseChain", chainId: 369, type: "evm", rpcUrl: "https://rpc.pulsechain.com", explorer: "https://scan.pulsechain.com", enabled: true },
  { name: "Abstract", chainId: 2741, type: "evm", rpcUrl: "https://api.mainnet.abs.xyz", explorer: "https://abscan.org", enabled: true },
  { name: "Harmony", chainId: 1666600000, type: "evm", rpcUrl: "https://api.harmony.one", explorer: "https://explorer.harmony.one", enabled: true }
];
