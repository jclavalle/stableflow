# StableFlow — Project Plan and Claude Code Handoff

Planning date: 2026-10-28  
Owner: Julio Lavalle  
Implementation lead: Claude Code  
Companion comparison project: FeedbackFlow on Codex  
Status: Planning only. This document does not establish that any application code, database, deployment, integration, or test has been built or run.

## 1. Provenance and decision labels

Use these labels throughout implementation and in subsequent decision records:

- **[R] Recovered context:** directly visible in the retrieved conversation or existing local reference material.
- **[U] User-required scope:** explicitly requested in the current handoff request. Included faithfully, but not represented as a verbatim recovery of unavailable earlier assistant messages.
- **[P] Proposed implementation:** a new, executable default supplied by this plan. Reversible defaults may proceed; unresolved external dependencies must remain explicit.
- **[O] Open question:** requires a decision or verification before the dependent release step.

**Recovery limitation:** The referenced chat, “Brainstorming Projects Recovery,” was retrieved using conversation ID `6ae24134-820c-83e9-830f-739a8a2f594a`. Its user messages were readable, but all assistant responses were returned as `chatgpt-content-reference` placeholders. Their full planning content could not be recovered. This file is therefore a transparent reconstruction from the user's requested scope plus new implementation proposals, not a transcript or a claim to contain every inaccessible historical detail.

**[R] Confirmed:** Julio wants to build two projects simultaneously, use one to gain Codex experience and compare it with Claude Code, consider costs, host under his existing website, and share a new planning file for StableFlow. Local project artwork depicts wallets linked by a transfer path and token; its accompanying notes explicitly describe conceptual illustrations, not product screenshots.

**[U] Required concept:** StableFlow serves LATAM freelancers using a USDC testnet journey; fiat payout is simulated. Use the specified stack, five implementation days and six PRs. Place StableFlow with Claude Code and compare against FeedbackFlow on Codex. Do not infer unavailable FeedbackFlow functionality.

Everything below marked **[P]** is a new proposed implementation decision, even where it elaborates a **[U]** concept.

## 2. Product problem, hypothesis, and learning goals

**[U] Concept:** Explore a stablecoin payment experience for LATAM freelancers receiving international payments and understanding their potential local-currency outcome.

**[P] Problem statement:** A freelancer may struggle to understand payment status, network requirements, conversion fees, and the amount that might reach a local account. These are product assumptions to validate, not established user-research findings.

**[P] Hypothesis:** A guided testnet payment request with independently verified receipt and a transparent simulated payout quote will help participants explain where their money is, what fees apply, and what remains simulated.

**[P] Proposed learning targets:** In five moderated walkthroughs, at least four participants complete the request-to-payout-simulation flow without facilitator intervention and correctly identify (a) the test network, (b) the simulated fiat amount, and (c) the separate gas cost. Record task completion, errors, time, and comprehension. These targets are not measured results and a sample of five is directional only.

**[P] MVP boundaries:** One freelancer, one payer, one token, one chain, one exact transfer per request, one illustrative USD/BRL corridor. No production money movement, custody, bridging, swap, lending, real invoices for tax purposes, bank integration, or custom smart contract.

## 3. Persona and end-to-end journey

**[U] Persona:** LATAM freelancer paid by an international client.

**[P] Working persona:** Camila, an independent designer in Brazil, invoices a US client in USD and budgets in BRL. She is comfortable with web apps but unfamiliar with wallet networks and gas. This is fictional; do not imply an interview occurred. English UI is the initial default; keep copy ready for later Portuguese/Spanish localization.

**[P] Journey:**

