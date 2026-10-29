import { loadEnvConfig } from "@next/env";
import { defineConfig, devices } from "@playwright/test";

// Same .env files Next.js reads, so locally configured Supabase enables the
// auth tests. Variables already set (as in CI) take precedence.
loadEnvConfig(process.cwd());

const PORT = 3217;
const MOCK_RPC_PORT = 8546;

// Runs against a production build (`npm run build` first). No wallet extension,
// faucet or live RPC is required: the app's server RPC points at a local mock
// chain, and tests install a fake EIP-1193 wallet that sends to it.
export default defineConfig({
  testDir: "./e2e",
  // Payments wait for the 30 s minimum confirmation age (D38) on the mock chain.
  timeout: 150_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `node e2e/mock-rpc.mjs`,
      url: `http://127.0.0.1:${MOCK_RPC_PORT}`,
      reuseExistingServer: false,
      env: { MOCK_RPC_PORT: String(MOCK_RPC_PORT) },
    },
    {
      command: `npm run start -- -p ${PORT}`,
      url: `http://localhost:${PORT}`,
      // Never reuse: another local app on the same port would make tests pass or fail falsely.
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        APP_URL: `http://localhost:${PORT}`,
        FIAT_PAYOUT_MODE: "simulation",
        BASE_SEPOLIA_RPC_URL: `http://127.0.0.1:${MOCK_RPC_PORT}`,
      },
    },
  ],
});
