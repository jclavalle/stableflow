// Read-only check of the chain allowlist against a live RPC (plan §7):
// chain ID, contract bytecode present, ERC-20 symbol and decimals.
// Usage: npm run chain:check -- [rpcUrl]
import { createPublicClient, erc20Abi, http } from "viem";

import { BASE_SEPOLIA, TEST_USDC } from "../src/lib/chain/allowlist.ts";

const rpcUrl = process.argv[2] ?? process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";
const client = createPublicClient({ transport: http(rpcUrl, { timeout: 10_000 }) });

const failures: string[] = [];
const chainId = await client.getChainId();
if (chainId !== BASE_SEPOLIA.chainId) failures.push(`chain ID ${chainId} ≠ ${BASE_SEPOLIA.chainId}`);

const code = await client.getCode({ address: TEST_USDC.address });
if (!code || code === "0x") failures.push("no contract bytecode at the USDC address");

const [symbol, decimals, head] = await Promise.all([
  client.readContract({ address: TEST_USDC.address, abi: erc20Abi, functionName: "symbol" }),
  client.readContract({ address: TEST_USDC.address, abi: erc20Abi, functionName: "decimals" }),
  client.getBlockNumber(),
]);
if (symbol !== TEST_USDC.symbol) failures.push(`symbol ${symbol} ≠ ${TEST_USDC.symbol}`);
if (decimals !== TEST_USDC.decimals) failures.push(`decimals ${decimals} ≠ ${TEST_USDC.decimals}`);

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      rpcUrl,
      chainId,
      usdc: TEST_USDC.address,
      bytecodeBytes: code ? (code.length - 2) / 2 : 0,
      symbol,
      decimals,
      headBlock: head.toString(),
      ok: failures.length === 0,
      failures,
    },
    null,
    2,
  ),
);
process.exit(failures.length === 0 ? 0 : 1);
