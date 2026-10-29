import { NextResponse } from "next/server";
import { z } from "zod";

import { createChainReader } from "@/lib/chain/reader";
import { isTrustedOrigin, jsonError } from "@/lib/http";
import { payoutErrorResponse, PROCESSING_SECONDS, revalidateEvidence } from "@/lib/payouts/server";
import { isTerminal, SIMULATION_COLUMNS, toSimulationView, type SimulationRow } from "@/lib/payouts/views";
import { createAdminClient, getCurrentUser } from "@/lib/supabase/server";

// Owner only: apply any transition that is due by server time. Browser timers
// only decide when to ask; the database decides what happens.
export async function POST(request: Request, context: RouteContext<"/api/simulations/[id]/advance">) {
  if (!isTrustedOrigin(request)) return jsonError(403, "bad_origin", "Request origin not allowed.");

  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "Sign in first.");

  const id = z.uuid().safeParse((await context.params).id);
  if (!id.success) return payoutErrorResponse("simulation_not_found");

  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("payout_simulations")
    .select(`${SIMULATION_COLUMNS}, request_id`)
    .eq("id", id.data)
    .eq("user_id", user.id)
    .maybeSingle<SimulationRow & { request_id: string }>();
  if (error) return payoutErrorResponse("unavailable");
  if (!row) return payoutErrorResponse("simulation_not_found");
  if (isTerminal(row.status)) return NextResponse.json({ simulation: toSimulationView(row), unavailable: false });

  try {
    // Completion requires a fresh evidence check (plan §7 rule 9).
    let evidenceOk: boolean | null = null;
    let unavailable = false;
    const due =
      row.status === "processing" &&
      row.processing_at !== null &&
      Date.now() - new Date(row.processing_at).getTime() >= PROCESSING_SECONDS * 1000;
    if (due) {
      const check = await revalidateEvidence(admin, createChainReader(), row.request_id);
      unavailable = check.kind === "unavailable";
      evidenceOk = unavailable ? null : check.kind === "valid";
    }

    const { data, error: rpcError } = await admin
      .rpc("advance_payout_simulation", {
        p_user_id: user.id,
        p_simulation_id: row.id,
        p_evidence_ok: evidenceOk,
      })
      .select(SIMULATION_COLUMNS)
      .single<SimulationRow>();
    if (rpcError) return payoutErrorResponse(rpcError.message);
    return NextResponse.json({ simulation: toSimulationView(data), unavailable });
  } catch {
    return payoutErrorResponse("unavailable");
  }
}
