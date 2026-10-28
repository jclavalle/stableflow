// Fixed server-side allowlist. Chain, token and explorer are code constants on
// purpose: no environment variable or browser input may override them.
// Recheck against official Base and Circle docs before PR 4 (receipt verification).

export const BASE_SEPOLIA = {
  chainId: 84532,
  name: "Base Sepolia",
  explorerUrl: "https://sepolia.basescan.org",
} as const;

export const TEST_USDC = {
  // Circle's published Base Sepolia test USDC. Testnet tokens have no value.
  address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  decimals: 6,
  symbol: "USDC",
} as const;
