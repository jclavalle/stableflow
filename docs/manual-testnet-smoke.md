# Manual testnet smoke test (Base Sepolia)

Status: **not yet run.** Automated E2E uses a mock chain; this checklist produces real-network evidence. Record results in the table at the end. Never record private keys or seed phrases anywhere.

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
| | | | | | | | |
