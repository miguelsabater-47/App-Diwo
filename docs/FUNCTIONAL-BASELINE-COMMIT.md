# Functional baseline commit proposal

Prepared 2026-10-13. Proposal only: no staging, commit, branch change or publication.
Repository: `web/`; current branch `main`, baseline `1c54328`.
Miguel must explicitly confirm the commit before it is executed.

## Suggested commit

`feat: add guarded order flow and owned ticket QR exports`

Purpose: preserve the current working functional checkpoint before changing login
presentation. This is not a Production release or a claim that all feature checks
are complete. The current login and registration remain the native Clerk pages.

## Candidate manifest

Paths below are relative to `web/`. Braces enumerate exact files, not a request
to stage entire directories. Final selection must be rechecked against Git at
confirmation time. Do not use `git add .`.

- Tracked changes: `.env.example`; `app/{account,admin,ticket}/page.tsx`;
  `app/{layout,page}.tsx`; `components/{account-actions,nav-button}.tsx`;
  `lib/local-access.ts`; `middleware.ts`; `package{,-lock}.json`;
  `tests/{http-access,local-access}.test.mjs`.
- New pages/routes: `app/admin/layout.tsx`; `app/admin/requests/page.tsx`;
  `app/api/orders/{approve-payment,report-payment,request}/route.ts`;
  `app/api/supabase-session/route.ts`; `app/api/tickets/[id]/route.ts`;
  `app/request/page.tsx`; `app/ticket/[id]/page.tsx`.
- Components: `components/{app-navigation,approve-order-payment,new-order-link,
  order-payment-details,order-request-form,owned-ticket-actions,
  owned-ticket-detail,refresh-orders}.tsx`.
- Libraries: `lib/{app-authorization-core,app-authorization,order-mutation-core,
  order-mutations,order-payment-state,order-reads,order-request-state,order-sales,
  order-view-model,owned-ticket-export,owned-ticket-model,owned-ticket-qr,
  owned-ticket-reader,supabase-session}.ts`.
- Application tests: `tests/{app-authorization,order-mutations,order-payment-state,
  order-request-state,order-view-model,owned-ticket-actions,owned-ticket-export,
  owned-ticket-model,owned-ticket-reader,ui-approval-test-script}.test.mjs`.
- Documentation: `docs/{ORDER-API,ORDER-READS,ORDER-UI,OWNED-TICKET-SQL,
  OWNED-TICKET-UI,SIGNED-ORDER-TEST,UI-APPROVAL-TEST,FUNCTIONAL-BASELINE-COMMIT}.md`;
  `odd/tasks/owned-ticket-detail.md`.
- Manual technical-test scripts: `scripts/{create-ui-approval-test,
  test-order-flow}.browser.js`. Retain their bounded/manual fixture contracts;
  including scripts does not authorize executing them again.
- SQL: `supabase/README.md`;
  `supabase/drafts/{bootstrap-admin,event,repair-development-admin}.sql.example`;
  `supabase/drafts/{foundation,order-payment-rpcs,owned-ticket-detail,
  technical-test-event}.sql`;
  `supabase/migrations/20261011225839_diwo_foundation.sql`;
  `supabase/migrations/20261012105444_diwo_order_payment_rpcs.sql`.
- SQL validation: `supabase/validation/.gitignore`;
  `supabase/validation/package{,-lock}.json`;
  `supabase/validation/{admin-repair,foundation,order-payment,
  postgres-concurrency,technical-fixture}.test.mjs`;
  `supabase/validation/tests/{owned-ticket-detail,owned-ticket-invariants}.test.mjs`.

Audit before this proposal: 14 modified tracked files and 77 untracked files,
including six font assets. Functional selection: 85 existing candidates; this
proposal adds one passive document, for 86 proposed files. Historical accumulation
is about 6,000 added textual lines, not a small feature diff. No cleanup or
artificial split is performed merely to reduce that size. No PR is authorized.

## Exclusions and privacy

- Keep `public/fonts/Satoshi-{Black,Bold,Light,Medium,Regular,Variable}.woff2`
  untracked for the future login design commit; font loading is not implemented.
- Do not include `.env.local`, credentials, private assets, runtime, dependencies,
  `.next`, build info, CodeGraph cache or scratch/test output. CodeGraph exclusions
  currently also rely on local `.git/info/exclude`; do not change config here.
- Root `docs/FUNCIONALIDADES.md`, `docs/DECISIONES.md`, `docs/UX-UI.md` and
  `SESSION-HANDOFF.md` are synchronized outside `web/` Git and cannot be included
  without expanding repository scope. Do not expand that scope.
- `.env.example` has placeholder keys, public project metadata and an empty Bizum
  recipient, not real secret values according to the bounded audit.
- Test contracts/scripts include retained synthetic identifiers/names and a
  historical fingerprint. They are not credentials, but publishing this checkpoint
  would require a separate audience/privacy review. Commit is not push permission.
- Original logo SVG is supplied in the conversation but not yet stored as an asset;
  it will be saved faithfully during authorized redesign, not reconstructed.

## Observed checks

Executed in an isolated external scratch copy with existing dependencies and
project-local Node. No installs, hosted writes or live-listener restart.

| Command from scratch `web/` | Result |
| --- | --- |
| `& '..\setup\Run-Web.ps1' -Command test` | 54 passed, no failures/skips; existing module-type warnings |
| `& '..\setup\Run-Web.ps1' -Command check` | Passed, no diagnostics |
| `& '..\setup\Run-Web.ps1' -Command lint` | No errors; one `no-img-element` warning for the local QR image |
| `& '..\setup\Run-Web.ps1' -Command sql` | 84 passed, no failures/skips, synthetic/mock auth |
| `git diff --check` | Passed for tracked delta; LF/CRLF notices only |

Anonymous HTTP previously passed eight checks, but was not rerun in this audit.
Build, native PostgreSQL concurrency, physical QR, complete rendered UI/mobile,
hosted detail permissions/history and Production checks were not run. Native RDD
is user-disabled; no review lifecycle started and no approval receipt claimed.
Independent probes found no new demonstrated blocker in examined owner boundaries.

## User-confirmed evidence and remaining scope

Miguel reports manual owned-ticket SQL execution and both function-existence
checks true, signed detail of four technical entries, correct PNG/JPG downloads
and one-click Chrome native-selector opening. This is not independent hosted
permission/data-invariant certification, proof of recipient delivery or admission.
The real event is unpublished; two technical paid orders/four tickets remain.
Scanner, staff management, cancellation/annulment and realtime are still pending.

## Next boundary

Present this proposal and the two-step login UX adjustments before redesign.
After commit confirmation, recheck Git status/diff/log, candidate bytes/exclusions
and run one reported focused command as a parent spot check. Stage only explicitly
listed intended paths. Do not commit the font assets or change production settings.
After baseline preservation, implement login separately with the installed Clerk
SDK, keeping existing authentication/security and independently verifying auth changes.