1. Camila signs in using Supabase Auth, reads the testnet disclosure, and links a dedicated test wallet by signing a short-lived challenge.
2. She creates a request for 100 test USDC. The app snapshots her verified recipient address and produces an unguessable public payment link.
3. The client opens a minimal public page showing amount, token, chain, recipient, and explicit no-value/testnet labels. It exposes no private profile or other requests.
4. The client connects a test wallet, switches to Base Sepolia, obtains test ETH and test USDC through linked faucets, and reviews the address and gas estimate.
5. The client signs one ERC-20 `transfer` in their wallet. StableFlow stores the transaction hash as a verification attempt; submission alone never means paid.
6. A server verifier checks the chain receipt and exact token Transfer event. The UI progresses through submitted, confirming, then confirmed after the configured confirmation policy.
7. Camila sees the verified receipt, a testnet explorer link, and an explanation of confirmations.
8. She requests an illustrative BRL quote, reviews fees and expiry, then explicitly starts a fake payout. It finishes with “Simulation complete — no bank transfer occurred.”
9. History separates blockchain evidence from simulated payout events. Refreshing or retrying does not duplicate a confirmation or payout.

## 4. Proposed stack and repository

**[U] Stack:** Next.js, TypeScript, Supabase, Base Sepolia, wagmi/viem, Vercel, Vitest, Playwright, GitHub Actions.

**[P] Responsibilities:**

| Component | Responsibility |
| --- | --- |
| Next.js App Router + TypeScript strict mode | Responsive pages, server routes, validation boundaries |
| Supabase Auth + Postgres | Identity, persistent requests, verification records, RLS |
| wagmi + viem | Client wallet connection/signing; server read-only chain verification |
| Base Sepolia | Valueless test USDC transfers; no mainnet fallback |
| Vercel | Preview and approved public demo hosting |
| Vitest | Amount math, quote math, verification rules, state transitions |
| Playwright | Deterministic browser journeys and access-control cases |
| GitHub Actions | Locked install, lint, type check, unit/integration tests, build, E2E |

**[P] Bootstrap:** Inspect an assigned repository and its instructions first. If empty, initialize Next.js with a supported Node LTS, choose mutually compatible stable dependencies, pin them with one package-manager lockfile, and record exact versions in README. Do not invent version compatibility in advance. Use npm unless the repository already standardizes another manager.

```text
src/app/                 pages and server routes
src/components/          shared accessible UI
src/lib/chain/           allowlist, ABI, receipt verifier
src/lib/auth/            sessions and wallet challenges
src/lib/payments/        request and state transition logic
src/lib/quotes/          pure fixed-point fee/FX calculations
src/lib/supabase/        server/client database adapters
supabase/migrations/     schema, constraints, RLS, functions
supabase/seed.sql        fictional development fixtures
tests/                   unit/integration fixtures
e2e/                     deterministic browser tests
docs/                    architecture, decisions, research, evidence
.github/workflows/       CI
```

## 5. Architecture and interfaces [P]

```text
Freelancer browser -> Supabase Auth -> Next.js authenticated routes -> Postgres + RLS
Payer browser -> public capability link -> minimal request projection
Payer wallet -> USDC transfer on Base Sepolia
Browser submits hash -> Next.js verifier -> trusted configured RPC -> atomic DB confirmation
Confirmed request -> server quote -> simulation-only payout state machine
```

The wallet signs locally. Server credentials never sign blockchain transactions. A wallet connection is not authentication and is not proof of wallet ownership until the challenge is verified. Browser state, explorer links, and client callbacks are not payment evidence.

| Route | Contract |
| --- | --- |
| `POST /api/wallet/challenge` | Authenticated; create one-use nonce bound to session, address, chain, domain, expiry |
| `POST /api/wallet/verify` | Verify signature, consume nonce atomically, link wallet |
| `POST /api/requests` | Owner creates positive fixed-precision amount and recipient snapshot |
| `GET /api/pay/:token` | Restricted public fields only; expired/revoked tokens fail closed |
| `POST /api/pay/:token/attempts` | Validate hash, enqueue/store candidate; throttle and cap attempts |
| `POST /api/pay/:token/verify` | Bounded read-only RPC checks; idempotent status refresh |
| `POST /api/requests/:id/quote` | Owner only; require confirmed receipt; create immutable quote |
| `POST /api/quotes/:id/simulate` | Owner only; unexpired quote; unique payout per request |
| `GET /api/requests/:id` | Owner-only history/status |

