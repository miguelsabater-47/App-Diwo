# Two-step login

User-approved 2026-10-13. Functional baseline commit: `ca99363`; implementation
branch: `feat/login-two-step`. No roles, Supabase, hosted configuration, SDK
upgrade or Production changes. Registration remains the existing native Clerk UI.

2026-10-14 checkpoint: Miguel reports “si, funciona correcto, haz commit del login”
after the browser-check request and authorizes the local commit, with no push.
This is user-reported confirmation; detailed prior limitations below remain
historical evidence rather than a claim that every recovery/keyboard case was run.
Latest application suite:74/74; focused boundary tests4/4 and targeted lint pass.

## Presentation and navigation

- Password-field correction (2026-10-14): editing and the visibility toggle stay
  available during pending sign-in or SDK-readiness loss. Only submission remains
  locked/readiness-gated; no duplicate or automatic request is introduced.
- Toggle and explicit submission reconcile the current native input value in case
  browser autofill did not emit a React change event. No input remount, storage,
  URL transport or logging is used. Toggle retains pointer focus; focusing the
  field itself never changes visibility. White text/caret and explicit masked/
  visible text-security styles reinforce native password/text types; the native
  Edge reveal control is suppressed so it cannot compete with the app's toggle.
- A real mounted React/Chrome baseline probe showed correct dots/show/hide with
  typed synthetic input, but reproduced locks when readiness dropped or a request
  stayed pending. Genuine saved-password autofill and the user's black-rendering
  symptom were not reproduced; styling is defensive, not a proved root cause.

- Post-login update (2026-10-14): all completed sign-in/signup/Google destinations
  now point to Home `/`, as explicitly requested. Account remains reachable from
  the avatar, not the automatic landing page; logout still returns to `/sign-in`.
- Custom password completion waits for `setActive`, then performs one guarded
  document replacement to `/`. It no longer races `router.replace` with
  `router.refresh` or a second signed-in effect. Existing active sessions take
  the same path; native Clerk continuations retain control over their own tasks.
- The transition status is «Abriendo Inicio…», with a real document link
  «Ir a Inicio» so a stalled client router cannot leave a screen with no escape.
  Route-level `app/loading.tsx` provides neutral accessible loading feedback.
- Anonymous local HTTP timings before this correction: signin327/247ms,
  account237/238ms and ticket222/210ms. These measure local response arrival,
  not authenticated permission/database latency, browser hydration or the user's
  network. They do not establish the cause of general slowness or prove speedup.

- Recovery fix (2026-10-14): the forgotten-password link now opens the existing
  native Clerk sign-in page `/sign-in/clerk` immediately, with no reset-code API
  request in front of navigation. Select password recovery in that native form;
  this is not a guessed internal forgot-password URL. Clerk owns identification,
  code delivery, verification and password reset. No email/password is placed in
  the URL or storage to transport the custom form state.
- `needs_client_trust`, when returned by the provider, is handed to native Clerk
  like other incomplete factors, never activated or reported as wrong credentials.
  Current installed legacy declarations do not list that newer documented state;
  this is defensive runtime compatibility, not proof of the user's account cause.
- User reports both recovery failing to navigate and a newly reset password not
  working. The blocked-navigation dependency and omitted-state failure were
  reproduced locally; the actual account/password outcome remains unverified.

- Signup has a visible arrow/`Volver` link above the native form returning to
  `/sign-in`, with keyboard focus and a touch-friendly target.

- Logout now targets `/sign-in` in both the provider and account action. Anonymous
  Home requests redirect server-side; the app shell hides content/navigation while
  auth loads and redirects signed-out visitors. Auth routes and `/setup` remain
  accessible. Existing server/API/database authorization is unchanged.
- Signup email/password fields have scoped black/white/gray styles, including
  autofill, and a thin yellow focus border. Miguel confirms first/last name were
  made required in Clerk Development; that setting is not simulated by local CSS.
  Local boundary regressions cover anonymous/loading access, retained signed-in
  buyer/admin views, native auth/setup access and logout destination. Independent
  isolated probes passed; actual browser logout and signup styling still require
  rendered confirmation. No new account or hosted auth operation was performed.

- `/sign-in` displays the supplied Google/email screen, then a password screen.
  Email-format validation is local, not an account-existence lookup or sign-up.
- Back/change-email preserve email only in component memory, clear password/error
  and focus the email input. Initial mobile arrival does not autofocus the email
  and open the keyboard. Continue focuses the password. Password managers, paste,
  visibility toggle and Enter submission are supported.
- Browser Back from the locally pushed password-step history entry returns to the
  email step. Superseded/unmounted password results cannot activate a new session.
- Auth-only `AppChrome` hides shared header/navigation on sign-in/up/callback;
  buyer/admin layout outside those boundaries is unchanged. This is presentation,
  not authorization. Existing middleware/server/DB guards remain authoritative.
- Original user-supplied SVG saved without path reconstruction at
  `public/brand/diwo-club.svg`. Satoshi weights300/400/500/700/900 loaded from local
  `public/fonts`, scoped to the auth shell. Variable font file is not required.
