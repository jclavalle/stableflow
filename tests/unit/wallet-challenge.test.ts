import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { parseSiweMessage } from "viem/siwe";
import { describe, expect, it } from "vitest";

import {
  buildChallenge,
  checkSignedChallenge,
  CHALLENGE_TTL_MS,
  hashNonce,
  nonceHashFromMessage,
  normalizeAddress,
  type StoredChallenge,
} from "@/lib/auth/wallet-challenge";

const APP_URL = "https://stableflow.example";
const NOW = new Date("2026-10-28T12:00:00.000Z");

const account = privateKeyToAccount(generatePrivateKey());
const other = privateKeyToAccount(generatePrivateKey());

function storedFor(address: string, now = NOW): StoredChallenge {
  const challenge = buildChallenge({
    address: normalizeAddress(address)!,
    appUrl: APP_URL,
    now,
  });
  return {
    address: challenge.address,
    message: challenge.message,
    expires_at: challenge.expiresAt.toISOString(),
    consumed_at: null,
  };
}

describe("normalizeAddress", () => {
  it("lowercases valid addresses regardless of checksum casing", () => {
    expect(normalizeAddress(account.address)).toBe(account.address.toLowerCase());
  });

  it("rejects malformed and zero addresses", () => {
    expect(normalizeAddress("0x123")).toBeNull();
    expect(normalizeAddress("not an address")).toBeNull();
    expect(normalizeAddress("0x0000000000000000000000000000000000000000")).toBeNull();
  });
});

describe("buildChallenge", () => {
  it("binds domain, origin, Base Sepolia chain and a five-minute expiry", () => {
    const challenge = buildChallenge({
      address: normalizeAddress(account.address)!,
      appUrl: APP_URL,
      now: NOW,
      nonce: "abcdefgh12345678",
    });
    const parsed = parseSiweMessage(challenge.message);
    expect(parsed.domain).toBe("stableflow.example");
    expect(parsed.uri).toBe("https://stableflow.example");
    expect(parsed.chainId).toBe(84532);
    expect(parsed.address).toBe(account.address);
    expect(parsed.expirationTime?.getTime()).toBe(NOW.getTime() + CHALLENGE_TTL_MS);
    expect(challenge.nonceHash).toBe(hashNonce("abcdefgh12345678"));
    expect(nonceHashFromMessage(challenge.message)).toBe(challenge.nonceHash);
  });

  it("uses a fresh nonce each time", () => {
    const a = buildChallenge({ address: normalizeAddress(account.address)!, appUrl: APP_URL, now: NOW });
    const b = buildChallenge({ address: normalizeAddress(account.address)!, appUrl: APP_URL, now: NOW });
    expect(a.nonceHash).not.toBe(b.nonceHash);
  });
});

describe("checkSignedChallenge", () => {
  it("accepts the wallet's signature over the exact stored message", async () => {
    const stored = storedFor(account.address);
    const signature = await account.signMessage({ message: stored.message });
    await expect(
      checkSignedChallenge({ stored, submittedMessage: stored.message, signature, now: NOW }),
    ).resolves.toEqual({ ok: true });
  });

  it("rejects a signature from a different wallet", async () => {
    const stored = storedFor(account.address);
    const signature = await other.signMessage({ message: stored.message });
    await expect(
      checkSignedChallenge({ stored, submittedMessage: stored.message, signature, now: NOW }),
    ).resolves.toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a malformed signature without throwing", async () => {
    const stored = storedFor(account.address);
    await expect(
      checkSignedChallenge({ stored, submittedMessage: stored.message, signature: "0x1234", now: NOW }),
    ).resolves.toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a message altered after issue (e.g. different domain)", async () => {
    const stored = storedFor(account.address);
    const altered = stored.message.replace("stableflow.example", "evil.example");
    const signature = await account.signMessage({ message: altered });
    await expect(
      checkSignedChallenge({ stored, submittedMessage: altered, signature, now: NOW }),
    ).resolves.toEqual({ ok: false, reason: "message_mismatch" });
  });

  it("rejects replay of an already consumed challenge", async () => {
    const stored = { ...storedFor(account.address), consumed_at: NOW.toISOString() };
    const signature = await account.signMessage({ message: stored.message });
    await expect(
      checkSignedChallenge({ stored, submittedMessage: stored.message, signature, now: NOW }),
    ).resolves.toEqual({ ok: false, reason: "consumed" });
  });

  it("rejects at and after the expiry instant", async () => {
    const stored = storedFor(account.address);
    const signature = await account.signMessage({ message: stored.message });
    const atExpiry = new Date(NOW.getTime() + CHALLENGE_TTL_MS);
    await expect(
      checkSignedChallenge({ stored, submittedMessage: stored.message, signature, now: atExpiry }),
    ).resolves.toEqual({ ok: false, reason: "expired" });
    const justBefore = new Date(atExpiry.getTime() - 1);
    await expect(
      checkSignedChallenge({ stored, submittedMessage: stored.message, signature, now: justBefore }),
    ).resolves.toEqual({ ok: true });
  });
});