Do not rely on long-running serverless polling. Refresh through bounded requests with backoff and a manual retry button. Persist evidence so reloads can resume. RPC outage returns “verification unavailable/pending,” never success. No live RPC is required for deterministic CI.

## 6. Database design [P]

Use UUID primary keys, UTC timestamps, foreign keys, explicit status checks, and migrations. Money uses integer base units (`numeric(78,0)` for EVM values), not floating-point numbers. Serialize large integers as decimal strings in JSON. Normalize addresses consistently and validate their syntax on all writes.

| Table | Minimum columns and constraints |
| --- | --- |
| `profiles` | `id` references auth user; display_name; preferred_currency (BRL default); created_at |
| `wallet_challenges` | id, user_id, address, chain_id, nonce_hash UNIQUE, message/domain, expires_at, consumed_at; server-only |
| `wallets` | id, user_id, address, chain_id, verified_at; UNIQUE(chain_id,address) for MVP; no private keys |
| `payment_requests` | id, user_id, wallet_id, recipient_snapshot, amount_units > 0, chain_id, token_address, status, public_token_hash UNIQUE, expires_at, created_at; snapshot immutable after publication |
| `payment_attempts` | id, request_id, chain_id, tx_hash, status, error_code, last_checked_at; UNIQUE(request_id,chain_id,tx_hash); invalid attempt must not fail the request |
| `verified_receipts` | id, request_id UNIQUE, chain_id, tx_hash, log_index, block_number, block_hash, sender, recipient, amount_units, confirmations, verified_at; UNIQUE(chain_id,tx_hash,log_index) prevents reuse |
| `payout_quotes` | id, request_id, user_id, input_units, fee_units, fx_rate_scaled, fx_scale, spread_bps, output_minor, currency, assumptions_version, expires_at, created_at; immutable |
| `payout_simulations` | id, request_id UNIQUE, quote_id UNIQUE, user_id, status, idempotency_key UNIQUE, created_at, completed_at; always simulation=true |
| `audit_events` | id, user_id nullable, request_id, event_type, sanitized metadata, created_at; server append only |

**RLS and writes:** Enable RLS on every table. Owners may read their records; other users cannot. Public users get no table access: a server endpoint resolves a high-entropy capability token and returns only the payment projection. Store token hashes, redact raw tokens from logs, and provide revoke/regenerate behavior. Payment confirmation, quote creation and simulation transitions are server-only operations. Scope every server query to its authenticated owner or validated capability, since privileged credentials bypass RLS. Never trust user_id from request bodies.

Use one transactional database function to lock the request, insert unique verified evidence and change status. Use another to lock the request/quote and create a single simulation. Restrict function execution to the intended server role. Race tests must demonstrate that concurrent retries cannot reuse evidence or create two payouts.

## 7. States, transaction verification, and security [P]

**Request:** `open -> confirming -> confirmed`; allow `open -> expired/cancelled`. A rejected candidate leaves the request open. Separate attempt states: `submitted / pending / rejected / verified`. Recheck expiry at confirmation; proposed strict rule is no new confirmation after request expiry, with explanatory late-transfer UI. A transfer may still exist on-chain even when the app declines association.

**Chain allowlist:** Base Sepolia chain ID `84532`; official RPC `https://sepolia.base.org` is a development default. Circle's published test USDC address is `0x036CbD53842c5426634e7929541eC2318f3dCF7e`. Verify contract bytecode and expected six decimals at setup; fail closed on mismatch. Recheck official documentation before implementation. Never allow a browser-supplied RPC URL, chain, token or recipient to override the server allowlist.

