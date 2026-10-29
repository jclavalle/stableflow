# StableFlow

Prototype of a stablecoin payment flow for LATAM freelancers: a freelancer requests test USDC on **Base Sepolia**, the payment is verified on-chain by the server, and a **simulated** BRL payout shows what might reach a local account after fees.

> **Testnet only.** Test USDC has no value. Fiat payout is simulated — no bank transfer occurs. Not a financial product.

## Status

| Area | State |
| --- | --- |
| Foundation (PR 1) | Merged |
| Auth, schema, RLS (PR 2) | Merged |
| Payment requests (PR 3) | Merged |
| Testnet verification (PR 4) | Merged |
| Payout simulation (PR 5) | In review |
| Release evidence, deployment (PR 6) | Not started |
| Deployment | **Not deployed** |

See [docs/known-limitations.md](docs/known-limitations.md) for what is and isn't built.

## Setup

Requires Node 24 (`.nvmrc`) and npm. The database needs Docker for local Supabase (OrbStack or Docker Desktop).

```bash
npm ci
npx supabase start          # needs Docker; applies supabase/migrations
cp .env.example .env.local
npx supabase status         # copy API URL, anon key, service_role key into .env.local
npm run dev
```

Reset the local database and re-apply all migrations with `npx supabase db reset`.

To run database tests locally, export the same values as `SUPABASE_TEST_URL`, `SUPABASE_TEST_ANON_KEY` and `SUPABASE_TEST_SERVICE_ROLE_KEY`. Stop the stack with `npx supabase stop`.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run lint` | ESLint (Next.js core-web-vitals + TypeScript rules) |
| `npm run typecheck` | Generates Next.js route types, then `tsc --noEmit` |
| `npm run test:unit` | Vitest unit tests in `tests/unit` |
| `npm run test:integration` | Vitest database tests (RLS, privileges, `link_wallet`) against local Supabase. Needs `SUPABASE_TEST_URL`, `SUPABASE_TEST_ANON_KEY`, `SUPABASE_TEST_SERVICE_ROLE_KEY`; skipped without them, required in CI |
| `npm run build` | Production build |
| `npm run chain:check` | Read-only check of chain ID, USDC bytecode, symbol and decimals against the live (or given) RPC |
| `npm run test:e2e` | Playwright against the production build on port 3217 (run `npm run build` first; `npx playwright install chromium` once). Auth tests need the Supabase variables |

No live secrets, wallet extension, faucet or RPC are needed for the test suite: E2E starts `e2e/mock-rpc.mjs` (a local stand-in for Base Sepolia on port 8546) and installs a fake browser wallet. Mock-chain results are not evidence of real-network behaviour; see `docs/manual-testnet-smoke.md`.

## Pinned versions

Recorded 2026-10-28; `package-lock.json` is authoritative.

| Package | Version |
| --- | --- |
| Node | 24 (24.21.0 locally) |
| next / eslint-config-next | 16.4.3 |
| react / react-dom | 19.3.0 |
| typescript | 5.9.3 |
| tailwindcss | 4.3.3 |
| zod | 4.6.7 |
| @supabase/supabase-js / @supabase/ssr | 2.118.0 / 0.12.7 |
| supabase (CLI) | 2.122.0 |
| viem / wagmi | 2.57.13 / 3.7.9 |
| @tanstack/react-query | 5.105.0 |
| vitest | 5.0.5 |
| @playwright/test / @next/env | 1.64.1 / 16.4.3 |
| eslint | 9.39.5 |

## Docs

- [Project plan](docs/project-plan.md) — scope, architecture, six-PR plan, acceptance checklist
- [Decisions](docs/decisions.md) — [R]/[U]/[P]/[O] decision record and open questions
- [PRD](docs/PRD.md) — problem, user, stories, metrics (assumptions, not research)
- [Known limitations](docs/known-limitations.md)
- [Evidence log](docs/evidence-log.md) — Claude Code vs Codex comparison notes

## Layout

```text
src/app/             pages and server routes
src/components/      shared UI (testnet banner)
src/lib/auth/        wallet challenge (SIWE) build/verify
src/lib/chain/       allowlist, receipt verifier, server RPC reader
src/lib/config/      validated server configuration
src/lib/payments/    amount parsing, link tokens, public projection
src/lib/supabase/    user (RLS) and admin (service role) clients
src/lib/wallet/      wagmi config (client-side connection only)
src/proxy.ts         session refresh
supabase/            local config and migrations
tests/unit/          Vitest unit tests
tests/integration/   database tests (PR 2+)
e2e/                 Playwright browser tests
docs/                plan, decisions, PRD, limitations, evidence
.github/workflows/   CI
```
