# Administrative request cancellation and rejection

## Current product decision — accept or cancel only

Manual cancellation evidence is now complete (Miguel's results/preflight
screenshots): both exact pending fixtures became cancelled, with closure timestamps,
protected admin attribution, retained payload and zero tickets. Original2paid/4tickets
and both business fingerprints are unchanged. No Production/other-role/full F09
claim follows. See [manual evidence](ORDER-CLOSURE-MANUAL-TEST.md); do not rerun
fixture creation or reopen history.

Miguel simplified pending requests to approval/payment confirmation or cancellation
on2026-10-15. The rejection button and `/api/orders/reject` route have been removed;
the frontend/API cancellation receipt accepts only `cancelled`. Historical `rejected`
reads and the SQL already applied are preserved; no hosted DROP/rewrite was run.
The remainder documents the original two-action implementation and local SQL history,
not an instruction to restore the rejected action. Current manual test cancels both
existing pending fixtures; retain their immutable labels/IDs and create no more.

Status: implemented on `main`, 2026-10-15. Miguel explicitly authorized application
of this exact draft and reports `Success` after manual Supabase SQL Editor execution.
Miguel subsequently supplied the metadata-query screenshot: all three expected
signatures exist, both public wrappers are invokers, the private helper is a
definer, all have empty search_path, authenticated can execute and anon/service_role
cannot. These metadata match the draft. **Hosted function bodies, data invariants,
migration-history registration and signed closure tests remain unverified.** No
new fixture, event publication or retained-order mutation was authorized.

## Scope

- Only a verified current DB `admin` can cancel or reject a pending request.
- `POST /api/orders/cancel` and `POST /api/orders/reject`, JSON `{ "orderId": "<uuid>" }`.
- The HTTP boundary reuses existing same-origin/local-origin, JSON/body limits,
  signed session and current-role checks. No actor, role, state or price from client.
- Each route selects a fixed RPC: `cancel_order_request` or `reject_order_request`.
- Receipt: `{ order: { id, status: "cancelled" | "rejected", closedAt } }`.
  No raw subjects, QR tokens, upstream messages or audit actor are returned.
- Same-action retry is a no-op, preserving date/operator/payload. An opposite
  decision or confirmed order returns `order_not_pending` (HTTP409).
- No automatic retry after a timeout/ambiguous response. Read current state and
  explicitly retry the same order/action if appropriate; never recreate the request.

## Database contract

`supabase/drafts/order-closure-rpcs.sql` is a transactional review draft requiring
the existing foundation and order/payment RPCs. It adds one private fixed-path
definer and two public invoker wrappers. No new tables/columns, table-write grants,
RLS changes, fixture resets or updates of paid history.

The private function checks the verified actor's current DB role with
`lock_order_actor(['admin'])`, then locks the parent order `FOR UPDATE`, matching
approval lock ordering. It accepts only `cancelled`/`rejected`, rejects paid or
oppositely closed orders, and refuses unexpected existing tickets. Foundation's
guard records `closed_by` and server `closed_at`; snapshot, names, price, payment
notice and history are retained. No tickets are issued/deleted, no refund occurs.
No free-form closure reason is introduced in this scope.

The first committed decision wins approval/closure or cancel/reject races. A
rollback releases the parent for the waiting transaction. Repeating a successful
same-action call does not execute an UPDATE or modify audit timestamps.

## UI

Pending requests in `/admin/requests` reuse their existing approval panel. Cancel
and reject first show an inline confirmation with irreversible/no-refund wording;
back performs no write. A shared singleflight protects all three actions. A
verified terminal receipt disables further actions before the server refresh.
Choosing, returning and completion manage keyboard focus. Confirmed/closed request
cards do not render these actions. Existing marked technical history stays intact.

The existing reader already exposes terminal statuses. Closure operator/date are
stored by the DB, not exposed as raw subjects or added to the personal DTO.

## Local checks

- `tests/order-mutations.test.mjs`: role/HTTP/body boundaries, fixed RPCs, safe
  exact-ID/status/time receipts, conflicts and no implicit retry.
