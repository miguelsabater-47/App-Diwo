# Supabase foundation

## Door staff — local draft only

`drafts/door-staff-rpcs.sql` prepares admin-only role listing/assignment/removal
using existing role storage, protected admin identity and actor/target locks.
**Not applied hosted; no real role changes.** Current-role/grant checks and an
explicit activation/test-account scope are still required before enabling it.
See [DOOR-STAFF.md](../docs/DOOR-STAFF.md). Scanner remains unimplemented.

## Latest local addition — 2026-10-15

Admin-only cancellation/rejection is prepared in `drafts/order-closure-rpcs.sql`.
Miguel authorized its application and reports manual SQL Editor `Success`.
His subsequent SQL-result screenshot confirms expected existence/invoker/definer,
empty search_path and authenticated-only execution for the three functions.
Miguel's final manual cancellation screenshots confirm both exact fixtures
cancelled with audit date/admin and zero tickets, while original2paid/4tickets and
both business fingerprints are unchanged. The app now exposes accept/cancel only;
the existing SQL rejection helper is historical compatibility, not a UI action.
Full hosted bodies, migration-history registration, other-role/F09 and Production
verification remain outstanding. No hosted business
row/role mutations were performed by the assistant. See [ORDER-CLOSURE.md](../docs/ORDER-CLOSURE.md) for
API, locking, validation and explicit hosted-activation boundaries. Historical
checkpoints below do not override this status.

Status: **foundation applied to hosted PG17.11 on 2026-10-12**. Native signed Clerk
Development session is user-confirmed. Owner bootstrap initially had a leftover
placeholder suffix. Authorized Development repair now user-executed successfully;
read-only verification confirms one admin, no marker fragments, role RLS/identity
guard enabled and client writes denied. Miguel now confirms same-browser signed
session diagnostic returns `appRole=admin`. This completes Development bootstrap
and repair, not Production or the complete privileged UI/payment flow. The current
application continues its already-tested Clerk Development bootstrap and
fail-closed legacy/admin routes. Last app commit: `1c54328`.

## Files

Hosted three-RPC migration applied on 2026-10-12 with explicit Development
authorization. Version `20261012105444_diwo_order_payment_rpcs`, exact local/remote
SHA256 `aa1c93a7c7ac3ba94ea2fdfb4f149cd136959166b48de2767688a3de237a22bc`.
Only draft outer BEGIN/COMMIT omitted; original draft comments retained verbatim
for provenance, not current execution status. Seven new fixed-path functions,
execution grants, direct-write/QR denials, RLS/guards and deferred constraints
verified. Six hosted negative synthetic-claim checks pass with rollback and no
stored fixtures; events/orders/tickets0/admin1 unchanged. Real signed writer
verification remains pending. Project OpenCode readonly restoration is now verified
live: supabase_read_only_user, transaction_read_only=on.

Local server integration is implemented and tested: POST `/api/orders/request`,
`/api/orders/report-payment`, `/api/orders/approve-payment`, current signed client
and DB role, strict JSON/origin validation and safe responses. Local20/HTTP8/types/
lint pass without hosted writes or lifecycle action in that block. Subsequent
authorized technical event and signed admin-as-buyer test now PASS6: readonly
confirms event1/confirmed order1/valid unused tickets2/1000cents. Final repeat PASS
and unchanged identity/issued-time/state fingerprint confirm no replacements or
duplicates. Technical test complete; actual event/UI/full F09 remain pending.
Contract and retry rules: [ORDER-API.md](../docs/ORDER-API.md), fixture evidence:
[SIGNED-ORDER-TEST.md](../docs/SIGNED-ORDER-TEST.md).

Current UI continuation: own /ticket reads (explicit actor filter even for admin),
admin root/requests current-role layout+reader gates, role-aware Home/account and
manual approval via existing API. Safe columns/no QR/subjects, exact paging and
role recheck after buffered reads. Local32/HTTP8/types/lint pass; hosted fixtures
and fingerprint unchanged. Signed rendered UI/other-buyer/approval click still
pending. [ORDER-READS.md](../docs/ORDER-READS.md) records boundaries/review steps.

- `migrations/20261012105444_diwo_order_payment_rpcs.sql`: exact applied SQL,
  server-generated version and SHA256 verified against remote migration history.
- `drafts/order-payment-rpcs.sql`: reviewed/local-tested source, now applied via
  the matching migration above. Three operations:
  buyer request creation, own payment notice and admin approval/exactN issuance.
  Client logical-submission UUID becomes immutable order PK for idempotent retries;
  no new table/column. Actor-role lock precedes creation advisory/order/ticket locks.
  Public invokers/private fixed-path definers, no owner anonymous fallback or raw QR
   output. Event seed, UI integration, cancellations/scanner/staff/download writers
  are separate. The selected real PG17 multi-connection cases now pass locally;
  hosted signed-RPC behavior and remaining state writers are still pending.
