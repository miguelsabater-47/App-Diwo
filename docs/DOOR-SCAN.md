# Online door scanner — local implementation

Prepared 2026-10-16. **Not certified for live use.** Miguel subsequently applied
the scanner SQL manually in the confirmed Development target and reported Success.
His catalog screenshot shows all four functions with expected security/search_path
and effective EXECUTE checks passing. His signed desktop `/scan` screenshot shows
the expected no-published-event state without shared navigation or configuration
error. These are user-supplied observations, not an independently executed hosted
audit or a successful check-in. No actual event has been published or ticket used.

## Contract

- `/scan`: current DB `admin` or `door_staff` only. Independent screen without
  public/admin navigation. Fixed allowed return destination by role.
- `/api/door-scan`: GET reads the canonical published `diwo-x-2-2026` event and
  operational counts. POST accepts exactly `{ eventId, token }` (UUID + persisted
  lowercase 64-hex bearer). Signed request-scoped client; no owner/service fallback.
- SQL: `supabase/drafts/door-scan-rpcs.sql` retains the reviewed source of the
  manually applied functions. It is not a recorded migration; do not auto-reapply.
  Requires foundation + `lock_order_actor` from the applied order-payment block.
  Public invokers/private definers with empty search paths, authenticated-only
  execution. No table grants, schema/role/event/fixture changes or new publication.
- Lock order: role SHARE -> published canonical event SHARE -> order UPDATE ->
  ticket UPDATE. Read ticket status again under lock. Transition `valid` to `used`
  once; existing trigger assigns server time and verified operator. Simultaneous
  devices yield one `admitted`, then `already_used`; no reentry or reactivation.
- Outcomes: `admitted`, `already_used` (original time), `revoked`, `unknown`,
  `wrong_event`. Unknown/other-event never return identity/name. DTOs never return
  QR tokens, buyer/operator subjects or payment information.
- Presentation simplified by Miguel on 2026-10-18: green **Entrada validada** only
  after admission in real operation, red **Entrada ya usada**, red **Entrada no válida**
  for revoked, unknown or wrong-event, without exposing extra technical states.
  Amber **No se ha podido comprobar**
  is a separate warning, never an incorrect-ticket judgment or admission. Shared
  `lib/door-scan-feedback.ts` projects outcomes for real scanner and rehearsal;
  no RPC/status/permission changes. Rehearsal keeps its simulation disclaimer.
- No arrival cutoff or sales-window enforcement at scanning. No exact address.
  Technical events are never a fallback or included in real event counts.
- Counts: U=used, P=valid unused, V=U+P; revoked excluded. Not occupancy. UI uses
  authorized read polling every 5 seconds (after each response), **not realtime**.
  No raw ticket/payment streams or additional subscriptions.

## Camera and failure behavior

- Explicit button starts the camera (QR only). Prefer native `BarcodeDetector`;
  absent/partial/failing native APIs fall back to bundled `jsqr` pinned at 1.4.0.
  Software loads lazily, not from a CDN, and decodes local canvas pixels only.
  Intended for Safari/iPhone too; **physical-device compatibility is unverified**.
  Frames are bounded to 960px on the longest side; pixel copies and the canvas are
  cleared after each software read and released when the session stops.
- One code per camera session; pause before POST and require another explicit
  button press after each result. Invalid codes never cause a write. Native
  multiple-code results reject the frame; jsQR returns the first located QR, so
  the operator must present one ticket at a time, as instructed on screen.
- Stop tracks on pause, result, backgrounding, unmount or loss of event/permissions.
  Ignore late camera work/receipts from obsolete generations. A pending POST has
  its own single-flight lock even if a counter refresh stops the camera.
- Token only lives in camera/request memory and POST body. Never URL, UI text,
  storage, console, analytics, exception response or logs in application code.
- Request timeout/network error is **unconfirmed**, never a green admission and
  never an automatic POST retry. A timeout may have committed. Only explicit new
  scan checks the live state; `already_used` remains a rejection, not retry success.
- Camera requires secure context. Local API intentionally accepts only
  `http://localhost:3000`; LAN HTTP/Production support is outside this block.

## Local checks and pending activation

- Observed first block 2026-10-16: API/model/gates 12 pass; isolated SQL 6 pass; real PG17
  concurrency runner 27 pass (includes existing order/staff coverage and four
  scanner races). TypeScript and focused ESLint pass. Disposable PG stopped and
  disposed. HTTP probe failed with ECONNREFUSED: no localhost:3000 listener; no
  app startup/restart attempted. This is a runtime prerequisite, not an HTTP pass.
- Subsequent continuation: Miguel explicitly authorized starting the local app
  for anonymous route probes, without his session or ticket consumption. Started
  using `setup/Run-Web.ps1 -Command dev`; listener on localhost:3000 is retained.
  Final focused run: **19 tests pass** (18 local API/model/gate/camera/decoder +
  1 live HTTP test). TypeScript and affected ESLint pass. No SQL was changed or
  rerun in this continuation. HTTP validates forged/anonymous denials and unchanged
  child/legacy gates. Next streaming can send status200 with an exact server
  `NEXT_REDIRECT;replace;/sign-in;307;` digest; the probe requires that digest AND
  absent protected scanner markup, never accepts HTTP200 by itself.
