# Order screens — authorized implementation checkpoint

Miguel authorized connecting the existing request/payment-notice/admin-approval
flow to screens on 2026-10-12. This is one continuing task. The mandated visual
workflow requires first-screen rendered review before extending remaining pages.

## First screen: `/request`

Implemented signed-in form with buyer name, +/− quantity, one mandatory attendee
name per ticket, EUR500cent derived summary and current sales status. All buyer
roles use the form. Remaining names are preserved when quantity decreases.
Reference direction is the approved black/acid-yellow/white compact-card design;
Miguel reports the first form works so far; this is not a full desktop/mobile/
keyboard visual approval or an audit of every state.

Server reads only explicit event columns through the normal current signed client.
Selection is restricted to actual `diwo-x-2-2026`, published and with approved
title/location/timezone/price/currency/dates. A published technical test event is
never selected as a public purchase fallback. Fresh readonly check finds no actual
event row, so normal submission remains unavailable. Miguel explicitly withdrew
October15 as a required opening on2026-10-12: it was an estimate. Actual sales
follow the deliberately published canonical event's configured opening when the
app is ready, not a hard-coded calendar date. Party metadata remains unchanged.
No event setup/publication occurred.

## Continue to payment: admin local preview and real receipt

For a current DB admin in local Development while the canonical published event
is absent, Continue to payment validates the entered names and renders a clearly
labeled payment PREVIEW. Role is read in the server page; no client metadata grant.
Preview branches BEFORE UUID generation/persistence/business fetch, creates no
orders and reports no payments. There is no technical-event fallback. User/staff
do not receive preview permission. A keyed remount isolates user/event/mode changes.

Preview displays quantity/500cent total, entered attendees/buyer, an explicitly
sample concept and unconfigured recipient. Back returns to the same form inputs.
Its payment notice button now simulates the reported state locally (explicit demo
message, no fetch/orderId or stored notice). Clipboard payment-data actions remain
disabled. It demonstrates layout/states, never a stored request or valid reference.

A real pending receipt uses the same payment component with actual reference,
buyer/total and validated recipient configured privately as `DIWO_BIZUM_PHONE`.
The blank field is added to `.env.example`; no real phone was collected and no
private env was edited. Phone is sent only when real sales are open, not preview.
Real phone/concept/amount can be copied. The buyer's payment-notice action calls
existing POST `/api/orders/report-payment` with only orderId, no automatic retry.
Verified response remains pending; only independently confirmed response shows
confirmation. Missing phone disables the real notice button until configuration;
admin approval still does not require a buyer notice. Preview never calls it.

When valid sales are open, the form calls POST `/api/orders/request`. Before
sending, it stores UUID AND exact payload in sessionStorage scoped to signed
account/event/tab. It blocks duplicate clicks, freezes submitted content and
offers only manual same-submission retries after ambiguous failures. A keyed
component remount isolates account changes; loading never triggers a writer.
If persistence fails, no request is sent. Name/schema/actualUTF8 body size checks
precede writes;64KiB is technical transport, not an attendance cap. API/SQL remain
the authoritative authorization, sales, idempotence and money boundaries.

Safe receipt verifies original ID/reference/state/quantity/total; the same draft
is retained through reload for exact replay. New logical submissions need an
explicit new-order action in the continuing flow, not silent UUID replacement.

External bottom navigation Inicio/Mis entradas/Mi cuenta is added, with safe-area
space and visible focus. Account links to `/request`. Existing Home/account remain
bootstrap screens pending their role-aware continuation; no final identical Home
for all roles is approved. No privileged routes were unlocked in this checkpoint.

## Rendered review needed now

At `http://localhost:3000/request`, signed in:

1. Desktop: inspect two-column form/summary, readable text and complete controls.
2. Mobile390×844: inspect single-column stacking, horizontal overflow, scrolling,
   bottom navigation, summary and button visibility.
3. Use synthetic names only. Increase to3 attendees, fill names, decrease to2;
   remaining names should stay and total should change15EUR→10EUR.
4. Tab/Shift+Tab: visible focus, labeled inputs, +/− and navigation keyboard access.
5. As current admin, refresh and click Continue with dummy names: payment preview
   should show the same count/total/names and return correctly without mutations.
   Normal users still see sale preparation while no event is published. Check console.

No usable browser automation is exposed in this session. User-provided rendered
review is required; types/HTML/logic tests cannot substitute for it. Do not claim
desktop/mobile rendered approval from the checks below.

## Checks and remaining authorized work

TypeScript without incremental and ESLint pass. Local25 tests, HTTP8 and SQL72 pass;
SQL verifies the updated unpublished event template without a fixed estimate. HTTP
tests include anonymous rejection of `/request`; no signed UI writer test occurred.
Database remains technical event1/order1/tickets2; no hosted writes, lifecycle,
build, roles, Production, commit or push in this checkpoint.

Miguel now confirms preview notice works and asks to continue. Mis entradas own
reads, management Summary/Requests/current-role approval UI, role-aware Home/account
and separate navigation are implemented. Details: [ORDER-READS.md](ORDER-READS.md).
Only admin root/requests page exceptions are active; other admin pages/scan/legacy
remain blocked. Screen wiring is implemented; **signed rendered data/approval and
full UI audit remain pending**. Bizum phone configuration
will be handled privately, and real event setup needs separately scoped approval.
QR renderer/download/scanner and remaining state writers need their own contracts;
do not draw demo QR or present unavailable operations as implemented.
