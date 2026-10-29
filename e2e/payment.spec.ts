import { randomBytes } from "node:crypto";

import { expect, test, type Browser } from "@playwright/test";

import { installFakeWallet, mockRpc } from "./fake-wallet";
import { createRequestViaUi, hasSupabase, seedFreelancer, signIn } from "./seed";

test.skip(!hasSupabase, "No local Supabase configured");
// The outage test toggles shared mock-chain state (scoped to its own payer).
test.describe.configure({ mode: "serial" });

const SEPOLIA_L1 = 11_155_111;

const newAccount = () => `0x${randomBytes(20).toString("hex")}`;

async function openAsPayer(browser: Browser, payUrl: string, account = newAccount()) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await installFakeWallet(page, { account, chainId: SEPOLIA_L1 });
  await page.goto(payUrl);
  return { context, page };
}

test.afterEach(async () => {
  await mockRpc("test_setOutage", [false]);
});

test("payer switches network, pays, and the request is verified only after confirmations", async ({ page, browser }) => {
  const freelancer = await seedFreelancer();
  await signIn(page, freelancer.email, freelancer.password);
  const { payUrl, detailPath } = await createRequestViaUi(page, "25");

  const payer = await openAsPayer(browser, payUrl);
  await payer.page.getByRole("button", { name: "Connect wallet" }).click();

  // Wrong network blocks signing until switched.
  await expect(payer.page.getByRole("button", { name: "Switch to Base Sepolia" })).toBeVisible();
  await expect(payer.page.getByRole("button", { name: /Send .* test USDC/ })).toHaveCount(0);
  await payer.page.getByRole("button", { name: "Switch to Base Sepolia" }).click();

  await expect(payer.page.getByText("Exactly 25.00 test USDC")).toBeVisible();
  await payer.page.getByRole("button", { name: "Send 25.00 test USDC" }).click();

  // Submission is not payment: verification starts unconfirmed.
  await expect(payer.page.getByRole("heading", { name: "Verifying your payment…" })).toBeVisible();

  // Reload mid-verification resumes from server state.
  await payer.page.reload();
  await expect(
    payer.page.getByRole("heading", { name: /Verifying your payment…|Payment verified on Base Sepolia/ }),
  ).toBeVisible();

  await expect(payer.page.getByRole("heading", { name: "Payment verified on Base Sepolia" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(payer.page.getByRole("region", { name: "Testnet disclosure" })).toBeVisible();

  // Owner sees the verified receipt and confirmed status.
  await page.goto(detailPath);
  await expect(page.getByText("Payment confirmed on testnet")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Verified receipt (blockchain evidence)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel request" })).toHaveCount(0);
  await payer.context.close();
});

test("an RPC outage keeps the payment pending, never confirmed, then recovers", async ({ page, browser }) => {
  const freelancer = await seedFreelancer();
  await signIn(page, freelancer.email, freelancer.password);
  const { payUrl, detailPath } = await createRequestViaUi(page, "3.5");

  const account = newAccount();
  await mockRpc("test_setOutage", [true, account]);
  const payer = await openAsPayer(browser, payUrl, account);
  await payer.page.getByRole("button", { name: "Connect wallet" }).click();
  await payer.page.getByRole("button", { name: "Switch to Base Sepolia" }).click();
  await payer.page.getByRole("button", { name: "Send 3.50 test USDC" }).click();

  await expect(payer.page.getByText("We can’t reach Base Sepolia to verify right now.")).toBeVisible();
  // Several blocks pass during the outage; it must still not confirm.
  await payer.page.waitForTimeout(5_000);
  await expect(payer.page.getByRole("heading", { name: "Payment verified on Base Sepolia" })).toHaveCount(0);
  await page.goto(detailPath);
  await expect(page.getByText("Payment confirmed on testnet")).toHaveCount(0);

  await mockRpc("test_setOutage", [false, account]);
  await payer.page.getByRole("button", { name: "Check again" }).click();
  await expect(payer.page.getByRole("heading", { name: "Payment verified on Base Sepolia" })).toBeVisible({
    timeout: 30_000,
  });
  await payer.context.close();
});

test("a transaction hash for a different request is rejected and the request stays open", async ({ page, browser, request }) => {
  const freelancer = await seedFreelancer();
  await signIn(page, freelancer.email, freelancer.password);
  const first = await createRequestViaUi(page, "10");
  const second = await createRequestViaUi(page, "10");

  // Pay the first request.
  const payer = await openAsPayer(browser, first.payUrl);
  await payer.page.getByRole("button", { name: "Connect wallet" }).click();
  await payer.page.getByRole("button", { name: "Switch to Base Sepolia" }).click();
  await payer.page.getByRole("button", { name: "Send 10.00 test USDC" }).click();
  await expect(payer.page.getByRole("heading", { name: "Payment verified on Base Sepolia" })).toBeVisible({
    timeout: 30_000,
  });
  const txHash = (await payer.page.locator("a[href*='/tx/']").first().textContent())!.trim();

  // Reuse the same evidence for the second request (same recipient and amount).
  const secondToken = second.payUrl.split("/pay/")[1];
  const origin = { origin: new URL(second.payUrl).origin };
  const submit = await request.post(`/api/pay/${secondToken}/attempts`, { data: { txHash }, headers: origin });
  expect(submit.status()).toBe(201);
  const verify = await request.post(`/api/pay/${secondToken}/verify`, { data: { txHash }, headers: origin });
  const { attempt } = await verify.json();
  expect(attempt.status).toBe("rejected");
  expect(attempt.errorCode).toBe("evidence_already_used");

  await page.goto(second.detailPath);
  await expect(page.getByText("Waiting for payment")).toBeVisible();
  await payer.context.close();
});
