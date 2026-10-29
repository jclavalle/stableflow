import {
  decodeEventLog,
  decodeFunctionData,
  erc20Abi,
  isHash,
  toEventSelector,
  type Hex,
} from "viem";

import { BASE_SEPOLIA, TEST_USDC } from "./allowlist";

/** Demo confidence policy, not a statement about settlement finality. */
export const REQUIRED_CONFIRMATIONS = 3;

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
  | "wrong_token_contract"
  | "not_direct_transfer"
  | "wrong_recipient"
  | "wrong_amount"
  | "unexpected_transfer_logs"
  | "sender_mismatch"
  | "transfer_before_request"
  | "transfer_after_expiry";

export type VerificationResult =
  /** RPC failed or is misconfigured. Never treated as success. */
  | { kind: "unavailable"; reason: "rpc_error" | "rpc_wrong_chain" }
  /** Not (yet) on chain. */
  | { kind: "submitted"; reason: "not_found" | "not_mined" }
  /** Matching transfer found; waiting for confirmations or canonical re-check. */
  | { kind: "pending"; confirmations: number; reason: "confirming" | "block_not_canonical" }
  | { kind: "rejected"; code: RejectionCode }
  | { kind: "confirmed"; evidence: TransferEvidence };

const lower = (value: string) => value.toLowerCase();

/**
 * Verifies that `txHash` is a direct, successful test-USDC transfer of
 * exactly the expected amount to the expected recipient, mined after the
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

    const tx = await reader.getTransaction(hash);
    if (!tx) return { kind: "submitted", reason: "not_found" };
    const receipt = await reader.getTransactionReceipt(hash);
    if (!receipt) return { kind: "submitted", reason: "not_mined" };
    if (receipt.status !== "success") return { kind: "rejected", code: "reverted" };

    if (expected.creationBlock === null) {
      return { kind: "rejected", code: "request_missing_creation_block" };
    }

    // Direct transfer only: the transaction calls transfer() on the token.
    if (!tx.to || lower(tx.to) !== TOKEN) return { kind: "rejected", code: "wrong_token_contract" };
    let call;
    try {
      call = decodeFunctionData({ abi: erc20Abi, data: tx.input });
    } catch {
      return { kind: "rejected", code: "not_direct_transfer" };
    }
    if (call.functionName !== "transfer") return { kind: "rejected", code: "not_direct_transfer" };
    const [callTo, callAmount] = call.args;
    if (lower(callTo) !== lower(expected.recipient)) return { kind: "rejected", code: "wrong_recipient" };
    if (callAmount !== expected.amountUnits) return { kind: "rejected", code: "wrong_amount" };

    // Exactly one Transfer event from the allowlisted token, matching the call.
    const transferLogs = receipt.logs.filter(
      (log) => lower(log.address) === TOKEN && log.topics[0] === TRANSFER_TOPIC,
    );
    if (transferLogs.length !== 1) return { kind: "rejected", code: "unexpected_transfer_logs" };
    const log = transferLogs[0];
    let event;
    try {
      event = decodeEventLog({ abi: erc20Abi, eventName: "Transfer", topics: log.topics as [Hex, ...Hex[]], data: log.data });
    } catch {
      return { kind: "rejected", code: "unexpected_transfer_logs" };
    }
    const { from, to, value } = event.args;
    if (lower(from) !== lower(tx.from)) return { kind: "rejected", code: "sender_mismatch" };
    if (lower(to) !== lower(expected.recipient)) return { kind: "rejected", code: "wrong_recipient" };
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
