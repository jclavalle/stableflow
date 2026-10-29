import "server-only";

import { isHash } from "viem";
import { z } from "zod";

import { jsonError } from "@/lib/http";
import { findRequestByToken, type CapabilityRequest } from "@/lib/payments/requests";
import { createAdminClient } from "@/lib/supabase/server";

export const txBodySchema = z.object({ txHash: z.string().max(80) });

export const NO_STORE = { "cache-control": "no-store", "referrer-policy": "no-referrer" };

export function linkInvalid() {
  return Response.json(
    { error: { code: "link_invalid", message: "This payment link is invalid, expired or cancelled." } },
    { status: 404, headers: NO_STORE },
  );
}

/** Parses `{ txHash }` and resolves the capability token, or returns an error response. */
export async function resolvePayRequest(
  request: Request,
  token: string,
): Promise<{ capability: CapabilityRequest; txHash: string } | Response> {
  const parsed = txBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !isHash(parsed.data.txHash)) {
    return jsonError(400, "invalid_hash", "That is not a valid transaction hash.");
  }
  let capability;
  try {
    capability = await findRequestByToken(createAdminClient(), token, new Date());
  } catch {
    return jsonError(503, "unavailable", "The service is unavailable. Try again.");
  }
  if (!capability) return linkInvalid();
  return { capability, txHash: parsed.data.txHash.toLowerCase() };
}
