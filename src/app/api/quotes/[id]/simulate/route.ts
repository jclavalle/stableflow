import { NextResponse } from "next/server";
import { z } from "zod";

import { createChainReader } from "@/lib/chain/reader";
import { isTrustedOrigin, jsonError } from "@/lib/http";
import { payoutErrorResponse, revalidateEvidence } from "@/lib/payouts/server";
import { SIMULATION_COLUMNS, toSimulationView, type SimulationRow } from "@/lib/payouts/views";
import { createAdminClient, getCurrentUser } from "@/lib/supabase/server";

const bodySchema = z.object({ idempotencyKey: z.uuid() });

// Owner only: start the single simulated payout for an unexpired quote.
export async function POST(request: Request, context: RouteContext<"/api/quotes/[id]/simulate">) {
  if (!isTrustedOrigin(request)) return jsonError(403, "bad_origin", "Request origin not allowed.");

  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "Sign in first.");

  const quoteId = z.uuid().safeParse((await context.params).id);
  if (!quoteId.success) return payoutErrorResponse("quote_not_found");

  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return jsonError(400, "invalid_body", "A simulation key is required.");
  const idempotencyKey = body.data.idempotencyKey.toLowerCase();

  const admin = createAdminClient();
  const { data: quote, error } = await admin
    .from("payout_quotes")
    .select("id, request_id, expires_at")
    .eq("id", quoteId.data)
    .eq("user_id", user.id)
    .maybeSingle<{ id: string; request_id: string; expires_at: string }>();
  if (error) return payoutErrorResponse("unavailable");
  if (!quote) return payoutErrorResponse("quote_not_found");

  const simulate = () =>
    admin
      .rpc("create_payout_simulation", {
        p_user_id: user.id,
        p_quote_id: quote.id,
        p_idempotency_key: idempotencyKey,
      })
      .select(SIMULATION_COLUMNS)
      .single<SimulationRow>();

  // A retry with the same key returns the existing simulation without a new chain check.
  const { data: existing } = await admin
    .from("payout_simulations")
    .select("id")
    .eq("idempotency_key", idempotencyKey)
    .eq("user_id", user.id)
    .maybeSingle();
  if (existing) {
    const repeat = await simulate();
    if (repeat.error) return payoutErrorResponse(repeat.error.message);
    return NextResponse.json({ simulation: toSimulationView(repeat.data) });
  }

  // Cheap refusals first, so an expired quote or a non-confirmed request never costs an RPC call.
  if (new Date(quote.expires_at).getTime() <= Date.now()) return payoutErrorResponse("quote_expired");
  const { data: req } = await admin
    .from("payment_requests")
    .select("status")
    .eq("id", quote.request_id)
    .single<{ status: string }>();
  if (req?.status !== "confirmed") return payoutErrorResponse("request_not_confirmed");

  try {
    const check = await revalidateEvidence(admin, createChainReader(), quote.request_id);
    if (check.kind === "unavailable") {
      return jsonError(503, "chain_unavailable", "We can’t reach Base Sepolia to re-check the payment right now. Nothing changed; try again.");
    }
    if (check.kind === "invalid") {
      return jsonError(409, "evidence_invalidated", "The payment evidence changed on chain, so this request is now under review and can’t be simulated.");
    }
  } catch {
    return payoutErrorResponse("unavailable");
  }

  const created = await simulate();
  if (created.error) return payoutErrorResponse(created.error.message);
  return NextResponse.json({ simulation: toSimulationView(created.data) }, { status: 201 });
}
