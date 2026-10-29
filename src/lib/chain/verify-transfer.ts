import {
  decodeEventLog,
  erc20Abi,
  isHash,
  toEventSelector,
  type Hex,
} from "viem";

import { BASE_SEPOLIA, TEST_USDC } from "./allowlist";

/** Demo confidence policy, not a statement about settlement finality. */
export const REQUIRED_CONFIRMATIONS = 3;

/**
 * Minimum chain time between the payment's block and the head (D38). Base
 * Sepolia produces several blocks per second, so block count alone is reached
 * almost instantly. Measured with block timestamps, not the server clock.
 */
export const MIN_CONFIRMATION_AGE_SECONDS = 30;

const TOKEN = TEST_USDC.address.toLowerCase();
const TRANSFER_TOPIC = toEventSelector("Transfer(address,address,uint256)");

export type ChainTransaction = {
  hash: Hex;
  from: string;
  to: string | null;
  input: Hex;
  blockNumber: bigint | null;
};

export type ChainLog = {
  address: string;
  topics: Hex[];
  data: Hex;
  logIndex: number;
};

export type ChainReceipt = {
  status: "success" | "reverted";
  blockNumber: bigint;
  blockHash: Hex;
  logs: ChainLog[];
};

export type ChainBlock = { hash: Hex; number: bigint; timestamp: bigint };

/** Read-only chain access. The server's implementation uses its own trusted RPC. */
export interface ChainReader {
  getChainId(): Promise<number>;
  getBlockNumber(): Promise<bigint>;
  getTransaction(hash: Hex): Promise<ChainTransaction | null>;
  getTransactionReceipt(hash: Hex): Promise<ChainReceipt | null>;
  getBlock(number: bigint): Promise<ChainBlock | null>;
}

export type TransferExpectation = {
  recipient: string;
  amountUnits: bigint;
  creationBlock: bigint | null;
  expiresAt: Date;
};

export type TransferEvidence = {
  txHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  blockHash: Hex;
  blockTimestamp: Date;
  sender: string;
  recipient: string;
  amountUnits: bigint;
  confirmations: number;
};

export type RejectionCode =
  | "invalid_hash"
  | "reverted"
  | "request_missing_creation_block"
  | "no_token_transfer"
  | "wrong_recipient"
  | "wrong_amount"
  | "unexpected_transfer_logs"
  | "transfer_before_request"
  | "transfer_after_expiry";

export type VerificationResult =
  /** RPC failed or is misconfigured. Never treated as success. */
  | { kind: "unavailable"; reason: "rpc_error" | "rpc_wrong_chain" }
  /** Not (yet) on chain. */
  | { kind: "submitted"; reason: "not_found" | "not_mined" }
  /** Matching transfer found; waiting for confirmations or canonical re-check. */
  | { kind: "pending"; confirmations: number; reason: "confirming" | "aging" | "block_not_canonical" }
  | { kind: "rejected"; code: RejectionCode }
  | { kind: "confirmed"; evidence: TransferEvidence };

const lower = (value: string) => value.toLowerCase();

/**
 * Verifies that `txHash` is a successful transaction whose only test-USDC
 * Transfer to the expected recipient carries exactly the expected amount
 * (direct, smart-account or relayed: D37), mined after the
 * request was created and before it expired, with enough confirmations on
 * the canonical chain. Every check must pass; anything uncertain is pending
 * or unavailable, never confirmed.
 */
