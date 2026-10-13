import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { test } from "node:test";

const script = await readFile(new URL("../scripts/create-ui-approval-test.browser.js", import.meta.url), "utf8");
async function run(role = "admin", failCreation = false) {
  const calls = [], output = [];
  await runInNewContext(script, {
    location: { origin: "http://localhost:3000" }, AbortSignal,
    console: { log: (...args) => output.push(args) },
    fetch: async (path, options) => {
      calls.push({ path, body: options.body ? JSON.parse(options.body) : null });
      const headers = { "Cache-Control": "private, no-store" };
      if (path === "/api/supabase-session") return Response.json({ authenticated: true, supabaseConnected: true, appRole: role }, { headers });
      assert.equal(path, "/api/orders/request", "Creation script must never report or approve payment.");
      if (failCreation) return Response.json({ error: "order_operation_failed" }, { status: 502, headers });
      const payload = JSON.parse(options.body);
      return Response.json({ order: { id: payload.requestId, reference: "DIWO-ABCDEF123456", status: "pending", quantity: 2, totalCents: 1000 } }, { headers });
    },
  });
  return { calls, output };
}

test("UI fixture script creates/replays exactly the fixed second order and never approves it", async () => {
  const first = await run(), repeated = await run();
  assert.equal(first.output[0][0], "DIWO_UI_APPROVAL_TEST_READY");
  assert.equal(first.calls.length, 3);
  assert.deepEqual(first.calls[1], first.calls[2]);
  assert.deepEqual(first.calls[1], repeated.calls[1]);
  assert.equal(first.calls[1].body.requestId, "57c58ec8-9537-4c5c-a573-5e2b8350f9c9");
  assert.equal(first.calls[1].body.eventId, "9d560641-aacf-4d25-8d65-94960bba59b2");
});

test("wrong current role cannot start a hosted test request", async () => {
  const { calls, output } = await run("user");
  assert.equal(calls.length, 1);
  assert.equal(output[0][0], "DIWO_UI_APPROVAL_TEST_STOPPED");
  assert.equal(output[0][1].reason, "signed_admin_required");
});

test("ambiguous creation failure stops without retry or replacement UUID", async () => {
  const { calls, output } = await run("admin", true);
  assert.equal(calls.length, 2);
  assert.equal(output[0][0], "DIWO_UI_APPROVAL_TEST_STOPPED");
  assert.equal(output[0][1].reason, "HTTP_502_order_operation_failed");
});
