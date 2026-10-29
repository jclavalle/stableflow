import { connection, NextResponse } from "next/server";

import { jsonError } from "@/lib/http";
import { linkInvalid, NO_STORE } from "@/lib/payments/pay-route";
import { findRequestByToken } from "@/lib/payments/requests";
import { listAttempts } from "@/lib/payments/verification";
import { createAdminClient } from "@/lib/supabase/server";

// Public: the capability token authorizes access to a minimal projection and
// the request's submitted transactions (which are public on chain anyway).
export async function GET(_request: Request, context: RouteContext<"/api/pay/[token]">) {
  await connection();
  const { token } = await context.params;
  const admin = createAdminClient();

  try {
    const capability = await findRequestByToken(admin, token, new Date());
    if (!capability) return linkInvalid();
    const attempts = await listAttempts(admin, capability.id);
    return NextResponse.json({ request: capability.projection, attempts }, { headers: NO_STORE });
  } catch {
    return jsonError(503, "unavailable", "The service is unavailable. Try again.");
  }
}
