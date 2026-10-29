import { NextResponse } from "next/server";

import { createChainReader } from "@/lib/chain/reader";
import { isTrustedOrigin, jsonError } from "@/lib/http";
import { requestIdSchema } from "@/lib/payments/server";
import { checkAttempt, listAttempts, REQUEST_VERIFY_COLUMNS } from "@/lib/payments/verification";
import { createAdminClient, getCurrentUser } from "@/lib/supabase/server";

const MAX_CHECKS = 3;

// Owner-triggered re-check of unfinished attempts (e.g. the payer closed the tab).
export async function POST(request: Request, context: RouteContext<"/api/requests/[id]/verify">) {
  if (!isTrustedOrigin(request)) return jsonError(403, "bad_origin", "Request origin not allowed.");

  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "Sign in first.");

  const id = requestIdSchema.safeParse((await context.params).id);
  if (!id.success) return jsonError(404, "request_not_found", "Payment request not found.");

  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("payment_requests")
    .select(REQUEST_VERIFY_COLUMNS)
    .eq("id", id.data)
    .eq("user_id", user.id)
    .maybeSingle<{ id: string; recipient_snapshot: string; amount_units: string; creation_block: string | null; expires_at: string }>();
  if (error) return jsonError(503, "unavailable", "The service is unavailable. Try again.");
  if (!row) return jsonError(404, "request_not_found", "Payment request not found.");

  try {
    const unfinished = (await listAttempts(admin, row.id))
      .filter((attempt) => attempt.status === "submitted" || attempt.status === "pending")
      .slice(0, MAX_CHECKS);
    const reader = createChainReader();
    let unavailable = false;
    for (const attempt of unfinished) {
      const result = await checkAttempt(admin, reader, row, attempt.txHash);
      unavailable ||= result.unavailable;
    }
    return NextResponse.json({ attempts: await listAttempts(admin, row.id), unavailable });
  } catch {
    return jsonError(503, "unavailable", "Verification is unavailable right now. Try again.");
  }
}
