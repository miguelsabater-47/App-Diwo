# Door staff management

Status: locally implemented on `main`, 2026-10-15. **Hosted SQL not applied. No
real role assignments/revocations or Clerk-directory calls were performed by the
assistant.** Scanner/check-in remains a separate pending block.

## Product/UI

`/admin/staff`, linked as Personal in the existing admin navigation:

1. Current staff list (names/verified email where available).
2. Exact email lookup against an existing Clerk account; no invitations/new users.
3. Explicit grant after showing the matched person. Already-staff/admin results
   cannot be granted; no admin selection/creation/demotion.
4. Explicit removal confirmation/back. Deleted/unavailable Clerk accounts remain
   removable by their existing DB entry, without resolving an old/reassigned email.
5. A verified mutation or any uncertain write requires refreshing the authorized
   list before another mutation. No automatic write retry or success on timeout.

Errors/unknown list state are not displayed as a valid empty list. Writes occur
only from explicit controls, not initial effects. Existing buyer functions, orders,
tickets and financial history are untouched. Staff cannot see this administration.

## Boundaries and identity

- Layout AND page require current admin; API checks independently. Only the exact
  `/admin/staff[/]` page is added to the middleware allowlist. Legacy admin APIs,
  `/admin/tickets`, descendants and `/scan` remain blocked.
- `GET /api/door-staff` lists staff. `POST` accepts only strict schemas:
  - lookup: `{ action: "lookup", email }`
  - grant: `{ action: "grant", email, staffId, version }`
  - revoke: `{ action: "revoke", staffId, version }`
- Same-origin localhost3000/JSON checks, byte-bounded2KiB body, signed session,
  current DB admin role before directory access, no-store replies and safe errors.
  This retains the project's Development-origin restriction; Production is not proven.
- Server uses awaited `clerkClient()` and read-only Backend API exact email filters.
  Requires exactly one account with the SAME normalized email in verified state;
  rejects ambiguous, unverified, mismatched, banned/locked or unavailable accounts.
- Grant resolves Clerk AGAIN and binds to the preview's opaque staff reference;
  changing an email to another account cannot silently redirect a grant.
- **Clerk registration/email assurance is the server boundary, not a PostgreSQL
  feature.** PostgreSQL cannot query this external directory. A direct RPC by the
  sole trusted admin takes a Clerk subject and is admin-only; it does not independently
  prove registration/verification. Never expose an application subject-entry field
  or bypass the resolver. No service-role fallback or privileges from email/metadata.
- Supabase alone determines roles. RPCs recheck the actual actor and current DB role;
  only literals `user` and `door_staff` can be written. Actor/admin targets are rejected.
- Client DTOs contain name/email, role where needed, version and `staffId`:
  SHA256 of domain prefix `diwo:staff:` plus Clerk subject. This is a stable
  pseudonymous reference, NOT a permission token; every operation still authenticates.
  Raw subjects stay in server joins and existing restricted role storage, not HTTP DTOs.
- No extra secrets/configuration, new role tables, columns or directory cache.
  Uses the configured Clerk backend and the actor's signed Supabase client.

## SQL draft and recency

`supabase/drafts/door-staff-rpcs.sql` requires foundation and `lock_order_actor`.
It adds public invokers/private fixed-path definers for list, lookup, grant, revoke;
internal reference/setter functions have NO authenticated EXECUTE. No public/anon/
service-role execution or direct role-table write grants are introduced.

Mutation lock order: actor role SHARE → target advisory gap lock → target role
FOR UPDATE. The first assignment is serialized too. Existing sensitive operations
hold SHARE on that role row; removal waits for an already-running operation, then
the next authorized operation reads `user`. Existing counter RPC checks current
role, not JWT metadata. The future scanner must use this same DB authority.

`version` is the original DB timestamp, preserved as a string without JS Date
roundtripping/millisecond truncation. A same-desired-role retry is a no-op. A stale
opposite-role change returns409 `staff_state_changed`, preventing a delayed old
grant from undoing removal or an old removal from undoing a new grant. No deletes:
identity/history/FKs remain; `assigned_by` and `updated_at` record the last change.
No full audit-log ledger is added for this small-party scope.

List RPC provides total_count so API truncation/duplicates cannot look complete.
Clerk identities are joined in bounded batches; deleted entries get an unavailable
label, still removable. A provider failure does not become an empty staff list.

## Checks and activation

- Focused application/core/model/UI/access tests cover exact verified resolution,
  no client subjects/escalation, stale preview, safe DTOs, role denial, admin protection,
  malformed/oversized/cross-site bodies, missing functions, no retry, confirmation,
  busy/stale callbacks and initial error versus empty list.
- Disposable PGlite tests cover invoker/grants/internal isolation, identity protection,
  same-action retry, stale version, default buyer functions after revoke and denial
  of the next door counter read. SQL replay preserves existing roles.
- Native PG17.11 uses separate psql backends to observe first-grant serialization,
  revoke waiting for an active actor lock, denial after removal, buyer continuity
  and stale commands. Test-only cluster stops/disposes itself; never hosted fixtures.

Hosted activation requires explicit authorization for THIS draft, destination,
application/history plan and verification. Do not reuse the earlier cancellation
authorization to apply staff SQL or change a real account's role. After approved
application, inspect definitions/grants and unchanged admin/business rows, then
agree a real registered verified test account for a grant/removal cycle. No new
account, fixture, admin bootstrap or event publication should be implicit.

Before SQL application the page fails safely with a configuration-required message.
Local/mock checks do not prove actual Clerk instance lookup, signed hosted mutations,
the real admin UI, scanner or Production.
