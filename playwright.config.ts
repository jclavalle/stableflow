import { loadEnvConfig } from "@next/env";
import { defineConfig, devices } from "@playwright/test";

// Same .env files Next.js reads, so locally configured Supabase enables the
// auth tests. Variables already set (as in CI) take precedence.
loadEnvConfig(process.cwd());

const PORT = 3217;

// Runs against a production build (`npm run build` first). No wallet extension,
// faucet or live RPC is required.
export default defineConfig({
  testDir: "./e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    // Never reuse: another local app on the same port would make tests pass or fail falsely.
    reuseExistingServer: false,
    timeout: 60_000,
    env: { APP_URL: `http://localhost:${PORT}`, FIAT_PAYOUT_MODE: "simulation" },
  },
});
