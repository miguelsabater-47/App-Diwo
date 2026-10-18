# Production preparation — local only

17 October 2026. Miguel authorized local compatibility/configuration changes, **not
deployment, hosted changes, spending, Git push or opening sales**. Visual revision
comes BEFORE deployment. No Vercel project exists yet; no secret values are in this
document and no environment file was changed/read during this preparation.

## Runtime contract

Local usage remains `http://localhost:3000`, the current Clerk Development pair and
the existing pinned App Diwo Supabase destination. No new env values are needed to
continue visual work. `NODE_ENV=production` alone is not application Production:
local `next start` can still use explicit/default local Development configuration.

Production is opt-in, not inferred from Host/forwarded headers, a preview URL, or a
Clerk email/metadata claim. Runtime values must be supplied **privately** through
the future hosting project, in the Production environment only:

| Variable | Requirement |
| --- | --- |
| `DIWO_APP_ENV` | `production` |
| `NODE_ENV` | `production` (framework/host sets this) |
| `DIWO_APP_ORIGIN` | Exact owned HTTPS origin, without trailing slash/path/query/port |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Production `pk_live_` key |
| `CLERK_SECRET_KEY` | Same Production instance's `sk_live_` key; server-only |
| `DIWO_PRODUCTION_SUPABASE_URL` | Explicit server-side pin for the approved Production destination |
| `NEXT_PUBLIC_SUPABASE_URL` | Must exactly match that pin |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable `sb_publishable_` key for that destination |
| `DIWO_BIZUM_PHONE` | Optional server-side override of Miguel's approved public recipient; if supplied, it must validate. Missing value uses the approved application default; invalid explicit values fail closed. |

Prefixes validate format, not key pairing or ownership. Supabase still receives the
native Clerk token and remains the sole role authority; there is no service-role
fallback, JWT role grant, client-side role bootstrap or anonymous signed-operation
fallback. HTTP mutations require BOTH exact request URL origin and Origin header;
cross-site/missing/spoofed origins fail. Clerk `authorizedParties` is the same exact
canonical origin. GET staff/scanner requests also require the canonical URL.

Vercel Preview/Development targets intentionally fail closed. Do not put live keys in
Preview or broaden the origin allowlist to `*.vercel.app`. The camera rehearsal is
still local/Development/admin-only. Configuration failure on a hosted target gives
a neutral unavailable screen, not instructions to enter Development secrets.

## Hosting setup, later and only with separate authorization

- Framework preset: Next.js. The Git repository is **already `web/`**: when importing
  that repository, Root Directory is its root (`.`), not another nested `web/`.
- Runtime pinned to Node24.x in package.json/lockfile, matching local Node24. No
  custom Vercel server, wildcard CORS, proxy trust or `vercel.json` is needed.
- Install from the retained package-lock (`npm ci`); build `npm run build`; standard
  Next.js output. No build or Vercel CLI deployment was performed here.
- Before an approved Production build, with injected values, run
  `npm run config:production`. It only reports named booleans/format checks; it does
  not validate hosted permissions or publish anything. It intentionally fails with
  local Development values; do not replace `.env.local` to make it pass.
- Clerk Production **requires an owned domain and its DNS configuration**; the
  provider's docs do not support `*.vercel.app` for Clerk Production. Domain purchase,
  DNS changes, Clerk Production creation/Google settings and Vercel creation are
  NOT authorized by this local preparation.
- Choose the Production Supabase destination explicitly before setting its pin.
  A new project is not silently required or created. Reusing the original project
  needs a separately approved plan for retained test data, Production issuer and
  the unique admin identity. The scanner sandbox is always rejected.
- Development Clerk users/subjects/admin do NOT become Production identities.
  Bootstrap/replace the unique protected admin only under a separately approved
  hosted operation; never derive this from email or editable metadata.
- No automatic schema migrations, fixture imports, event creation/publication,
  opening sales, identity copying or SQL changes occur during build/deploy.

## Evidence and remaining gates

Focused tests cover Development continuity, opt-in live config, explicit database
pin, Preview/invalid-origin rejection, all three HTTP boundaries and native-token
client configuration with synthetic values and no hosted access. Existing role,
ownership, payment, staff and camera rehearsal checks remain intact.

Actual local checks:68 focused tests pass, plus2 anonymous/forged-header HTTP checks
against the already-running localhost listener. TypeScript, affected ESLint and
`git diff --check` pass. No full suite, Production build, server restart or signed
hosted write was performed for this preparation.

Production build, provider connection/issuer/Google session, actual Production admin,
HTTPS on a real mobile and rendered visual approval are still unverified. The sales
validator and ticket-list copy now use the confirmed23:30 event start (22:30Z on
31 October); historical technical fixtures remain unchanged. Actual event creation
and publication are still separate approved operations.
Keep the event unpublished and sales closed until Miguel explicitly activates them.

Next block: revise the visual design locally using the existing DIWO components and
reference, preserving a distinct admin Home. Review actual desktop/mobile, focus,
navigation and console before calling the UI final. No deployment before that review.

References consulted: Clerk Production/Vercel deployment docs (`authorizedParties`,
live key pair, owned-domain requirement); Vercel Node runtime/system env docs
(`engines.node=24.x`, `VERCEL_ENV` available at build and runtime).
