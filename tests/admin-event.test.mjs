import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import * as scan from "../lib/door-scan-model.ts";
const modelModule = { exports: {} };
new Function("require", "module", "exports", ts.transpileModule(readFileSync(new URL("../lib/admin-event-model.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(() => scan, modelModule, modelModule.exports);
const { eventControl, parseEventControl } = modelModule.exports;

const compiled = ts.transpileModule(readFileSync(new URL("../lib/admin-event-core.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = { exports: {} };
new Function("require", "module", "exports", compiled)(() => scan, mod, mod.exports);
const { handleManualAccess } = mod.exports;
const eventId = "99233d64-f779-4a4b-8f7e-634a5ee4ed94", ticketId = "5ba7d710-cb52-4053-8b7e-d2ac9c4f733e";
const usedAt = "2026-11-01T00:40:00Z";
const event = { id: eventId, title: "Synthetic event", timezone: "Europe/Madrid", starts_at: "2026-10-31T22:30:00Z", ends_at: "2026-11-01T06:00:00Z" };
const row = (n, state = "valid", extra = false) => ({ id: `5ba7d710-cb52-4053-8b7e-${String(n).padStart(12, "0")}`, event_id: eventId,
  order_id: extra ? null : ticketId, orders: extra ? null : { reference: "ABCD", status: "confirmed" },
  ticket_position: n, attendee_name: `Álex García ${n}`, status: state, used_at: state === "used" ? usedAt : null });

test("attendance excludes annulled tickets, includes extras, rounds and avoids zero division", () => {
  const data = eventControl(event, [row(1, "used"), row(2), row(3, "used", true), row(4, "revoked")], "", 0, new Date(usedAt));
  assert.deepEqual([data.used, data.pending, data.total, data.percentage, data.general, data.extras], [2, 1, 3, 67, 2, 1]);
  assert.equal(data.event.phase, "live"); assert.ok(parseEventControl(data));
  const empty = eventControl(event, []);
  assert.equal(empty.percentage, 0); assert.equal(empty.total, 0); assert.equal(empty.recent.length, 0);
  assert.equal(parseEventControl({ ...data, total: 4 }), null);
  assert.equal(eventControl(event, [row(1), row(1)]), null);
  assert.equal(eventControl(event, [{ ...row(1), orders: { reference: "ABCD", status: "cancelled" } }]), null);
  assert.equal(eventControl(event, [{ ...row(1), event_id: ticketId }]), null);
});
test("event status uses persisted dates, not fixed live text or punctuality limits", () => {
  assert.equal(eventControl(event, [], "", 0, new Date("2026-10-30T00:00Z")).event.phase, "upcoming");
  assert.equal(eventControl(event, [], "", 0, new Date("2026-11-01T06:00Z")).event.phase, "ended");
  assert.equal(eventControl({ ...event, timezone: "invalid" }, []), null);
});
test("name/code/reference searches fold accents and return only a bounded server page; access history uses used_at", () => {
  const rows = Array.from({ length: 45 }, (_, i) => row(i + 1, "used"));
  const data = eventControl(event, rows, "alex garcia", 1);
  assert.equal(data.matches, 45); assert.equal(data.results.length, 20); assert.equal(data.page, 1);
  assert.equal(eventControl(event, rows, "ABCD").matches, 45);
  assert.equal(eventControl(event, rows, "absent").results.length, 0);
  assert.equal(data.historyTotal, 45); assert.equal(data.recent.length, 20);
  assert.equal(data.latest.length, 5);
  assert.deepEqual(data.latest, eventControl(event, rows, "", 0).latest, "search pagination never paginates the five latest accesses");
  assert.ok(parseEventControl(data));
  assert.equal(eventControl(event, [row(1, "used"), { ...row(2, "used"), used_at: "2026-11-01T01:00:00Z" }]).recent[0].id, row(2).id);
  assert.ok(data.recent.every(r => r.usedAt === usedAt));
});
function fixture(role = "admin", change = {}) {
  const calls = [], state = { data: [{ outcome: "admitted", ticket_id: ticketId, attendee_name: "Synthetic", used_at: usedAt }], error: null, ...change };
  return { calls, authorize: async () => ({ ok: true, role, client: { rpc: async (name, args) => { calls.push({ name, args }); return state; } } }) };
}
const request = (body = { eventId, ticketId }, options = {}) => new Request("http://localhost:3000/api/admin/event-control", {
  method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" }, body: JSON.stringify(body), ...options,
});
test("manual API calls the protected DB wrapper exactly once, with no client-supplied actor, method or QR", async () => {
  const f = fixture(); const response = await handleManualAccess(request(), f.authorize, "http://localhost:3000");
  assert.equal(response.status, 200); assert.match(response.headers.get("cache-control"), /no-store/);
  assert.deepEqual(f.calls, [{ name: "manual_check_in_ticket", args: { target_event: eventId, target_ticket: ticketId } }]);
  assert.deepEqual(await response.json(), { result: { outcome: "admitted", ticketId, name: "Synthetic", usedAt } });
});
test("manual API accepts designated staff but rejects buyer/anonymous, cross-origin and malformed writes before mutation", async () => {
  const staff = fixture("door_staff"); assert.equal((await handleManualAccess(request(), staff.authorize, "http://localhost:3000")).status, 200); assert.equal(staff.calls.length, 1);
  for (const role of ["user"]) {
    const f = fixture(role); assert.equal((await handleManualAccess(request(), f.authorize, "http://localhost:3000")).status, 403); assert.equal(f.calls.length, 0);
  }
  assert.equal((await handleManualAccess(request(), async () => ({ ok: false, status: 401 }), "http://localhost:3000")).status, 401);
  for (const req of [request({ eventId, ticketId, actor: "admin" }), request({ eventId, ticketId: "bad" }), request(undefined, { headers: { origin: "https://foreign.invalid", "content-type": "application/json" } }), request(undefined, { body: " ".repeat(513) })]) {
    const f = fixture(); assert.ok((await handleManualAccess(req, f.authorize, "http://localhost:3000")).status >= 400); assert.equal(f.calls.length, 0);
  }
});
test("manual API returns unconfirmed for corrupt receipt/errors, never retries or exposes private errors", async () => {
  for (const change of [{ data: [] }, { error: { code: "XX000", message: "PRIVATE" } }, { data: [{ outcome: "admitted", ticket_id: ticketId, attendee_name: "Synthetic", used_at: null }] }]) {
    const f = fixture("admin", change), response = await handleManualAccess(request(), f.authorize, "http://localhost:3000");
    assert.equal(response.status, 502); assert.equal(f.calls.length, 1); assert.doesNotMatch(await response.text(), /PRIVATE/);
  }
  const f = fixture("admin", { error: { code: "PGRST202" } });
  const response = await handleManualAccess(request(), f.authorize, "http://localhost:3000");
  assert.equal(response.status, 503); assert.equal((await response.json()).error, "manual_access_not_configured");
});

test("dashboard reader filters canonical published event, uses safe columns, server pagination and rechecks current admin", async () => {
  let roles = ["admin", "admin"], reads = 0;
  const columns = [], filters = [];
  const chain = {
    select(value) { columns.push(value); return this; },
    eq(key, value) { filters.push([key, value]); return this; }, order() { return this; },
    maybeSingle: async () => ({ data: event, error: null }),
    range: async () => { reads++; return { data: [row(1)], count: 1, error: null }; },
  };
  const session = { status: "ready", client: { from: () => chain, rpc: async () => ({ data: null, error: { code: "PGRST202" } }) } };
  const paginate = async callback => (await callback(0, 499)).data;
  const dependencies = {
    "server-only": {}, "@/lib/supabase-session": { createSessionSupabaseClient: async () => session },
    "@/lib/app-authorization-core": { readCurrentAppAccess: async () => ({ ok: true, role: roles.shift() ?? "user" }) },
    "@/lib/order-view-model": { readOrderPages: paginate }, "@/lib/admin-event-model": { eventControl, parseEventControl },
  };
  const readerModule = { exports: {} };
  const source = ts.transpileModule(readFileSync(new URL("../lib/admin-event-reader.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "module", "exports", source)(name => dependencies[name], readerModule, readerModule.exports);
  const result = await readerModule.exports.readAdminEvent("alex");
  assert.equal(result.ok, true); assert.equal(result.data.results.length, 1);
  assert.ok(filters.some(([k, v]) => k === "slug" && v === "diwo-x-2-2026"));
  assert.ok(filters.some(([k, v]) => k === "is_published" && v === true));
  assert.ok(filters.some(([k, v]) => k === "event_id" && v === eventId));
  assert.doesNotMatch(columns.join(), /qr_token|used_by|buyer_clerk_id|\*/);
  roles = ["admin", "user"];
  assert.deepEqual(await readerModule.exports.readAdminEvent(), { ok: false, status: 403 });
  roles = ["door_staff"]; const previous = reads;
  assert.deepEqual(await readerModule.exports.readAdminEvent(), { ok: false, status: 503 }); assert.equal(reads, previous);
  session.client.rpc=async()=>({data:eventControl(event,[row(1)],"alex"),error:null});
  roles=["door_staff","door_staff"];
  assert.equal((await readerModule.exports.readAdminEvent()).ok,true);assert.equal(reads,previous,"staff uses bounded RPC and never the admin table fallback");
  roles=["door_staff","user"];
  assert.deepEqual(await readerModule.exports.readAdminEvent(),{ok:false,status:403},"revoked staff role cannot release a buffered DTO");
});
