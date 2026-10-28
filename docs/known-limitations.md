# Known limitations

Updated with each PR. Nothing here is resolved unless marked so with evidence.

## Current state (PR 1 — foundation)

- Only a static home page and the testnet disclosure banner exist. No sign-in, database, wallet connection, payment request, chain verification, quote or payout simulation is built.
- `npm run test:integration` runs zero tests; database integration tests arrive with PR 2.
- The test USDC address and explorer URL are taken from the planning document and have not yet been re-verified on-chain (scheduled for PR 4).
- Not deployed. No Vercel project, Supabase project or DNS record has been created.

## By design (MVP)

- Testnet only. Test USDC has no value; no mainnet configuration exists.
- Fiat payout is a simulation with fictional FX and fees; no bank transfer occurs and no banking details are collected.
- An ordinary ERC-20 transfer carries no invoice identifier. Secret links, creation windows and unique-event checks reduce misuse but do not cryptographically bind a transfer to a request.
- Three block confirmations is a demo confidence policy, not a statement about settlement finality.
- No legal or compliance conclusion is made; see the compliance research register when it exists.
