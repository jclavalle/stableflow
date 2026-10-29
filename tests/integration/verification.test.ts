import { randomBytes } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { generateLinkToken } from "@/lib/payments/link-token";

import { adminClient, anonClient, createSignedInUser, hasTestDatabase, insertChallenge, linkWallet } from "./supabase";

const PERMISSION_DENIED = "42501";
const DAY = 24 * 60 * 60 * 1000;
const CREATION_BLOCK = 1_000;

type User = { id: string; client: SupabaseClient; walletId: string; address: string };

const txHash = () => `0x${randomBytes(32).toString("hex")}`;

async function userWithWallet(): Promise<User> {
  const user = await createSignedInUser();
  const { nonceHash, address } = await insertChallenge({ userId: user.id });
  const { data, error } = await linkWallet(user.id, nonceHash).single<{ id: string }>();
  if (error) throw error;
  return { ...user, walletId: data.id, address };
}

async function newRequest(user: User, expiresAt = new Date(Date.now() + DAY)) {
  const { data, error } = await adminClient()
    .rpc("create_payment_request", {
      p_user_id: user.id,
      p_wallet_id: user.walletId,
      p_amount_units: "100000000",
      p_public_token_hash: generateLinkToken().tokenHash,
      p_expires_at: expiresAt.toISOString(),
      p_creation_block: String(CREATION_BLOCK),
    })
    .single<{ id: string }>();
  if (error) throw error;
  return data.id;
}

function submit(requestId: string, hash: string) {
  return adminClient().rpc("submit_payment_attempt", { p_request_id: requestId, p_tx_hash: hash });
}

function confirm(requestId: string, hash: string, user: User, overrides: Record<string, unknown> = {}) {
  return adminClient().rpc("confirm_payment", {
    p_request_id: requestId,
    p_tx_hash: hash,
    p_log_index: 0,
    p_block_number: String(CREATION_BLOCK + 5),
    p_block_hash: `0x${"ab".repeat(32)}`,
    p_block_timestamp: new Date().toISOString(),
    p_sender: `0x${"11".repeat(20)}`,
    p_recipient: user.address,
    p_amount_units: "100000000",
    p_confirmations: 3,
    ...overrides,
  });
}

async function requestStatus(id: string) {
  const { data } = await adminClient().from("payment_requests").select("status").eq("id", id).single();
  return data?.status;
}

