import { expect, test } from "@playwright/test";

test("testnet disclosure is visible on the home page", async ({ page }) => {
  await page.goto("/");
  const banner = page.getByRole("region", { name: "Testnet disclosure" });
  await expect(banner).toContainText("no value");
  await expect(banner).toContainText("no bank transfer occurs");
});

test("home page fits a 360px viewport without horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