- #000000 canvas and #FCE921 accent. Reference402×874; no white device frame.
  Email/password focus uses the existing 1px border in yellow, without an added
  outer shadow; other controls retain their keyboard-focus outlines.
  Flexible height/scroll/safe-area padding, smaller logo for short windows and
  reduced-motion support. No fixed screenshot-sized viewport or hidden overflow.

## Clerk boundary

Installed Next.js SDK6.39.7 legacy `useSignIn` API is retained. Email/password calls
`signIn.create({ strategy: 'password', identifier, password })` once. Only complete
with a nonempty createdSessionId calls `setActive`, then opens Home `/` once.
Partial first/second factor or password-reset states go to `/sign-in/clerk`, the
native SignIn continuation under the existing catch-all, with base path matching.
No public error displays raw provider messages, passwords, subjects or tokens.
Already signed-in users open Home instead of being offered another login;
controls wait for both Clerk auth/sign-in initialization.

Google uses `authenticateWithRedirect` and `/sso-callback` with the official
`AuthenticateWithRedirectCallback`; successful destination `/`, native
sign-in continuation `/sign-in/clerk`, native registration `/sign-up`.

Forgot-password opens `/sign-in/clerk` directly. Select recovery inside the native
form, which owns identification, email delivery, code verification and reset.
The previous baseline attempted `reset_password_email_code` before navigating;
that dependency has been removed. No custom API call can now block opening the
native access page. This is not direct navigation to a native forgot-password
subview, whose internal URL was not established for the installed SDK. Actual
delivery/reset/login still require the user's Development browser session;
mocked tests do not certify the affected account. Error state also exposes the
same native sign-in entry if an account needs another Clerk method.

In-flight lock prevents duplicate action requests. Going back supersedes the UI
attempt; pending provider work is not automatically retried. No email/password in
URLs, storage, logs, analytics or fixtures. Only synthetic `example.com` test values.

## Checks and limitations

Runners: `& '..\setup\Run-Web.ps1' -Command test`, `-Command check`, `-Command lint`.
Focused: local Node `--test tests/login-flow.test.mjs tests/login-screen.test.mjs`.
RED observed for missing flow/component; subsequent core/component GREEN recorded
in `odd/tasks/login-two-step.md`. Real Chrome mobile/desktop/focus/navigation and
console review, Google login, email/password session and native recovery/MFA
continuation require separate browser evidence. No login implementation commit or
publication is implied by these checks; user authorized the baseline commit only.

Independent Chrome headless rendering observed at402×874/390×844/320×568/1280×900:
both screens, actual five Satoshi weights, logo/black/yellow, no horizontal overflow,
password focus/show-hide and change-email return. 320px requires vertical scrolling.
No captured runtime/hydration errors; screenshots are external temporary artifacts.
Native registration/continuation GET pages render. This did not submit credentials,
Google or recovery; Clerk issued its usual automatic initialization/telemetry
requests when pages loaded, so this is not a claim of zero SDK network traffic.
Full keyboard Tab/Back-Forward sequence and real mobile keyboard still need review.
Independent initial suite67/67 and targeted signed-in correction69/69 passed;
latest additional readiness regression is recorded separately in the feature log.
Final parent suite after persisting readiness probe:70/70 passed. Current source
typecheck/focused lint pass; full lint retains only the baseline QR image warning.
No signed browser credentials were available to certify real authentication.

Auth correction checkpoint (2026-10-14): observed new regressions RED4/17 then
GREEN17/17; complete application suite78/78, TypeScript and focused ESLint pass.
Independent scratch baseline/current comparison reproduces blocked recovery on
rejected/pending reset requests and rejects/continues device trust respectively;
80-case activation matrix and focused17 pass. Actual affected-account login is
still unverified. Pending Home changes were preserved; no credential operations,
hosted changes, commits, server restart or dependencies were involved.

Home-landing checkpoint (2026-10-14): before implementation, changed-destination,
single-navigation and loading regressions observed RED7/15; after correction,
focused17/17, full83/83 and TypeScript pass. Initial targeted ESLint flagged the
intentional native escape anchor; one documented line exemption preserves its
full-document behavior instead of silently turning it into another client route.
Independent deferred-activation comparison observed baseline early `/account`
replacement, another replacement and refresh; current waits for activation and
performs one document replacement `/`. Native signed-in continuations remain
mounted. This demonstrates removal of overlapping operations, not reproduction
of the user's actual browser freeze or proof that all transitions became faster.

Password-field checkpoint (2026-10-14): new editing/readiness/DOM-autofill tests
observed RED4/16, then GREEN16/16; full suite88/88, TypeScript and targeted ESLint
pass. Independent mounted React/Chrome recheck at430×900 (mobile emulation) and
1280×900 passed: hidden dots, immediate visible text, hidden-field focus stays
masked, eye preserves selection, same input node, white fill/caret, editable fields
after rejection/readiness loss and while a provider request is pending. Duplicate
sends remain blocked; the original request's credential snapshot stays unchanged;
only an explicit retry sends the corrected value. DOM injection without change
events was verified, not genuine saved-password autofill. No hosted auth/session
or physical-device test was performed; full global CSS/extensions remain outside
that isolated harness. Final parent strengthened auth tests25/25 and lint pass;
parent inspected hidden/shown screenshots. User confirms landing on Inicio works.
