# Known limitations

Updated with each PR. Nothing here is resolved unless marked so with evidence.

## Current state (PR 2 — identity and data)

- Built: email/password sign-in, account page, wallet linking by signed message, identity schema with RLS. Not built: payment requests, chain verification, quote, payout simulation.
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
