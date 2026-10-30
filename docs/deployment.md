# Deployment runbook

**Status: not deployed.** No Vercel project, hosted Supabase project or DNS record has been created. This runbook follows plan §15. Each step marked **Julio** needs his accounts, his acceptance of provider terms, and his go-ahead; nothing here should be done for him.

Target: `stableflow.juliolavalle.com` (suggested; confirm before binding). Budget target: $0 incremental (plan §14). Do not enable billing, paid add-ons or a paid RPC.

## 0. Before you start (Julio)

- [ ] Re-read the [Vercel Hobby policy](https://vercel.com/docs/plans/hobby) and confirm a non-commercial portfolio demo is eligible. If not, stop at a local or preview build.
- [ ] Check [Supabase pricing](https://supabase.com/pricing) for the free-plan project limit, pausing after inactivity, and auth email limits. A paused project makes the demo look broken, so plan to wake it before sharing the link.
- [ ] Confirm who manages DNS for `juliolavalle.com` and that no `stableflow` record exists.

## 1. Hosted Supabase project (Julio creates; Claude can run the CLI steps after)

1. Create a new **free** project. Choose a region (São Paulo is closest to the persona; this is a latency choice, not a compliance one; see `compliance-research.md` C7).
2. Apply migrations from this repo, not by hand:

   ```bash
   npx supabase link --project-ref <project-ref>
   npx supabase db push
   ```

3. Auth → URL configuration:
   - Site URL: `https://stableflow.juliolavalle.com` (use the Vercel preview URL until DNS exists).
   - Redirect URLs: exactly `https://stableflow.juliolavalle.com/auth/callback` and the specific preview URL's `/auth/callback`. No wildcards across `*.vercel.app`.
4. Auth → Email: decide whether to require email confirmation. If on, the sign-up email links to `/auth/callback` (untested until this step; see known limitations). Hosted email has low rate limits, so expect throttling if many people sign up.
5. Seed nothing. Accounts are created by people signing up; no fictional data is needed in hosted.

## 2. Vercel project (Julio creates)

1. Import `jclavalle/stableflow` as a **new** project (not the portfolio project). Framework: Next.js. Node 24.
2. Environment variables. Set Production and Preview separately. The app refuses to start if any are wrong (`src/lib/config/server.ts`).

   | Variable | Value | Exposure |
   | --- | --- | --- |
   | `APP_URL` | `https://stableflow.juliolavalle.com` (or the preview URL) | Server |
   | `FIAT_PAYOUT_MODE` | `simulation` (any other value refuses to start) | Server |
   | `BASE_SEPOLIA_RPC_URL` | `https://sepolia.base.org` (public, rate-limited) | Server |
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL | Browser |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon/publishable key | Browser |
   | `SUPABASE_SERVICE_ROLE_KEY` | Service role/secret key, **Sensitive** | Server only |

   Never put the service-role key in a `NEXT_PUBLIC_*` variable. The app refuses to start if a secret-looking name has that prefix.
3. Preview deployments of pull requests must not get the production service-role key. Either give Preview its own Supabase project, or leave Preview without Supabase variables so it fails closed. Never expose secrets to fork PRs.
4. There is no chain or token setting: Base Sepolia and test USDC are code constants, so a deployment cannot be pointed at mainnet.

## 3. Preview smoke test (before DNS)

Run against the preview URL and record the results in `docs/evidence-log.md`:

- [ ] Testnet banner on every page; `/` and `/sign-in` load over HTTPS.
- [ ] Sign up, then sign in. If confirmation is on, the email link lands on `/account`.
- [ ] Link a wallet (first real-wallet test of linking; see known limitations).
- [ ] Create a small request, pay it from MetaMask on Base Sepolia, wait for confirmation (≥ 30 s), get a quote, complete one simulation.
- [ ] A second account cannot open the first account's request (shows "not found").
- [ ] Vercel function logs show no server errors.

## 4. Custom domain (Julio)

1. In Vercel, add `stableflow.juliolavalle.com` to the project. Vercel shows the exact record to create (usually a CNAME for a subdomain).
2. Create **only that record** at the DNS provider. Do not change the apex, `www`, MX or any other record. Use the value Vercel shows for this account, not one from a guide.
3. Wait for TLS issuance, then switch `APP_URL` and Supabase Site URL/redirects to the custom domain and redeploy.
4. Repeat the §3 smoke test on the custom domain.
5. Only then, link the demo from the portfolio site.

## Cookies and sessions

Supabase auth cookies are **host-only** (no `domain` attribute is set anywhere in the app), so a session on `stableflow.juliolavalle.com` is not shared with `juliolavalle.com` or a sibling subdomain such as FeedbackFlow's. Keep it that way.

## Rollback

- **App:** In Vercel, promote the previous deployment. To stop new activity quickly, remove the production deployment's environment variables and redeploy. Server routes then fail closed on configuration validation instead of running half-configured.
- **Database:** Migrations are forward-only. A bad migration needs a reviewed fix-forward migration, not a manual edit. Testnet data has no value, so a full reset (`supabase db reset` on a new project) is acceptable as a last resort and must be written down.
- **During an incident** the testnet banner stays; never remove disclosures to work around an error.

## What "deployed" will mean in the README

The README status changes from "Not deployed" only after the §3 checklist passes on a real URL and its date, commit and URL are recorded in the evidence log.
