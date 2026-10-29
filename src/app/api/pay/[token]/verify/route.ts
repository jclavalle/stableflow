import { NextResponse } from "next/server";

import { createChainReader } from "@/lib/chain/reader";
import { isTrustedOrigin, jsonError } from "@/lib/http";
import { NO_STORE, resolvePayRequest } from "@/lib/payments/pay-route";
import { verificationRow } from "@/lib/payments/requests";
import { checkAttempt } from "@/lib/payments/verification";
import { createAdminClient } from "@/lib/supabase/server";

// Bounded, idempotent status refresh for one submitted transaction. The
// browser retries with backoff; nothing polls on the server.
export async function POST(request: Request, context: RouteContext<"/api/pay/[token]/verify">) {
  if (!isTrustedOrigin(request)) return jsonError(403, "bad_origin", "Request origin not allowed.");

  const resolved = await resolvePayRequest(request, (await context.params).token);
  if (resolved instanceof Response) return resolved;
  const { capability, txHash } = resolved;

  try {
    const attempt = await checkAttempt(createAdminClient(), createChainReader(), verificationRow(capability), txHash);
    return NextResponse.json({ attempt }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Error && error.message === "attempt_not_found") {
      return jsonError(404, "attempt_not_found", "That transaction was not submitted for this request.");
    }
    return jsonError(503, "unavailable", "Verification is unavailable right now. Try again.");
  }
}
