import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { generateLinkToken } from "@/lib/payments/link-token";
import { findPublicRequest } from "@/lib/payments/requests";

import {
  adminClient,
  anonClient,
  createSignedInUser,
  hasTestDatabase,
  insertChallenge,
  linkWallet,
} from "./supabase";

const PERMISSION_DENIED = "42501";
const DAY = 24 * 60 * 60 * 1000;

type User = { id: string; client: SupabaseClient; walletId: string; address: string };

async function userWithWallet(): Promise<User> {
  const user = await createSignedInUser();
  const { nonceHash, address } = await insertChallenge({ userId: user.id });
  const { data, error } = await linkWallet(user.id, nonceHash).single<{ id: string }>();
  if (error) throw error;
  return { ...user, walletId: data.id, address };
}

async function createRequest(
  user: { id: string; walletId: string },
  options: { amountUnits?: string; expiresAt?: Date } = {},
) {
  const { token, tokenHash } = generateLinkToken();
  const result = await adminClient()
    .rpc("create_payment_request", {
      p_user_id: user.id,
      p_wallet_id: user.walletId,
      p_amount_units: options.amountUnits ?? "100000000",
      p_public_token_hash: tokenHash,
      p_expires_at: (options.expiresAt ?? new Date(Date.now() + DAY)).toISOString(),
    })
    .single<{ id: string; recipient_snapshot: string }>();
  return { ...result, token, tokenHash };
}