**Receipt checks, all required:**

1. Validate hash syntax and that configured RPC reports the expected chain ID.
2. Retrieve transaction and successful receipt; missing receipt remains pending, failed receipt is rejected.
3. Decode logs only from the allowlisted USDC contract, using the ERC-20 Transfer ABI.
4. For MVP, require a direct token transfer: transaction destination is the token contract, decoded calldata is `transfer`, event sender equals transaction sender, and event recipient/amount exactly match the immutable request snapshot.
5. Require a matching Transfer log and persist its log index. Reject wrong token, wrong recipient, partial/overpayment, wrong chain, unrelated event, or malformed evidence.
6. Require the receipt block at or after request creation block (capture creation block before publishing the request), and matching on-chain timestamp within the request validity window. Never accept old payment evidence for a new request.
7. Proposed threshold: three block confirmations, computed consistently as head minus receipt block plus one. Re-fetch canonical block hash and receipt before committing. This is a demo confidence policy, not a claim of final settlement; document Base finality separately.
8. Atomically enforce receipt uniqueness across requests and request ownership/capability validity. Simultaneous checks return the existing result.
9. Before simulation, revalidate receipt/block canonicality. Reorganization or lost evidence places the request in a review/error state and blocks further simulation; preserve audit history.

**MVP association limitation:** An ordinary ERC-20 transfer carries no invoice identifier. A secret link, creation window and globally unique event reduce misuse but do not create a cryptographic invoice binding. Do not claim they do. Disallow ambiguous matching and document this limitation; stronger invoice binding is future scope.

**Additional controls:** Never collect seeds, private keys, bank credentials, identity documents, or real bank account details. Reject zero/invalid recipient addresses; freeze recipient after publishing. No approvals or unlimited allowances are needed for a direct transfer. Confirm network and recipient immediately before signing. Handle rejected signatures, switched accounts, replacement/cancelled transactions, insufficient gas, empty balances, RPC throttling, and dropped transactions with recoverable UI. Replacement hashes must pass the same checks.

Use short-lived single-use wallet challenges with replay protection and exact origin/domain binding; use a standard reviewed message/signature format supported by the chosen libraries. Apply CSRF/origin protections to cookie-authenticated mutations, server input validation, throttling, safe redirects, sanitized rendering and logs. Hide privileged Supabase and RPC keys from client bundles. Public database keys are safe only with tested RLS. Add secret scanning or an equivalent documented CI check. Do not collect production wallet history for analytics.

## 8. Fiat payout simulation and fee/FX model

**[U] Scope:** Illustrate a local-currency payout without sending fiat.

**[P] Behavior:** Only a verified request can create a quote. No tokens are burned, swapped, transferred to a platform wallet, or reserved. A simulation does not represent an actual balance debit. One simulation per request is a product constraint to prevent confusing repeated claims, not an accounting ledger.

Simulation states: `created -> processing -> completed_simulation`, or `failed_simulation`. Use deterministic server-side transition logic, with optional dev-only failure fixtures. Reload must resume persisted state; browser timers must not be authoritative. Label all screens, receipts and history entries “Simulated — no bank transfer.”

**[P] Illustrative assumptions, NOT live prices, promises, taxes, or provider quotes:**

| Input | Default |
| --- | --- |
| Test USDC/USD notional | 1.00 USD per test USDC, solely for arithmetic |
| USD/BRL reference | 5.00 BRL per USD, fixed fictional rate |
| Service fee | 0.5% of input notional |
| Fixed payout fee | 0.50 USD equivalent |
| FX spread | 1% haircut to reference rate |
| Quote validity | 5 minutes |
| Gas | Paid separately in test ETH by sender; exclude from BRL quote |

Use fixed-point integer arithmetic, round fees up to USDC base units and BRL output down to cents; specify rounding at each step. Reject input when fees consume the amount. Never silently clamp a negative payout to a plausible amount.

