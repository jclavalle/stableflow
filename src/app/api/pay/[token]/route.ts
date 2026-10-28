import { connection, NextResponse } from "next/server";

import { jsonError } from "@/lib/http";
import { findPublicRequest } from "@/lib/payments/requests";
import { createAdminClient } from "@/lib/supabase/server";

const NO_STORE = { "cache-control": "no-store", "referrer-policy": "no-referrer" };

// Public: the capability token authorizes access to a minimal projection only.
export async function GET(_request: Request, context: RouteContext<"/api/pay/[token]">) {
  await connection();
  const { token } = await context.params;

  let request;
  try {
    request = await findPublicRequest(createAdminClient(), token, new Date());
  } catch {
    return jsonError(503, "unavailable", "The service is unavailable. Try again.");
  }
  if (!request) {
    return NextResponse.json(
      { error: { code: "link_invalid", message: "This payment link is invalid, expired or cancelled." } },
      { status: 404, headers: NO_STORE },
    );
  }
  return NextResponse.json({ request }, { headers: NO_STORE });
}
