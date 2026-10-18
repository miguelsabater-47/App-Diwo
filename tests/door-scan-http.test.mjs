import assert from "node:assert/strict";
import { test } from "node:test";

// Anonymous probes only. No env files, cookies, bearer values or valid writer body.
const origin = "http://localhost:3000";
test("scanner rejects anonymous and forged sessions; legacy/child gates remain closed", async () => {
  for (const forged of [false,true]) {
    const headers = forged ? { "x-clerk-auth-status":"signed-in", "x-clerk-auth-user-id":"untrusted-client-value", "x-middleware-subrequest":"middleware:middleware:middleware:middleware:middleware" } : {};
    for (const method of ["GET","POST"]) {
      const response = await fetch(`${origin}/api/door-scan`, { method, redirect:"manual", signal:AbortSignal.timeout(30000), headers:{ ...headers, origin, "Content-Type":"application/json" }, ...(method === "POST" ? { body:JSON.stringify({ invalid:true }) } : {}) });
      assert.ok([302,303,307,308,401,503].includes(response.status));
      if ([401,503].includes(response.status)) {
        const data = await response.json(); assert.ok(["authentication_required","local_configuration_required"].includes(data.error));
        assert.match(response.headers.get("cache-control"),/no-store/);
      }
    }
    for (const path of ["/scan", "/admin/scan-rehearsal"]) {
    const page = await fetch(`${origin}${path}`, { redirect:"manual",signal:AbortSignal.timeout(30000),headers });
    if (page.status === 200) {
      // App Router can already be streaming when the server gate redirects.
      // A 200 alone is NOT accepted: require the exact server sign-in redirect
      // and absence of the protected scanner markup, without printing HTML.
      const html = await page.text();
      assert.equal(html.includes("NEXT_REDIRECT;replace;/sign-in;307;"),true,"Stream must carry the server sign-in redirect");
      assert.equal(/<video\b|<h1[^>]*>Control de acceso<\/h1>/.test(html),false,"Anonymous response must not render the scanner");
      assert.equal(/<h1[^>]*>Ensayo del escáner<\/h1>/.test(html),false,"Anonymous response must not render the rehearsal");
    } else assert.ok([302,303,307,308,401].includes(page.status));
    }
  }
  for (const [path,status] of [["/scan/session",403],["/admin/scan-rehearsal/child",403],["/api/redeem",503]]) {
    const response = await fetch(`${origin}${path}`,{ method:path.startsWith("/api/") ? "POST" : "GET",redirect:"manual",signal:AbortSignal.timeout(30000) }); assert.equal(response.status,status);
  }
});
