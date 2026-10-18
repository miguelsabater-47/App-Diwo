import assert from "node:assert/strict";
import { test } from "node:test";

// Anonymous/forged-header localhost only; deliberately invalid body cannot mutate.
const origin = "http://localhost:3000";
test("admin tickets/payment pages and API reject anonymous identity; descendants remain blocked", async () => {
  const forged = { "x-clerk-auth-status": "signed-in", "x-clerk-auth-user-id": "untrusted",
    "x-middleware-subrequest": "middleware:middleware:middleware:middleware:middleware" };
  for (const path of ["/admin/tickets", "/admin/tickets/other", "/admin/scan", "/admin/scan/other", "/ticket/payment/00000000-0000-4000-8000-000000000001", "/ticket/payment/preview?quantity=2"]) {
    const response = await fetch(origin + path, { headers: forged, redirect: "manual", signal: AbortSignal.timeout(30000) });
    if (path.endsWith("other")) assert.equal(response.status, 403);
    else if (response.status === 200) {
      // Next.js can stream a layout redirect after committing HTTP headers.
      const html = await response.text();
      assert.ok(/NEXT_REDIRECT;replace;\/sign-in;30[378];/.test(html) ||
        /http-equiv="refresh" content="0;url=\/sign-in"/.test(html), "Streamed response must redirect to sign-in");
      assert.equal(html.includes("Buscar entrada"), false, "No admin list can render for an anonymous request");
      assert.equal(html.includes("Realiza el pago"), false, "No customer instructions or prototype can render anonymously");
    } else assert.ok([302, 303, 307, 308, 401].includes(response.status), `${path}: unexpected HTTP ${response.status}`);
  }
  const response = await fetch(origin + "/api/tickets/revoke", {
    method: "POST", redirect: "manual", signal: AbortSignal.timeout(30000),
    headers: { ...forged, Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ role: "admin" }),
  });
  assert.ok([302, 303, 307, 308, 401].includes(response.status));
});
