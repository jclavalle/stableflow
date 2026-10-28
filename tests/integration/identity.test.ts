import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import {
  adminClient,
  anonClient,
  createSignedInUser,
  hasTestDatabase,
  insertChallenge,
  linkWallet,
  randomAddress,
} from "./supabase";

const PERMISSION_DENIED = "42501";

describe.skipIf(!hasTestDatabase)("identity schema: RLS, privileges and link_wallet", () => {
  let userA: { id: string; client: SupabaseClient };
  let userB: { id: string; client: SupabaseClient };
  let walletB: string;

  beforeAll(async () => {
    [userA, userB] = await Promise.all([createSignedInUser(), createSignedInUser()]);
    const { nonceHash, address } = await insertChallenge({ userId: userB.id });
    const { error } = await linkWallet(userB.id, nonceHash);
    if (error) throw error;
    walletB = address;
  });

  describe("two-user isolation", () => {
    it("creates a profile on sign-up and shows each user only their own", async () => {
      const { data, error } = await userA.client.from("profiles").select("id");
      expect(error).toBeNull();
      expect(data).toEqual([{ id: userA.id }]);
    });

    it("hides user B's wallet from user A", async () => {
      const a = await userA.client.from("wallets").select("address");
      expect(a.error).toBeNull();
      expect(a.data).toEqual([]);

      const b = await userB.client.from("wallets").select("address");
      expect(b.data).toEqual([{ address: walletB }]);
    });

    it("hides user B's audit events from user A", async () => {
      const { data } = await userA.client.from("audit_events").select("id, user_id");
      expect(data?.every((row) => row.user_id === userA.id)).toBe(true);
      const b = await userB.client.from("audit_events").select("event_type");
      expect(b.data?.map((row) => row.event_type)).toContain("wallet.linked");
    });

    it("blocks user A from writing wallets, including user B's", async () => {
      const insert = await userA.client
        .from("wallets")
        .insert({ user_id: userA.id, address: randomAddress(), chain_id: 84532 });
      expect(insert.error?.code).toBe(PERMISSION_DENIED);

      const steal = await userA.client
        .from("wallets")
        .update({ user_id: userA.id })
        .eq("address", walletB);
      expect(steal.error?.code).toBe(PERMISSION_DENIED);

      const remove = await userA.client.from("wallets").delete().eq("address", walletB);
      expect(remove.error?.code).toBe(PERMISSION_DENIED);

      const still = await adminClient().from("wallets").select("user_id").eq("address", walletB);
      expect(still.data).toEqual([{ user_id: userB.id }]);
    });

    it("blocks profile edits by clients", async () => {
      const { error } = await userA.client
        .from("profiles")
        .update({ display_name: "x" })
        .eq("id", userB.id);
      expect(error?.code).toBe(PERMISSION_DENIED);
    });
  });

  describe("server-only surfaces", () => {
    it("denies clients any access to wallet challenges", async () => {
      const read = await userA.client.from("wallet_challenges").select("id");
      expect(read.error?.code).toBe(PERMISSION_DENIED);
      const write = await userA.client.from("wallet_challenges").insert({
        user_id: userA.id,
        address: randomAddress(),
        chain_id: 84532,
        nonce_hash: "0".repeat(64),
        message: "m",
        domain: "d",
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      });
      expect(write.error?.code).toBe(PERMISSION_DENIED);
    });

    it("denies anonymous visitors all table access", async () => {
      const anon = anonClient();
      for (const table of ["profiles", "wallets", "wallet_challenges", "audit_events"]) {
        const { error } = await anon.from(table).select("*");
        expect(error?.code, table).toBe(PERMISSION_DENIED);
      }
    });

    it("denies clients execution of link_wallet, even for themselves", async () => {
      const { nonceHash } = await insertChallenge({ userId: userA.id });
      const { error } = await userA.client.rpc("link_wallet", {
        p_user_id: userA.id,
        p_nonce_hash: nonceHash,
      });
      expect(error?.code).toBe(PERMISSION_DENIED);
    });

    it("keeps audit events append-only, even for the service role", async () => {
      const update = await adminClient()
        .from("audit_events")
        .update({ event_type: "tampered" })
        .eq("user_id", userB.id);
      expect(update.error?.message).toMatch(/append-only/);
    });
  });

  describe("link_wallet", () => {
    it("links a wallet once and rejects replay of the same challenge", async () => {
      const { nonceHash, address } = await insertChallenge({ userId: userA.id });
      const first = await linkWallet(userA.id, nonceHash);
      expect(first.error).toBeNull();
      expect(first.data).toMatchObject({ user_id: userA.id, address, chain_id: 84532 });

      const replay = await linkWallet(userA.id, nonceHash);
      expect(replay.error?.message).toBe("challenge_consumed");
    });

    it("lets exactly one of several concurrent attempts consume a challenge", async () => {
      const { nonceHash } = await insertChallenge({ userId: userA.id });
      const results = await Promise.all(
        Array.from({ length: 6 }, () => linkWallet(userA.id, nonceHash)),
      );
      expect(results.filter((r) => r.error === null)).toHaveLength(1);
      expect(
        results.filter((r) => r.error?.message === "challenge_consumed"),
      ).toHaveLength(5);
    });

    it("rejects an expired challenge", async () => {
      const createdAt = new Date(Date.now() - 10 * 60 * 1000);
      const { nonceHash } = await insertChallenge({
        userId: userA.id,
        createdAt,
        expiresAt: new Date(Date.now() - 1000),
      });
      const { error } = await linkWallet(userA.id, nonceHash);
      expect(error?.message).toBe("challenge_expired");
    });

    it("does not let one user consume another user's challenge", async () => {
      const { nonceHash } = await insertChallenge({ userId: userA.id });
      const { error } = await linkWallet(userB.id, nonceHash);
      expect(error?.message).toBe("challenge_not_found");
      const owner = await linkWallet(userA.id, nonceHash);
      expect(owner.error).toBeNull();
    });

    it("refuses a wallet already linked to another user and leaves the challenge unused", async () => {
      const { nonceHash } = await insertChallenge({ userId: userA.id, address: walletB });
      const { error } = await linkWallet(userA.id, nonceHash);
      expect(error?.message).toBe("wallet_linked_to_another_user");

      const { data } = await adminClient()
        .from("wallet_challenges")
        .select("consumed_at")
        .eq("nonce_hash", nonceHash)
        .single();
      expect(data?.consumed_at).toBeNull();
    });

    it("rejects zero and malformed addresses at the database", async () => {
      await expect(
        insertChallenge({ userId: userA.id, address: "0xABC" }),
      ).rejects.toMatchObject({ code: "23514" });
      const zero = await adminClient()
        .from("wallets")
        .insert({ user_id: userA.id, address: `0x${"0".repeat(40)}`, chain_id: 84532 });
      expect(zero.error?.code).toBe("23514");
    });

    it("rejects any chain other than Base Sepolia", async () => {
      const { error } = await adminClient()
        .from("wallets")
        .insert({ user_id: userA.id, address: randomAddress(), chain_id: 8453 });
      expect(error?.code).toBe("23514");
    });
  });
});
