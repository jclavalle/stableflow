import { randomBytes } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { installFakeWallet } from "./fake-wallet";
import { paidRequest } from "./flows";
import { createRequestViaUi, hasSupabase, seedFreelancer, signIn } from "./seed";

// Automated checks only: axe finds a subset of WCAG failures (roughly a third
// by most estimates). Screen-reader and manual keyboard review stay separate.
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const MOBILE = { width: 360, height: 740 };

/** Runs axe in light and dark schemes, then checks the 360px layout for horizontal scroll. */
async function audit(page: Page, label: string) {
  const original = page.viewportSize()!;
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    const summary = violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
    expect(summary, `${label} (${colorScheme})`).toEqual([]);
  }
  await page.emulateMedia({ colorScheme: "light" });

  await page.setViewportSize(MOBILE);
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    const wide = [...document.querySelectorAll("body *")]
      .filter((el) => el.getBoundingClientRect().right > root.clientWidth + 1)
      .map((el) => el.tagName.toLowerCase() + (el.id ? `#${el.id}` : ""))
      .slice(0, 5);
    return { scroll: root.scrollWidth - root.clientWidth, wide };
  });
  expect(overflow, `${label} at 360px`).toEqual({ scroll: 0, wide: [] });
  // Optional evidence for release notes: SCREENSHOT_DIR=docs/screenshots npm run test:e2e
  if (process.env.SCREENSHOT_DIR) {
    const file = label.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/360-${file}.png`, fullPage: true });
  }
  await page.setViewportSize(original);
}

test("signed-out pages pass automated accessibility and 360px checks", async ({ page }) => {
  await page.goto("/");
  await audit(page, "home");
  await page.goto("/sign-in");
  await audit(page, "sign-in");
  await page.goto(`/pay/${randomBytes(32).toString("base64url")}`);
  await expect(page.getByRole("heading", { name: "Payment link not available" })).toBeVisible();
  await audit(page, "inactive payment link");
});

test("sign-in works from the keyboard with a visible focus indicator", async ({ page }) => {
  test.skip(!hasSupabase, "No local Supabase configured");
  const freelancer = await seedFreelancer();
  await page.goto("/sign-in");

  // Tab from the top of the page until the email field has focus.
  const email = page.getByLabel("Email");
  for (let i = 0; i < 20 && !(await email.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press("Tab");
    const outline = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const style = getComputedStyle(el);
      return { tag: el.tagName, visible: style.outlineStyle !== "none" && style.outlineWidth !== "0px" };
    });
    expect(outline.visible, `focus indicator on ${outline.tag}`).toBe(true);
  }
  await expect(email).toBeFocused();
  await page.keyboard.type(freelancer.email);
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Password")).toBeFocused();
  await page.keyboard.type(freelancer.password);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/account$/);
});

test("signed-in pages, payment page and payout states pass automated checks", async ({ page, browser }) => {
  test.skip(!hasSupabase, "No local Supabase configured");

  // Open request: owner view and payer view before and after connecting.
  const owner = await seedFreelancer();
  await signIn(page, owner.email, owner.password);
  await audit(page, "account");
  const { payUrl, detailPath } = await createRequestViaUi(page, "3");
  await audit(page, "requests with new link");
  await page.goto(detailPath);
  await audit(page, "open request detail");

  const context = await browser.newContext();
  const payer = await context.newPage();
  await installFakeWallet(payer, { account: `0x${randomBytes(20).toString("hex")}`, chainId: 84532 });
  await payer.goto(payUrl);
  await audit(payer, "payment page");
  await payer.getByRole("button", { name: "Connect wallet" }).click();
  await expect(payer.getByRole("button", { name: /Send .* test USDC/ })).toBeVisible();
  await audit(payer, "payment page, wallet connected");
  await context.close();

  // Paid request: verified payer page, quote, completed simulation and history.
  const paid = await paidRequest(page, browser, "100");
  await audit(page, "confirmed request");
  await page.getByRole("button", { name: "Get illustrative BRL quote" }).click();
  await expect(page.getByText("BRL 490.05 (rounded down to the cent)")).toBeVisible();
  await audit(page, "quote");
  await page.getByRole("button", { name: /Start simulated payout/ }).click();
  await expect(page.getByText("Simulation complete — no bank transfer occurred.")).toBeVisible({ timeout: 20_000 });
  await audit(page, "completed simulation");

  const verified = await browser.newContext();
  const verifiedPage = await verified.newPage();
  await verifiedPage.goto(paid.payUrl);
  await expect(verifiedPage.getByRole("heading", { name: "Payment verified on Base Sepolia" })).toBeVisible();
  await audit(verifiedPage, "verified payment page");
  await verified.close();
});