- `migrations/20261011225839_diwo_foundation.sql`: applied via MCP, filename
  matches the server-generated history version. Exact SQL matches remote history
  by SHA256 (including the local trailing LF). MCP handles the transaction;
  draft BEGIN/COMMIT omitted, business SQL preserved. No CLI/history repair used.
- `drafts/foundation.sql`: four application tables, RLS, explicit grants,
  protected identities/state/history, deferred issuance-count verification and
  restricted read RPCs. This is deliberately outside `migrations/`.
- `drafts/bootstrap-admin.sql.example`: owner-only template; placeholder refuses
  execution. Resolve the intended admin's **verified registered account in the
  correct Clerk environment** before privately filling the template. Email is
  identification, never authorization. Do not commit a filled copy.
- `drafts/event.sql.example`: approved public event metadata, 500 cents,
   Europe/Madrid party timestamps. Opening uses preparation time/unpublished;
   Miguel withdraws the fixed October15 estimate and releases when app ready with
   deliberate publication. No exact address/group link. Updated local SQL72 pass.
- `drafts/repair-development-admin.sql.example`: authorized owner-only Development
  repair for the specifically reported leftover suffix. Replace the ENTIRE
  placeholder privately. Requires exact identity-plus-suffix match, no business
  rows/role assignments/target conflict and enabled protections. Exclusive locks
  protect the temporary identity-trigger suspension; trigger restored before
  commit, and any error rolls back both identity and DDL. Not a general admin
  replacement, migration or application RPC. Never commit a filled copy.
- `validation/`: isolated pinned PGlite development dependency/lockfile and tests.
  No change to the web application's dependency declarations or runtime.

## Local validation

From `web/`, using the existing project-local runtime:

```powershell
& "../setup/Run-Web.ps1" -Command sql-install
& "../setup/Run-Web.ps1" -Command sql
```

Install only when needed; subsequent runs need only `sql`. Tests use an ephemeral
in-memory PostgreSQL, synthetic identities and an `auth.jwt()` mock. They do not
read `.env.local`, call Clerk/Supabase, or start/stop the web server. The runner
has a 90-second limit and closes the database. No real personal data or private
ticket credentials are fixtures.

Recorded 2026-10-11: **49 tests passed**, zero failures/skips, PGlite 0.5.8 engine
PostgreSQL **18.3**. Hosted metadata reports **17.11**. The draft uses syntax
available in PG17, but local validation is not a hosted PG17 execution, signature
verification, or a multi-connection race test.

Recorded 2026-10-12 repair preparation: **56 tests passed**, including seven
synthetic repair/bootstrap cases against the applied foundation SQL. Checks cover
role mapping, protected identity after repair, rollback after trigger suspension,
caller denial, placeholder fragments, identity mismatch, target conflicts and
existing role assignments. This is not evidence of actual hosted repair.

Recorded 2026-10-12 order/payment draft: **72 tests passed**, adding fifteen
business scenarios and their parent suite against the applied foundation SQL.
Coverage includes all buyer roles, own notice without approval, admin-only issuance
without notice, retry payload conflicts, exactN private tokens, safe projections,
closed-state refusal, stable identities/timestamps/used or revoked ticket replay,
and full rollback on the second ticket failure. Targeted JS lint passes. Local
PG18.3/mock claims alone do not prove real JWT or multi-connection races. The
subsequent PG17 validation below supplies selected real-connection evidence;
hosted RPC application is not authorized by draft completion.

### Real PostgreSQL 17.11 connections — 2026-10-12

Miguel authorized project-local portable PostgreSQL; see
[POSTGRES-VALIDATION.md](../../setup/POSTGRES-VALIDATION.md) for provenance/lifecycle.

```powershell
# From web/, after installing the owned runtime if missing:
& "../setup/Run-Web.ps1" -Command sql-race
```

Actual **PG17.11**, **12 passing tests (11 scenarios)** using different psql backend
PIDs and verified blocking relationships, not Promise.all on a single connection.
Creation/approval commit and rollback races, notice/approval, both winner orders
of approval/cancellation, actor-role maintenance, terminal-ticket replay and a
second-ticket failure pass. Cancellation uses a synthetic owner fixture through
the foundation guard; no cancellation RPC is delivered. Test cluster is fresh,
SCRAM/loopback-only and automatically stopped/disposed; app process unchanged.
Mock auth settings do not verify signed hosted RPCs/PostgREST/all F09 operations.

## Access model

