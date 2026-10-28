import { NextResponse } from "next/server";
import { z } from "zod";

import { getServerConfig } from "@/lib/config/server";
import { isTrustedOrigin, jsonError } from "@/lib/http";
import { AMOUNT_ERROR_MESSAGES, parseUsdcAmount } from "@/lib/payments/amount";
import { generateLinkToken, payUrl } from "@/lib/payments/link-token";
import { EXPIRY_OPTIONS_DAYS } from "@/lib/payments/requests";
import { dbErrorResponse } from "@/lib/payments/server";
import { createAdminClient, getCurrentUser } from "@/lib/supabase/server";

const bodySchema = z.object({
  walletId: z.uuid(),
  amount: z.string().max(64),
  expiresInDays: z.union(EXPIRY_OPTIONS_DAYS.map((days) => z.literal(days))),
});

const MAX_CREATED_PER_HOUR = 20;

export async function POST(request: Request) {
  if (!isTrustedOrigin(request)) return jsonError(403, "bad_origin", "Request origin not allowed.");

  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "Sign in first.");

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError(400, "invalid_body", "Choose a wallet, an amount and an expiry.");
  }

  const amount = parseUsdcAmount(parsed.data.amount);
  if (!amount.ok) return jsonError(400, `amount_${amount.error}`, AMOUNT_ERROR_MESSAGES[amount.error]);

  const admin = createAdminClient();
  const now = new Date();

  const { count, error: countError } = await admin
    .from("payment_requests")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", new Date(now.getTime() - 60 * 60 * 1000).toISOString());
  if (countError) return dbErrorResponse("");
  if ((count ?? 0) >= MAX_CREATED_PER_HOUR) {
    return jsonError(429, "too_many_requests", "Too many requests created. Try again later.");
  }

  const { token, tokenHash } = generateLinkToken();
  const expiresAt = new Date(now.getTime() + parsed.data.expiresInDays * 24 * 60 * 60 * 1000);

  const { data, error } = await admin
    .rpc("create_payment_request", {
      p_user_id: user.id,
      p_wallet_id: parsed.data.walletId,
      // Decimal string: never passes through a JS number.
      p_amount_units: amount.units.toString(),
      p_public_token_hash: tokenHash,
      p_expires_at: expiresAt.toISOString(),
    })
    .single<{ id: string }>();
  if (error) return dbErrorResponse(error.message);

  return NextResponse.json(
    { id: data.id, payUrl: payUrl(getServerConfig().APP_URL, token) },
    { status: 201, headers: { "cache-control": "no-store" } },
  );
}
