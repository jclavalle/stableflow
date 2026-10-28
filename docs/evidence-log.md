# Evidence log — Claude Code vs Codex comparison

StableFlow is built with Claude Code; FeedbackFlow is built with Codex. Different products, so outcomes are case studies, not a controlled ranking (see `project-plan.md` §16). Record failures as well as successes. Times are approximate unless stated.

## Kickoff

| Field | Value |
| --- | --- |
| Project | StableFlow |
| Tool | Claude Code, desktop app (Code tab) |
| Model | Claude Opus 5.5 (`claude-opus-5-5`) |
| Kickoff date | 2026-10-28 |
| Subscription / usage basis | _Julio to fill in_ |
| Frozen scope | `project-plan.md` as of 2026-10-28, plus PM artifacts from the Airtm conversation (see `decisions.md`) |
| Acceptance baseline | `project-plan.md` §11 checklist (all unchecked at kickoff) |

## Entries

| Date | PR / task | Prompt summary | Human interventions | Retries / failures | First-run result | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-10-28 | Setup | Read plan and Airtm conversation; propose first step | Chose repo location/visibility (public) | — | — | Claude surfaced scope gap between Airtm 10–12 h concept and 5-day plan. |
| 2026-10-28 | PR 1 foundation | Scaffold, config, banner, scripts, CI, docs | None during build | npm peer conflict (`@types/node` 20 vs Vitest 5) fixed by moving to Node 24 types; E2E first run hit a FeedbackFlow server already on port 3100, fixed by changing port and disabling server reuse | Lint, typecheck, unit (8), build, E2E (2) passed locally after fixes | CI result recorded in the PR. |
| 2026-10-28 | PR 1 CI | — | Julio merged PR 1 | — | CI `checks` and `secret-scan` passed on the PR (run 40757611913) | Julio approved `gh` workflow scope via device flow after a PATH issue in the terminal pane. |
| 2026-10-28 | PR 2 identity | Auth, wallet challenges, schema, RLS, atomic function | None during build | Two prerender failures under Next 16 Cache Components (config read before request data) fixed by reading request data first | Lint, typecheck, unit (19), build passed locally; DB integration (16) and auth E2E (2) skipped locally (no Docker) | CI result recorded in the PR. |