```text
service_fee = ceil(input_usdc_units * 50 / 10000)
fixed_fee = 500000 units
net_units = input_units - service_fee - fixed_fee
effective_brl_per_usd = reference_rate * (1 - 100 / 10000)
output_brl_minor = floor(net_units / 1e6 * effective_brl_per_usd * 100)
```

For 100 test USDC: variable fee 0.50, fixed fee 0.50, net 99.00; effective rate 4.95; output BRL 490.05. Display input, each fee, reference rate, spread, effective rate, output, expiry, assumptions version, and separate gas caveat. Do not describe testnet gas as representative of mainnet costs. No tax amount is computed; “not modeled” must not appear as “zero tax.”

## 9. Five-day implementation plan [P]

Five focused implementation days are a timebox and target, not a delivery guarantee. Keep security and truthful labeling when reducing scope. Open PRs incrementally; no fake screenshots, passing-test claims, or fabricated user validation.

| Day | Phase and work | Exit evidence |
| --- | --- | --- |
| 1 | Scaffold, typed config, testnet banner, auth, migrations, RLS, architecture decisions | Fresh install/build; migration reset; two-user isolation test |
| 2 | Wallet proof, create request, public capability page, expiry and revocation | Owner and payer flow; invalid input/access tests |
| 3 | Wallet transfer, server receipt verification, confirmations and retries | Fixture matrix passes; one documented manual testnet transfer if faucets/RPC available |
| 4 | Quote math, fiat simulation, history, disclosure and failure UX | Exact arithmetic tests, concurrency/idempotency tests, browser journey |
| 5 | Accessibility/mobile review, CI, deployment preparation, research notes, README, comparison evidence | CI green; preview smoke test; known limitations and unfinished tasks recorded |

If credentials or faucets are unavailable, finish deterministic fixtures and document the blocker. Mocked browser evidence cannot substitute for a real testnet smoke test; release notes must distinguish them.

## 10. Six PRs [P]

Every PR should explain the user-visible change, link relevant acceptance criteria, include actual validation output and screenshots where useful, and record unresolved limitations. Branch names below are suggestions. Each PR depends on the preceding merged baseline; do not merge unreviewed failing changes to satisfy the timebox.

| PR | Scope | Required acceptance evidence |
| --- | --- | --- |
| 1 — `chore/foundation` | Next.js/TS scaffold, environment template, CI skeleton, banner, repository docs | Clean locked install, lint, type check, build; no secrets |
| 2 — `feat/identity-data` | Auth, wallet challenges, schema, RLS, atomic function permissions | Signature replay/expiry tests; user A cannot read/write user B data |
| 3 — `feat/payment-requests` | Recipient snapshot, amount handling, share page, revoke/expire | Public projection minimal; invalid/expired tokens fail; precision tests |
| 4 — `feat/testnet-verification` | Direct transfer UI, server verification, idempotency and recovery | Valid receipt passes; all negative fixtures fail; concurrent evidence reuse blocked |
| 5 — `feat/payout-simulation` | Immutable quotes, deterministic fake payout, history | BRL 490.05 example; expired quote denied; duplicate simulation prevented |
| 6 — `chore/release-evidence` | E2E, accessibility, responsive fixes, research, deployment docs, benchmark log | CI results, preview smoke evidence, release checklist and limitations |

## 11. Acceptance checklist [P]

