# Local Development order API

Implemented on 2026-10-12 under Miguel's authorization for local server integration
and tests. Event setup, UI and real signed writer verification are still pending.

## Request boundary

### Sales closure authorized on 2026-10-22

For `diwo-x-2-2026`, NEW order INSERTs now fail with `sales_closed` (HTTP 409),
including stale browser pages and direct RPC calls. Existing exact request replays
still reconcile their original receipt; approval/reporting/cancellation remain available
under their existing role checks. No pending orders are deleted or auto-approved.

The exceptional approval ceiling is **133 valid + used tickets**, excluding revoked
tickets, serialized with the existing per-event lock. The authenticated availability
RPC returns `{capacity: 133, remaining_tickets: 0}`: this is NEW-request availability,
not approval headroom. Cancellation or annulment never reopens requests.
SQL: `supabase/drafts/close-sales-capacity-133.sql`, applied after the original
`event-ticket-capacity.sql`. Replacing these private functions preserves existing ACLs.

- Use `POST` from the signed-in application at `http://localhost:3000`.
- Send `Origin: http://localhost:3000` and `Content-Type: application/json`.
- The server rejects missing/foreign Origin, cross-site requests and non-JSON bodies.
- JSON is limited to 64 KiB of actual UTF-8 bytes, independently of Content-Length.
  This is a transport limit, not an attendance/ticket quantity cap.
- Clerk Development supplies the verified current token. One request-scoped client
  reads `get_current_app_role` and calls the business RPC. No service-role client,
  caller-supplied identity/role/price or application-role token claim is accepted.
- SQL independently enforces current role, ownership, sales and state in its
  transaction. Approval requires admin in both the server and SQL.
- All handler responses are `private, no-store`. Private QR, Clerk subjects and
  upstream error details are excluded, including unexpected extra RPC columns.

## Endpoints and exact JSON bodies

| Endpoint | Body | Successful `order` properties |
| --- | --- | --- |
| `/api/orders/request` | `{requestId, eventId, buyerName, attendeeNames}` | `id`, `reference`, `status`, `quantity`, `totalCents` |
| `/api/orders/report-payment` | `{orderId}` | `id`, `status`, `paymentReportedAt` |
| `/api/orders/approve-payment` | `{orderId}` | `id`, `status`, `confirmedAt`, `issuedTicketCount` |

Responses use `{ "order": { ... } }` with HTTP 200, including successful retries.
Extra or missing input properties fail with 400. `requestId` must be a UUIDv4;
`eventId` and `orderId` use canonical UUID syntax. Names must be nonempty strings;
`attendeeNames` must be a nonempty flat array. Duplicate names are permitted.
Quantity and EUR cents are derived by SQL, never submitted by the caller.

Generate `requestId` **once per logical submission** and preserve it and the
submitted payload across retries. Never generate a replacement ID automatically
after a timeout/502: the original operation may already have committed. The API
does not retry business calls. A changed payload with the same ID receives 409.

Payment notice does not approve or issue tickets. A confirmed order may return a
null `paymentReportedAt`, because approval does not require a buyer notice.
Approval returns a count only, not the QR credentials; repeated approval preserves
the database's original ticket identities, times and terminal states.

## Public failures

Failures use `{ "error": "<stable_identifier>" }`.

- 400: `invalid_request_body` or `invalid_order_request`.
- 401: `authentication_required`.
- 403: `request_origin_not_allowed` or `operation_not_authorized`.
- 404: `order_not_found` (no distinction between missing and not-owned).
- 409: `sales_not_open`, `sales_closed`, `event_capacity_exceeded`, `request_id_conflict` or `order_not_pending`.
- 413: `request_body_too_large`; 415: `json_request_required`.
- 503: missing local/Supabase configuration.
- 502: `supabase_session_verification_failed` or `order_operation_failed`.

Clerk Development middleware can redirect anonymous requests for its browser
handshake before the handler. Only POST handlers are exported; Next rejects other
business methods. Current `/admin` and `/admin/requests` use independent layout
and reader authorization. Other admin pages, `/scan` and legacy APIs remain blocked.

## Verification evidence

From `web/`, run `& "../setup/Run-Web.ps1" -Command test` and `-Command lint`.
TypeScript was checked with `--noEmit --incremental false`. Recorded: **20 local
tests** (10 new mutation-boundary cases), types and lint passed. The HTTP suite
(`-Command http`) passed **8 tests** against the existing local listener, including
all three new endpoints with anonymous and forged headers. These probes submit
invalid payloads as a second no-write barrier and never use real signed sessions.

Fresh readonly hosted verification: events/orders/tickets remain 0, admin remains
1; MCP role `supabase_read_only_user`, `transaction_read_only=on`. No event seed,
hosted writes, app restart/build, Production, commit or push occurred in this block.
Successful signed PostgREST calls and the full payment-to-ticket flow are not yet
proven. Configure a separately approved Development event/test strategy first;
keep deliberate real-event publication/opening control. Miguel subsequently
withdraws the fixed October15 estimate: launch when app ready and he activates it.

Subsequent authorized test setup is prepared in [SIGNED-ORDER-TEST.md](SIGNED-ORDER-TEST.md):
one separate fictional published event, one fixed-ID synthetic order/two tickets,
no real Bizum. First signed admin-as-buyer run now reports PASS and readonly confirms
one confirmed order/two valid unused tickets. Final repeat also PASS; readonly
before/after fingerprint verifies original identities/issued times/states unchanged.
See the test contract for retained fixture scope and PowerShell copy-encoding note.
