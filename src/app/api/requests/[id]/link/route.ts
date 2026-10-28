import { NextResponse } from "next/server";

import { getServerConfig } from "@/lib/config/server";
import { isTrustedOrigin, jsonError } from "@/lib/http";
import { generateLinkToken, payUrl } from "@/lib/payments/link-token";
import { dbErrorResponse, requestIdSchema } from "@/lib/payments/server";
import { createAdminClient, getCurrentUser } from "@/lib/supabase/server";

// Replaces the share link. The previous link stops working immediately.
export async function POST(request: Request, context: RouteContext<"/api/requests/[id]/link">) {
  if (!isTrustedOrigin(request)) return jsonError(403, "bad_origin", "Request origin not allowed.");

  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "Sign in first.");

  const id = requestIdSchema.safeParse((await context.params).id);
  if (!id.success) return dbErrorResponse("request_not_found");

  const { token, tokenHash } = generateLinkToken();
  const { error } = await createAdminClient().rpc("regenerate_payment_link", {
    p_user_id: user.id,
    p_request_id: id.data,
    p_public_token_hash: tokenHash,
  });
  if (error) return dbErrorResponse(error.message);

  return NextResponse.json(
    { payUrl: payUrl(getServerConfig().APP_URL, token) },
    { headers: { "cache-control": "no-store" } },
  );
}
