import { decodeEventLog, erc20Abi, type Hex } from "viem";

import { BASE_SEPOLIA, TEST_USDC } from "./allowlist";
import type { ChainReader } from "./verify-transfer";

/** Evidence stored in verified_receipts when the request was confirmed. */
export type StoredEvidence = {
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  blockHash: string;
  recipient: string;
  amountUnits: bigint;
};

export type EvidenceInvalidReason =
  | "receipt_missing"
  | "receipt_reverted"
  | "block_changed"
  | "block_not_canonical"
  | "log_missing";

export type RecheckResult =
  | { kind: "valid" }
  | { kind: "invalid"; reason: EvidenceInvalidReason }
  /** RPC failed: say nothing about the evidence, block the action. */
  | { kind: "unavailable" };

const lower = (value: string) => value.toLowerCase();

/**
 * Re-validates confirmed evidence against the chain right now (plan §7 rule
 * 9): the receipt still exists, succeeded, sits in the same block, that block
 * is still canonical at its height, and the same Transfer log is present.
 * Only "valid" may let a payout simulation proceed.
 */
export async function recheckEvidence(reader: ChainReader, evidence: StoredEvidence): Promise<RecheckResult> {
  try {
    if ((await reader.getChainId()) !== BASE_SEPOLIA.chainId) return { kind: "unavailable" };

    const receipt = await reader.getTransactionReceipt(evidence.txHash as Hex);
    if (!receipt) return { kind: "invalid", reason: "receipt_missing" };
    if (receipt.status !== "success") return { kind: "invalid", reason: "receipt_reverted" };
    if (receipt.blockNumber !== evidence.blockNumber || lower(receipt.blockHash) !== lower(evidence.blockHash)) {
      return { kind: "invalid", reason: "block_changed" };
    }

    const block = await reader.getBlock(evidence.blockNumber);
    if (!block) return { kind: "unavailable" };
    if (lower(block.hash) !== lower(evidence.blockHash)) return { kind: "invalid", reason: "block_not_canonical" };

    const log = receipt.logs.find((entry) => entry.logIndex === evidence.logIndex);
    if (!log || lower(log.address) !== lower(TEST_USDC.address)) return { kind: "invalid", reason: "log_missing" };
    try {
      const event = decodeEventLog({ abi: erc20Abi, eventName: "Transfer", topics: log.topics as [Hex, ...Hex[]], data: log.data });
      if (lower(event.args.to) !== lower(evidence.recipient) || event.args.value !== evidence.amountUnits) {
        return { kind: "invalid", reason: "log_missing" };
      }
    } catch {
      return { kind: "invalid", reason: "log_missing" };
    }

    return { kind: "valid" };
  } catch {
    return { kind: "unavailable" };
  }
}