- [ ] Testnet and simulated-fiat disclosures persist across the complete flow, including errors and receipts.
- [ ] Sign-in works; wallet proof is session-bound, expires, and cannot be replayed.
- [ ] Positive values with at most six USDC decimals are parsed exactly; zero, negatives, exponent notation, excess precision, and oversized inputs fail clearly.
- [ ] Recipient and token/chain snapshots cannot be altered after publication.
- [ ] A payer can use a link without gaining access to private freelancer data.
- [ ] Wrong chain blocks signing; declined signatures and insufficient funds offer a safe retry.
- [ ] Submission never sets “paid.” Server checks reject spoofed, failed, wrong-token, wrong-recipient, wrong-amount, old, reused and noncanonical evidence.
- [ ] Pending checks recover after reload and bounded RPC failures; simultaneous retries remain idempotent.
- [ ] No quote or simulation is available before verification or after evidence invalidation.
- [ ] Fee/FX arithmetic matches the documented example, uses integers, and rejects expired quotes and duplicate simulations.
- [ ] Simulation receipts explicitly say no bank transfer occurred and collect no real banking details.
- [ ] Two authenticated users are isolated by both application checks and database policies.
- [ ] Keyboard navigation, meaningful focus, field labels, readable contrast, status announcements and 360px mobile layout work.
- [ ] Deterministic tests run without live secrets/RPC; a real testnet smoke test is recorded separately or marked blocked.
- [ ] Deployment uses HTTPS, correct auth callbacks, isolated secrets and no mainnet configuration.
- [ ] README explains setup, migrations, fixtures, tests, limitations and actual deployment status.

## 12. Test and evidence strategy [P]

Vitest covers fixed-point parsing/rounding, quote expiry, signed challenge verification, allowed state transitions, receipt decoding, chain mismatch, reverted/pending receipts, wrong event fields, confirmation boundary and reorg detection. Database integration tests cover RLS and concurrent confirmation/simulation writes against a disposable local Supabase database.

Playwright covers freelancer sign-in/create, public request display, a deterministic wallet adapter and mocked RPC for successful/failed/pending transfer flows, quote/simulation/history, reload recovery, and cross-user denial. Confine adapters and fixture hooks to test builds; production must refuse test override settings. Do not require a browser extension or faucet in CI.

