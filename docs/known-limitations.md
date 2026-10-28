# Known limitations

Updated with each PR. Nothing here is resolved unless marked so with evidence.

## Current state (PR 3 — payment requests)

- Built: sign-in, wallet linking, payment requests with immutable snapshot, one-time share link, regenerate/cancel, public payment page. Not built: in-app payment, chain verification, quote, payout simulation. The payment page shows the details but has no "pay" button yet.
- Payment links are shown once; a freelancer who loses one must regenerate it.
- No rate limit on public link lookups. 256-bit tokens cannot be enumerated, but the endpoint can still be hammered; acceptable for a demo.
- Request pages stream, so a request belonging to someone else returns HTTP 200 with "not found" content (no data shown); the JSON API returns a real 404.
- Database integration tests and auth E2E need a running local Supabase (`npx supabase start`); without it they are reported as skipped, not passed. CI always runs them.
- Wallet linking has unit tests (signature, replay, expiry) and database tests (atomic consume), but **no browser test with a wallet yet**; a deterministic wallet adapter for E2E is planned with PR 3/6. Not yet tried with a real wallet extension.
- Smart-contract wallets (ERC-1271/6492) cannot link; EOA wallets only.
- Hosted Supabase email confirmation flow (`/auth/callback`) is untested until a hosted project exists.
- The test USDC address and explorer URL are taken from the planning document and have not yet been re-verified on-chain (scheduled for PR 4).
- Not deployed. No Vercel project, Supabase project or DNS record has been created.

## By design (MVP)

- Testnet only. Test USDC has no value; no mainnet configuration exists.
- Fiat payout is a simulation with fictional FX and fees; no bank transfer occurs and no banking details are collected.
- An ordinary ERC-20 transfer carries no invoice identifier. Secret links, creation windows and unique-event checks reduce misuse but do not cryptographically bind a transfer to a request.
- Three block confirmations is a demo confidence policy, not a statement about settlement finality.
- No legal or compliance conclusion is made; see the compliance research register when it exists.
