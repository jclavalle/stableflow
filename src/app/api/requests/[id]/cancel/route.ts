import { NextResponse } from "next/server";

import { isTrustedOrigin, jsonError } from "@/lib/http";
import { dbErrorResponse, requestIdSchema } from "@/lib/payments/server";
import { createAdminClient, getCurrentUser } from "@/lib/supabase/server";

export async function POST(request: Request, context: RouteContext<"/api/requests/[id]/cancel">) {
  if (!isTrustedOrigin(request)) return jsonError(403, "bad_origin", "Request origin not allowed.");

  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "Sign in first.");

  const id = requestIdSchema.safeParse((await context.params).id);
  if (!id.success) return dbErrorResponse("request_not_found");

  const { error } = await createAdminClient().rpc("cancel_payment_request", {
    p_user_id: user.id,
    p_request_id: id.data,
  });
  if (error) return dbErrorResponse(error.message);

  return NextResponse.json({ status: "cancelled" });
}