export async function verifyTransfer(
  reader: ChainReader,
  txHash: string,
  expected: TransferExpectation,
): Promise<VerificationResult> {
  if (!isHash(txHash)) return { kind: "rejected", code: "invalid_hash" };
  const hash = lower(txHash) as Hex;

  try {
    if ((await reader.getChainId()) !== BASE_SEPOLIA.chainId) {
      return { kind: "unavailable", reason: "rpc_wrong_chain" };
    }

    if (!(await reader.getTransaction(hash))) return { kind: "submitted", reason: "not_found" };
    const receipt = await reader.getTransactionReceipt(hash);
    if (!receipt) return { kind: "submitted", reason: "not_mined" };
    if (receipt.status !== "success") return { kind: "rejected", code: "reverted" };

    if (expected.creationBlock === null) {
      return { kind: "rejected", code: "request_missing_creation_block" };
    }

    // Match on what the chain recorded, not on how the transaction was packaged
    // (D37): direct transfers, smart accounts (EIP-7702, ERC-4337) and relayers
    // all produce a Transfer event from the allowlisted token. Exactly one such
    // event to the recipient is required; more than one is ambiguous.
    const tokenLogs = receipt.logs.filter(
      (log) => lower(log.address) === TOKEN && log.topics[0] === TRANSFER_TOPIC,
    );
    if (tokenLogs.length === 0) return { kind: "rejected", code: "no_token_transfer" };
    const transfers = [];
    for (const log of tokenLogs) {
      try {
        const event = decodeEventLog({ abi: erc20Abi, eventName: "Transfer", topics: log.topics as [Hex, ...Hex[]], data: log.data });
        transfers.push({ log, ...event.args });
      } catch {
        return { kind: "rejected", code: "unexpected_transfer_logs" };
      }
    }
    const toRecipient = transfers.filter((t) => lower(t.to) === lower(expected.recipient));
    if (toRecipient.length === 0) return { kind: "rejected", code: "wrong_recipient" };
    if (toRecipient.length > 1) return { kind: "rejected", code: "unexpected_transfer_logs" };
    const { log, from, to, value } = toRecipient[0];
    if (value !== expected.amountUnits) return { kind: "rejected", code: "wrong_amount" };

    // Never accept evidence older than the request.
    if (receipt.blockNumber < expected.creationBlock) {
      return { kind: "rejected", code: "transfer_before_request" };
    }

    const block = await reader.getBlock(receipt.blockNumber);
    if (!block) return { kind: "unavailable", reason: "rpc_error" };
    if (lower(block.hash) !== lower(receipt.blockHash)) {
      return { kind: "pending", confirmations: 0, reason: "block_not_canonical" };
    }
    const blockTimestamp = new Date(Number(block.timestamp) * 1000);
    if (blockTimestamp.getTime() >= expected.expiresAt.getTime()) {
      return { kind: "rejected", code: "transfer_after_expiry" };
    }

    const head = await reader.getBlockNumber();
    const confirmations = head >= receipt.blockNumber ? Number(head - receipt.blockNumber) + 1 : 0;
    if (confirmations < REQUIRED_CONFIRMATIONS) {
      return { kind: "pending", confirmations, reason: "confirming" };
    }

    // Re-fetch before committing: the receipt and block must still be canonical.
    const [receiptAgain, blockAgain] = await Promise.all([
      reader.getTransactionReceipt(hash),
      reader.getBlock(receipt.blockNumber),
    ]);
    if (
      !receiptAgain ||
      !blockAgain ||
      lower(receiptAgain.blockHash) !== lower(receipt.blockHash) ||
      lower(blockAgain.hash) !== lower(receipt.blockHash)
    ) {
      return { kind: "pending", confirmations: 0, reason: "block_not_canonical" };
    }

    const headBlock = await reader.getBlock(head);
    if (!headBlock) return { kind: "unavailable", reason: "rpc_error" };
    if (headBlock.timestamp - block.timestamp < BigInt(MIN_CONFIRMATION_AGE_SECONDS)) {
      return { kind: "pending", confirmations, reason: "aging" };
    }

    return {
      kind: "confirmed",
      evidence: {
        txHash: hash,
        logIndex: log.logIndex,
        blockNumber: receipt.blockNumber,
        blockHash: lower(receipt.blockHash) as Hex,
        blockTimestamp,
        sender: lower(from),
        recipient: lower(to),
        amountUnits: value,
        confirmations,
      },
    };
  } catch {
    return { kind: "unavailable", reason: "rpc_error" };
  }
}
