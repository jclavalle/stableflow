import { createHash } from "node:crypto";

import { getAddress, isAddress, verifyMessage, zeroAddress, type Hex } from "viem";
import { createSiweMessage, generateSiweNonce, parseSiweMessage } from "viem/siwe";

import { BASE_SEPOLIA } from "@/lib/chain/allowlist";

export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export const CHALLENGE_STATEMENT =
  "Link this wallet to your StableFlow testnet account. This signature does not send a transaction or cost gas.";

/** Lowercase form stored in the database; returns null for invalid or zero addresses. */
export function normalizeAddress(input: string): `0x${string}` | null {
  if (!isAddress(input, { strict: false })) return null;
  const lower = input.toLowerCase() as `0x${string}`;
  if (lower === zeroAddress) return null;
  return lower;
}

export function hashNonce(nonce: string): string {
  return createHash("sha256").update(nonce).digest("hex");
}

export type NewChallenge = {
  address: `0x${string}`;
  chainId: number;
  domain: string;
  message: string;
  nonceHash: string;
  expiresAt: Date;
};

/**
 * Builds an EIP-4361 (Sign-In with Ethereum) message bound to this app's
 * origin, the Base Sepolia chain and a fresh single-use nonce. Only the nonce
 * hash is persisted; the full message is stored so verification can require an
 * exact match.
 */
export function buildChallenge(params: {
  address: `0x${string}`;
  appUrl: string;
  now: Date;
  nonce?: string;
}): NewChallenge {
  const url = new URL(params.appUrl);
  const nonce = params.nonce ?? generateSiweNonce();
  const expiresAt = new Date(params.now.getTime() + CHALLENGE_TTL_MS);
  const message = createSiweMessage({
    address: getAddress(params.address),
    chainId: BASE_SEPOLIA.chainId,
    domain: url.host,
    uri: url.origin,
    nonce,
    issuedAt: params.now,
    expirationTime: expiresAt,
    statement: CHALLENGE_STATEMENT,
    version: "1",
  });
  return {
    address: params.address,
    chainId: BASE_SEPOLIA.chainId,
    domain: url.host,
    message,
    nonceHash: hashNonce(nonce),
    expiresAt,
  };
}

/** Extracts the nonce hash used to look up the stored challenge. */
export function nonceHashFromMessage(message: string): string | null {
  const { nonce } = parseSiweMessage(message);
  return nonce ? hashNonce(nonce) : null;
}

export type StoredChallenge = {
  address: string;
  message: string;
  expires_at: string;
  consumed_at: string | null;
};

export type ChallengeCheck =
  | { ok: true }
  | {
      ok: false;
      reason: "message_mismatch" | "expired" | "consumed" | "bad_signature";
    };

/**
 * Pre-checks a signed challenge before the atomic database consume. The
 * database function re-checks expiry and consumption under a row lock, so
 * these checks give clear errors but are not the only line of defence.
 */
export async function checkSignedChallenge(params: {
  stored: StoredChallenge;
  submittedMessage: string;
  signature: Hex;
  now: Date;
}): Promise<ChallengeCheck> {
  const { stored, submittedMessage, signature, now } = params;
  if (submittedMessage !== stored.message) return { ok: false, reason: "message_mismatch" };
  if (stored.consumed_at !== null) return { ok: false, reason: "consumed" };
  if (new Date(stored.expires_at).getTime() <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }

  // EOA signatures only (ecrecover, no RPC). Smart-contract wallets
  // (ERC-1271/6492) are a documented MVP limitation.
  let valid = false;
  try {
    valid = await verifyMessage({
      address: getAddress(stored.address),
      message: stored.message,
      signature,
    });
  } catch {
    valid = false;
  }
  return valid ? { ok: true } : { ok: false, reason: "bad_signature" };
}