Server foundation: `lib/app-authorization.ts` is server-only and reads the current
role using the request's native client on every call. `requireAdminAccess` and
`requireDoorAccess` are prepared for future operations, with deny-by-default role
checks. `app-authorization-core.ts` isolates policy for synthetic tests; it is not
an independent authentication boundary. The session diagnostic now consumes the
shared lookup. Existing admin/scan/legacy denies stay active. Local10/HTTP7 plus
types/lint pass; Miguel confirms signed-admin role remains correct after refactor. Sensitive
business RPCs must independently recheck the DB actor/role inside their transaction.

`authenticated` is the technical database role from a verified Clerk token, not
DIWO admin/door_staff. Application privileges come from `user_roles`, read on
each sensitive operation. Do not cast Clerk `sub` through UUID `auth.uid()`.

| Caller | Data access |
| --- | --- |
| Anonymous | Published event metadata only |
| Clerk user | Own order/ticket projections; default app role `user` |
| Door Staff | Own buyer projections plus event operational snapshot RPC |
| Admin | All safe order/ticket projections and role ledger, including personal buyer features |

All ordinary table writes are revoked, including direct role changes by an
admin client. The three applied business RPCs independently recheck actor/role.
Cancellation/annulment/check-in/staff/renderers need later reviewed work;
old code issuance/redemption remains blocked.

`qr_token` is an opaque bearer credential and has **no authenticated SELECT
grant**, even for an admin. Use explicit safe column projections rather than
`select('*')`. A future renderer RPC must return the credential only to the
authorized buyer, must never present a revoked ticket as valid, and must not
deliver raw ticket streams to door staff. The raw token is retained in the
database, not hashed: restricted recovery enables later downloads. Do not log
it or return it from staff/aggregate APIs.

Private definers have fixed empty `search_path`, explicit caller checks and no
default PUBLIC execution. Public read wrappers are invokers; keep
`diwo_private` out of Data API exposed schemas. Explicit grants are independent
of RLS and are required by the current Data API opt-in rollout.

## Integrity and operations

- Mandatory one-dimensional attendee-name array; quantity/total generated from
  it and the fixed 500-cent price. Duplicate names allowed; no attendance cap.
- Request snapshots are immutable. Buyer payment notice leaves it pending and
  is separate from admin confirmation; terminal orders cannot reopen/change.
- Confirmation and exactly N ticket inserts must share one transaction; a
  deferred constraint rejects partial issuance at commit. Ticket ordinal/name
  matches the order and composite FK protects event isolation.
- Valid tickets can become used or revoked; both are terminal. No use reset,
  used-ticket annulment, physical history deletion or token/name transfer.
- Trigger guards derive native caller/clock for sensitive changes and reject
  wrong-role or malformed API contexts, including behind a privileged writer.
  Trusted database-owner maintenance is explicit, not ordinary API access.
- First admin binding is owner-only and unique; normal updates/deletes cannot
  change/remove that identity. A future production identity change needs a
  separate controlled maintenance decision, not reuse of a Development subject.
- Counter RPC returns U/P/V and ratio U/V (NULL when V=0), with V=U+P, excluding
  revoked and including used. It returns no finances/ticket rows/QR tokens.
- No Realtime publication/platform schema is modified. Synchronization UI and
  transport remain separate; each later snapshot must recheck current roles.

## Hosted verification — 2026-10-12

Applied with explicit authorization after OAuth reauthentication. Verified four
empty tables with RLS, five SELECT policies, twelve fixed-search-path functions,
public invoker wrappers, no PUBLIC/anon function execution, restricted column
grants, no API-role/service_role direct table writes, private QR denial and two
initially-deferred constraint triggers. Read-only hosted synthetic-claim checks
passed default user, anonymous restrictions and operational-counter denial.
These do not verify real signed Clerk JWTs, populated ownership or concurrency.
Realtime publication remains unchanged; no application tables published.

Security/Performance Advisors remain pending: not exposed by database-only tools.
Project MCP read-only restored on disk; reload the selected App Diwo harness to
apply it. No administrator/event seeded and no app runtime changes or new commit.

## Next integration scope

Configure native Clerk third-party authentication in both services for the same
instance/environment. Ordinary data clients must use a publishable key plus the
current request's Clerk token via `accessToken`/`getToken()`, not the legacy
global service-role client or deprecated JWT-template integration. Never use
editable metadata/JWT app-role claims to elevate privileges. No live native
connection/key/role provisioning is proven by these tests.

Next reviewed work needs: real JWT read verification, protected admin bootstrap,
verified-email-to-ID staff assignment, narrow transactional write RPCs with
idempotency and ordered locks, and multi-connection approval/cancel/check-in/
annul races on PG17. Nothing here changes production, deploys, purchases a
service, or grants final-role UI acceptance.
