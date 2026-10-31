import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import * as model from "../lib/door-scan-model.ts";

const compiled = ts.transpileModule(readFileSync(new URL("../lib/door-scan-core.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = { exports: {} };
new Function("require", "module", "exports", compiled)(() => model, mod, mod.exports);
const { handleDoorScan } = mod.exports;
const eventId = "99233d64-f779-4a4b-8f7e-634a5ee4ed94", ticketId = "5ba7d710-cb52-4053-8b7e-d2ac9c4f733e", token = "a".repeat(64), at = "2026-11-01T02:30:00.123456+00:00";
function fixture(options = {}) {
  const state = { role: "door_staff", nextRole: "door_staff", data: [{ outcome: "admitted", ticket_id: ticketId, attendee_name: "Synthetic", used_at: at, qr_token: token, used_by: "private" }], error: null, ...options }, calls = [];
  return { state, calls, authorize: async () => state.denied ?? { ok: true, role: state.role, client: { async rpc(name, args) {
    calls.push({ name, args });
    if (state.throws) throw new Error(token);
    if (name === "get_extra_event_counters") return { data: state.extraData ?? [{ used_admissions: 0, pending_admissions: 0, issued_non_revoked: 0 }], error: state.extraError ?? null };
    return name === "get_current_app_role" ? { data: state.nextRole, error: null } : { data: state.data, error: state.error };
  } } } };
}
function request(body = { eventId, token }, options = {}) {
  return new Request("http://localhost:3000/api/door-scan", { method: body === null ? "GET" : "POST", headers: body === null ? {} : { origin: "http://localhost:3000", "Content-Type": "application/json" }, ...(body === null ? {} : { body: JSON.stringify(body) }), ...options });
}
test("scan forwards only event and token once and projects safe receipt", async () => {
  const f = fixture(); const response = await handleDoorScan(request(), f.authorize);
  assert.equal(response.status, 200); assert.match(response.headers.get("cache-control"), /no-store/);
  assert.deepEqual(await response.json(), { result: { outcome: "admitted", ticketId, name: "Synthetic", usedAt: at } });
  assert.deepEqual(f.calls, [{ name: "check_in_ticket", args: { target_event: eventId, scanned_token: token } }]);
});
test("no mutation for anonymous, user, bad origin, shape, token, content type or oversized streams", async () => {
  const cases = [
    [fixture({ role: "user" }), request(), 403], [fixture({ denied: { ok: false, status: 401, reason: "authentication_required" } }), request(), 401],
    [fixture(), request(undefined, { headers: { origin: "https://foreign.invalid", "Content-Type": "application/json" } }), 403],
    [fixture(), request({ eventId, token, operator: "admin" }), 400], [fixture(), request({ eventId, token: "invalid" }), 400],
    [fixture(), request(undefined, { headers: { origin: "http://localhost:3000", "Content-Type": "text/plain" } }), 415],
    [fixture(), request(undefined, { body: " ".repeat(513) }), 413],
  ];
  for (const [f, req, status] of cases) { assert.equal((await handleDoorScan(req, f.authorize)).status, status); assert.equal(f.calls.length, 0); }
});
test("failures never return an admission, raw exception/token or automatic write retry", async () => {
  for (const change of [{ throws: true }, { error: { code: "XX000", message: token } }, { data: [] }, { data: [{ outcome: "admitted", ticket_id: ticketId, attendee_name: "Synthetic", used_at: null }] }]) {
    const f = fixture(change), response = await handleDoorScan(request(), f.authorize);
    assert.equal(response.status, 502); assert.deepEqual(await response.json(), { error: "scan_operation_unconfirmed" }); assert.equal(f.calls.length, 1);
  }
  for (const [code, status, reason] of [["42501", 403, "operation_not_authorized"], ["PGRST202", 503, "scanner_configuration_required"]]) {
    const f = fixture({ error: { code } }); const response = await handleDoorScan(request(), f.authorize);
    assert.equal(response.status, status); assert.deepEqual(await response.json(), { error: reason });
  }
});
test("all reject outcomes are explicitly non-admission, terminal states validate timestamps", () => {
  for (const outcome of ["unknown", "wrong_event"]) assert.ok(model.scanResult({ outcome, ticketId: null, name: null, usedAt: null }));
  for (const outcome of ["already_used", "revoked"]) assert.ok(model.scanResult({ outcome, ticketId, name: "Synthetic", usedAt: outcome === "revoked" ? null : at }));
  assert.equal(model.scanResult({ outcome: "admitted", ticketId, name: "Synthetic", usedAt: null }), null);
  assert.equal(model.scanResult({ outcome: "unknown", ticketId, name: "Private", usedAt: null }), null);
});
test("event reads exclude upstream private fields and require U+P=V and current role", async () => {
  const data = [{ event_id: eventId, event_title: "Synthetic", used_admissions: 1, pending_admissions: 2, issued_non_revoked: 3, private: token }];
  const f = fixture({ data });
  assert.deepEqual(await (await handleDoorScan(request(null), f.authorize)).json(), { event: { id: eventId, title: "Synthetic", used: 1, pending: 2, total: 3 } });
  assert.deepEqual(f.calls.map(c => c.name), ["read_door_event", "get_extra_event_counters", "get_current_app_role"]);
  const revoked = fixture({ data, nextRole: "user" }); assert.equal((await handleDoorScan(request(null), revoked.authorize)).status, 403);
  const broken = fixture({ data: [{ ...data[0], issued_non_revoked: 4 }] }); assert.equal((await handleDoorScan(request(null), broken.authorize)).status, 502);
  const absent = fixture({ data: [] }); assert.deepEqual(await (await handleDoorScan(request(null), absent.authorize)).json(), { event: null });
});
test("scanner counters combine general and extra admissions for admin and door staff", async () => {
  for (const role of ["admin", "door_staff"]) {
    const f = fixture({ role, nextRole: role,
      data: [{ event_id: eventId, event_title: "Synthetic", used_admissions: 33, pending_admissions: 100, issued_non_revoked: 133 }],
      extraData: [{ used_admissions: 2, pending_admissions: 8, issued_non_revoked: 10, private: token }],
    });
    const response = await handleDoorScan(request(null), f.authorize);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { event: { id: eventId, title: "Synthetic", used: 35, pending: 108, total: 143 } });
    assert.deepEqual(f.calls[1], { name: "get_extra_event_counters", args: { target_event: eventId } });
  }
});
test("scanner never serves partial totals when extra counters fail or are malformed", async () => {
  const data = [{ event_id: eventId, event_title: "Synthetic", used_admissions: 1, pending_admissions: 2, issued_non_revoked: 3 }];
  for (const change of [
    { extraError: { code: "XX000", message: token } }, { extraData: [] },
    { extraData: [{ used_admissions: 1, pending_admissions: 2, issued_non_revoked: 4 }] },
    { extraData: [{ used_admissions: -1, pending_admissions: 2, issued_non_revoked: 1 }] },
    { extraData: [{ used_admissions: 0, pending_admissions: Number.MAX_SAFE_INTEGER, issued_non_revoked: Number.MAX_SAFE_INTEGER }] },
  ]) {
    const f = fixture({ data, ...change });
    const response = await handleDoorScan(request(null), f.authorize);
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "scan_operation_unconfirmed" });
  }
  const revoked = fixture({ data, extraError: { code: "42501" } });
  assert.equal((await handleDoorScan(request(null), revoked.authorize)).status, 403);
});