describe.skipIf(!hasTestDatabase)("payment verification functions", () => {
  let alice: User;
  let bob: User;

  beforeAll(async () => {
    [alice, bob] = await Promise.all([userWithWallet(), userWithWallet()]);
  });

  it("requires a creation block for new requests", async () => {
    const { error } = await adminClient().rpc("create_payment_request", {
      p_user_id: alice.id,
      p_wallet_id: alice.walletId,
      p_amount_units: "1",
      p_public_token_hash: generateLinkToken().tokenHash,
      p_expires_at: new Date(Date.now() + DAY).toISOString(),
      p_creation_block: null,
    });
    expect(error?.message).toBe("creation_block_required");
  });

  describe("attempts", () => {
    it("stores a candidate without changing the request, idempotently", async () => {
      const id = await newRequest(alice);
      const hash = txHash();
      const first = await submit(id, hash);
      const again = await submit(id, hash);
      expect(first.error).toBeNull();
      expect(again.data).toEqual(first.data);
      expect(await requestStatus(id)).toBe("open");
    });

    it("caps attempts per request", async () => {
      const id = await newRequest(alice);
      for (let i = 0; i < 10; i++) expect((await submit(id, txHash())).error).toBeNull();
      expect((await submit(id, txHash())).error?.message).toBe("too_many_attempts");
    });

    it("refuses attempts on expired or cancelled requests", async () => {
      const expired = await newRequest(alice, new Date(Date.now() + 1500));
      await new Promise((resolve) => setTimeout(resolve, 2000));
      expect((await submit(expired, txHash())).error?.message).toBe("request_not_open");

      const cancelled = await newRequest(alice);
      await adminClient().rpc("cancel_payment_request", { p_user_id: alice.id, p_request_id: cancelled });
      expect((await submit(cancelled, txHash())).error?.message).toBe("request_not_open");
    });

    it("moves the request to confirming while a match is pending, and back to open if it is rejected", async () => {
      const id = await newRequest(alice);
      const hash = txHash();
      await submit(id, hash);
      const pending = await adminClient().rpc("record_attempt_check", {
        p_request_id: id,
        p_tx_hash: hash,
        p_status: "pending",
        p_error_code: null,
        p_confirmations: 1,
      });
      expect(pending.error).toBeNull();
      expect(await requestStatus(id)).toBe("confirming");

      await adminClient().rpc("record_attempt_check", {
        p_request_id: id,
        p_tx_hash: hash,
        p_status: "rejected",
        p_error_code: "block_not_canonical",
        p_confirmations: 0,
      });
      expect(await requestStatus(id)).toBe("open");
    });

    it("cannot record a verified status without evidence", async () => {
      const id = await newRequest(alice);
      const hash = txHash();
      await submit(id, hash);
      const { error } = await adminClient().rpc("record_attempt_check", {
        p_request_id: id,
        p_tx_hash: hash,
        p_status: "verified",
        p_error_code: null,
        p_confirmations: 3,
      });
      expect(error?.message).toBe("invalid_attempt_status");
    });
  });

  describe("confirm_payment", () => {
    it("confirms once with matching evidence and is idempotent on repeat", async () => {
      const id = await newRequest(alice);
      const hash = txHash();
      await submit(id, hash);
      const first = await confirm(id, hash, alice);
      expect(first.error).toBeNull();
      expect(await requestStatus(id)).toBe("confirmed");

      const repeat = await confirm(id, hash, alice);
      expect(repeat.error).toBeNull();
      expect(repeat.data).toEqual(first.data);
    });

    it("lets exactly one evidence record win under concurrent confirmations", async () => {
      const id = await newRequest(alice);
      const hash = txHash();
      await submit(id, hash);
      const results = await Promise.all(Array.from({ length: 8 }, () => confirm(id, hash, alice)));
      expect(results.every((r) => r.error === null)).toBe(true);
      const ids = new Set(results.map((r) => (r.data as { id: string }).id));
      expect(ids.size).toBe(1);
      const { count } = await adminClient()
        .from("verified_receipts")
        .select("id", { count: "exact", head: true })
        .eq("request_id", id);
      expect(count).toBe(1);
    });

    it("blocks reuse of the same chain evidence for another request, even concurrently", async () => {
      const a = await newRequest(alice);
      const b = await newRequest(alice);
      const hash = txHash();
      await Promise.all([submit(a, hash), submit(b, hash)]);
      const [ra, rb] = await Promise.all([confirm(a, hash, alice), confirm(b, hash, alice)]);
      const outcomes = [ra.error?.message ?? "ok", rb.error?.message ?? "ok"].sort();
      expect(outcomes).toEqual(["evidence_already_used", "ok"]);
    });

    it("blocks a second, different receipt for an already confirmed request", async () => {
      const id = await newRequest(alice);
      const [h1, h2] = [txHash(), txHash()];
      await submit(id, h1);
      await submit(id, h2);
      expect((await confirm(id, h1, alice)).error).toBeNull();
      expect((await confirm(id, h2, alice)).error?.message).toBe("request_already_confirmed");
    });

    it.each([
      ["wrong recipient", { p_recipient: `0x${"99".repeat(20)}` }, "evidence_mismatch"],
      ["wrong amount", { p_amount_units: "99999999" }, "evidence_mismatch"],
      ["block before the request", { p_block_number: String(CREATION_BLOCK - 1) }, "evidence_before_request"],
      ["mined after expiry", { p_block_timestamp: new Date(Date.now() + 2 * DAY).toISOString() }, "evidence_after_expiry"],
    ])("rejects %s and leaves the request unconfirmed", async (_name, overrides, code) => {
      const id = await newRequest(alice);
      const hash = txHash();
      await submit(id, hash);
      expect((await confirm(id, hash, alice, overrides)).error?.message).toBe(code);
      expect(await requestStatus(id)).toBe("open");
    });

    it("requires the transaction to have been submitted for that request", async () => {
      const id = await newRequest(alice);
      expect((await confirm(id, txHash(), alice)).error?.message).toBe("attempt_not_found");
    });

    it("refuses to confirm a cancelled request", async () => {
      const id = await newRequest(alice);
      const hash = txHash();
      await submit(id, hash);
      await adminClient().rpc("cancel_payment_request", { p_user_id: alice.id, p_request_id: id });
      expect((await confirm(id, hash, alice)).error?.message).toBe("request_not_open");
    });

    it("keeps receipts append-only, even for the service role", async () => {
      const id = await newRequest(alice);
      const hash = txHash();
      await submit(id, hash);
      await confirm(id, hash, alice);
      const update = await adminClient().from("verified_receipts").update({ confirmations: 99 }).eq("request_id", id);
      expect(update.error?.message).toMatch(/append-only/);
      const del = await adminClient().from("verified_receipts").delete().eq("request_id", id);
      expect(del.error?.message).toMatch(/append-only/);
    });
  });

  describe("access control", () => {
    it("shows attempts and receipts only to the request owner", async () => {
      const id = await newRequest(alice);
      const hash = txHash();
      await submit(id, hash);
      await confirm(id, hash, alice);

      const own = await alice.client.from("verified_receipts").select("tx_hash").eq("request_id", id);
      expect(own.data).toEqual([{ tx_hash: hash }]);
      const ownAttempts = await alice.client.from("payment_attempts").select("tx_hash").eq("request_id", id);
      expect(ownAttempts.data).toEqual([{ tx_hash: hash }]);

      const other = await bob.client.from("verified_receipts").select("tx_hash").eq("request_id", id);
      expect(other.data).toEqual([]);
      const otherAttempts = await bob.client.from("payment_attempts").select("tx_hash").eq("request_id", id);
      expect(otherAttempts.data).toEqual([]);
    });

    it("denies anonymous access and client writes", async () => {
      for (const table of ["payment_attempts", "verified_receipts"]) {
        expect((await anonClient().from(table).select("id")).error?.code, table).toBe(PERMISSION_DENIED);
      }
      const insert = await alice.client
        .from("payment_attempts")
        .insert({ request_id: await newRequest(alice), chain_id: 84532, tx_hash: txHash() });
      expect(insert.error?.code).toBe(PERMISSION_DENIED);
    });

    it("denies clients the verification functions", async () => {
      const id = await newRequest(alice);
      const hash = txHash();
      expect((await alice.client.rpc("submit_payment_attempt", { p_request_id: id, p_tx_hash: hash })).error?.code).toBe(
        PERMISSION_DENIED,
      );
      const forged = await alice.client.rpc("confirm_payment", {
        p_request_id: id,
        p_tx_hash: hash,
        p_log_index: 0,
        p_block_number: "2000",
        p_block_hash: `0x${"ab".repeat(32)}`,
        p_block_timestamp: new Date().toISOString(),
        p_sender: `0x${"11".repeat(20)}`,
        p_recipient: alice.address,
        p_amount_units: "100000000",
        p_confirmations: 3,
      });
      expect(forged.error?.code).toBe(PERMISSION_DENIED);
      expect(await requestStatus(id)).toBe("open");
    });
  });
});