describe.skipIf(!hasTestDatabase)("payment requests", () => {
  let alice: User;
  let bob: User;

  beforeAll(async () => {
    [alice, bob] = await Promise.all([userWithWallet(), userWithWallet()]);
  });

  describe("creation and snapshot", () => {
    it("snapshots the recipient from the owner's verified wallet", async () => {
      const { data, error } = await createRequest(alice);
      expect(error).toBeNull();
      expect(data?.recipient_snapshot).toBe(alice.address);
    });

    it("refuses another user's wallet as the recipient", async () => {
      const { error } = await createRequest({ id: alice.id, walletId: bob.walletId });
      expect(error?.message).toBe("wallet_not_found");
    });

    it("stores very large integer amounts exactly", async () => {
      const big = "123456789012345678901234567890";
      const { data } = await createRequest(alice, { amountUnits: big });
      const read = await adminClient()
        .from("payment_requests")
        .select("amount_units::text")
        .eq("id", (data as { id: string }).id)
        .single<{ amount_units: string }>();
      expect(read.data?.amount_units).toBe(big);
    });

    it("rejects zero, negative and fractional base-unit amounts", async () => {
      for (const amount of ["0", "-1", "1.5"]) {
        const { error } = await createRequest(alice, { amountUnits: amount });
        expect(error, amount).not.toBeNull();
      }
    });

    it("keeps the snapshot immutable, even for the service role", async () => {
      const { data } = await createRequest(alice);
      const id = (data as { id: string }).id;
      for (const change of [
        { recipient_snapshot: bob.address },
        { amount_units: "1" },
        { chain_id: 8453 },
        { token_address: "0x" + "1".repeat(40) },
        { expires_at: new Date(Date.now() + 30 * DAY).toISOString() },
        { user_id: bob.id },
      ]) {
        const { error } = await adminClient().from("payment_requests").update(change).eq("id", id);
        expect(error?.message, JSON.stringify(change)).toMatch(
          /payment_request_snapshot_immutable|violates check constraint/,
        );
      }
    });

    it("allows only valid status transitions", async () => {
      const { data } = await createRequest(alice);
      const id = (data as { id: string }).id;
      const skip = await adminClient().from("payment_requests").update({ status: "confirmed" }).eq("id", id);
      expect(skip.error?.message).toBe("payment_request_invalid_transition");
      const cancel = await adminClient().from("payment_requests").update({ status: "cancelled" }).eq("id", id);
      expect(cancel.error).toBeNull();
      const reopen = await adminClient().from("payment_requests").update({ status: "open" }).eq("id", id);
      expect(reopen.error?.message).toBe("payment_request_invalid_transition");
    });
  });

  describe("access control", () => {
    it("shows each user only their own requests", async () => {
      await createRequest(bob);
      const { data, error } = await alice.client.from("payment_requests").select("user_id");
      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThan(0);
      expect(data!.every((row) => row.user_id === alice.id)).toBe(true);
    });

    it("denies anonymous access and all client writes", async () => {
      const anon = await anonClient().from("payment_requests").select("id");
      expect(anon.error?.code).toBe(PERMISSION_DENIED);

      const insert = await alice.client.from("payment_requests").insert({
        user_id: alice.id,
        wallet_id: alice.walletId,
        recipient_snapshot: alice.address,
        amount_units: "1",
        chain_id: 84532,
        token_address: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
        public_token_hash: "a".repeat(64),
        expires_at: new Date(Date.now() + DAY).toISOString(),
      });
      expect(insert.error?.code).toBe(PERMISSION_DENIED);

      const update = await alice.client.from("payment_requests").update({ status: "cancelled" }).eq("user_id", alice.id);
      expect(update.error?.code).toBe(PERMISSION_DENIED);
    });

    it("denies clients the request functions", async () => {
      const { tokenHash } = generateLinkToken();
      const create = await alice.client.rpc("create_payment_request", {
        p_user_id: alice.id,
        p_wallet_id: alice.walletId,
        p_amount_units: "1",
        p_public_token_hash: tokenHash,
        p_expires_at: new Date(Date.now() + DAY).toISOString(),
      });
      expect(create.error?.code).toBe(PERMISSION_DENIED);
    });

    it("does not let one user cancel or relink another user's request", async () => {
      const { data } = await createRequest(alice);
      const id = (data as { id: string }).id;
      const cancel = await adminClient().rpc("cancel_payment_request", {
        p_user_id: bob.id,
        p_request_id: id,
      });
      expect(cancel.error?.message).toBe("request_not_found");
      const relink = await adminClient().rpc("regenerate_payment_link", {
        p_user_id: bob.id,
        p_request_id: id,
        p_public_token_hash: generateLinkToken().tokenHash,
      });
      expect(relink.error?.message).toBe("request_not_found");
    });
  });

  describe("public capability link", () => {
    it("returns only the minimal projection for a valid link", async () => {
      const { token } = await createRequest(alice);
      const projection = await findPublicRequest(adminClient(), token, new Date());
      expect(projection).not.toBeNull();
      expect(Object.keys(projection!).sort()).toEqual(
        [
          "amountDisplay",
          "amountUnits",
          "chainId",
          "chainName",
          "expiresAt",
          "recipient",
          "status",
          "tokenAddress",
          "tokenSymbol",
        ].sort(),
      );
      expect(projection!.recipient).toBe(alice.address);
      expect(projection!.amountUnits).toBe("100000000");
      expect(JSON.stringify(projection)).not.toContain(alice.id);
    });

    it("fails closed for unknown and malformed tokens", async () => {
      expect(await findPublicRequest(adminClient(), generateLinkToken().token, new Date())).toBeNull();
      expect(await findPublicRequest(adminClient(), "not-a-token", new Date())).toBeNull();
      expect(await findPublicRequest(adminClient(), "' or 1=1 --", new Date())).toBeNull();
    });

    it("fails closed once the request expires", async () => {
      const expiresAt = new Date(Date.now() + 60_000);
      const { token } = await createRequest(alice, { expiresAt });
      expect(await findPublicRequest(adminClient(), token, new Date())).not.toBeNull();
      expect(await findPublicRequest(adminClient(), token, expiresAt)).toBeNull();
    });

    it("disables the old link on regenerate and every link on cancel", async () => {
      const { data, token: oldToken } = await createRequest(alice);
      const id = (data as { id: string }).id;
      const next = generateLinkToken();
      const relink = await adminClient().rpc("regenerate_payment_link", {
        p_user_id: alice.id,
        p_request_id: id,
        p_public_token_hash: next.tokenHash,
      });
      expect(relink.error).toBeNull();
      expect(await findPublicRequest(adminClient(), oldToken, new Date())).toBeNull();
      expect(await findPublicRequest(adminClient(), next.token, new Date())).not.toBeNull();

      const cancel = await adminClient().rpc("cancel_payment_request", {
        p_user_id: alice.id,
        p_request_id: id,
      });
      expect(cancel.error).toBeNull();
      expect(await findPublicRequest(adminClient(), next.token, new Date())).toBeNull();

      const relinkCancelled = await adminClient().rpc("regenerate_payment_link", {
        p_user_id: alice.id,
        p_request_id: id,
        p_public_token_hash: generateLinkToken().tokenHash,
      });
      expect(relinkCancelled.error?.message).toBe("request_not_open");
    });

    it("records audit events for create, relink and cancel", async () => {
      const { data } = await createRequest(alice);
      const id = (data as { id: string }).id;
      await adminClient().rpc("regenerate_payment_link", {
        p_user_id: alice.id,
        p_request_id: id,
        p_public_token_hash: generateLinkToken().tokenHash,
      });
      await adminClient().rpc("cancel_payment_request", { p_user_id: alice.id, p_request_id: id });
      const { data: events } = await alice.client
        .from("audit_events")
        .select("event_type")
        .eq("request_id", id)
        .order("created_at");
      expect(events?.map((e) => e.event_type)).toEqual([
        "request.created",
        "request.link_regenerated",
        "request.cancelled",
      ]);
    });
  });
});
