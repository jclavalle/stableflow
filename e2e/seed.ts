import { randomBytes, randomUUID } from "node:crypto";

import { expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

export const hasSupabase = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

export function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

/** Seeds a confirmed user with a linked test wallet, bypassing the wallet UI. */
export async function seedFreelancer() {
  const email = `e2e-${randomUUID()}@example.test`;
  const password = randomBytes(16).toString("hex");
  const address = `0x${randomBytes(20).toString("hex")}`;
  const { data, error } = await admin().auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error;

  const nonceHash = randomBytes(32).toString("hex");
  const insert = await admin().from("wallet_challenges").insert({
    user_id: data.user.id,
    address,
    chain_id: 84532,
    nonce_hash: nonceHash,
    message: "e2e seed",
    domain: "localhost",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  });
  if (insert.error) throw insert.error;
  const link = await admin().rpc("link_wallet", { p_user_id: data.user.id, p_nonce_hash: nonceHash });
  if (link.error) throw link.error;
  return { id: data.user.id, email, password, address };
}

export async function signIn(page: Page, email: string, password: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/account$/);
}

/** Creates a request through the UI and returns its share link and detail path. */
export async function createRequestViaUi(page: Page, amount: string) {
  await page.goto("/requests");
  await page.getByLabel("Amount (test USDC)").fill(amount);
  await page.getByRole("button", { name: "Create payment request" }).click();
  await expect(page.getByText("Payment request created.")).toBeVisible();
  const payUrl = await page.getByLabel("Payment link").inputValue();
  const detailPath = await page.getByRole("link", { name: "View request" }).getAttribute("href");
  return { payUrl, detailPath: detailPath! };
}
