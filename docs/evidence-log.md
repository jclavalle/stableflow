# Evidence log — Claude Code vs Codex comparison

StableFlow is built with Claude Code; FeedbackFlow is built with Codex. Different products, so outcomes are case studies, not a controlled ranking (see `project-plan.md` §16). Record failures as well as successes. Times are approximate unless stated.

## Kickoff

| Field | Value |
| --- | --- |
| Project | StableFlow |
| Tool | Claude Code, desktop app (Code tab) |
| Model | Claude Opus 5.5 (`claude-opus-5-5`) |
| Kickoff date | 2026-10-28 |
| Subscription / usage basis | _Julio to fill in_ |
| Frozen scope | `project-plan.md` as of 2026-10-28, plus PM artifacts from the Airtm conversation (see `decisions.md`) |
| Acceptance baseline | `project-plan.md` §11 checklist (all unchecked at kickoff) |

## Entries

| Date | PR / task | Prompt summary | Human interventions | Retries / failures | First-run result | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-10-28 | Setup | Read plan and Airtm conversation; propose first step | Chose repo location/visibility (public) | — | — | Claude surfaced scope gap between Airtm 10–12 h concept and 5-day plan. |
| 2026-10-28 | PR 1 foundation | Scaffold, config, banner, scripts, CI, docs | None during build | npm peer conflict (`@types/node` 20 vs Vitest 5) fixed by moving to Node 24 types; E2E first run hit a FeedbackFlow server already on port 3100, fixed by changing port and disabling server reuse | Lint, typecheck, unit (8), build, E2E (2) passed locally after fixes | CI result recorded in the PR. |
| 2026-10-28 | PR 1 CI | — | Julio merged PR 1 | — | CI `checks` and `secret-scan` passed on the PR (run 40757611913) | Julio approved `gh` workflow scope via device flow after a PATH issue in the terminal pane. |
| 2026-10-28 | PR 2 identity | Auth, wallet challenges, schema, RLS, atomic function | None during build | Two prerender failures under Next 16 Cache Components (config read before request data) fixed by reading request data first | Lint, typecheck, unit (19), build passed locally; DB integration (16) and auth E2E (2) skipped locally (no Docker) | CI result recorded in the PR. |
| 2026-10-28 | Local Docker | Set up OrbStack | Julio installed OrbStack (GUI) | — | `supabase start` applied migration cleanly; **DB integration 16/16 passed on first run**; auth E2E skipped until Playwright loaded `.env.local`, then 4/4 passed | Server log showed a Next.js "unstable `Date.now()` during prerender" error on `/account` while tests still passed; fixed with `connection()`. Caught only by reading server logs, not by test status. |
| 2026-10-28 | PR 3 requests | Requests, snapshot, share link, revoke/expire | None during build | Integration test caught `numeric(78,0)` silently rounding 1.5→2 (real defect, fixed in schema). Two E2E failures were test bugs (Next route-announcer `role=alert`; streamed page cannot send 404 status) | Unit 61, integration 31, E2E 7 passed locally; 0 server errors in E2E log | Started on top of unmerged PR 2 to save time. |
| 2026-10-28 | PR 4 verification | Direct transfer UI, server verification, idempotency, recovery | None during build | Lint error on a self-referencing polling callback (refactored to one effect). No test failures on first runs | `chain:check` OK on live Base Sepolia; unit 100 (38 verifier fixtures), integration 51, E2E 10 (mock chain + fake wallet), 0 server errors | Evidence reuse rejected by DB uniqueness (`evidence_already_used`) confirmed in DB, not only by test status. Manual testnet transfer pending (needs Julio's wallets). |
| 2026-10-29 | PR 5 payout simulation | Immutable quotes, deterministic fake payout, history, rule 9 re-check | None during build | TS target ES2017 rejected bigint literals (switched to `BigInt()`); first draft of the expired-quote integration test asserted nothing and was rewritten before running; scoped the mock-chain outage switch to one payer so the new parallel payout specs can't be disturbed | Unit 129, integration 72, E2E 13 passed locally on first runs | Plan example reproduced exactly (100 → BRL 490.05) in unit, DB and browser tests. Concurrency tests: 6 parallel simulations → exactly 1. |
| 2026-10-29 | Manual testnet smoke, attempt 1 | Real MetaMask payment on Base Sepolia | Julio installed MetaMask, created two accounts, added Base Sepolia, funded Payer via the Coinbase Developer faucet, signed up and paid | Payment rejected although funds arrived: MetaMask used an EIP-7702 smart account + relayer, which the plan's direct-transfer rule (and every mock-based test) did not anticipate | Defect found only by the real-network test | Julio chose to accept relayed transfers (D37). Verifier switched to event matching; unit 127, E2E 13 pass; the real transaction verifies under the new rules (live probe). |
| 2026-10-29 | Manual testnet smoke, attempt 2 | Real end-to-end run after D37 | Julio created the request, paid from MetaMask, took the quote and started the simulation | Quote was taken but simulation not yet started on the first "done" (caught by checking the database, not the user report) | Passed: verified 1.2 s after submission; BRL 3.68; one completed simulation | New finding: Base Sepolia ~0.2 s blocks make 3 confirmations sub-second (open question, not changed). |
