# Second technical order — manual UI approval test

Miguel explicitly authorizes on2026-10-12 a SECOND synthetic pending order with
two additional tickets after manual UI approval, retained in the EXISTING technical
event. No real Bizum; no reopening/deleting the first paid order, new event, actual
sales publication, roles, Production or commit/push.

- Event: `9d560641-aacf-4d25-8d65-94960bba59b2` (existing fictional published event).
- New fixed order: `57c58ec8-9537-4c5c-a573-5e2b8350f9c9`.
- Buyer: `Comprador PRUEBA UI 2`; two explicitly fictional ASCII attendee names.
- Quantity2/1000cents. Original order/two tickets stay untouched.

## Execution

1. Stay signed in as admin at localhost3000. Copy the FULL creation-only script:

   ```powershell
   Get-Content -Raw -Encoding UTF8 -LiteralPath "C:\Users\Miguel\Proyectos\App Diwo\web\scripts\create-ui-approval-test.browser.js" | Set-Clipboard
   ```

2. Paste into empty browser DevTools console and Ctrl+Enter. The script checks
   current signed admin, creates/replays SAME request, then stops. It never reports
   or approves payment or prints credentials/subjects/QR. No failure auto-retry.
3. Report `DIWO_UI_APPROVAL_TEST_READY` plus safe summary/code. Agent verifies
   exact pending fixture/zero new tickets in readonly before manual approval.
4. Open `/admin/requests`, locate `Comprador PRUEBA UI 2` with Pending status,
   TWO synthetic attendees/10EUR. Checkbox explicitly acknowledges a technical
   fictional test, not a bank receipt. Only this known technical event uses that
   wording; real orders still require manual bank-check acknowledgment.
5. Click `Aprobar solicitud técnica y emitir entradas` ONCE. Inspect confirmed
   status and `/ticket`. Agent readonly verifies exactN additional issued tickets,
   original fingerprint unchanged, total events1/orders2/tickets4.

If stopped/unexpected output, preserve script/UUID and report safe code; do not
generate another UUID or reset the original order. Confirmed reruns are safe and
reported as already confirmed rather than reopening payment.

## Prepared evidence

Fresh preflight readonly/on events1/orders1/tickets2, technical sale ready, original
fingerprint unchanged. Local creation-script3 mock tests verify one fixed order,
no approval/notice call, wrong-role denial and failure stop without retry. These
do not prove signed execution or hosted insertion.

Creation now verified: Miguel reports READY; fresh readonly confirms events1/
orders2/tickets2, exact new technical buyer/attendees/qty2/1000cents, pending with
no payment notice/confirmation and ZERO new-order tickets, current admin buyer.
Original fingerprint remains unchanged at that checkpoint.

## Manual UI approval complete

Miguel reports the checkbox/approve result correct. Fresh readonly independently
verifies the SECOND order confirmed/qty2/1000cents, exact event/buyer/attendees,
current admin approver also the test buyer, no prior payment notice required,
EXACTLY two new valid-unused tickets at positions1/2 with matching names/event.
Totals: events1/orders2/tickets4. Original identity/issued-time/state fingerprint
remains `761e49cbdfa2b5b74160db24a338f0a5` unchanged. The manual UI approval test
is complete; both synthetic orders/four tickets are retained. No real Bizum,
actual release, QR delivery, scanner/other-role/full rendered audit proven here.
