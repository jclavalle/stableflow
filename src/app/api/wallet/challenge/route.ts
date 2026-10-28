import { NextResponse } from "next/server";
import { z } from "zod";

import { buildChallenge, normalizeAddress } from "@/lib/auth/wallet-challenge";
import { getServerConfig } from "@/lib/config/server";
import { isTrustedOrigin, jsonError } from "@/lib/http";
import { createAdminClient, getCurrentUser } from "@/lib/supabase/server";

const bodySchema = z.object({ address: z.string().max(64) });

// Throttle: at most this many challenges per user per window.
const MAX_CHALLENGES = 5;
const WINDOW_MS = 10 * 60 * 1000;

export async function POST(request: Request) {
  if (!isTrustedOrigin(request)) return jsonError(403, "bad_origin", "Request origin not allowed.");

  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "Sign in first.");

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "invalid_body", "Expected { address }.");

  const address = normalizeAddress(parsed.data.address);
  if (!address) return jsonError(400, "invalid_address", "Not a valid, non-zero wallet address.");

  const admin = createAdminClient();
  const now = new Date();

  const { count, error: countError } = await admin
    .from("wallet_challenges")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", new Date(now.getTime() - WINDOW_MS).toISOString());
  if (countError) return jsonError(503, "unavailable", "Could not create a challenge. Try again.");
  if ((count ?? 0) >= MAX_CHALLENGES) {
    return jsonError(429, "too_many_challenges", "Too many attempts. Wait a few minutes.");
  }

  const challenge = buildChallenge({ address, appUrl: getServerConfig().APP_URL, now });
  const { error } = await admin.from("wallet_challenges").insert({
    user_id: user.id,
    address: challenge.address,
    chain_id: challenge.chainId,
    nonce_hash: challenge.nonceHash,
    message: challenge.message,
    domain: challenge.domain,
    created_at: now.toISOString(),
    expires_at: challenge.expiresAt.toISOString(),
  });
  if (error) return jsonError(503, "unavailable", "Could not create a challenge. Try again.");

  return NextResponse.json({ message: challenge.message, expiresAt: challenge.expiresAt });
}
