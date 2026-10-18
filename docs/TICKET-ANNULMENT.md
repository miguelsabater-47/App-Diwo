# Individual ticket annulment

Local implementation, 17 October 2026. **Hosted SQL NOT applied. No retained App
Diwo ticket has been annulled. Production and rendered UI verification are pending.**

## User flow

`/admin/tickets` reuses the current admin order reader and safe ticket DTOs. Search
by attendee/buyer name, order reference or ticket ID; filter all/unused/used/revoked.
Technical retained orders remain visibly marked. No QR tokens or Clerk subjects
are sent to this screen. Existing admin navigation and styles are reused.

Only unused valid tickets offer an explicit two-step confirmation. The confirmation
warns that the QR becomes invalid, the action cannot be undone through the app and
there is no automatic refund. Success requires an exact same-ticket revoked receipt
with a timestamp; local state then displays Anulada. An uncertain/failed response
blocks further actions until an explicit page reload; no automatic write retries.
Loading failures are not presented as an empty authorized list.

## Boundaries

- Layout AND `readOrderOverview("admin")` require the current DB admin role.
- Only exact `/admin/tickets[/]` is unblocked; children/old admin APIs stay blocked.
- `POST /api/tickets/revoke` accepts exactly `{ ticketId }`, using existing signed
  session, strict JSON/byte limit, localhost origin and current-admin HTTP boundary.
- SQL `revoke_issued_ticket(uuid)` checks current admin again, locks actor → event →
  parent order → ticket, and decides from the locked live ticket status.
- Used tickets fail; already-revoked same-ticket retries preserve the original audit.
  A valid ticket becomes revoked with current operator, time and an admin reason.
- Public invoker/private fixed-search-path definer; no new direct table/QR grants,
  service-role fallback, token generation, deletion, refunds or financial updates.
- The parent paid order, immutable ticket identity and sibling tickets are untouched.

## Evidence

- 22 focused application/access/mutation tests pass, including same-ID safe receipt,
  admin-only operation, used-ticket conflict, no retry and search/filter projection.
- Disposable SQL test passes: paid parent/sibling exact preservation, repeated audit,
  used protection, rejection of the old QR, U/P/V and no extra API-role privileges.
- Existing real PostgreSQL17.11 race runner passes32 tests, now using the ACTUAL
  annulment RPC rather than owner-only update probes for scan-versus-annul races.
  Each winner blocks the other connection and retains the correct terminal state.
- TypeScript and affected ESLint pass. No browser automation tool is available here:
  desktop/mobile/focus/navigation/console evidence is NOT claimed.
- Anonymous/forged-header HTTP check passes on the existing localhost listener:
  page redirects to sign-in (including a validated streamed redirect under HTTP200),
  descendants remain403 and revoke API denies anonymous identity. No signed writes.

## Activation boundary

Apply ONLY after explicit hosted approval for App Diwo Development:
`supabase/drafts/ticket-annulment-rpc.sql`. Separate pending staff activation uses
`supabase/drafts/door-staff-rpcs.sql`; do not infer approval or reapply scanner SQL.
Inspect definitions/grants and keep original technical paid orders/tickets unchanged.
Neither draft publishes a real event, opens sales, assigns a new person or configures
Production. Hosted manual/signed UI evidence remains separate from local checks.