- `tests/order-closure-ui.test.mjs`: separate confirmation/back, shared action
  lock, stale callback protection, terminal gating and failure handling.
- `supabase/validation/order-closure.test.mjs`: disposable PGlite, mock claims,
  privileges/current role, full-row history invariants, retry and SQL replay.
- `supabase/validation/postgres-concurrency.test.mjs`: actual local PG17.11,
  separate psql backends and observed blocking. Real RPC cancel/reject against
  approval in both winner orders, repeated decisions, opposite decisions, rollback.
  The old owner-only cancellation fixture has been replaced by actual RPC calls.

Run focused application tests with the existing project runtime from `web/`:

```powershell
& "../.diwo-tools/node/node-v24.16.0-win-x64/node.exe" --test tests/order-mutations.test.mjs tests/order-closure-ui.test.mjs tests/order-payment-state.test.mjs tests/order-view-model.test.mjs
```

SQL runners are registered in the existing isolated validation package. Do not
confuse synthetic claims/local concurrency with a real signed hosted write.

Observed on 2026-10-15: 38 focused app tests pass (including request/legacy-route
regressions), 23 PGlite payment/closure tests pass, and 20 native PG17.11 tests
pass (19 scenarios plus parent). TypeScript without emit/incremental and affected
ESLint pass. Existing Node module-type warnings remain. Tracked diff check passes.

Actual action and Button components/styles were mounted in isolated Chrome at
320x700, 390x844 and1280x900 with mocked network/router and synthetic data. Choosing
reject/back restores focus; confirming cancel focuses confirmation; a simulated
409 never announces success; an explicit same-order retry succeeds, refreshes once
and focuses the result with all subsequent actions disabled. No horizontal
overflow/console errors were observed. Desktop/mobile screenshots were inspected.
These are not a signed hosted cancellation, a full live admin-page review or proof
that the new RPCs exist remotely. No application restart/build/hosted write occurred.

## Prepared manual protocol — not executed

See [ORDER-CLOSURE-MANUAL-TEST.md](ORDER-CLOSURE-MANUAL-TEST.md). It prepares exactly
two fixed-ID one-attendee fictional requests in the existing technical event,
read-only preflight/final checks and explicit UI cancellation/rejection. Creation
is manual through the signed API, persists exact payloads per account/event/tab,
stops on ambiguity and never opens sales, approves, closes or resets anything by
itself. No hosted data was created while preparing this protocol.

## Hosted activation — manual execution reported; verification pending

Miguel authorized this exact file and subsequent verification, then reported
`Success`. Direct Supabase execution/inspection tools were unavailable in the
assistant session; execution was performed manually by Miguel. This is not
independent confirmation of destination, full definitions or unchanged rows.
Execution grants and function security metadata were subsequently checked against
Miguel's supplied screenshot and match the expected values; no function bodies or
business-row snapshots were obtained in that check.
Do not reapply the SQL merely to obtain another success message. The historical
application checklist follows; execution (step3) is user-reported, not independently
verified. Migration-history registration was not established by this manual run.

1. Verify the intended project/environment and existing foundation/payment RPCs
   read-only. Do not repeat bootstrap, owned-ticket SQL or fixture creation.
2. Obtain explicit authorization for this exact hosted change. Review only
   `supabase/drafts/order-closure-rpcs.sql`, and agree how to record its migration
   history before application. This file is NOT an applied migration entry.
3. Apply only the approved functions/grants. Recheck function definitions,
   invoker/definer/search paths, execution grants and unchanged business rows.
4. Verify a signed current admin and nonadmin boundaries, with a separately
   authorized pending test request if needed. Never reset the two paid technical
   orders/four tickets or create a fixture without concrete permission.
5. Verify rendered real-session pending→cancelled/rejected and buyer history,
   retaining names, notice, date/operator and no tickets. Until then, this feature
   is **not certified end-to-end against hosted Supabase**. Calls to absent hosted
   RPCs fail safely and cannot be treated as completed decisions.
