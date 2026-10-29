import { expect, test } from "@playwright/test";

import { mockRpc } from "./fake-wallet";
import { paidRequest } from "./flows";
import { admin, hasSupabase, seedFreelancer, signIn } from "./seed";

test.skip(!hasSupabase, "No local Supabase configured");

const SIMULATED = "Simulated — no bank transfer";

test("freelancer quotes BRL 490.05 for 100 test USDC and completes one simulated payout", async ({ page, browser }) => {
  const { detailPath, requestId } = await paidRequest(page, browser, "100");

  await page.getByRole("button", { name: "Get illustrative BRL quote" }).click();
  const panel = page.getByRole("region", { name: /Illustrative BRL payout/ });
  await expect(panel.getByText("BRL 490.05 (rounded down to the cent)")).toBeVisible();
  await expect(panel.getByText("− 0.50 USD")).toHaveCount(2);
  await expect(panel.getByText("4.95 BRL per USD")).toBeVisible();
  await expect(panel.getByText(/Not modeled/)).toBeVisible();
  await expect(panel.getByText(/Paid separately by the sender in test ETH/)).toBeVisible();
  await expect(panel.getByText(/Quote valid for 4:5\d|Quote valid for 5:00/)).toBeVisible();

  // A double click must not create two simulations.
  await page.getByRole("button", { name: "Start simulated payout of BRL 490.05" }).dblclick();
  const progress = page.getByRole("region", { name: /Payout simulation/ });
  await expect(progress.getByText(SIMULATED)).toBeVisible();

  // Reload mid-simulation resumes from server state.
  await page.reload();
  await expect(page.getByText("Simulation complete — no bank transfer occurred.")).toBeVisible({ timeout: 20_000 });

  const { count } = await admin()
    .from("payout_simulations")
    .select("id", { count: "exact", head: true })
    .eq("request_id", requestId);
  expect(count).toBe(1);

  // History keeps blockchain evidence and simulated payout events apart.
  await page.goto(detailPath);
  const history = page.getByRole("region", { name: "History" });
  await expect(history.getByRole("heading", { name: /Request and blockchain evidence/ })).toBeVisible();
  await expect(history.getByText("Payment verified on Base Sepolia")).toBeVisible();
  await expect(history.getByRole("heading", { name: `Payout simulation (${SIMULATED})` })).toBeVisible();
  await expect(history.getByText(/Illustrative BRL quote created — BRL 490.05/)).toBeVisible();
  await expect(history.getByText("Payout simulation complete")).toBeVisible();
  await expect(page.getByRole("button", { name: /Get .*quote/ })).toHaveCount(0);
});

test("a request whose evidence vanished from the chain goes under review and cannot be simulated", async ({ page, browser }) => {
  const { txHash } = await paidRequest(page, browser, "12");
  await page.getByRole("button", { name: "Get illustrative BRL quote" }).click();
  await expect(page.getByText(/^BRL \d.* \(rounded down to the cent\)$/)).toBeVisible();

  await mockRpc("test_dropTransaction", [txHash]);
  await page.getByRole("button", { name: /Start simulated payout/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: "under review" })).toBeVisible();

  await page.reload();
  await expect(page.getByText("Under review — payment evidence changed on chain")).toBeVisible();
  await expect(page.getByRole("button", { name: /Start simulated payout|Get .*quote/ })).toHaveCount(0);
  await expect(page.getByText("Payment evidence no longer on the canonical chain — under review")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Verified receipt (blockchain evidence)" })).toBeVisible();
});

test("another user cannot quote or simulate someone else's request", async ({ page, browser, request }) => {
  const { requestId } = await paidRequest(page, browser, "5");

  const intruder = await seedFreelancer();
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await signIn(otherPage, intruder.email, intruder.password);
  const origin = new URL(page.url()).origin;
  const response = await otherPage.request.post(`/api/requests/${requestId}/quote`, { headers: { origin } });
  expect(response.status()).toBe(404);
  await other.close();

  // Signed out: refused before any lookup.
  const anonymous = await request.post(`/api/requests/${requestId}/quote`, { headers: { origin } });
  expect(anonymous.status()).toBe(401);
});
