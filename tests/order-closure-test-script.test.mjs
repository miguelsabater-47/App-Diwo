import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { test } from "node:test";

const source = await readFile(new URL("../scripts/create-order-closure-test.browser.js", import.meta.url), "utf8");
const eventId = "9d560641-aacf-4d25-8d65-94960bba59b2";
const ids = ["cb67be71-6b85-4c80-b234-70a920ba41e8", "5856888b-18ee-4fb6-8e4f-ba6222e993ab"];
async function run(options = {}) {
  const calls = [], output = [], saved = options.saved ?? new Map();
  const actorId = "user_synthetic_admin";
  const window = options.window ?? { Clerk: { user: { id: actorId } } };
  let writes = 0;
  const sessionStorage = {
    getItem(key) { return options.corruptSaved ? "mismatched" : saved.get(key) ?? null; },
    setItem(key, value) { if (options.blockStorage) throw Error("storage unavailable"); saved.set(key, value); },
  };
  await runInNewContext(source, {
    window, sessionStorage, location: { origin: options.origin ?? "http://localhost:3000" }, AbortSignal,
    console: { log: (...args) => output.push(args) },
    fetch: async (path, init) => {
      calls.push({ path, body: init.body ? JSON.parse(init.body) : null });
      const headers = { "Cache-Control": "private, no-store" };
      if (path === "/api/supabase-session") return Response.json({ authenticated: true, supabaseConnected: true, appRole: options.role ?? "admin" }, { headers });
      assert.equal(path, "/api/orders/request", "Never call approval, notice, close, role or event endpoints");
      assert.equal(init.method, "POST"); assert.equal(init.credentials, "same-origin"); assert.equal(init.redirect, "error");
      const n = writes++;
      assert.equal(saved.size, 1, "Save both immutable payloads before the first write");
      const [key, serialized] = [...saved][0];
      assert.equal(key, `diwo:closure-test:v1:${actorId}:${eventId}`);
      const draft = JSON.parse(serialized);
      assert.equal(draft.version, 1);
      assert.deepEqual(draft.fixtures.map(f => f.payload.requestId), ids);
      const payload = JSON.parse(init.body);
      assert.deepEqual(payload, draft.fixtures[n].payload);
      assert.equal(payload.eventId, eventId); assert.equal(payload.attendeeNames.length, 1);
      if (options.failAt === n) return Response.json({ error: "order_operation_failed" }, { status: 502, headers });
      if (options.networkAt === n) throw Error("synthetic network failure");
      if (options.changeAccountAfter === n) window.Clerk.user.id = "user_different_account";
      const row = { id: payload.requestId, quantity: 1, totalCents: 500, status: options.statuses?.[n] ?? "pending", reference: n ? "DIWO-ABCDEF123457" : "DIWO-ABCDEF123456", ...options.override };
      if (options.malformed) return new Response("{", { status: 200, headers });
      return Response.json({ order: row }, { headers });
    },
  });
  return { calls, output, saved, window };
}
test("creation-only script saves both fixed payloads first and creates exactly two fictional pending requests", async () => {
  const first = await run(), repeated = await run({ saved: first.saved });
  assert.equal(first.calls.length, 3); assert.deepEqual(first.calls, repeated.calls);
  assert.equal(first.output[0][0], "DIWO_CLOSURE_TEST_READY");
  const rows = JSON.parse(JSON.stringify(first.output[0][1].requests));
  assert.deepEqual(rows.map(r => r.id), ids); assert.ok(rows.every(r => r.status === "pending" && r.quantity === 1 && r.totalCents === 500));
  assert.equal(JSON.stringify(first.output).includes("user_synthetic_admin"), false);
  assert.equal(first.window.__diwoClosureTestRunning, false);
});
test("wrong origin, missing Clerk user and nonadmin roles stop before any creation", async () => {
  for (const options of [{ origin: "http://127.0.0.1:3000" }, { window: {} }, { role: "user" }, { role: "door_staff" }]) {
    const result = await run(options);
    assert.equal(result.calls.filter(c => c.body).length, 0);
    assert.equal(result.output[0][0], "DIWO_CLOSURE_TEST_STOPPED");
  }
});
test("blocked/corrupt storage prevents any write; an account switch stops before the second request", async () => {
  for (const options of [{ blockStorage: true }, { corruptSaved: true }]) {
    const result = await run(options); assert.equal(result.calls.length, 1);
    assert.equal(result.output[0][0], "DIWO_CLOSURE_TEST_STOPPED");
  }
  const changed = await run({ changeAccountAfter: 0 });
  assert.equal(changed.calls.length, 2); assert.equal(changed.output[0][1].reason, "account_changed");
});
test("first/second request failure never retries, replaces IDs or continues after ambiguity", async () => {
  for (const options of [{ failAt: 0 }, { failAt: 1 }, { networkAt: 0 }, { networkAt: 1 }, { malformed: true }]) {
    const result = await run(options);
    assert.equal(result.output[0][0], "DIWO_CLOSURE_TEST_STOPPED");
    assert.equal(result.calls.filter(c => c.body).length, options.failAt === 1 || options.networkAt === 1 ? 2 : 1);
    const resumed = await run({ saved: result.saved });
    assert.equal(resumed.output[0][0], "DIWO_CLOSURE_TEST_READY");
    for (const call of result.calls.filter(c => c.body)) assert.deepEqual(call, resumed.calls.find(r => r.body?.requestId === call.body.requestId));
  }
});
test("same-ID terminal replays are recognized without reopening; wrong receipt fails closed", async () => {
  const closed = await run({ statuses: ["cancelled", "rejected"] });
  assert.equal(closed.output[0][0], "DIWO_CLOSURE_TEST_ALREADY_CLOSED");
  for (const override of [{ id: ids[1] }, { quantity: 2 }, { totalCents: 1000 }, { status: "confirmed" }, { status: "rejected" }, { reference: "private-invalid" }]) {
    const result = await run({ override });
    assert.equal(result.output[0][0], "DIWO_CLOSURE_TEST_STOPPED");
    assert.equal(result.output[0][1].reason, "request_result_mismatch"); assert.equal(result.calls.length, 2);
  }
});
test("concurrent invocation guard performs no requests and does not unlock another running invocation", async () => {
  const result = await run({ window: { __diwoClosureTestRunning: true } });
  assert.equal(result.calls.length, 0); assert.equal(result.window.__diwoClosureTestRunning, true);
  assert.equal(result.output[0][1].reason, "test_already_running");
});
