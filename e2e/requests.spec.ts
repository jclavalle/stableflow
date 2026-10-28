import { randomBytes, randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// Needs a local Supabase (CI starts one). Skipped otherwise.
test.skip(!process.env.SUPABASE_SERVICE_ROLE_KEY, "No local Supabase configured");

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

/** Seeds a confirmed user with a linked test wallet, bypassing the wallet UI. */
async function seedFreelancer() {
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
  return { email, password, address };
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/account$/);
}

test("freelancer creates a request; payer sees only the minimal public view; cancel disables it", async ({
  page,
  browser,
}) => {
  const freelancer = await seedFreelancer();
  await signIn(page, freelancer.email, freelancer.password);

  await page.getByRole("link", { name: "Requests" }).click();
  await page.getByLabel("Amount (test USDC)").fill("1e6");
  await page.getByRole("button", { name: "Create payment request" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("plain number");

  await page.getByLabel("Amount (test USDC)").fill("100.5");
  await page.getByRole("button", { name: "Create payment request" }).click();
  await expect(page.getByText("Payment request created.")).toBeVisible();
  const payUrl = await page.getByLabel("Payment link").inputValue();
  expect(payUrl).toMatch(/\/pay\/[A-Za-z0-9_-]{43}$/);

  // Payer: a separate browser context with no session.
  const payerContext = await browser.newContext();
  const payer = await payerContext.newPage();
  const response = await payer.goto(payUrl);
  expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
  await expect(payer.getByRole("heading", { name: "Payment request" })).toBeVisible();
  await expect(payer.getByText("100.50")).toBeVisible();
  await expect(payer.getByText(freelancer.address)).toBeVisible();
  await expect(payer.getByText("no financial value")).toBeVisible();
  await expect(payer.getByRole("region", { name: "Testnet disclosure" })).toBeVisible();
  await payer.setViewportSize({ width: 360, height: 740 });
  const overflow = await payer.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const payerText = await payer.locator("body").innerText();
  expect(payerText).not.toContain(freelancer.email);

  // Owner cancels; the payer's link stops working.
  await page.getByRole("link", { name: "View request" }).click();
  await expect(page.getByText("Waiting for payment")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Cancel request" }).click();
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();

  await payer.reload();
  await expect(payer.getByRole("heading", { name: "Payment link not available" })).toBeVisible();
  await expect(payer.getByText(freelancer.address)).toHaveCount(0);
  await payerContext.close();
});

test("another freelancer cannot open someone else's request", async ({ page, browser }) => {
  const owner = await seedFreelancer();
  await signIn(page, owner.email, owner.password);
  await page.goto("/requests");
  await page.getByLabel("Amount (test USDC)").fill("5");
  await page.getByRole("button", { name: "Create payment request" }).click();
  await page.getByRole("link", { name: "View request" }).click();
  const requestPath = new URL(page.url()).pathname;

  const other = await seedFreelancer();
  const otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();
  await signIn(otherPage, other.email, other.password);
  // The page streams, so its HTTP status is sent before the lookup; assert on
  // content instead. The JSON API below returns a real 404.
  await otherPage.goto(requestPath);
  await expect(otherPage.getByText("This page could not be found.")).toBeVisible();
  await expect(otherPage.getByText(owner.address)).toHaveCount(0);
  await expect(otherPage.getByText("5.00 test USDC")).toHaveCount(0);

  const api = await otherPage.request.get(`/api${requestPath}`);
  expect(api.status()).toBe(404);
  await otherContext.close();
});

test("unknown and malformed payment links fail closed", async ({ request }) => {
  for (const token of ["nope", "A".repeat(43)]) {
    const response = await request.get(`/api/pay/${token}`);
    expect(response.status()).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "link_invalid", message: "This payment link is invalid, expired or cancelled." },
    });
  }
});
