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
with a nonempty createdSessionId calls `setActive`, then navigates to `/account`.
Partial first/second factor or password-reset states go to `/sign-in/clerk`, the
native SignIn continuation under the existing catch-all, with base path matching.
No public error displays raw provider messages, passwords, subjects or tokens.
Already signed-in users retain the previous `/account` redirect rather than being
offered another login; controls wait for both Clerk auth/sign-in initialization.

Google uses `authenticateWithRedirect` and `/sso-callback` with the official
`AuthenticateWithRedirectCallback`; successful destination `/account`, native
sign-in continuation `/sign-in/clerk`, native registration `/sign-up`.

Forgot-password initiates Clerk's `reset_password_email_code` strategy for the
selected email, then hands off to native `/sign-in/clerk`. The app does not send
its own email or issue its own reset credentials. Native component continuity and
real email delivery must be verified in the actual Development session; mocked
tests cannot certify that SDK runtime behavior. Error state also exposes a native
sign-in entry, avoiding a dead end if an account needs another Clerk method.

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
