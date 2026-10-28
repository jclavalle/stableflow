import { randomBytes, randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Points at a disposable local Supabase (`npx supabase start`). Never a hosted
// project: these tests create and mutate users.
const url = process.env.SUPABASE_TEST_URL;
const anonKey = process.env.SUPABASE_TEST_ANON_KEY;
const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;

export const hasTestDatabase = Boolean(url && anonKey && serviceKey);

if (!hasTestDatabase && process.env.CI) {
  throw new Error("Integration tests require SUPABASE_TEST_* variables in CI.");
}
if (url && !/^http:\/\/(127\.0\.0\.1|localhost):/.test(url)) {
  throw new Error(`Refusing to run integration tests against non-local Supabase: ${url}`);
}

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

export function adminClient(): SupabaseClient {
  return createClient(url!, serviceKey!, noSession);
}

export function anonClient(): SupabaseClient {
  return createClient(url!, anonKey!, noSession);
}

export async function createSignedInUser(): Promise<{ id: string; client: SupabaseClient }> {
  const email = `test-${randomUUID()}@example.test`;
  const password = randomBytes(16).toString("hex");
  const { data, error } = await adminClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("createUser failed");

  const client = anonClient();
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { id: data.user.id, client };
}

export function randomAddress(): string {
  return `0x${randomBytes(20).toString("hex")}`;
}

export function randomNonceHash(): string {
  return randomBytes(32).toString("hex");
}

/** Inserts a challenge directly, as the server would after signature checks. */
export async function insertChallenge(params: {
  userId: string;
  address?: string;
  createdAt?: Date;
  expiresAt?: Date;
}): Promise<{ nonceHash: string; address: string }> {
  const nonceHash = randomNonceHash();
  const address = params.address ?? randomAddress();
  const createdAt = params.createdAt ?? new Date();
  const expiresAt = params.expiresAt ?? new Date(createdAt.getTime() + 5 * 60 * 1000);
  const { error } = await adminClient().from("wallet_challenges").insert({
    user_id: params.userId,
    address,
    chain_id: 84532,
    nonce_hash: nonceHash,
    message: "test message",
    domain: "localhost:3000",
    created_at: createdAt.toISOString(),
    expires_at: expiresAt.toISOString(),
  });
  if (error) throw error;
  return { nonceHash, address };
}

export function linkWallet(userId: string, nonceHash: string) {
  return adminClient().rpc("link_wallet", { p_user_id: userId, p_nonce_hash: nonceHash });
}
