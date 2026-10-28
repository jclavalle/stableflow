import type { SupabaseClient } from "@supabase/supabase-js";

import { BASE_SEPOLIA, TEST_USDC } from "@/lib/chain/allowlist";

import { formatUsdcUnits } from "./amount";
import { hashLinkToken, isWellFormedLinkToken } from "./link-token";

export type RequestStatus = "open" | "confirming" | "confirmed" | "expired" | "cancelled";

export const EXPIRY_OPTIONS_DAYS = [1, 3, 7] as const;

/** Stored status plus time: an open request past its expiry is expired. */
export function effectiveStatus(
  row: { status: RequestStatus; expires_at: string },
  now: Date,
): RequestStatus {
  if (row.status === "open" && new Date(row.expires_at).getTime() <= now.getTime()) {
    return "expired";
  }
  return row.status;
}

/** Everything a payer may see. Nothing about the freelancer's account. */
export type PublicPaymentRequest = {
  amountUnits: string;
  amountDisplay: string;
  tokenSymbol: string;
  tokenAddress: string;
  chainId: number;
  chainName: string;
  recipient: string;
  expiresAt: string;
  status: "open" | "confirming" | "confirmed";
};

export const PUBLIC_REQUEST_COLUMNS =
  "amount_units::text, recipient_snapshot, chain_id, token_address, status, expires_at";

type PublicRow = {
  amount_units: string;
  recipient_snapshot: string;
  chain_id: number;
  token_address: string;
  status: RequestStatus;
  expires_at: string;
};

export function toPublicProjection(row: PublicRow, now: Date): PublicPaymentRequest | null {
  const status = effectiveStatus(row, now);
  if (status === "expired" || status === "cancelled") return null;
  return {
    amountUnits: row.amount_units,
    amountDisplay: formatUsdcUnits(row.amount_units),
    tokenSymbol: TEST_USDC.symbol,
    tokenAddress: row.token_address,
    chainId: row.chain_id,
    chainName: BASE_SEPOLIA.name,
    recipient: row.recipient_snapshot,
    expiresAt: row.expires_at,
    status,
  };
}

export type CapabilityRequest = {
  /** Server-side only; never sent to the payer. */
  id: string;
  creationBlock: string | null;
  projection: PublicPaymentRequest;
};

/**
 * Resolves a capability token to its request, or null for malformed,
 * unknown, expired or cancelled links (fail closed, one answer for all).
 * Takes a service-role client: the capability, not RLS, authorizes this.
 */
export async function findRequestByToken(
  admin: SupabaseClient,
  token: string,
  now: Date,
): Promise<CapabilityRequest | null> {
  if (!isWellFormedLinkToken(token)) return null;
  const { data, error } = await admin
    .from("payment_requests")
    .select(`id, creation_block::text, ${PUBLIC_REQUEST_COLUMNS}`)
    .eq("public_token_hash", hashLinkToken(token))
    .maybeSingle<PublicRow & { id: string; creation_block: string | null }>();
  if (error) throw new Error("payment request lookup failed");
  if (!data) return null;
  const projection = toPublicProjection(data, now);
  return projection ? { id: data.id, creationBlock: data.creation_block, projection } : null;
}

export async function findPublicRequest(
  admin: SupabaseClient,
  token: string,
  now: Date,
): Promise<PublicPaymentRequest | null> {
  return (await findRequestByToken(admin, token, now))?.projection ?? null;
}

/** Row shape the verifier needs, rebuilt from a resolved capability. */
export function verificationRow(request: CapabilityRequest) {
  return {
    id: request.id,
    recipient_snapshot: request.projection.recipient,
    amount_units: request.projection.amountUnits,
    creation_block: request.creationBlock,
    expires_at: request.projection.expiresAt,
  };
}
