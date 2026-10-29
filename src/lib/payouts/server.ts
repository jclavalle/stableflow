import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { recheckEvidence, type RecheckResult } from "@/lib/chain/recheck-evidence";
import type { ChainReader } from "@/lib/chain/verify-transfer";
import { jsonError } from "@/lib/http";

// Errors raised by the payout database functions.
const DB_ERRORS: Record<string, [number, string]> = {
  request_not_found: [404, "Payment request not found."],
  request_not_confirmed: [409, "A quote or simulation needs a payment confirmed on testnet."],
  quote_not_found: [404, "Quote not found."],
  quote_expired: [409, "This quote expired. Get a new quote."],
  quote_input_mismatch: [409, "The quote does not match this request."],
  too_many_quotes: [429, "Too many quotes for this request."],
  simulation_exists: [409, "A payout simulation already exists for this request."],
  simulation_not_found: [404, "Simulation not found."],
  idempotency_key_reused: [409, "That simulation key was already used."],
};

export function payoutErrorResponse(message: string) {
  const known = DB_ERRORS[message];
  if (known) return jsonError(known[0], message, known[1]);
  return jsonError(503, "unavailable", "The service is unavailable. Try again.");
}

type ReceiptRow = {
  tx_hash: string;
  log_index: number;
  block_number: string;
  block_hash: string;
  recipient: string;
  amount_units: string;
};

/**
 * Re-checks a confirmed request's receipt on chain (plan §7 rule 9). Invalid
 * evidence moves the request to under_review, which also stops any
 * unfinished simulation. Unavailable changes nothing.
 */
export async function revalidateEvidence(
  admin: SupabaseClient,
  reader: ChainReader,
  requestId: string,
): Promise<RecheckResult> {
  const { data, error } = await admin
    .from("verified_receipts")
    .select("tx_hash, log_index, block_number::text, block_hash, recipient, amount_units::text")
    .eq("request_id", requestId)
    .maybeSingle<ReceiptRow>();
  if (error) throw new Error("receipt lookup failed");
  if (!data) return { kind: "invalid", reason: "receipt_missing" };

  const result = await recheckEvidence(reader, {
    txHash: data.tx_hash,
    logIndex: data.log_index,
    blockNumber: BigInt(data.block_number),
    blockHash: data.block_hash,
    recipient: data.recipient,
    amountUnits: BigInt(data.amount_units),
  });

  if (result.kind === "invalid") {
    const flag = await admin.rpc("flag_evidence_review", { p_request_id: requestId, p_reason: result.reason });
    if (flag.error) throw new Error("flagging review failed");
  }
  return result;
}

/** Server timing mirrored from advance_payout_simulation(); the database re-checks it. */
export const PROCESSING_SECONDS = 3;
