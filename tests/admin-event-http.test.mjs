// Anonymous, no-write probes against the user-authorized local server only.
import assert from "node:assert/strict";
import { test } from "node:test";

test("local event dashboard and API deny anonymous/forged sessions; neighboring admin APIs stay blocked", async () => {
  for (const path of ["/admin", "/door", "/api/admin/event-control", "/api/door/event-control"]) {
    const response = await fetch(`http://localhost:3000${path}`, { redirect: "manual", signal: AbortSignal.timeout(30000) });
    if (["/admin","/door"].includes(path) && response.status === 200) {
      // Next can stream the layout's redirect after sending the HTTP headers.
      const html = await response.text();
      assert.ok(/NEXT_REDIRECT;replace;\/sign-in;30[378];/.test(html) || /http-equiv="refresh" content="0;url=\/sign-in"/.test(html));
      assert.equal(html.includes("diwo-event-squares"), false);
    } else assert.ok([302, 303, 307, 308, 401, 403].includes(response.status), `${path}: ${response.status}`);
  }
  const mutation = await fetch("http://localhost:3000/api/admin/event-control", {
    method: "POST", redirect: "manual", headers: { origin: "http://localhost:3000", "content-type": "application/json", "x-clerk-auth-status": "signed-in", "x-clerk-auth-user-id": "user_forged_fixture" }, body: "{}",
  });
  assert.ok([302, 303, 307, 308, 401, 403].includes(mutation.status));
  for (const path of ["/api/admin/event-control/nested", "/api/admin/issue", "/api/admin/next-code"]) {
    assert.equal((await fetch(`http://localhost:3000${path}`, { redirect: "manual" })).status, 403);
  }
});
