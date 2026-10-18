# Isolated hosted scanner test project

Target: **`diwo-scanner-test` ONLY**, a separate empty Supabase project manually
created by Miguel. Never use the original App Diwo project or its retained tickets.
No management/SQL MCP tools are available in this session; hosted steps are manual.

## Current scope

Miguel reports all five preflight checks true: no public events/orders/tickets/
user_roles tables and no diwo_private schema. This is user-provided evidence, not
an independent project identity check. Confirm the dashboard project name before
every SQL operation; the empty-state guard cannot determine a Supabase project name.

1. Open `scanner-test-install.sql` and copy the COMPLETE file into a new SQL Editor
   query on the new test project, using the `postgres` role. Run once.
2. On Success, run the COMPLETE `scanner-test-verify.sql` in a new query. One row,
   eleven boolean checks should all be true. No QR, personal IDs or secrets output.
3. If any statement fails, stop and inspect the error. Do not reset, drop, remove
   guards, retry a partial selection or run the original application's repair SQL.

The installer is one transaction and **deliberately not idempotent**: repetition
fails closed before modification. A partially selected file has no such guarantee;
always run the complete file. It rejects preexisting DIWO schemas, tables and public
role/counter/scanner function names. There is no overwrite or rollback-by-deletion.

## What is installed

- Exact reviewed foundation (RLS, domain guards, immutable identities, retained
  paid history, exact-N constraints, private QR column and baseline reader RPCs).
- Exact `lock_order_actor` helper from order-payment RPC source, direct execution
  revoked from API roles. No order creation/payment/approval writer API is installed.
- Exact reviewed scanner RPC bodies and grants; privileged operations still need
  a verified Clerk subject with a current DB admin/door_staff role.
- Inert schema comment `DIWO_SCANNER_TEST_ONLY_V1 - isolated empty scanner project`.
  No extra exposed environment helper, API key, JWT, subject or real fixture.

There are **zero application-role, event, order and ticket rows** after installation.
It does not enable a Clerk provider, change managed auth functions/settings, switch
the application's Supabase destination, publish the real party or modify migration
history. The original reviewed sources remain untouched. No credentials are needed
in the SQL or collected by the assistant.

## Verification and next boundary

Local `supabase/validation/scanner-test-install.test.mjs`: eight tests pass using
disposable PGlite SQL/auth mocks, including exact-source drift detection, empty/RLS/
ACL checks under broad default grants, repeat/occupied-target protection, API-role
denials and full rollback after an injected final failure. This is NOT signed hosted
auth or proof the file has been applied. A separate PG17 runner already validates
the original scanner/handler under local claims, not this new hosted installation.

Run local installer checks from web: `npm --prefix supabase/validation run test:scanner-install`.

Next, ONLY after hosted installation/verification: configure native Clerk Development
integration for this target, verify the actor again, then prepare separately scoped
and visibly technical fixtures in this isolated DB. Do not copy original user_roles,
reuse Production identities, collect session tokens/secret keys or add an owner/
service-role fallback. Do not change the running app's configuration or reopen LAN/
firewall/certificate access implicitly. No real event publication is authorized.

## Native signed read check — pinned separate target

Miguel provided sandbox Project ID **`ofqywrjvzolmoqimkngt`** and reports installer
Success, all eleven verification checks true and the native Clerk Development
provider added to this test project. These are manual reports, not signed evidence.

Use `scripts/verify-scanner-sandbox-session.browser.js` in the browser console of
the existing signed-in `http://localhost:3000` app. Read the script before running.
It only calls the pinned sandbox's `get_current_app_role` RPC (SQL stable read),
not original app APIs or scanner writers. No app env/destination changes required.

- Copy ONLY this sandbox's **Publishable key** (`sb_publishable_...`) from its
  Dashboard API Keys into the script's browser prompt. Not a Secret key, legacy
  service-role key, password or JWT. Never send any credential in chat or embed it
  in the script. Prompt value and native Clerk token stay in invocation memory;
  no cookies/storage or console identity/token dumps.
- Script obtains `Clerk.session.getToken()` without a legacy template. It checks
  exact localhost origin and original session/account throughout async work;
  changed session IDs are compared with an immutable snapshot, not a mutable SDK
  object's current value. No anonymous/owner fallback or automatic retry.
- Native JWT goes only in Authorization; public key only in apikey. Cookies omitted,
  redirects rejected, no-referrer/no-store, 15-second request timeout. One request
  guarded against duplicate execution. No grants/bootstrap/event/ticket writes.
- Expected new-target role: **`user`**, because no role rows exist in the sandbox.
  Being admin in the original database does NOT grant privileges in this one.
- Share ONLY the bounded output `DIWO_SCANNER_SANDBOX_AUTH_PASS` or
  `DIWO_SCANNER_SANDBOX_AUTH_STOPPED` with its safe reason. Never share the Network
  panel, prompt contents, request headers, token, account ID or an unfiltered console
  screenshot. Failures stop; diagnose before repeating or changing any configuration.
- Seven mocked-browser tests pass, including exact target/request, key and session
  guards, no credential logs, async session mutation and duplicate lock. They are
  not a live hosted result; native signed sandbox read is still awaiting manual run.

No need to reopen the completed LAN/certificate/firewall trial for this check.

## Minimal signed scanner test — authorized 17 October

Miguel supplied `DIWO_SCANNER_SANDBOX_AUTH_PASS`, role `user`, writes false.
He authorized fictional fixtures and test privileges **only in diwo-scanner-test**.

Use `scripts/test-scanner-sandbox.browser.js` from the signed-in localhost console:

1. Run the complete script; supply only the sandbox Publishable key in its prompt.
   With role `user`, it copies one complete SQL transaction to the clipboard using
   Chrome DevTools `copy()`. It obtains the current subject from the native session;
   no ID transcription, credential logging or client-side privilege grant.
2. Paste ONLY into **diwo-scanner-test** SQL Editor, role `postgres`, and run the
   complete transaction once. Expected `DIWO_SCANNER_FIXTURE_READY`. Its marker and
   empty-table guards reject the original/unmarked or already-populated target.
3. Rerun the same browser script and supply the sandbox Publishable key again.
   Expected `DIWO_SCANNER_SANDBOX_PASS`: valid admitted, repeat denied, revoked
   denied, two parallel HTTP scans admitting exactly once, counters U2/P0/V2.

The fixture retains one sandbox-only admin bound to the verified current account,
one loudly fictional event using the scanner's required canonical slug, one fictional
confirmed order and three tickets (one revoked, two consumed by the test). Known
fixture QR values are **not real tickets** and must never enter the original DB.
No new API functions/grants, payment writers, trigger bypasses or app env edits.
Do not paste the generated SQL/subject into chat. Share only the bounded result.

On STOPPED do not reset/retry/reseed: scans may already have committed. The script
does not automatically retry and refuses a consumed fixture. Parallel HTTP requests
exercise the hosted RPC, but are not proof of two physical phones or the camera UI;
local deterministic lock/concurrency evidence remains in the existing PG17 tests.
Focused local validation: run `node --test scanner-sandbox-flow.test.mjs` from
`supabase/validation` using the project-local Node runtime. Hosted run is pending.
