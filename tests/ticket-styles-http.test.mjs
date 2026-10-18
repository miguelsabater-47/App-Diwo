import assert from "node:assert/strict";
import { test } from "node:test";

// Existing localhost listener only. No credentials, env reads, writes or app startup.
test("served page styles include the actual ticket card, responsive QR and action rules", async () => {
  const origin = "http://localhost:3000";
  const response = await fetch(origin + "/sign-in", { credentials: "omit", redirect: "error", signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200);
  const html = await response.text();
  const links = [...html.matchAll(/<link\b[^>]*>/g)].map(match => match[0])
    .filter(tag => /\brel=["']stylesheet["']/.test(tag))
    .map(tag => /\bhref=["']([^"']+)["']/.exec(tag)?.[1]?.replaceAll("&amp;", "&"))
    .filter(Boolean);
  assert.ok(links.length > 0, "Page must reference its stylesheets");
  const styles = await Promise.all([...new Set(links)].map(async href => {
    const url = new URL(href, origin);
    assert.equal(url.origin, origin); assert.ok(url.pathname.startsWith("/_next/"));
    const css = await fetch(url, { credentials: "omit", redirect: "error", signal: AbortSignal.timeout(30000) });
    assert.equal(css.status, 200);
    assert.match(css.headers.get("content-type") ?? "", /text\/css/);
    return css.text();
  }));
  const delivered = styles.join("\n");
  for (const selector of ["diwo-ticket-screen", "diwo-ticket-card", "diwo-ticket-grid", "diwo-ticket-qr", "diwo-ticket-foot", "diwo-ticket-share", "diwo-ticket-download", "diwo-ticket-track", "diwo-ticket-slide-next"]) {
    assert.ok(new RegExp(`\\.${selector}\\s*\\{`).test(delivered), `Missing served CSS: .${selector}`);
  }
  assert.match(delivered, /min-width:\s*360px/);
  assert.match(delivered, /cursor:\s*grab\s*;/);
  assert.match(delivered, /transition:\s*transform\s+(?:220ms|0?\.22s)/);
  const cardRule = /\.diwo-ticket-card\s*\{([^}]+)\}/.exec(delivered)?.[1] ?? "";
  assert.match(cardRule, /\bborder:\s*0(?:px)?\s*;/, "No extra rectangular border over the notched ticket perimeter");
  const dotsRule = /\.diwo-ticket-dots\s+a\s*\{([^}]+)\}/.exec(delivered)?.[1] ?? "";
  assert.match(dotsRule, /\bwidth:\s*24px\s*;/, "Dot touch areas must not space the indicators far apart");
  const scheduleRule = /\.diwo-ticket-schedule\s*\{([^}]+)\}/.exec(delivered)?.[1] ?? "";
  assert.match(scheduleRule, /grid-template-columns:\s*minmax\(0(?:px)?,\s*0?\.85fr\)\s+minmax\(0(?:px)?,\s*1\.15fr\)/,
    "Date and time stay side by side, with more space for the complete time range");
  const adminRule = /\.diwo-app-navigation-items-admin\s*\{([^}]+)\}/.exec(delivered)?.[1] ?? "";
  assert.match(adminRule, /grid-template-columns:\s*repeat\(5,\s*minmax\(0(?:px)?,\s*1fr\)\)/, "Admin five-tab CSS must actually reach the browser");
  for (const selector of ["diwo-admin-requests", "diwo-admin-request-card", "diwo-admin-request-amount", "diwo-admin-request-detail", "diwo-admin-requests-dialog"]) {
    assert.ok(new RegExp(`\\.${selector}\\s*\\{`).test(delivered), `Missing served Requests CSS: .${selector}`);
  }
  for (const selector of ["diwo-admin-ticket-tabs", "diwo-admin-ticket-workspace", "diwo-admin-ticket-open", "diwo-admin-ticket-detail", "diwo-admin-ticket-data"]) {
    assert.ok(new RegExp(`\\.${selector}\\s*\\{`).test(delivered), `Missing served Entries CSS: .${selector}`);
  }
  for (const selector of ["diwo-admin-staff-workspace", "diwo-admin-staff-panel", "diwo-admin-staff-person", "diwo-admin-staff-confirm"]) {
    assert.ok(new RegExp(`\\.${selector}\\s*\\{`).test(delivered), `Missing served Staff CSS: .${selector}`);
  }
  for (const selector of ["diwo-door-scanner", "diwo-door-counters", "diwo-door-camera", "diwo-door-result"]) {
    assert.ok(new RegExp(`\\.${selector}\\s*\\{`).test(delivered), `Missing served Scanner CSS: .${selector}`);
  }
  for (const selector of ["diwo-issued-card", "diwo-issued-summary", "diwo-issued-list", "diwo-issued-entry", "diwo-issued-open"]) {
    assert.ok(new RegExp(`\\.${selector}\\s*\\{`).test(delivered), `Missing served issued-order CSS: .${selector}`);
  }
  for (const selector of ["diwo-pending-state", "diwo-issued-status"]) {
    const badge = new RegExp(`\\.${selector}\\s*\\{([^}]+)\\}`).exec(delivered)?.[1] ?? "";
    assert.match(badge, /font-size:\s*12px/, "Pending/available badges share the same base text size");
    assert.match(badge, /border-radius:\s*30px/, "Both states use a pill background");
  }
  const pendingPrice = /\.diwo-pending-price\s*>\s*p:last-child\s*\{([^}]+)\}/.exec(delivered)?.[1] ?? "";
  assert.match(pendingPrice, /color:\s*(?:#fff(?:fff)?|white)\s*;/, "Pending total matches the white issued total");
});
