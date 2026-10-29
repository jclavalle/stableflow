import { randomBytes, randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { generateLinkToken } from "@/lib/payments/link-token";
import { computeQuote, QUOTE_ASSUMPTIONS } from "@/lib/quotes/fx";

import { adminClient, anonClient, createSignedInUser, hasTestDatabase, insertChallenge, linkWallet } from "./supabase";

const PERMISSION_DENIED = "42501";
const DAY = 24 * 60 * 60 * 1000;
const AMOUNT = BigInt(100_000_000);

type User = { id: string; client: SupabaseClient; walletId: string; address: string };

const txHash = () => `0x${randomBytes(32).toString("hex")}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function userWithWallet(): Promise<User> {
  const user = await createSignedInUser();
  const { nonceHash, address } = await insertChallenge({ userId: user.id });
  const { data, error } = await linkWallet(user.id, nonceHash).single<{ id: string }>();
  if (error) throw error;
  return { ...user, walletId: data.id, address };
}

async function openRequest(user: User) {
  const { data, error } = await adminClient()
    .rpc("create_payment_request", {
      p_user_id: user.id,
      p_wallet_id: user.walletId,
      p_amount_units: AMOUNT.toString(),
      p_public_token_hash: generateLinkToken().tokenHash,
      p_expires_at: new Date(Date.now() + DAY).toISOString(),
      p_creation_block: "1000",
    })
    .single<{ id: string }>();
  if (error) throw error;
  return data.id;
}

async function confirmedRequest(user: User) {
  const id = await openRequest(user);
  const hash = txHash();
  await adminClient().rpc("submit_payment_attempt", { p_request_id: id, p_tx_hash: hash });
  const { error } = await adminClient().rpc("confirm_payment", {
    p_request_id: id,
    p_tx_hash: hash,
    p_log_index: 0,
    p_block_number: "1005",
    p_block_hash: `0x${"ab".repeat(32)}`,
    p_block_timestamp: new Date().toISOString(),
    p_sender: `0x${"11".repeat(20)}`,
    p_recipient: user.address,
    p_amount_units: AMOUNT.toString(),
    p_confirmations: 3,
  });
  if (error) throw error;
  return id;
}

function quoteArgs(user: User, requestId: string, overrides: Record<string, unknown> = {}) {
  const result = computeQuote(AMOUNT);
  if (!result.ok) throw new Error("quote");
  const f = result.figures;
  return {
    p_user_id: user.id,
    p_request_id: requestId,
    p_input_units: f.inputUnits.toString(),
    p_service_fee_bps: Number(f.serviceFeeBps),
    p_service_fee_units: f.serviceFeeUnits.toString(),
    p_fixed_fee_units: f.fixedFeeUnits.toString(),
    p_net_units: f.netUnits.toString(),
    p_fx_scale: Number(f.fxScale),
    p_reference_rate_scaled: Number(f.referenceRateScaled),
    p_spread_bps: Number(f.spreadBps),
    p_effective_rate_scaled: Number(f.effectiveRateScaled),
    p_output_minor: f.outputMinor.toString(),
    p_assumptions_version: QUOTE_ASSUMPTIONS.version,
    p_valid_seconds: QUOTE_ASSUMPTIONS.validitySeconds,
    ...overrides,
  };
}

async function quote(user: User, requestId: string, overrides: Record<string, unknown> = {}) {
  const { data, error } = await adminClient()
    .rpc("create_payout_quote", quoteArgs(user, requestId, overrides))
    .single<{ id: string; output_minor: number; expires_at: string }>();
  if (error) throw error;
  return data;
}

function simulate(user: User, quoteId: string, key: string = randomUUID()) {
  return adminClient().rpc("create_payout_simulation", { p_user_id: user.id, p_quote_id: quoteId, p_idempotency_key: key });
}

function advance(user: User, simulationId: string, evidenceOk: boolean | null) {
  return adminClient()
    .rpc("advance_payout_simulation", { p_user_id: user.id, p_simulation_id: simulationId, p_evidence_ok: evidenceOk })
    .single<{ status: string; failure_code: string | null }>();
}

describe.skipIf(!hasTestDatabase)("payout quotes and simulations", () => {
  let alice: User;
  let bob: User;

  beforeAll(async () => {
    [alice, bob] = await Promise.all([userWithWallet(), userWithWallet()]);
  });

  describe("quotes", () => {
    it("stores the documented 100 USDC → BRL 490.05 quote, valid for 5 minutes", async () => {
      const id = await confirmedRequest(alice);
      const q = await quote(alice, id);
      const { data } = await adminClient()
        .from("payout_quotes")
        .select("output_minor::text, net_units::text, created_at, expires_at")
        .eq("id", q.id)
        .single<{ output_minor: string; net_units: string; created_at: string; expires_at: string }>();
      expect(data!.output_minor).toBe("49005");
      expect(data!.net_units).toBe("99000000");
      expect(new Date(data!.expires_at).getTime() - new Date(data!.created_at).getTime()).toBe(300_000);
    });

    it("refuses requests that are not confirmed", async () => {
      const id = await openRequest(alice);
      await expect(quote(alice, id)).rejects.toMatchObject({ message: "request_not_confirmed" });
    });

    it("refuses another user's request", async () => {
      const id = await confirmedRequest(alice);
      await expect(quote(bob, id)).rejects.toMatchObject({ message: "request_not_found" });
    });

    it("pins the input to the request amount", async () => {
      const id = await confirmedRequest(alice);
      const bigger = computeQuote(AMOUNT * BigInt(2));
      if (!bigger.ok) throw new Error("quote");
      const f = bigger.figures;
      await expect(
        quote(alice, id, {
          p_input_units: f.inputUnits.toString(),
          p_service_fee_units: f.serviceFeeUnits.toString(),
          p_net_units: f.netUnits.toString(),
          p_output_minor: f.outputMinor.toString(),
        }),
      ).rejects.toMatchObject({ message: "quote_input_mismatch" });
    });

    it.each([
      ["an inflated payout", { p_output_minor: "49006" }],
      ["a waived service fee", { p_service_fee_units: "0" }],
      ["a better rate than the spread allows", { p_effective_rate_scaled: 50_000 }],
      ["a net that ignores fees", { p_net_units: "100000000" }],
    ])("rejects inconsistent arithmetic: %s", async (_name, overrides) => {
      const id = await confirmedRequest(alice);
      await expect(quote(alice, id, overrides)).rejects.toMatchObject({ code: "23514" });
    });

    it("is immutable, even for the service role", async () => {
      const id = await confirmedRequest(alice);
      const q = await quote(alice, id);
      const update = await adminClient().from("payout_quotes").update({ output_minor: 1 }).eq("id", q.id);
      expect(update.error?.message).toMatch(/append-only/);
      const del = await adminClient().from("payout_quotes").delete().eq("id", q.id);
      expect(del.error?.message).toMatch(/append-only/);
    });
  });

  describe("simulations", () => {
    it("denies an expired quote and allows a fresh one", async () => {
      const id = await confirmedRequest(alice);
      const stale = await quote(alice, id, { p_valid_seconds: 1 });
      await sleep(1_500);
      expect((await simulate(alice, stale.id)).error?.message).toBe("quote_expired");
      const fresh = await quote(alice, id);
      expect((await simulate(alice, fresh.id)).error).toBeNull();
    });

    it("creates exactly one simulation per request, even under concurrent different keys", async () => {
      const id = await confirmedRequest(alice);
      const q = await quote(alice, id);
      const results = await Promise.all(Array.from({ length: 6 }, () => simulate(alice, q.id)));
      const ok = results.filter((r) => r.error === null);
      expect(ok).toHaveLength(1);
      expect(results.filter((r) => r.error).every((r) => r.error!.message === "simulation_exists")).toBe(true);
      const { count } = await adminClient()
        .from("payout_simulations")
        .select("id", { count: "exact", head: true })
        .eq("request_id", id);
      expect(count).toBe(1);
    });

    it("returns the same simulation for a repeated idempotency key, even concurrently", async () => {
      const id = await confirmedRequest(alice);
      const q = await quote(alice, id);
      const key = randomUUID();
      const results = await Promise.all(Array.from({ length: 6 }, () => simulate(alice, q.id, key)));
      expect(results.every((r) => r.error === null)).toBe(true);
      expect(new Set(results.map((r) => (r.data as { id: string }).id)).size).toBe(1);
    });

    it("refuses a second quote's simulation for the same request", async () => {
      const id = await confirmedRequest(alice);
      const first = await quote(alice, id);
      const second = await quote(alice, id);
      expect((await simulate(alice, first.id)).error).toBeNull();
      expect((await simulate(alice, second.id)).error?.message).toBe("simulation_exists");
      await expect(quote(alice, id)).rejects.toMatchObject({ message: "simulation_exists" });
    });

    it("refuses another user's quote and a reused key", async () => {
      const id = await confirmedRequest(alice);
      const q = await quote(alice, id);
      expect((await simulate(bob, q.id)).error?.message).toBe("quote_not_found");

      const key = randomUUID();
      expect((await simulate(alice, q.id, key)).error).toBeNull();
      const other = await quote(bob, await confirmedRequest(bob));
      expect((await simulate(bob, other.id, key)).error?.message).toBe("idempotency_key_reused");
    });

    it("advances created → processing → completed_simulation on server time, only with fresh evidence", async () => {
      const id = await confirmedRequest(alice);
      const q = await quote(alice, id);
      const { data: sim } = await simulate(alice, q.id).single<{ id: string; status: string; simulation: boolean }>();
      expect(sim!.status).toBe("created");
      expect(sim!.simulation).toBe(true);

      expect((await advance(alice, sim!.id, null)).data!.status).toBe("created"); // too early
      await sleep(1_100);
      expect((await advance(alice, sim!.id, null)).data!.status).toBe("processing");
      expect((await advance(alice, sim!.id, true)).data!.status).toBe("processing"); // too early
      await sleep(3_100);
      expect((await advance(alice, sim!.id, null)).data!.status).toBe("processing"); // chain not checked
      expect((await advance(alice, sim!.id, true)).data!.status).toBe("completed_simulation");
      expect((await advance(alice, sim!.id, false)).data!.status).toBe("completed_simulation"); // terminal
    });

    it("fails the simulation and puts the request under review when evidence is invalid", async () => {
      const id = await confirmedRequest(alice);
      const q = await quote(alice, id);
      const { data: sim } = await simulate(alice, q.id).single<{ id: string }>();
      await sleep(1_100);
      await advance(alice, sim!.id, null);
      await sleep(3_100);
      const { data } = await advance(alice, sim!.id, false);
      expect(data).toMatchObject({ status: "failed_simulation", failure_code: "evidence_invalidated" });
    });

    it("blocks simulations and quotes after evidence is flagged for review, keeping history", async () => {
      const id = await confirmedRequest(alice);
      const q = await quote(alice, id);
      const flag = await adminClient().rpc("flag_evidence_review", { p_request_id: id, p_reason: "block_not_canonical" });
      expect(flag.error).toBeNull();

      expect((await simulate(alice, q.id)).error?.message).toBe("request_not_confirmed");
      await expect(quote(alice, id)).rejects.toMatchObject({ message: "request_not_confirmed" });
      const { data: req } = await adminClient().from("payment_requests").select("status").eq("id", id).single();
      expect(req!.status).toBe("under_review");
      const { count } = await adminClient()
        .from("verified_receipts")
        .select("id", { count: "exact", head: true })
        .eq("request_id", id);
      expect(count).toBe(1);
    });

    it("stops an unfinished simulation when evidence is flagged", async () => {
      const id = await confirmedRequest(alice);
      const q = await quote(alice, id);
      const { data: sim } = await simulate(alice, q.id).single<{ id: string }>();
      await adminClient().rpc("flag_evidence_review", { p_request_id: id, p_reason: "receipt_missing" });
      const { data } = await adminClient().from("payout_simulations").select("status, failure_code").eq("id", sim!.id).single();
      expect(data).toEqual({ status: "failed_simulation", failure_code: "evidence_invalidated" });
    });

    it("never allows a terminal simulation to change or be deleted", async () => {
      const id = await confirmedRequest(alice);
      const q = await quote(alice, id);
      const { data: sim } = await simulate(alice, q.id).single<{ id: string }>();
      const back = await adminClient().from("payout_simulations").update({ status: "completed_simulation" }).eq("id", sim!.id);
      expect(back.error?.message).toBe("payout_simulation_invalid_transition");
      const flip = await adminClient().from("payout_simulations").update({ simulation: false }).eq("id", sim!.id);
      expect(flip.error?.message).toBe("payout_simulation_immutable");
      const del = await adminClient().from("payout_simulations").delete().eq("id", sim!.id);
      expect(del.error?.message).toMatch(/append-only/);
    });
  });

  describe("access control", () => {
    it("shows quotes and simulations only to their owner", async () => {
      const id = await confirmedRequest(alice);
      const q = await quote(alice, id);
      await simulate(alice, q.id);

      expect((await alice.client.from("payout_quotes").select("id").eq("request_id", id)).data).toHaveLength(1);
      expect((await alice.client.from("payout_simulations").select("id").eq("request_id", id)).data).toHaveLength(1);
      expect((await bob.client.from("payout_quotes").select("id").eq("request_id", id)).data).toEqual([]);
      expect((await bob.client.from("payout_simulations").select("id").eq("request_id", id)).data).toEqual([]);
    });

    it("denies anonymous access, client writes and the payout functions", async () => {
      for (const table of ["payout_quotes", "payout_simulations"]) {
        expect((await anonClient().from(table).select("id")).error?.code, table).toBe(PERMISSION_DENIED);
      }
      const id = await confirmedRequest(alice);
      expect((await alice.client.rpc("create_payout_quote", quoteArgs(alice, id))).error?.code).toBe(PERMISSION_DENIED);
      const q = await quote(alice, id);
      expect(
        (await alice.client.rpc("create_payout_simulation", { p_user_id: alice.id, p_quote_id: q.id, p_idempotency_key: randomUUID() }))
          .error?.code,
      ).toBe(PERMISSION_DENIED);
      expect((await alice.client.rpc("flag_evidence_review", { p_request_id: id, p_reason: "receipt_missing" })).error?.code).toBe(
        PERMISSION_DENIED,
      );
      const insert = await alice.client
        .from("payout_simulations")
        .insert({ request_id: id, quote_id: q.id, user_id: alice.id, idempotency_key: randomUUID() });
      expect(insert.error?.code).toBe(PERMISSION_DENIED);
    });
  });
});
