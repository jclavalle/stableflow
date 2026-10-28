import { NextResponse } from "next/server";

import { jsonError } from "@/lib/http";
import { effectiveStatus, type RequestStatus } from "@/lib/payments/requests";
import { requestIdSchema } from "@/lib/payments/server";
import { createUserClient, getCurrentUser } from "@/lib/supabase/server";

export async function GET(_request: Request, context: RouteContext<"/api/requests/[id]">) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "Sign in first.");

  const id = requestIdSchema.safeParse((await context.params).id);
  if (!id.success) return jsonError(404, "request_not_found", "Payment request not found.");

  // User-scoped client: RLS returns nothing for another user's request.
  const supabase = await createUserClient();
  const { data, error } = await supabase
    .from("payment_requests")
    .select("id, amount_units::text, recipient_snapshot, chain_id, token_address, status, created_at, expires_at")
    .eq("id", id.data)
    .maybeSingle<{
      id: string;
      amount_units: string;
      recipient_snapshot: string;
      chain_id: number;
      token_address: string;
      status: RequestStatus;
      created_at: string;
      expires_at: string;
    }>();
  if (error) return jsonError(503, "unavailable", "The service is unavailable. Try again.");
  if (!data) return jsonError(404, "request_not_found", "Payment request not found.");

  return NextResponse.json(
    { request: { ...data, status: effectiveStatus(data, new Date()) } },
    { headers: { "cache-control": "private, no-store" } },
  );
}
