import { randomBytes } from "node:crypto";

import { expect, type Browser, type Page } from "@playwright/test";

import { installFakeWallet } from "./fake-wallet";
import { createRequestViaUi, seedFreelancer, signIn } from "./seed";

/** Freelancer creates a request; a payer pays it with the fake wallet; returns once verified. */
export async function paidRequest(page: Page, browser: Browser, amount: string) {
  const freelancer = await seedFreelancer();
  await signIn(page, freelancer.email, freelancer.password);
  const { payUrl, detailPath } = await createRequestViaUi(page, amount);

  const context = await browser.newContext();
  const payer = await context.newPage();
  await installFakeWallet(payer, { account: `0x${randomBytes(20).toString("hex")}`, chainId: 84532 });
  await payer.goto(payUrl);
  await payer.getByRole("button", { name: "Connect wallet" }).click();
  await payer.getByRole("button", { name: /Send .* test USDC/ }).click();
  await expect(payer.getByRole("heading", { name: "Payment verified on Base Sepolia" })).toBeVisible({ timeout: 90_000 });
  const txHash = (await payer.locator("a[href*='/tx/']").first().textContent())!.trim();
  await context.close();

  await page.goto(detailPath);
  await expect(page.getByText("Payment confirmed on testnet")).toBeVisible();
  return { freelancer, payUrl, detailPath, txHash, requestId: detailPath.split("/").pop()! };
}
