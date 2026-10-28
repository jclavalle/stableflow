import { NextResponse } from "next/server";

import { createChainReader } from "@/lib/chain/reader";
import { isTrustedOrigin, jsonError } from "@/lib/http";
import { NO_STORE, resolvePayRequest } from "@/lib/payments/pay-route";
import { verificationRow } from "@/lib/payments/requests";
import { checkAttempt, type AttemptView } from "@/lib/payments/verification";
import { REQUIRED_CONFIRMATIONS } from "@/lib/chain/verify-transfer";
import { createAdminClient } from "@/lib/supabase/server";

const ATTEMPT_ERRORS: Record<string, [number, string]> = {
  request_not_open: [409, "This request is no longer accepting payments."],
  too_many_attempts: [429, "Too many transactions were submitted for this request."],
};

// Stores a candidate transaction hash. Submission alone never marks a request paid.
export async function POST(request: Request, context: RouteContext<"/api/pay/[token]/attempts">) {
  if (!isTrustedOrigin(request)) return jsonError(403, "bad_origin", "Request origin not allowed.");

  const resolved = await resolvePayRequest(request, (await context.params).token);
  if (resolved instanceof Response) return resolved;
  const { capability, txHash } = resolved;

  const admin = createAdminClient();
  const { error } = await admin.rpc("submit_payment_attempt", {
    p_request_id: capability.id,
    p_tx_hash: txHash,
  });
  if (error) {
    const known = ATTEMPT_ERRORS[error.message];
    if (known) return jsonError(known[0], error.message, known[1]);
    return jsonError(503, "unavailable", "Could not record the transaction. Try again.");
  }

  let attempt: AttemptView;
  try {
    attempt = await checkAttempt(admin, createChainReader(), verificationRow(capability), txHash);
  } catch {
    attempt = {
      txHash,
      status: "submitted",
      errorCode: null,
      confirmations: 0,
      requiredConfirmations: REQUIRED_CONFIRMATIONS,
      unavailable: true,
    };
  }
  return NextResponse.json({ attempt }, { status: 201, headers: NO_STORE });
}
