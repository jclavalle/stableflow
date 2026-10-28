# StableFlow — mini PRD

Status: draft, 2026-10-28. Problem, users and metrics below are **assumptions to validate**, not research findings.

## Problem

LATAM freelancers paid by international clients may struggle to understand where a payment is, which network and fees apply, and how much could reach a local account. Traditional cross-border payments can involve FX fees, settlement delays and limited access to USD-denominated accounts. Stablecoin rails change some of these trade-offs but introduce others (wallet and network errors, off-ramp availability, stablecoin and smart-contract risk). They are not universally cheaper or faster.

## User

Camila (fictional persona): an independent designer in Brazil who invoices a US client in USD and budgets in BRL. She is comfortable with web apps but unfamiliar with wallet networks and gas. No interview has taken place.

## User stories

1. As a freelancer, I want to send my client a payment request in digital dollars so I know exactly what to expect.
2. As a client, I want to see the amount, token, network and recipient before I sign, so I don't send to the wrong place.
3. As a freelancer, I want to see when the payment is verified on-chain, separately from when it was merely submitted.
4. As a freelancer, I want to understand how much I would receive in BRL after each fee, with the gas cost shown separately.
5. As a freelancer, I want it to be unmistakable which parts are testnet or simulated.

## Scope

In: one freelancer, one payer, test USDC on Base Sepolia, exact single transfer per request, server-side receipt verification, illustrative USD→BRL quote, simulated payout. Out: real money, custody, swaps, bridging, bank integration, real KYC, tax computation. See `project-plan.md` §2 and §8.

## Learning targets (hypothesis, not results)

In five moderated walkthroughs, at least four participants complete request → simulated payout without help and correctly identify the test network, the simulated BRL amount and the separate gas cost. A sample of five is directional only.

## Candidate product metrics (for a real product, not measured here)

- Request-to-verified payment completion rate
- Transaction failure / rejection rate by reason
- Time from submission to verified confirmation
- Quote-to-payout conversion rate
- Comprehension: share of users who correctly identify fees and network

## Failure states to design for

Insufficient balance or gas, invalid recipient address, unsupported or wrong network, pending transaction, failed or replaced transaction, wrong token or amount, expired request or quote, off-ramp unavailable, KYC required, USDC depeg warning. Rationale for each is planned for PR 6.
