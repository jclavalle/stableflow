# Traditional vs stablecoin rails — for a freelancer in Brazil paid from the US

A product comparison for framing, not a cost study. No figures here are measured. Real costs depend on provider, corridor, amount, account type and date, and should be quoted from providers before any claim is made. Stablecoin rails are **not** universally cheaper or faster; they move costs and risks to different places.

## Scenario

A US client owes a Brazilian freelancer for a project. The freelancer wants BRL in a Brazilian bank account.

## Comparison

| Dimension | International wire (SWIFT) | Payment platform / remittance app | Stablecoin rail (USDC on an L2 + off-ramp) |
| --- | --- | --- | --- |
| Who the payer needs | A bank account that sends international wires | An account on the platform | A funded wallet, the right network, gas, and the stablecoin itself |
| Where cost appears | Sending fee, possible intermediary fees, receiving fee, FX spread at conversion | Platform fee, FX spread (often in the rate rather than as a line item) | Network gas (small on L2s but not zero), on-ramp fee for the payer, off-ramp fee and FX spread for the freelancer, possible withdrawal fees |
| Speed of the transfer leg | Business days; cut-offs and holidays apply | Often fast once both sides are verified | Seconds to minutes on chain, 24/7 |
| Speed to spendable BRL | Includes bank processing | Depends on the platform's payout | Bounded by the **off-ramp**, not the chain. Fast on-chain settlement does not mean fast BRL. |
| Transparency | Intermediary fees can be hard to predict | Varies; "no fee" offers may sit in the rate | On-chain leg is publicly verifiable; FX and off-ramp costs are as opaque as the provider makes them |
| Failure modes | Returned wires, wrong beneficiary details, compliance holds | Account holds, verification requests | Wrong network, wrong token, wrong address are often unrecoverable; smart-wallet and relayer differences (found in this project's real test); depeg and issuer risk; off-ramp unavailable |
| Reversibility | Recalls possible but not guaranteed | Platform-dependent disputes | No protocol-level reversal; recovery depends on the recipient or the issuer's freeze powers |
| Holding USD | Usually needs a USD account | Some platforms offer balances | Holding USDC is possible, with issuer, custody and regulatory risk instead of bank deposit protection |
| Regulatory picture in Brazil | Mature FX framework through authorized institutions | Operates through licensed entities or partners | Since 2 Feb 2026, BCB treats fiat-referenced virtual-asset operations and international payments with virtual assets as FX market operations (Res. BCB 521/2025; see the [register](compliance-research.md)). This narrows the regulatory difference from traditional rails. |

## What this means for the product

- **The chain is the easy part.** In the prototype the on-chain leg verified in about a second. Everything that makes the money usable (KYC, off-ramp, FX, reporting) sits off chain and dominates the real cost and time.
- **The payer's experience is the adoption risk.** A US client who has never held USDC needs an on-ramp, a wallet, gas and the right network before paying. A wire asks for none of that.
- **The value is predictability, when it exists:** a known on-chain amount, a public receipt, and 24/7 movement. It matters most where traditional receiving is slow or unpredictable, and only if the off-ramp is reliable.
- **Brazil's 2026 FX treatment** means a stablecoin product for this corridor is regulated much like an FX product. "Crypto is outside the system" is not a valid product assumption.

## What would make this comparison quantitative

Collect, for the same amount and date: the all-in BRL received through each route, time from payer action to spendable BRL, and the steps each side took. Use real provider quotes and record their date and source. None of this has been collected yet.
