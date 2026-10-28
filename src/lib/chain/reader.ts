import "server-only";

import {
  createPublicClient,
  http,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  type Hex,
} from "viem";

import { getServerConfig } from "@/lib/config/server";

import type { ChainReader } from "./verify-transfer";

/** Bounded, read-only access to the server's configured RPC. Never signs. */
export function createChainReader(): ChainReader {
  const client = createPublicClient({
    transport: http(getServerConfig().BASE_SEPOLIA_RPC_URL, { timeout: 8_000, retryCount: 1 }),
  });

  return {
    getChainId: () => client.getChainId(),
    getBlockNumber: () => client.getBlockNumber({ cacheTime: 0 }),
    async getTransaction(hash: Hex) {
      try {
        const tx = await client.getTransaction({ hash });
        return { hash: tx.hash, from: tx.from, to: tx.to, input: tx.input, blockNumber: tx.blockNumber };
      } catch (error) {
        if (error instanceof TransactionNotFoundError) return null;
        throw error;
      }
    },
    async getTransactionReceipt(hash: Hex) {
      try {
        const receipt = await client.getTransactionReceipt({ hash });
        return {
          status: receipt.status,
          blockNumber: receipt.blockNumber,
          blockHash: receipt.blockHash,
          logs: receipt.logs.map((log) => ({
            address: log.address,
            topics: log.topics as Hex[],
            data: log.data,
            logIndex: log.logIndex,
          })),
        };
      } catch (error) {
        if (error instanceof TransactionReceiptNotFoundError) return null;
        throw error;
      }
    },
    async getBlock(number: bigint) {
      const block = await client.getBlock({ blockNumber: number });
      if (!block.hash || block.number === null) return null;
      return { hash: block.hash, number: block.number, timestamp: block.timestamp };
    },
  };
}
