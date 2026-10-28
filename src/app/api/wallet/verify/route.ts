import { NextResponse } from "next/server";
import { z } from "zod";

import { checkSignedChallenge, nonceHashFromMessage } from "@/lib/auth/wallet-challenge";
import { isTrustedOrigin, jsonError } from "@/lib/http";
import { createAdminClient, getCurrentUser } from "@/lib/supabase/server";

const bodySchema = z.object({
  message: z.string().min(1).max(2000),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/).max(2000),
});

const DB_ERRORS: Record<string, [number, string]> = {
  challenge_not_found: [400, "This sign-in request was not found. Start again."],
  challenge_consumed: [409, "This signature was already used. Start again."],
  challenge_expired: [410, "This request expired. Start again."],
  wallet_linked_to_another_user: [409, "This wallet is linked to another account."],
};

export async function POST(request: Request) {
  if (!isTrustedOrigin(request)) return jsonError(403, "bad_origin", "Request origin not allowed.");

  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "Sign in first.");

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "invalid_body", "Expected { message, signature }.");
  const { message, signature } = parsed.data;

  let nonceHash: string | null;
  try {
    nonceHash = nonceHashFromMessage(message);
  } catch {
    nonceHash = null;
  }
  if (!nonceHash) return jsonError(400, "challenge_not_found", DB_ERRORS.challenge_not_found[1]);

  const admin = createAdminClient();
  // Scoped to the session user: another user's challenge is indistinguishable
  // from a missing one.
  const { data: stored, error } = await admin
    .from("wallet_challenges")
    .select("address, message, expires_at, consumed_at")
    .eq("nonce_hash", nonceHash)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) return jsonError(503, "unavailable", "Verification is unavailable. Try again.");
  if (!stored) return jsonError(400, "challenge_not_found", DB_ERRORS.challenge_not_found[1]);

  const check = await checkSignedChallenge({
    stored,
    submittedMessage: message,
    signature: signature as `0x${string}`,
    now: new Date(),
  });
  if (!check.ok) {
    const status = check.reason === "consumed" ? 409 : check.reason === "expired" ? 410 : 400;
    return jsonError(status, check.reason, "The signature could not be verified. Start again.");
  }

  // Atomic consume + link under a row lock; concurrent replays lose here.
  const { data: wallet, error: linkError } = await admin
    .rpc("link_wallet", { p_user_id: user.id, p_nonce_hash: nonceHash })
    .single<{ id: string; address: string; chain_id: number; verified_at: string }>();
  if (linkError) {
    const known = DB_ERRORS[linkError.message];
    if (known) return jsonError(known[0], linkError.message, known[1]);
    return jsonError(503, "unavailable", "Verification is unavailable. Try again.");
  }

  return NextResponse.json({ wallet });
}