Proposed scripts: `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, `npm run build`, `npm run test:e2e`. Define these scripts in PR 1 rather than assuming they exist. CI installs locked dependencies, provisions the test database, applies migrations, and runs the suite. Preview deployment must not expose production secrets to untrusted pull requests.

Record commit SHA, exact commands, timestamps, pass/fail output, and whether network calls were mocked. Capture a manual testnet transaction hash only after it exists. Maintain `docs/known-limitations.md` and never mark unchecked acceptance items complete.

## 13. Compliance research workstream [U/P]

**[U] Required:** Include compliance research. **[P] Deliverable:** `docs/compliance-research.md`, an issue register rather than legal clearance. No jurisdiction-specific legal conclusion is asserted here.

Research Brazil as the proposed first corridor; other LATAM countries require their own assessment. For each topic, record jurisdiction, business activity assumption, official regulator/source URL, publication/effective date, date checked, findings, unknowns, owner and required follow-up. Consult current primary sources from Banco Central do Brasil, Receita Federal, CVM where applicable, ANPD, and relevant US authorities for a US payer scenario.

Questions to resolve before any real-money design:

- Does the intended operating model constitute payment, remittance, FX, virtual-asset or custody activity, and which entities would need authorization or licensed partners?
- What KYC/AML, sanctions, transaction monitoring and record retention obligations apply to each participant and provider?
- What reporting, tax and potential FX/IOF treatment applies? Do not infer that a simulated fee schedule represents tax treatment.
- How should LGPD duties, lawful basis, retention/deletion, international transfers and public wallet-address linkage be handled?
- Which disclosures, complaints processes, consumer protections and marketing restrictions apply?
- What provider eligibility, geographic restrictions, USDC terms and bank/off-ramp requirements constrain a later product?

A testnet prototype does not establish an exemption or production readiness. Keep findings separate from implementation assumptions. Real-money scope requires a new design and qualified review; do not add live off-ramp credentials to this MVP.

## 14. $0 incremental prototype budget and caveats

**[U] Target:** $0 incremental infrastructure spend using free tiers and the existing domain.

**[P] Planning model:**

| Item | Target incremental spend | Conditions / caveats |
| --- | --- | --- |
| Next.js, TypeScript, wagmi/viem, test tools | $0 software license spend | Review dependency licenses; developer time excluded |
| Vercel | $0 eligible personal demo | Hobby is restricted to noncommercial personal use; confirm eligibility and limits before hosting |
| Supabase | $0 within Free plan | Account limits, project availability, resource quotas, inactivity behavior and email constraints must be checked |
| GitHub Actions | $0 within account allowance | Private-repository minutes/storage can be limited; use retention and bounded runs |
| Base Sepolia test ETH / test USDC | $0 intended via faucets | Valueless assets; faucets and RPCs may throttle or become unavailable |
| FX and payout provider | $0 | Fixed fictional FX and local simulation; no paid APIs |
| Domain/subdomain | $0 incremental if existing plan supports DNS | Existing domain registration/renewal and any DNS charges are excluded |
| Claude Code / Codex | Excluded from infrastructure target | Existing subscriptions, token usage or overages may cost money |

$0 is a constrained target, not a guaranteed total project cost. Do not enable paid upgrades, billing, paid RPCs, live money movement or usage-based services silently. If a free tier blocks progress, document a local/mock fallback and the actual blocker. Avoid adding cron/background services solely for polling.

Provider policies were checked against the official pages below on 2026-10-28; recheck exact quotas and terms at setup rather than freezing changing numeric limits in this document:

- [Vercel Hobby policy](https://vercel.com/docs/plans/hobby)
- [Supabase pricing](https://supabase.com/pricing)
- [GitHub Actions billing documentation — verify before enabling billable usage](https://docs.github.com/en/billing/concepts/product-billing/github-actions)

## 15. Deployment under juliolavalle.com

**[R]** Julio approved hosting both projects under his website. **[U]** Use a subdomain of `juliolavalle.com`. **[P]** Suggested hostname: `stableflow.juliolavalle.com`; confirm availability and existing DNS ownership before binding it.

1. Create a separate Vercel project for StableFlow with a preview URL first. Check free-plan eligibility.
2. Configure separate local, preview/test and public demo environments; avoid consuming unavailable free database projects. If sharing a demo database is necessary, document isolation and never use it for production data.
3. Set Supabase project URL/public key and server-only privileged key; set trusted server RPC, fixed chain/token allowlist, app URL, and simulation mode. Provide `.env.example` placeholders without credentials. Do not expose privileged keys using `NEXT_PUBLIC_`.
4. Configure Supabase Auth site URL and narrowly allowed callback URLs for local and approved deployed origins. Use host-only cookies to avoid cross-subdomain session sharing.
5. Run migrations and seed only fictional data; run preview smoke checks before DNS changes.
6. Add the subdomain in Vercel, then use the exact DNS record supplied for that account. Do not invent a target or change apex, mail or unrelated records. Confirm TLS and redirects.
7. Re-run the auth, payment-page, chain-verification and simulation smoke checks over HTTPS. Add a link from the portfolio only after the demo is actually available.
8. Rollback means reverting the application deployment and disabling new requests; schema migrations need a separate reviewed recovery plan. Keep testnet-only labels visible during incidents.

This planning task provisions nothing and changes no DNS. Missing access should leave deployment instructions and a preview-ready build, not a fabricated public URL.

## 16. Claude Code versus Codex evaluation

**[R] Goal:** Gain Codex experience and compare the tools. **[U] Assignment:** StableFlow on Claude Code; FeedbackFlow on Codex.

**[P] Method:** Record both as separate project case studies. Different products have different complexity, so outcome differences cannot establish a controlled model-performance ranking. Do not invent FeedbackFlow's scope; obtain its own acceptance baseline before comparison.

Use a shared evidence log containing project, tool/model/version, date, subscription/usage basis, prompt, task complexity, active human time, elapsed time, interruptions, retries, first-run test result, defects, manual edits and final artifact links. Freeze each project's scope at kickoff and log changes. Keep model/effort settings and available integrations recorded.

| Dimension | Evidence / scoring approach |
| --- | --- |
| Requirement completion | Percentage of predeclared acceptance criteria independently verified |
| Correctness and security | Severity-weighted review findings and unresolved defects |
| Testing | Meaningful cases and observed failures caught; do not reward raw test count |
| Implementation quality | Consistent 1–5 rubric for clarity, types, boundaries, migrations, maintainability |
| UX | Shared 1–5 rubric for responsiveness, accessibility, recovery and clear copy |
| Autonomy | Human intervention count, clarification quality, and manual repair time |
| Efficiency | Active human time, wall time and actual usage cost where available |
| Handoff quality | Fresh-clone setup success, reproducible tests, honest documentation |

For a stronger comparison, later assign the same small, isolated task to both tools with equivalent context and review it blind. No winner should be declared in this plan. Keep provider outages separate from tool-caused issues and record failed attempts as well as successes.

## 17. Open questions and safe defaults

| Question | Proposed default / dependency |
| --- | --- |
| What was in the unavailable original assistant planning? | Preserve this provenance notice; reconcile only if original text becomes available |
| Which repository and GitHub account? | Inspect assigned workspace; do not assume ownership or create external resources without access |
| First country/currency/language? | Brazil / BRL / English UI; other corridors remain future scope |
| Public hostname available? | Suggest stableflow.juliolavalle.com; verify DNS before binding |
| Does Vercel Hobby fit this demo's use? | Verify eligibility; keep local/preview alternative if not |
| Auth delivery and test users? | Supabase Auth with local test identities; verify email limits and callback setup |
| Sender/recipient wallets and faucet access? | Dedicated test wallets; never import personal keys into code |
| Confirmation/finality policy? | Three confirmations for demo UX; clearly document limitations |
| Exact amount vs partial payment? | Exact single transfer only; explain unmatched transfers without claiming refunds |
| Real off-ramp or banking? | Explicitly out of scope; simulation only |
| Actual user validation and FeedbackFlow baseline? | Pending; no measured claims until evidence exists |

## 18. Execution instructions for Claude Code [P]

Treat this file as planning input, subject to the user's current instructions and repository rules. Begin by inspecting the repository and reporting what already exists. Preserve unrelated files and synced reference materials. Create `docs/decisions.md` with this document's [R]/[U]/[P]/[O] distinctions and note deviations.

Implement the six PR scopes in order. Prefer the reversible defaults above for routine choices; ask only when a missing decision blocks dependent work or would introduce paid services, real funds, sensitive personal data, or material scope changes. Continue independent implementation while external access is missing. Never report an integration, test, deployment, user interview, or PR as completed without evidence.

Definition of done: reviewed source and migrations, verified acceptance evidence, reproducible setup, CI results, an honest limitations/research register, and an accessible testnet demo if hosting access permits. If something remains blocked, deliver the working subset and exact remaining steps without changing its status to complete.

## 19. Technical sources and verification notes

These sources support current network/provider facts, not claims about the unavailable earlier conversation:

- [Circle USDC contract addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses): Base Sepolia test token address; testnet assets have no financial value or USD backing.
- [Base network details](https://docs.base.org/get-started/connect-to-base): Base Sepolia chain ID, RPC and explorer.
- [Circle testnet faucet](https://faucet.circle.com): recheck availability and limits before the manual smoke test.
- [Vercel Hobby policy](https://vercel.com/docs/plans/hobby): personal, noncommercial eligibility caveat.
- [Supabase pricing](https://supabase.com/pricing): free-plan availability and changing limits.

Network address and chain details checked on 2026-10-28. Software versions, finality characteristics, regulatory questions, GitHub quotas and account-specific deployment eligibility require implementation-time verification. This file is a new planning artifact, not proof of a deployed financial product.
