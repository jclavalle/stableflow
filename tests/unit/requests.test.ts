import { describe, expect, it } from "vitest";

import {
  generateLinkToken,
  hashLinkToken,
  isWellFormedLinkToken,
  payUrl,
} from "@/lib/payments/link-token";
import { effectiveStatus, toPublicProjection } from "@/lib/payments/requests";

const NOW = new Date("2026-10-28T12:00:00.000Z");
const row = {
  amount_units: "100000000",
  recipient_snapshot: "0x1111111111111111111111111111111111111111",
  chain_id: 84532,
  token_address: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  status: "open" as const,
  expires_at: "2026-10-29T12:00:00.000Z",
};

describe("link tokens", () => {
  it("are 256-bit base64url and hash deterministically", () => {
    const { token, tokenHash } = generateLinkToken();
    expect(isWellFormedLinkToken(token)).toBe(true);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashLinkToken(token)).toBe(tokenHash);
    expect(generateLinkToken().token).not.toBe(token);
  });

  it("rejects malformed tokens before any lookup", () => {
    expect(isWellFormedLinkToken("short")).toBe(false);
    expect(isWellFormedLinkToken("a".repeat(44))).toBe(false);
    expect(isWellFormedLinkToken(`${"a".repeat(42)}/`)).toBe(false);
  });

  it("builds the share URL on the app origin", () => {
    expect(payUrl("https://stableflow.example", "abc")).toBe("https://stableflow.example/pay/abc");
  });
});

describe("effectiveStatus", () => {
  it("treats an open request as expired at and after its expiry", () => {
    expect(effectiveStatus(row, NOW)).toBe("open");
    expect(effectiveStatus(row, new Date(row.expires_at))).toBe("expired");
  });

  it("does not alter non-open statuses", () => {
    expect(effectiveStatus({ ...row, status: "cancelled" }, NOW)).toBe("cancelled");
    expect(
      effectiveStatus({ ...row, status: "confirmed" }, new Date("2030-01-01T00:00:00Z")),
    ).toBe("confirmed");
  });
});

describe("toPublicProjection", () => {
  it("exposes only payment fields, with the amount as a decimal string", () => {
    const projection = toPublicProjection(row, NOW);
    expect(projection).toEqual({
      amountUnits: "100000000",
      amountDisplay: "100.00",
      tokenSymbol: "USDC",
      tokenAddress: row.token_address,
      chainId: 84532,
      chainName: "Base Sepolia",
      recipient: row.recipient_snapshot,
      expiresAt: row.expires_at,
      status: "open",
    });
  });

  it("fails closed for expired and cancelled requests", () => {
    expect(toPublicProjection(row, new Date(row.expires_at))).toBeNull();
    expect(toPublicProjection({ ...row, status: "cancelled" }, NOW)).toBeNull();
    expect(toPublicProjection({ ...row, status: "under_review" }, NOW)).toBeNull();
  });
});
