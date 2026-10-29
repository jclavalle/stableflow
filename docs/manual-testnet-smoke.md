# Manual testnet smoke test (Base Sepolia)

Status: **passed on 2026-10-29 (attempt 2)**, except the manual negative check in step 9, which was not run by hand (it is covered by E2E on the mock chain and by the database uniqueness constraint). Attempt 1 found a defect, fixed by D37. Automated E2E uses a mock chain; this checklist produces real-network evidence. Record results in the table at the end. Never record private keys or seed phrases anywhere.

## Prerequisites (Julio)

- A browser wallet extension (e.g. MetaMask, Coinbase Wallet, Rabby) with **two dedicated test accounts**: *Freelancer* and *Payer*. Never use an account holding real funds.
- Base Sepolia added to the wallet (chain ID 84532, RPC `https://sepolia.base.org`).
- Payer funded from faucets: test USDC from https://faucet.circle.com (select Base Sepolia) and a little Base Sepolia ETH for gas from a faucet listed at https://docs.base.org/get-started/get-funds.
- Local app running against the real RPC: `npx supabase start`, `.env.local` with `BASE_SEPOLIA_RPC_URL=https://sepolia.base.org`, then `npm run build && npm run start`.

## Steps

1. `npm run chain:check` passes.
2. Sign up, open **Account**, link the *Freelancer* wallet (signature only, no gas).
3. **Requests** → create a request for a small amount (e.g. `1.25`). Copy the payment link.
4. In a private window (or another browser profile) with the *Payer* account, open the link.
5. Connect, switch to Base Sepolia if asked, confirm the recipient and amount match, send.
6. Watch the page go *Submitted → Found on chain → Confirming → Payment verified*. Note the time to verification.
7. Open the explorer link; confirm token, from, to and amount on the explorer.
8. As the freelancer, open the request: status *Payment confirmed on testnet*, verified receipt shown.
9. Negative check: create a second request for the same amount, and on its link submit the step-6 transaction hash via the browser console or API — it must be rejected (`evidence_already_used`).
10. On the confirmed request, **Get illustrative BRL quote**: check each fee, the 4.95 effective rate and the "Simulated — no bank transfer" label (for 1.25 test USDC: fee 0.006250 + 0.50, net 0.743750, BRL 3.68).
11. **Start simulated payout**: it re-checks the transaction on the real chain, then shows "Simulation complete — no bank transfer occurred." History lists blockchain and simulated events separately.

## Results

| Date (UTC) | Commit | Tx hash | Amount | Time to verified | Explorer matches | Negative check | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-10-29 | 067e9f5 | `0xe4ae817323cae4b908e552d2c2453a804a04727665ad1300afe26a5bca365fba` | 1.50 | — (rejected) | Yes: one test-USDC Transfer Payer → Freelancer, 1.50, block 51,920,270 | — | MetaMask sent an EIP-7702 smart-account transaction via a relayer; the direct-transfer rule rejected it (`wrong_token_contract`). Funds arrived. Led to D37. |
| 2026-10-29 | f644452 | `0x93eb78191694c6aca492e2e69070183c03b405a3f5ce2cc5e23e9b936a30d143` | 1.25 | 1.2 s from hash submission to verified (block mined 20:40:28Z, verified 20:40:30.8Z, 12 confirmations) | Yes: block 51,922,797 canonical; one test-USDC Transfer Payer → Freelancer, 1.25 (relayed by MetaMask, accepted under D37) | Not run by hand | Quote BRL 3.68 (`illustrative-2026-10.1`) matched the documented formula; one simulation created → processing → completed_simulation in 4.9 s; history separated chain and simulated events. No server errors. |
