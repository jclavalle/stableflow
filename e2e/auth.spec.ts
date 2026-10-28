import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

// Needs a local Supabase (CI starts one). Skipped otherwise.
test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL, "No local Supabase configured");

test("signed-out visitors are sent from /account to sign-in", async ({ page }) => {
  await page.goto("/account");
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole("heading", { name: "Sign in to StableFlow" })).toBeVisible();
});

test("a new freelancer can sign up, see their account, and sign out", async ({ page }) => {
  const email = `e2e-${randomUUID()}@example.test`;

  await page.goto("/sign-in");
  await page.getByRole("button", { name: "New here? Create an account" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(`pw-${randomUUID()}`);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
  await expect(page.getByText("No wallet linked yet.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Testnet disclosure" })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/account");
  await expect(page).toHaveURL(/\/sign-in$/);
});
