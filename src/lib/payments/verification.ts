import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { verifyTransfer, type ChainReader, REQUIRED_CONFIRMATIONS } from "@/lib/chain/verify-transfer";

export type AttemptStatus = "submitted" | "pending" | "rejected" | "verified";

/** What a payer or owner sees about one attempt. Tx hashes are public on chain. */
export type AttemptView = {
  txHash: string;
  status: AttemptStatus;
  errorCode: string | null;
  confirmations: number;
  requiredConfirmations: number;
  /** True when the chain could not be read just now; status is unchanged. */
  unavailable: boolean;
};

type RequestRow = {
  id: string;
  recipient_snapshot: string;
  amount_units: string;
  creation_block: string | null;
  expires_at: string;
};

type AttemptRow = {
  tx_hash: string;
  status: AttemptStatus;
  error_code: string | null;
  confirmations: number;
  last_checked_at: string | null;
};

// Bound RPC use per attempt: repeated checks within this window reuse the stored result.
const CHECK_COOLDOWN_MS = 2_000;

// Database outcomes that mean "this evidence can't satisfy this request".
const CONFIRM_REJECTIONS = new Set([
  "evidence_already_used",
  "evidence_before_request",
  "evidence_after_expiry",
  "evidence_mismatch",
]);

function view(row: AttemptRow, unavailable = false): AttemptView {
  return {
    txHash: row.tx_hash,
    status: row.status,
    errorCode: row.error_code,
    confirmations: row.confirmations,
    requiredConfirmations: REQUIRED_CONFIRMATIONS,
    unavailable,
  };
}

export const REQUEST_VERIFY_COLUMNS =
  "id, recipient_snapshot, amount_units::text, creation_block::text, expires_at";

/**
 * Checks one attempt against the chain and records the outcome. Safe to call
 * repeatedly and concurrently: confirmation happens in one locked database
 * transaction, and repeats return the stored result.
 */
export async function checkAttempt(
  admin: SupabaseClient,
  reader: ChainReader,
  request: RequestRow,
  txHash: string,
  now = new Date(),
): Promise<AttemptView> {
  const { data: attempt, error } = await admin
    .from("payment_attempts")
    .select("tx_hash, status, error_code, confirmations, last_checked_at")
    .eq("request_id", request.id)
    .eq("tx_hash", txHash)
    .maybeSingle<AttemptRow>();
  if (error) throw new Error("attempt lookup failed");
  if (!attempt) throw new Error("attempt_not_found");

  if (attempt.status === "verified" || attempt.status === "rejected") return view(attempt);
  if (attempt.last_checked_at && now.getTime() - new Date(attempt.last_checked_at).getTime() < CHECK_COOLDOWN_MS) {
    return view(attempt);
  }

  const result = await verifyTransfer(reader, txHash, {
    recipient: request.recipient_snapshot,
    amountUnits: BigInt(request.amount_units),
    creationBlock: request.creation_block === null ? null : BigInt(request.creation_block),
    expiresAt: new Date(request.expires_at),
  });

  if (result.kind === "unavailable") return view(attempt, true);

  if (result.kind === "confirmed") {
    const e = result.evidence;
    const confirm = await admin.rpc("confirm_payment", {
      p_request_id: request.id,
      p_tx_hash: e.txHash,
      p_log_index: e.logIndex,
      p_block_number: e.blockNumber.toString(),
      p_block_hash: e.blockHash,
      p_block_timestamp: e.blockTimestamp.toISOString(),
      p_sender: e.sender,
      p_recipient: e.recipient,
      p_amount_units: e.amountUnits.toString(),
      p_confirmations: e.confirmations,
    });
    if (!confirm.error) {
      return view({ ...attempt, status: "verified", error_code: null, confirmations: e.confirmations });
    }
    if (CONFIRM_REJECTIONS.has(confirm.error.message)) {
      return record(admin, request.id, txHash, "rejected", confirm.error.message, 0);
    }
    if (confirm.error.message === "request_already_confirmed" || confirm.error.message === "request_not_open") {
      return record(admin, request.id, txHash, "rejected", confirm.error.message, 0);
    }
    throw new Error("confirmation failed");
  }

  if (result.kind === "rejected") return record(admin, request.id, txHash, "rejected", result.code, 0);
  if (result.kind === "pending") return record(admin, request.id, txHash, "pending", null, result.confirmations);
  return record(admin, request.id, txHash, "submitted", null, 0);
}

async function record(
  admin: SupabaseClient,
  requestId: string,
  txHash: string,
  status: "submitted" | "pending" | "rejected",
  errorCode: string | null,
  confirmations: number,
): Promise<AttemptView> {
  const { data, error } = await admin
    .rpc("record_attempt_check", {
      p_request_id: requestId,
      p_tx_hash: txHash,
      p_status: status,
      p_error_code: errorCode,
      p_confirmations: confirmations,
    })
    .single<AttemptRow>();
  if (error) throw new Error("recording attempt failed");
  return view(data);
}

export async function listAttempts(admin: SupabaseClient, requestId: string): Promise<AttemptView[]> {
  const { data, error } = await admin
    .from("payment_attempts")
    .select("tx_hash, status, error_code, confirmations, last_checked_at")
    .eq("request_id", requestId)
    .order("created_at", { ascending: false })
    .returns<AttemptRow[]>();
  if (error) throw new Error("attempt lookup failed");
  return data.map((row) => view(row));
}