- Decoder/camera tests decode actual synthetic QR pixel buffers (rotation and
  inversion too), native failure fallback, late download/decode cancellation,
  stop-before-result, permission/playback/decoder errors and pending camera cleanup.
- Focused API/model/gate tests: `npm run test:scan`.
- Isolated in-memory SQL: `npm --prefix supabase/validation run test:scan`.
- Real PG17 concurrency runner includes scanner/rollback and scan-vs-annulment
  probes in disposable local data only; `Run-Web.ps1 -Command sql-race`.
- Anonymous/forged HTTP probes (existing listener only, no env read):
  `node --test tests/door-scan-http.test.mjs`.
- Remaining: signed write-RPC execution and full data invariant verification are
  not established by the catalog/empty-state screenshots. No remote write tools
  were used by the assistant; Miguel applied the exact file after scoped consent.
  Do not consume the four retained
  technical tickets or create new hosted fixtures without concrete authorization.
- Rendered desktop/mobile/focus/navigation/console, real camera/physical QR and
  accessible result interaction are **unverified**. Native decoder fallback is
  locally implemented/tested, not proof of physical iPhone use. Secure mobile
  origin and realtime counters remain incomplete. Actual
  event has not been published. Do not infer readiness from local tests.

## Designing the real scanner in local development

- There is one production interface: `DoorScanner`, including
  `renderDoorScanResult`, with `components/door-scanner.css`. Both `/scan` and
  `/admin/scan` render it. There is no separate visual prototype or on-screen
  fixture selector. **Abrir escáner** always starts the same camera lifecycle.
- Change `lib/door-scan-development-config.ts` outside the UI:

  ```ts
  export const doorScanDevelopmentConfig: DoorScanDevelopmentConfig = {
    enabled: true,
    outcome: "admitted",
  };
  ```

  Supported outcomes: `admitted`, `already_used`, `revoked`, `unknown`,
  `connection_error`. With injection enabled, the selected response is visible
  immediately, so no published event, camera or ticket consumption is required
  to inspect the final result screen. No extra labels or controls change its layout.
- Server injection requires **all** of: development runtime, exact
  `localhost:3000` Host, configured local canonical origin, Development key pair,
  and the page's independently verified current admin/door-staff role. Query
  parameters cannot enable it. The client also ignores injected data outside
  development. Production cannot activate this path by changing the config.
- Injected event/receipt DTOs are purely local presentation data. The scanner's
  transport returns them without fetching `/api/door-scan`; it does not read or
  mutate Supabase tickets. Page/session/current-role authorization still runs
  normally. Clicking **Abrir escáner** can use the camera, but any resulting
  check-in request remains local while injection is enabled. QR decoding,
  validation, generation cancellation and single-flight behavior are unchanged.
- Set `enabled: false` and reload to restore real event reads/check-in. Route
  keys remount the scanner when its source changes, stopping the previous camera
  and preventing a fictitious event ID from entering a real POST. Live mode may
  correctly show no published event; do not publish just to review a design.
- Local tests compare the complete rendered element tree for each injected
  response with the corresponding real-transport response. They also check zero
  mock GET/POST calls, Production exclusion, role/host/key gates, and restoration
  of real transport when disabled. This is not browser/phone rendering proof.
- The old `/admin/scan-rehearsal?design=1` bookmark redirects to `/admin/scan`.
  The technical camera/image rehearsal below is retained as an isolated test
  utility, not a dependency or alternate layout of the final scanner.

## Local camera rehearsal (not a hosted check-in test)

- Open `http://localhost:3000/admin/scan-rehearsal` with Miguel's admin session.
  Exact local route only, development runtime and Development keys only. Page
  checks current admin role independently of the protected admin layout. Production,
  other hosts, descendants, anonymous users and staff do not gain access.
- Uses the same `qr-frame-reader` and `door-camera-session` as the real scanner.
  The simulated state machine is separate browser memory, not another production
  API or a way around `/scan`'s published-event requirement.
- Four visibly fictitious QR cases: A valid, B revoked, C other event, D unknown.
  Payloads use `DIWO-REHEARSAL-v1:<random session>:<case>` and are deliberately NOT
  64-hex ticket tokens. The real API rejects them. Any real token shown to this
  rehearsal is unknown; the page never calls a scan RPC or persists the token.
- Take a photo of the QR A on the computer with a phone, then show that photo to
  the computer webcam after pressing **Abrir cámara del ensayo**. First result is
  **Entrada validada** with the simulation disclaimer; explicitly start again and
  present the same photo for **Entrada ya usada**. B/C/D yield **Entrada no válida**,
  all clearly simulated.
