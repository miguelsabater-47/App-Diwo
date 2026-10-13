# Authorized signed technical order test — 2026-10-12

Miguel explicitly authorized one separate published technical event, one synthetic
order and two issued tickets, retained as test records. No real Bizum is required.
This is a Development-connected integration fixture, never an early opening of
actual DIWO sales. Miguel subsequently withdraws the October15 estimate on2026-10-12;
actual sales are activated deliberately when the app is ready. The retained signed
test evidence/fixtures are unchanged by that later product decision.

## Fixed fixture contract

- Technical event: `9d560641-aacf-4d25-8d65-94960bba59b2`, slug
  `diwo-technical-test-20261012`. Title explicitly says it is not valid for DIWO.
- Technical request/order: `0efaab8d-b894-4df3-a00a-4255a302d9ba`.
- One synthetic buyer name, two synthetic attendees, quantity2/total1000 cents.
- Dates in2020 make the fictional event visibly distinct and permit testing the
  unchanged sales guard. All ordinary actor/role/state guards remain active.
- Reuse these fixed IDs and exact payload on reruns. No resets/new IDs/deletions.
- The event is published synthetic metadata. Test rows stay in the database;
  any later exclusion from actual event metrics is by event identity.

## Step 1 — owner event fixture

Open `supabase/drafts/technical-test-event.sql`, copy its full contents and execute
in **App Diwo's SQL Editor as postgres**. No private substitution is needed.
The current MCP connector stays readonly, so this one owner operation is performed
by Miguel. The template creates only the exact technical event, verifies existing
fixtures instead of overwriting them, and rolls back on a conflicting ID/slug.
It does not insert orders/tickets or change actual events/roles/permissions.

The agent verifies the event using readonly SQL before the browser test.

## Step 2 — signed browser test

1. Open `http://localhost:3000/account` and sign in with the confirmed Development
   administrator. Keep this origin; do not use numeric loopback or a published app.
2. Open the browser's Developer Tools console.
3. Inspect and run the full contents of `scripts/test-order-flow.browser.js`.
   It uses same-origin authenticated fetches; it never accesses/prints raw tokens,
   cookies, Clerk IDs or QR credentials. No values need to be copied into it.
   To copy the entire file reliably in Windows PowerShell5.1, use explicit UTF-8:

   ```powershell
   Get-Content -Raw -Encoding UTF8 -LiteralPath "C:\Users\Miguel\Proyectos\App Diwo\web\scripts\test-order-flow.browser.js" | Set-Clipboard
   ```

   Then paste into an empty browser console input without copying another text
   first, and run with Ctrl+Enter if using multiline console mode.
4. Report only `DIWO_TECHNICAL_TEST_PASS` or `DIWO_TECHNICAL_TEST_STOPPED` and its
   safe summary/code. Do not send network dumps, private URLs or full screenshots.

The script verifies admin session, creates/repeats the same request, rejects changed
payload with409, reports/repeats notice, approves/repeats approval, then repeats
the original request after confirmation. The intentional changed-payload409 may
appear red in the console; it is an expected negative check.

There are no automatic retries after errors. The script stops on first unexpected
response. Re-running the SAME script resumes with the same logical order and can
preserve existing confirmed output. `startedPending` distinguishes the initial
pending-to-confirmed run from later confirmed reruns.

## Step 3 — readonly hosted verification

Verify the exact technical order's event, synthetic names, quantity/total, notice,
confirmed state/time and exactly two tickets at positions1/2. Inspect safe state
and counts only; never read QR credentials or actor subjects. Record whether
ticket identities/times stay stable across a repeat run before claiming that
property proven through this signed path. A count alone proves no extra tickets,
not preservation of every underlying identity.

The signed test uses one admin account as both buyer and approver. It does not
prove a second buyer's ownership isolation, real nonadmin denial, role revocation,
check-in/annulment/QR delivery/full F09 or Production. Those require their own tests.

## Prepared evidence

Local disposable PGlite test passed: exact fixture/idempotent replay, preservation
of the real-event fixture, ordinary-role denial, conflicting-row rollback and no
order/ticket writes. This mock-owner test is not evidence of hosted fixture creation
or signed API success. Browser script syntax and targeted ESLint passed.

**Owner event fixture is now executed and verified.** Miguel reports the expected
SQL result without errors. Fresh readonly verification confirms exact identity,
metadata/dates/price/publication, events1/orders0/tickets0 and connector readonly/on.
That was the owner-fixture checkpoint; the first signed result is recorded below.

## First signed result — verified 2026-10-12

Miguel's browser reports `DIWO_TECHNICAL_TEST_PASS` with six completed checks,
confirmed order/quantity2/1000cents/issued2. The deliberate changed-payload409 is
expected. Fresh readonly verification confirms one event/one order/two tickets,
exact technical event/attendees, reported+confirmed payment, current admin as
buyer+approver, and both ticket positions valid/unused with matching names/event.

The first PowerShell copy instruction omitted `-Encoding UTF8`. Windows
PowerShell5.1 decoded BOM-less UTF-8 using ANSI: the buyer name's accented letter
was mojibake. Boolean readonly comparison confirms that specific transformation;
no real buyer data is involved. The API stored the submitted name faithfully.
Keep the immutable original order; do not rename it or create a replacement.
The browser script now uses ASCII Unicode escapes for that existing synthetic
spelling so future copies replay the EXACT stored payload on the SAME fixed UUID.
New copy instructions explicitly use UTF8.

## Final replay — verified 2026-10-12

Miguel reruns the updated SAME script and reports PASS/six checks. Fresh readonly
verification confirms events1/orders1/tickets2, exact immutable buyer spelling,
attendees/event, confirmed order/quantity2/1000cents and both tickets valid/unused.
The ordered ticket-ID/issued-time/state fingerprint is identical before/after:
`761e49cbdfa2b5b74160db24a338f0a5`. No ticket identities, issuance timestamps or
states changed, and no extra orders or tickets were created. The authorized
technical test is complete; fixtures are retained. The scope limitations above
still apply. MCP remains readonly/on; actual DIWO sales timing is unchanged.
