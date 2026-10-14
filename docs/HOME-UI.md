# Attendee Home reference implementation

Approved reference: Miguel's supplied Home mockup and original
`public/hero inicio interfaz.jpg`, confirmed 2026-10-14. Baseline: `014d729`.

## Scope

- User and door_staff share the informational Home, with native text over the
  original hero, black/#FCE921/Satoshi styling, the request CTA and four cards.
- Official hours are **23:30–07:00**, replacing the previous 23:00 start. Keep
  **«Acceso hasta la 01:30»** as requested punctuality messaging, never a QR gate.
- Outside the dashboard the bottom tabs are Inicio and Mis entradas. The real
  signed-in user's avatar opens `/account`, retaining profile/logout and existing
  role-specific account content. No fictional avatar identity or role inference.
- Admin Home management content, authorization and order reads remain separate.
- CTA goes to the existing `/request` route. It does not publish an event, open
  sales, create an order or override server availability checks. Price remains5€.
- Exact address stays outside the application. Informational cards do not create
  counters, benefits allocation logic, an attendance cap or a scanner deadline.
- Do not rewrite retained technical event/order/ticket dates to apply the new
  official schedule. No hosted configuration/data changes are included.

## Checks

`tests/home-ui.test.mjs` covers the hero/copy/request link, two-tab route activity,
and account-avatar destination/fallback. Existing auth-boundary tests retain the
anonymous gate, signed-in role branching, admin reader boundary and logout checks.

Rendered mobile/desktop, keyboard focus/navigation and console inspection are a
separate required evidence boundary; mocked component tests do not prove layout.
No new commit or push is authorized by this implementation request.

## Observed verification (2026-10-14)

- Requested-rule RED: missing attendee component, existing three-tab navigation,
  and missing direct account avatar link. GREEN: focused7/7, full suite77/77,
  TypeScript and targeted ESLint pass. The existing Node typeless-module warning
  remains; no dependency/configuration change was made to hide it.
- Independent verifier compared to `014d729`: identical admin and permission-error
  render/read calls, denied/loading gates retained, no admin overview reads from
  user/staff Home; role-specific account content unchanged.
- Chrome with a fresh temporary profile rendered actual components/CSS/local
  assets in an isolated, simulated signed-in presentation harness at402×874,
  320×568 and1280×900. No horizontal overflow, hero copy clipping or inaccessible
  final content; original hero and Satoshi loaded. Observed visible2px keyboard
  focus on the first link; remaining targets inspected structurally, not all
  individually traversed. Only favicon404 from the scratch harness; no JS errors.
- Parent inspected mobile/desktop and narrow-screen bottom screenshots. These
  are layout evidence, NOT real Clerk/Supabase session or Next image-optimizer
  proof. A real browser pass with a user/door_staff account remains pending.
- Admin still sees management Home. No preview route, role change or sale/event
  publication was added to let admin impersonate attendee Home.
