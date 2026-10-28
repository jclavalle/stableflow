# Decision record

Labels follow [project-plan.md](project-plan.md) §1:

- **[R] Recovered context** — visible in a retrieved conversation or local reference material.
- **[U] User-required scope** — explicitly requested by Julio.
- **[P] Proposed implementation** — a reversible default from the plan or from implementation.
- **[O] Open question** — needs a decision or verification before the dependent step.

## Sources

| Source | What it is |
| --- | --- |
| `docs/project-plan.md` | Planning handoff dated 2026-10-28 (copied verbatim). Its own provenance notice says the earlier assistant planning could not be recovered. |
| `airtm_resume_blockchain_stableflow_conversation.md` (local, not committed) | Earlier conversation that first defined StableFlow as a PM portfolio project for an Airtm Product Manager application. Read on 2026-10-28. Only the StableFlow sections are summarized here; resume content is out of scope. |

## Recovered context from the Airtm conversation [R]

- Purpose: show hands-on understanding of stablecoin payment infrastructure **from a Product Manager perspective**, not to build a production wallet.
- Scenario: a Brazilian freelancer receives US$1,000 in USDC from a US client and can later withdraw to BRL.
- Original timebox: 10–12 hours over two days.
- Suggested test network: Stellar "or another selected test network".
- PM artifacts called out: `docs/PRD.md`, failure states (insufficient balance, invalid address, unsupported network, pending, failed, off-ramp unavailable, KYC required, USDC depeg warning), architecture diagram showing where KYC/AML, FX pricing, confirmation, monitoring and reconciliation occur, and a traditional-vs-stablecoin rail comparison that does not claim stablecoins are universally cheaper or faster.
- Narrative: MiBolsillo (crypto products inside a marketplace) → Conecta Pro (Open Finance, KYC) → StableFlow (hands-on wallets, USDC, rails).

## Deviations between the Airtm conversation and the project plan

| Topic | Airtm conversation [R] | Project plan [U/P] | Decision |
| --- | --- | --- | --- |
| Network | Stellar or other testnet | Base Sepolia | **Base Sepolia** [U] — plan's specified stack; Airtm text left the network open. |
| Scope / time | 10–12 h | 5 days, 6 PRs | **[O]** Plan scope is ~3–4× larger. Proceeding with the plan; Julio to say if an Airtm deadline requires a reduced cut. |
| Money model | Held USDC balance, later withdraw | Request → verified receipt → one simulated payout; no balance | **Plan model** [P]. Avoids implying custody. |
| Example amount | US$1,000 | 100 test USDC | **Plan example** for tests (BRL 490.05); UI may show any amount. |
| PM artifacts | PRD, failure states, rail comparison, architecture | Compliance register, research notes | **Both** [P]: PRD added in PR 1; failure-state rationale, rail comparison and architecture diagram scheduled for PR 6. |

## Implementation decisions

| # | Label | Decision | Date |
| --- | --- | --- | --- |
| D1 | [U] | Separate repository `jclavalle/stableflow` (public), outside the portfolio repo. Local path `~/Downloads/stableflow`. | 2026-10-28 |
| D2 | [P] | Node 24 LTS (`.nvmrc`, `engines`), npm with one lockfile, all direct dependencies pinned to exact versions (see README). | 2026-10-28 |
| D3 | [P] | Next.js 16 App Router from `create-next-app`, `src/` layout, Tailwind 4, TypeScript strict. Scaffold defaults (`cacheComponents`, Turbopack CSS rule) kept. | 2026-10-28 |
| D4 | [P] | Chain ID, token address/decimals and explorer are **code constants** (`src/lib/chain/allowlist.ts`), not environment variables, so no deployment setting can switch to mainnet. | 2026-10-28 |
| D5 | [P] | Server config is validated with zod and fails closed: `FIAT_PAYOUT_MODE` must equal `simulation`; URLs must be https except localhost; startup refuses secret-looking `NEXT_PUBLIC_*` names. | 2026-10-28 |
| D6 | [P] | Testnet disclosure banner rendered from the root layout so it persists on every page. | 2026-10-28 |
| D7 | [P] | E2E runs against a production build on port 3217 with `reuseExistingServer: false`. Port 3100 was already in use locally by a FeedbackFlow server, which made a reused-server run test the wrong app. | 2026-10-28 |
| D8 | [P] | `test:integration` passes with no tests until PR 2 adds local Supabase; this is reported as "no tests yet", not as passing coverage. | 2026-10-28 |
| D9 | [P] | Secret scanning in CI via gitleaks, in addition to GitHub's default secret scanning on public repos. | 2026-10-28 |
| D10 | [P] | **Migrations per PR** rather than the whole §6 schema up front: PR 2 adds `profiles`, `wallet_challenges`, `wallets`, `audit_events`; payment tables arrive with the PRs that use them. Deviation from plan §9 Day 1 wording, for reviewability. | 2026-10-28 |
| D11 | [P] | Sign-in uses Supabase email + password (deterministic for tests; email confirmation via `/auth/callback` when enabled on the hosted project). Magic links remain an option. | 2026-10-28 |
| D12 | [P] | Wallet proof uses Sign-In with Ethereum (EIP-4361) via `viem/siwe`: message bound to app domain/origin, chain 84532, single-use nonce, 5-minute expiry. Server stores only the nonce hash plus the exact message and requires an exact match. | 2026-10-28 |
| D13 | [P] | Signature check is EOA-only (`ecrecover`, no RPC). Smart-contract wallets (ERC-1271/6492) are not supported for linking in the MVP. | 2026-10-28 |
| D14 | [P] | Challenge consumption and wallet linking happen in one `link_wallet` Postgres function under a row lock, executable only by `service_role`. `user_id` always comes from the verified server session. | 2026-10-28 |
| D15 | [P] | Clients get `SELECT` on their own rows only; all writes are server-side. `anon` has no table grants. `audit_events` is append-only via trigger, including for the service role. | 2026-10-28 |
| D16 | [P] | Cookie-authenticated mutations require an exact `Origin` match with `APP_URL` (CSRF guard). Challenge creation is throttled to 5 per user per 10 minutes, counted in the database (no in-memory state on serverless). | 2026-10-28 |
| D17 | [P] | Docker via **OrbStack** on the development Mac (Apple silicon, 8 GB RAM; lighter than Docker Desktop, free for personal use). Local Supabase runs there; CI also runs a disposable local Supabase. No hosted Supabase project created. | 2026-10-28 |
| D18 | [P] | Server Supabase user client calls `connection()` before creation: under Cache Components the client reads the clock on construction, which Next.js rejects during prerendering. Playwright loads `.env*` via `@next/env` so local runs use the same configuration as `next start`. | 2026-10-28 |

## Open questions [O]

| Question | Needed by | Default until answered |
| --- | --- | --- |
| Is there an Airtm application deadline that should shrink scope? | Now | Follow the six-PR plan. |
| Verify Base Sepolia test USDC address, decimals and bytecode against Circle docs and on-chain. | PR 4 | Constant from plan, checked 2026-10-28 per plan. |
| Explorer: `sepolia.basescan.org` vs Base's own explorer. | PR 4 | `sepolia.basescan.org`. |
| Supabase project: free-plan availability for an additional project. | PR 6 (hosting) | Local Supabase in CI; no hosted project yet. Check limits before creating one. |
| Vercel Hobby eligibility for this demo. | PR 6 | Preview build only. |
| `stableflow.juliolavalle.com` DNS ownership and availability. | PR 6 | No DNS changes. |
