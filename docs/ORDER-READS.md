# Owned order reads and guarded management screens

Implemented 2026-10-12 within Miguel's authorized request/notice/approval UI flow,
after he confirms the local simulated notice works. No schema/role/hosted-write
change; actual event and publication remain pending. This is Development only.

## Authorization and data boundary

- `createSessionSupabaseClient` adds `actorId` from verified server `auth().userId`
  for INTERNAL filtering. It is not returned by diagnostics or response DTOs.
- Personal reads explicitly filter `orders.buyer_clerk_id = actorId` for every
  role, INCLUDING admin. RLS alone is not enough to make an admin view personal.
- Management reads require current DB admin. One signed request client performs
  role lookup before and after the buffered multi-request read; revoked privilege
  fails closed. Table RLS independently protects every query.
- Only named safe columns are selected. No QR, raw subjects, service-role client
  or editable-metadata permissions. Projection validates counts/price/state,
  event/positions/names and preserves used/annulled history; partial issuance
  or changing snapshots show an error and explicit refresh instead of fake data.
- Exact-count pagination handles server limits below500 and rejects count drift,
  duplicate identities or incomplete ranges. IN lists use50 IDs per query. These
  are transport choices, not attendance capacity. Reads are not transactionally
  atomic across PostgREST requests; this is not realtime proof.
- Pages are force-dynamic; no privilege/client cache is retained across requests.

## Screens and current controls

- `/ticket`: own mixed/pending/reported/confirmed/rejected/cancelled orders and
  valid/used/annulled tickets. Pending notice uses the existing API, initializes
  reported status from real timestamp and refreshes after a real notice. Used/
  annulled tickets are not valid admissions. `/ticket/[id]` now reads an owner-only
  detail with persisted QR; valid-only PNG/JPG and one-click native sharing are
  user-confirmed in Chrome. No illustrated fake QR. See [OWNED-TICKET-UI.md](OWNED-TICKET-UI.md).
- Explicit new-order action clears only an acknowledged owned draft. Unknown/
  corrupt submissions remain for same-ID recovery, never reset automatically.
- `/admin`: management layout/summary. `/admin/requests`: pending-priority list,
  buyer/reference/quantity/total/attendees, notice separate from approval. Only
  pending rows expose approval; checkbox acknowledges manual bank check. API
  accepts only orderId, rechecks current role and issues via existing atomic RPC.
  Client validates same confirmed ID/N/timestamp, never auto-retries.
- Admin layout AND each data consumer authorize independently. Only these two
  page routes pass the earlier namespace stop. Old `/api/admin/*`, other admin
  pages, `/scan` and retired redemption remain blocked.
- Admin Home has yellow management card, REAL actual-event pending shortcut and
  visibly unavailable scanner card. User/staff share public Home. Admin keeps
  personal tickets/buyer actions; account role cards use current DB role.
- Account profile/settings both open the existing native Clerk UserProfile modal,
  without experimental start-page options or changing auth policy/role mapping.
- Admin bottom navigation is separate: Summary/Requests active, Tickets/Staff
  disabled. External bottom navigation does not overlay management.

Technical fixture is marked in history/management and excluded from actual DIWO
financial/admission summary. Stats are manually refreshed, not live occupancy or
a new Door Staff financial feed.

## Evidence and next rendered review

Types (no incremental), full+final focused ESLint, local32/HTTP8 and tracked diff
check pass. HTTP includes anonymous/forged-Clerk/middleware-subrequest headers on
new pages plus unchanged legacy denials. Model tests cover admin-own binding,
role denial, count paging/drift, safe projection/history/mismatch and fixture
exclusion. This is not a signed other-buyer/browser approval demonstration.

Fresh hosted readonly/on: canonical event0, technical event1/order1/tickets2/admin1;
original ticket identity/issued-time/state fingerprint unchanged. No hosted writes,
new fixture, schema/roles/env edits, restart/build, Production, commit or push.

At localhost3000 in Miguel's admin session, review:

1. `/ticket`: TWO retained technical confirmed orders/FOUR test tickets at the last
   verified fixture checkpoint, clearly not actual DIWO tickets. Miguel confirms
   their detail/QR/downloads and Chrome sharing. No new order is needed to inspect.
2. `/admin/requests`: same technical order ALREADY confirmed, so no approve button.
   Pending approval UI test is now separately authorized for ONE second synthetic
   order/two additional tickets. Creation and manual UI approval now verified; see
   [UI-APPROVAL-TEST.md](UI-APPROVAL-TEST.md). Do not reopen the first paid order.
3. `/admin`: actual-event summary is ZERO because fixtures are excluded, not
   missing payment data. Home has management direction and pending shortcut.
4. `/account`: panel/tickets/profile/settings/logout; signout shows public Home.
   Existing other registered account should see only own data and be denied admin.
5. Desktop/mobile390×844, tab/focus/navigation/scroll/overflow/console and header/
   footer completeness. No automated rendered browser is available this session.

Current checkpoint (2026-10-13): user confirms earlier form/payment PREVIEW,
technical approval and signed own ticket detail/real QR/PNG/JPG/one-click Chrome
selector. This is not a complete UI audit, other-buyer/role-revocation review or
independent hosted detail-grant/history check. Earlier evidence/counts in this
section are historical. Full F09/scanner/staff/cancel/annulment/actual event/Bizum
recipient/release/Production remain pending.
