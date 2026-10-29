import { NextResponse } from "next/server";

import { isTrustedOrigin, jsonError } from "@/lib/http";
import { requestIdSchema } from "@/lib/payments/server";
import { payoutErrorResponse } from "@/lib/payouts/server";
import { QUOTE_COLUMNS, toQuoteView, type QuoteRow } from "@/lib/payouts/views";
import { computeQuote, QUOTE_ASSUMPTIONS } from "@/lib/quotes/fx";
import { createAdminClient, getCurrentUser } from "@/lib/supabase/server";

const QUOTE_ERRORS = {
  invalid_input: "This amount can’t be quoted.",
  fees_exceed_amount: "The illustrative fees are larger than this amount, so no payout can be quoted.",
  payout_too_small: "This amount is too small to produce a BRL payout after fees.",
} as const;

// Owner only: an immutable illustrative BRL quote for a confirmed request.
export async function POST(request: Request, context: RouteContext<"/api/requests/[id]/quote">) {
  if (!isTrustedOrigin(request)) return jsonError(403, "bad_origin", "Request origin not allowed.");

  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "Sign in first.");

  const id = requestIdSchema.safeParse((await context.params).id);
  if (!id.success) return payoutErrorResponse("request_not_found");

  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("payment_requests")
    .select("id, amount_units::text, status")
    .eq("id", id.data)
    .eq("user_id", user.id)
    .maybeSingle<{ id: string; amount_units: string; status: string }>();
  if (error) return payoutErrorResponse("unavailable");
  if (!row) return payoutErrorResponse("request_not_found");
  if (row.status !== "confirmed") return payoutErrorResponse("request_not_confirmed");

  const quote = computeQuote(BigInt(row.amount_units));
  if (!quote.ok) return jsonError(422, quote.error, QUOTE_ERRORS[quote.error]);
  const f = quote.figures;

  const { data, error: rpcError } = await admin
    .rpc("create_payout_quote", {
      p_user_id: user.id,
      p_request_id: row.id,
      p_input_units: f.inputUnits.toString(),
      p_service_fee_bps: Number(f.serviceFeeBps),
      p_service_fee_units: f.serviceFeeUnits.toString(),
      p_fixed_fee_units: f.fixedFeeUnits.toString(),
      p_net_units: f.netUnits.toString(),
      p_fx_scale: Number(f.fxScale),
      p_reference_rate_scaled: Number(f.referenceRateScaled),
      p_spread_bps: Number(f.spreadBps),
      p_effective_rate_scaled: Number(f.effectiveRateScaled),
      p_output_minor: f.outputMinor.toString(),
      p_assumptions_version: QUOTE_ASSUMPTIONS.version,
      p_valid_seconds: QUOTE_ASSUMPTIONS.validitySeconds,
    })
    .select("id")
    .single<{ id: string }>();
  if (rpcError) return payoutErrorResponse(rpcError.message);

  // Re-read with text casts so large numerics never pass through JS numbers.
  const { data: stored, error: readError } = await admin
    .from("payout_quotes")
    .select(QUOTE_COLUMNS)
    .eq("id", data.id)
    .single<QuoteRow>();
  if (readError) return payoutErrorResponse("unavailable");

  return NextResponse.json({ quote: toQuoteView(stored) }, { status: 201 });
}