- Miguel has no webcam. The rehearsal now also offers **Descargar QR ficticio PNG**
  and **Cargar imagen del QR**. Download A and select the same PNG twice in the same
  tab without reloading: first simulated admission, then already-used rejection.
  The file input clears after selection so the same file can be picked again.
  This is a genuine local pixel decode using jsQR, not direct submission of the
  selected fixture, but still only a simulated admission and NOT a camera test.
- Image loading is rehearsal-only, never added to the real scanner or API. PNG,
  JPEG and WebP only, max5MiB, max8192px per dimension and16million pixels before
  canvas work; rendered longest side capped1600px. No upload, object URL, saved
  application image, network call or logging. Pixel copies/canvas/bitmap released
  after success/failure/cancellation. SVG/GIF and empty files reject safely.
- Camera/image reads share a single-flight generation guard. Cancellation,
  backgrounding and unmount ignore late image results; uploads cannot race camera
  starts. Decode failure/no QR never produces a simulated admission.
- Test **Simular fallo de conexión** before the first A scan: result is unconfirmed
  in simulation and A remains unused. This toggle does not disconnect the browser
  or verify real network failure behavior against Supabase.
- One QR at a time; stopping, backgrounding and unmounting stop the same camera
  session implementation. Reload creates a new synthetic session and makes old
  QR photos unknown. Separate tabs/devices do NOT share this simulated state.
- Camera on the phone itself still requires an authorized secure mobile origin.
  Do not expose the dev server to LAN/public tunneling or publish an event to
  circumvent this. Those operations are outside this rehearsal.
- Validation after simplifying headlines: 32 focused tests pass (including local UI
  callback/no-fetch/late-result tests and anonymous HTTP probes), TypeScript and
  affected ESLint pass. Authenticated rendered desktop/mobile/focus/nav/console
  evidence is partial, not a complete visual/accessibility audit. Miguel manually
  confirmed image-file first/repeated, annulled, other-event and unknown outcomes;
  later he confirmed iPhone camera first/repeated scans in the isolated tool below.
  These checks do not prove hosted check-in or full mobile/focus/console behavior.

## Isolated iPhone camera trial — completed and cleaned up

- `scripts/scan-https/server.mjs` and `client.ts` reuse only the shared camera,
  decoder, feedback and fictitious model. Fixed asset allowlist, no app/auth/config
  bundling, app proxy, hosted connection or real ticket token. No private-key files.
- Miguel explicitly authorized a temporary LAN HTTPS tool and certificate. His
  iPhone and Ethernet PC were on the same subnet. Two existing Public inbound
  Node block rules overrode the first narrow firewall allow; those blocks stayed
  intact. With separate consent, a verified copy of Node was used exclusively at
  `.diwo-tools/scan-rehearsal-runtime/node.exe`, and only the temporary allow rule's
  Program changed. The app executable and app listener were not modified.
- Manual result: Safari opened trusted HTTPS, camera read the fictitious A on the
  PC screen, first read showed **Entrada validada**, explicit second read showed
  **Entrada ya usada**. This confirms this physical camera/decoder path and local
  simulation, not synchronization, a hosted admission or which decoder was used.
- Trial is CLOSED: owned standalone process stopped after identity/port checks,
  ports3080/3443 confirmed closed, existing Next listener retained. Miguel confirmed
  removing the temporary certificate profile and `DIWO-QR-Rehearsal-iPhone` rule.
  Device/firewall removals are user-reported; agent had no device/elevated access.
  Do not recreate listeners, trust profiles or firewall exceptions automatically.

## Handler + real local PostgreSQL integration

- `supabase/validation/postgres-concurrency.test.mjs` now loads the CURRENT
  `handleDoorScan` and projects its actual Response DTOs from real PostgreSQL RPC
  rows. Test adapters supply synthetic authenticated claims and a psql RPC transport;
  this is NOT Clerk verification, Supabase/PostgREST or a live HTTP/mobile write.
- Five new integration scenarios: (1) two concurrent handler requests wait for a
  real lock and yield one admission/one used rejection only AFTER commit, matching
  U/P/V deltas and unchanged paid parent; (2) lost response after commit returns502,
  no automatic retry, explicit rescan rejects and preserves audit; (3) revoked,
  wrong-event and unknown reject without mutating tickets/parents or leaking bearer/
  subjects; (4) current DB role revocation defeats a stale app role; (5) a role
  revocation between read/recheck suppresses counters, and unpublished canonical
  event yields no fallback to technical events.
- Observed: PG17.11 runner32 tests pass (previous27 + five integration scenarios),
  focused handler5 tests pass, affected ESLint and diffcheck pass. No TS app sources
  changed in this continuation; no build/full application suite was run.
- Disposable loopback-only DB stopped/disposed after the run. No hosted SQL/data,
  retained ticket, event publication, app service, certificate or firewall change.
- Still pending: a separately scoped hosted signed PostgREST/write-RPC and
  multi-device check-in test. Do not claim that local claims/transport adapters or
  the physical simulation close this boundary, or publish the real party to test it.
