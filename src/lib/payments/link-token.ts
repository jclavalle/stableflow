import { createHash, randomBytes } from "node:crypto";

// 256-bit capability token, base64url without padding (43 chars). Only its
// SHA-256 hash is stored; the raw token appears once, in the share link.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateLinkToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashLinkToken(token) };
}

export function isWellFormedLinkToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

export function hashLinkToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function payUrl(appUrl: string, token: string): string {
  return new URL(`/pay/${token}`, appUrl).toString();
}
