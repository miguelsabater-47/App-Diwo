import assert from "node:assert/strict";
import { test } from "node:test";
import { hasDevelopmentClerkKeys } from "../lib/local-access.ts";

const origin = new URL(process.env.DIWO_HTTP_TEST_ORIGIN ?? "http://localhost:3000");
assert.equal(origin.protocol, "http:", "Only the local test server is allowed.");
assert.equal(origin.hostname, "localhost", "Use canonical localhost so Clerk rewrites remain internal. Never target a published app.");
const configured = hasDevelopmentClerkKeys(process.env);
const request = (path, options = {}) => fetch(new URL(path, origin), { ...options, redirect: "manual", signal: AbortSignal.timeout(30000) });

test("local public response never exposes the secret key", async () => {
  const response = await request("/");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.equal(html.includes("DIWO X 2.0"), true);
  const secret = process.env.CLERK_SECRET_KEY;
  // Assert booleans only so failures cannot print a key or a private HTML dump.
  assert.equal(!secret || !html.includes(secret), true, "The server secret must never appear in HTML.");
  if (!configured) assert.equal(html.includes("Conectar tu cuenta de Clerk"), true);
});

test("anonymous visitors never receive the protected server-session content", async () => {
  const response = await request("/account");
  assert.equal([302, 303, 307, 308, 401].includes(response.status), true);
  if (!configured) assert.equal(new URL(response.headers.get("location"), origin).pathname, "/setup");
});

test("old administrative handlers cannot be elevated by request headers or body", async () => {
  for (const [path, method] of [["/api/admin/issue", "POST"], ["/api/admin/next-code", "GET"]]) {
    const response = await request(path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-clerk-auth-status": "signed-in",
        "x-clerk-auth-user-id": "untrusted-client-value",
        "x-middleware-subrequest": "middleware:middleware:middleware:middleware:middleware",
      },
      ...(method === "POST" ? { body: JSON.stringify({ role: "admin", isAdmin: true, code: "ABC123" }) } : {}),
    });
    assert.equal(response.status, 403, path);
    assert.equal((await response.json()).error, "authorization_not_configured");
  }
});

test("admin and scanner pages remain blocked until real database authorization exists", async () => {
  for (const path of ["/admin", "/admin/requests", "/scan"]) {
    assert.equal((await request(path)).status, 403, path);
  }
});

test("retired redemption never mutates or initializes Supabase", async () => {
  const response = await request("/api/redeem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: "ABC123", role: "admin" }) });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "legacy_workflow_disabled");
});

test("session endpoint cannot report authenticated to an anonymous request", async () => {
  const response = await request("/api/session");
  if (!configured) {
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "local_configuration_required");
    assert.equal(response.headers.get("cache-control").includes("no-store"), true);
  } else if (response.status === 401) {
    assert.deepEqual(await response.json(), { authenticated: false });
    assert.equal(response.headers.get("cache-control").includes("no-store"), true);
  } else {
    // Clerk Development may first redirect for its dev-browser handshake.
    assert.equal([302, 303, 307, 308].includes(response.status), true);
  }
});
