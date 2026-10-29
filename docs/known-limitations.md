# Known limitations

Updated with each PR. Nothing here is resolved unless marked so with evidence.

## Current state (PR 5 — payout simulation)

- Built: sign-in, wallet linking, payment requests, public payment page with in-app wallet payment, server-side receipt verification with confirmations, owner receipt view, illustrative BRL quote, simulated payout, request history. Not built: release evidence, accessibility audit, deployment (PR 6).
- Real-network evidence: one end-to-end run on Base Sepolia with MetaMask (request → relayed smart-account payment → verified → quote → simulated payout) passed on 2026-10-29 (`docs/manual-testnet-smoke.md`). It is a single run with one wallet; other wallets are untested. Automated E2E uses a mock chain and a fake wallet that sends direct transfers only (D30).
- **Confirmation depth is now sub-second.** Base Sepolia produced ~5 blocks per second during the smoke test (523 blocks in ~104 s), so the plan's 3-confirmation policy is met in well under a second; the real payment had 12 confirmations 2.8 s after mining. The policy is therefore weaker than its wording suggests. A time-based minimum (or Base's safe/finalized head) is an open decision.
- Reorg handling is tested with unit fixtures and a mock-chain "transaction disappeared" case, not against a real Base Sepolia reorg.
- `under_review` is terminal: there is no admin tool to resolve a review in the MVP.
- If the owner leaves the page mid-simulation, it stays `created`/`processing` until they return (no background job); reopening the page resumes it.
- The quote countdown uses the browser clock for display only; a skewed clock may show a quote as valid that the server then refuses as expired (the server's answer wins).
- If the payer closes the tab before confirmation and nobody presses "Check payment status", the request stays `confirming`/`open` until someone checks (no background job, by design).
- A transfer that does not match (wrong amount, late, wrong network) is not refunded or reassigned by the app; the funds are on chain wherever they were sent.
- Payment links are shown once; a freelancer who loses one must regenerate it.
- No rate limit on public link lookups. 256-bit tokens cannot be enumerated, but the endpoint can still be hammered; acceptable for a demo.
- Request pages stream, so a request belonging to someone else returns HTTP 200 with "not found" content (no data shown); the JSON API returns a real 404.
- Database integration tests and auth E2E need a running local Supabase (`npx supabase start`); without it they are reported as skipped, not passed. CI always runs them.
- Wallet linking has unit tests (signature, replay, expiry) and database tests (atomic consume), but no browser test of the linking UI (E2E seeds linked wallets directly). Not yet tried with a real wallet extension.
- Smart-contract wallets (ERC-1271/6492) cannot link; EOA wallets only.
- Hosted Supabase email confirmation flow (`/auth/callback`) is untested until a hosted project exists.
- Not deployed. No Vercel project, Supabase project or DNS record has been created.

## By design (MVP)

- Testnet only. Test USDC has no value; no mainnet configuration exists.
- Fiat payout is a simulation with fictional FX and fees (assumptions version `illustrative-2026-10.1`); no bank transfer occurs, no tokens are moved or reserved, and no banking details are collected. Taxes are not modeled (shown as "not modeled", never as zero).
- Verification matches the token's Transfer event (D37), so any transaction that moves exactly the requested test USDC to the recipient — direct, smart-account or relayed — can satisfy a request once. An ordinary ERC-20 transfer carries no invoice identifier. Secret links, creation windows and unique-event checks reduce misuse but do not cryptographically bind a transfer to a request.
- Three block confirmations is a demo confidence policy, not a statement about settlement finality.
- No legal or compliance conclusion is made; see the compliance research register when it exists.
