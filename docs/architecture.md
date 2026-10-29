# Architecture

What the prototype runs today, and where a real product would need controls that this MVP deliberately does not build. Boxes marked **not built** are product placeholders, not code.

## Built: request → verified receipt → simulated payout

```mermaid
flowchart LR
  subgraph Browser
    F[Freelancer<br/>signed in]
    P[Payer<br/>public link, no account]
    W[Payer's wallet<br/>MetaMask or other]
  end

  subgraph App["Next.js server (route handlers)"]
    REQ[Requests API<br/>amount parsing, snapshot]
    VER[Verifier<br/>Transfer event match,<br/>3 confirmations + 30 s]
    Q[Quote<br/>fixed fictional FX,<br/>integer math]
    SIM[Payout simulation<br/>state machine]
    RECHK[Evidence re-check<br/>before quote/simulation]
  end

  subgraph DB["Supabase Postgres"]
    T[(requests, attempts,<br/>receipts, quotes,<br/>simulations)]
    AUD[(audit_events<br/>append-only)]
  end

  RPC[Base Sepolia RPC<br/>server-side only]

  F -- create request --> REQ --> T
  P -- open link --> REQ
  P -- sign transfer --> W -- test USDC --> RPC
  P -- tx hash --> VER -- receipt, logs, blocks --> RPC
  VER -- confirm_payment() --> T
  F -- get quote --> Q --> RECHK --> RPC
  F -- start simulation --> SIM --> RECHK
  Q --> T
  SIM --> T
  T --> AUD
```

Trust boundaries:

- **Browser → server.** The browser never decides that a payment happened. A submitted transaction hash is only a pointer; the server reads the chain itself.
- **Server → chain.** One trusted RPC endpoint, set server-side. Chain ID, token address and decimals are code constants (D4), so no setting can point the app at mainnet.
- **Server → database.** Writes go through `service_role`-only Postgres functions that lock rows and re-check state. Owners can only read their own rows (RLS). Payers have no database access; the public page gets a minimal projection.
- **Simulation.** No tokens move, nothing is reserved and no bank details exist anywhere in the schema. `simulation boolean check (simulation)` makes a non-simulated payout row impossible to insert.

## Where a real product would add controls (not built)

The Airtm framing asked where KYC/AML, FX pricing, confirmation, monitoring and reconciliation occur. In a production rail they sit roughly here:

```mermaid
flowchart LR
  ON[Onboarding] --> KYC[KYC / KYB<br/><b>not built</b>]
  KYC --> REQ[Payment request]
  REQ --> SCR[Wallet & sanctions screening<br/><b>not built</b>]
  SCR --> PAY[On-chain payment]
  PAY --> CONF[Confirmation policy<br/><b>built: demo policy</b>]
  CONF --> MON[Transaction monitoring<br/>& travel rule<br/><b>not built</b>]
  MON --> FX[FX pricing<br/><b>built: fixed fictional rate</b>]
  FX --> OFF[Off-ramp via licensed partner<br/><b>simulated</b>]
  OFF --> REC[Reconciliation<br/>chain ↔ ledger ↔ bank<br/><b>partial: audit log only</b>]
  REC --> REP[Regulatory reporting<br/><b>not built</b>]
```

| Control | Prototype | What production would need |
| --- | --- | --- |
| KYC / KYB | None. Email sign-in only. | Identity verification for the freelancer (and possibly the payer), done by or with a licensed partner. See [compliance-research.md](compliance-research.md). |
| Sanctions / wallet screening | None. | Screen payer and recipient addresses and people before accepting funds; decide what happens to funds that arrive from a flagged address. |
| Confirmation | 3 blocks and ≥ 30 s chain time (D38). | A finality policy based on the L2's `safe`/`finalized` heads and the off-ramp's own deposit rules. |
| Transaction monitoring | None. | Rules and case management for unusual patterns; travel-rule data exchange with other providers where required. |
| FX pricing | Fixed fictional rate and fees (`illustrative-2026-10.1`). | Live rate from a licensed FX provider, quote lock with expiry (this part is built), disclosure of spread and taxes. |
| Off-ramp | Simulated state machine. | Licensed partner, payout to a verified local account, failure and return handling. |
| Reconciliation | Every state change writes an append-only audit event; evidence is re-checked before payout. | Three-way match of chain transfers, internal ledger and bank statements, with breaks investigated. |
| Reporting | None. | Whatever the operating model triggers (e.g., Receita Federal DeCripto, BCB FX reporting); see the register. |

## Code map

| Concern | Where |
| --- | --- |
| Chain allowlist (Base Sepolia, test USDC) | `src/lib/chain/allowlist.ts` |
| Transfer verification (D37 event match, D38 age) | `src/lib/chain/verify-transfer.ts` |
| Evidence re-check before payout (rule 9) | `src/lib/chain/recheck-evidence.ts`, `src/lib/payouts/server.ts` |
| Quote arithmetic | `src/lib/quotes/fx.ts` (mirrored by CHECK constraints in the migration) |
| Database functions, RLS, triggers | `supabase/migrations/` |
| Testnet / simulation disclosure | `src/components/TestnetBanner.tsx`, labels in `src/lib/payouts/views.ts` |
