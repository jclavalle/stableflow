@AGENTS.md

# StableFlow — working rules

- Plan of record: `docs/project-plan.md`. Record decisions and deviations in `docs/decisions.md` using [R]/[U]/[P]/[O] labels.
- Testnet only. Chain and token come from `src/lib/chain/allowlist.ts`; never make them configurable by env or browser input. No mainnet configuration.
- Fiat payout is simulation only. Never collect real banking details, seeds or private keys.
- Money is integer base units; never floating point.
- Never claim a test, integration, deployment or user validation happened without evidence. Update `docs/known-limitations.md` and `docs/evidence-log.md` with each PR.
- Before finishing a change, run: `npm run lint && npm run typecheck && npm run test:unit && npm run build && npm run test:e2e`.
