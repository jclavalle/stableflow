# Failure states — product rationale

Why each failure state exists, what the user sees, and what it protects against. Copy lives in `src/lib/payments/labels.ts`, `src/app/pay/[token]/PayWithWallet.tsx` and `src/lib/payouts/views.ts`.

Design rules applied throughout:

1. **Say what happened to the money.** Every error tells the payer whether anything was sent. "Nothing was sent" and "the USDC may still have arrived on chain" are different situations and say so.
2. **Never claim "paid" from the client.** Submitting a transaction is not payment. Only the server's on-chain check moves a request to confirmed.
3. **Offer a safe retry only when retrying is safe.** A declined signature can be retried. A transfer that went to the wrong place cannot be fixed by sending again.
4. **No refund promises.** The app cannot move funds, so it never says it will return them.

## Payer side

| State | Trigger | What the payer sees | Why |
| --- | --- | --- | --- |
| Wrong network | Wallet on any chain other than Base Sepolia | Alert plus a "Switch to Base Sepolia" button; Send is not offered | Sending on another chain would never reach this request. Blocking before signing is cheaper than explaining afterwards. |
| Insufficient funds | Balance below amount, or no test ETH for gas | "Not enough test USDC" / "No test ETH for gas" with faucet links | The most common first-time failure in the real smoke test was funding, not the app. |
| Declined signature | User rejects in the wallet | "You declined the transaction in your wallet. Nothing was sent; you can try again." | The user needs to know their funds did not move. |
| Pending | Transaction mined but under 3 confirmations or 30 s of chain time | Progress with confirmation count; resumes after reload | Base Sepolia makes 3 blocks in under a second, so a time floor was added after the real-network test (D38). |
| RPC unavailable | Server can't reach the chain | "We can't reach Base Sepolia to verify right now. Your transaction is saved." Checking retries with backoff | An outage says nothing about the payment, so the request stays pending rather than failing. |
| Reverted | Transaction failed on chain | "No USDC moved. You can try again." | Safe to retry because nothing moved. |
| Wrong amount / wrong recipient / no token transfer | Event doesn't match the request | Specific message; no retry promise | Funds may have moved somewhere. The message says why it can't be matched, without implying a refund. |
| Late / early | Transfer before creation or after expiry | "The USDC may still have arrived on chain, but it can't be matched to this request." | Truthful about funds while protecting against reusing old transfers. |
| Reused evidence | Same transfer submitted for a second request | "Already used to pay another request" | A database uniqueness constraint blocks it, so concurrent submissions can't both win. |
| Inactive link | Expired, cancelled or invalid token | "Do not send funds to an address from an inactive link." | A stale link shouldn't look like a payable address. |

## Freelancer side

| State | Trigger | What the freelancer sees | Why |
| --- | --- | --- | --- |
| No quote before verification | Request not confirmed | Quote button absent | A quote implies money exists to convert. |
| Quote expired | More than 5 min since quote | "This quote expired. Get a new quote." | Real FX quotes expire. The server's clock decides, not the browser's. |
| Duplicate simulation | Double click, two tabs, retries | Same simulation returned (idempotency key); one row per request | Duplicate payouts are the most expensive bug in a real off-ramp. |
| Evidence invalidated | Reorg or vanished transaction found by the re-check before quote or payout | "Under review — payment evidence changed on chain"; simulation stopped | A payout must not be based on a receipt that is no longer canonical. |
| Simulation complete | Normal path | "Simulation complete — no bank transfer occurred." | Even success says nothing real happened. |

## Real-network finding: smart-account payments

The first real payment (2026-10-29, MetaMask on Base Sepolia) was **rejected although the funds arrived**. MetaMask sent it through an EIP-7702 smart account and a relayer, so the transaction's `to` was not the USDC contract and its `from` was the relayer. The verifier, built to the plan's "direct transfer" rule and tested only with a fake wallet that sends direct transfers, said "wrong token contract".

From the user's side this is the worst failure: the money left and the app said it didn't. Julio decided to verify the **Transfer event** instead of the transaction envelope (D37). The real transaction then verified, and attempt 2 passed end to end.

Product lessons:

- Mocked wallets test the integration you imagined. Wallets change faster than plans; at least one real-wallet run belongs in every release.
- "The transfer arrived but we can't match it" is a state a payments product must design for, because it will happen.
- Fast L2 blocks broke the intuition behind "3 confirmations". Confirmation policy should be expressed in time or finality, not only block count.

## From the Airtm brief, not modeled

| State | Status |
| --- | --- |
| Invalid address | Not reachable. The payer never types an address; the recipient is fixed by the request snapshot. |
| Off-ramp unavailable | Not modeled. The simulation has no provider to fail. A real product would need a "funds received, payout delayed" state. |
| KYC required | Not modeled (no KYC). It would gate request creation or payout, not the on-chain payment, which the app can't block. |
| USDC depeg warning | Not modeled. The illustration treats 1 test USDC as 1 USD and says so; a real quote would need a price source and a threshold. |
