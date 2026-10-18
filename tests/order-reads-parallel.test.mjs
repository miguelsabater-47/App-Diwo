import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import * as views from "../lib/order-view-model.ts";

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = "2026-10-18T12:00:00Z";
const order = n => ({ id: uuid(n), event_id: uuid(n + 1000), buyer_clerk_id: "user_buyer", buyer_name: "Synthetic Buyer",
  attendee_names: ["Synthetic Attendee"], quantity: 1, unit_price_cents: 500, total_cents: 500, currency: "EUR",
  reference: "DIWO-123456ABCDEF", status: "pending", payment_reported_at: null, confirmed_at: null, created_at: at });
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

function harness(options = {}) {
  const state = { orders: [order(1)], tickets: [], roles: ["admin", "admin", "admin"], configured: true,
    sessionStatus: "ready", roleReads: 0, sessionReads: 0, directoryReads: 0, calls: [], gates: {}, fail: null,
    active: { tickets: 0, events: 0 }, maximum: { tickets: 0, events: 0 }, pageSize: 500, ...options };
  state.events ??= state.orders.map(row => ({ id: row.event_id, slug: "diwo-x-2-2026" }));
  const session = { status: state.sessionStatus, actorId: "user_admin", client: { from(table) {
    const filters = [], query = { table, columns: null, ids: null, filters };
    return {
      select(columns) { query.columns = columns; return this; }, order() { return this; },
      eq(key, value) { filters.push([key, value]); return this; },
      in(key, ids) { query.ids = [...ids]; filters.push([key, ids]); return this; },
      async range(from, to) {
        state.calls.push({ ...query, from, to });
        if (table !== "orders") { state.active[table]++; state.maximum[table] = Math.max(state.maximum[table], state.active[table]); }
        try {
          if (state.gates[table]) await state.gates[table].promise;
          else await Promise.resolve();
          if (state.fail === table) return { data: null, count: null, error: { code: "synthetic_failure" } };
          const rows = state[table].filter(row => filters.every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value));
          return { data: rows.slice(from, Math.min(to + 1, from + state.pageSize)), count: rows.length, error: null };
        } finally { if (table !== "orders") state.active[table]--; }
      },
    };
  } } };
  const deps = {
    "server-only": {}, "@/lib/order-view-model": views,
    "@/lib/local-access": { hasConfiguredClerkKeys: () => state.configured },
    "@/lib/supabase-session": { createSessionSupabaseClient: async () => { state.sessionReads++; return session; } },
    "@/lib/app-authorization-core": { readCurrentAppAccess: async () => {
      const role = state.roles[Math.min(state.roleReads++, state.roles.length - 1)];
      return typeof role === "string" ? { ok: true, role } : role;
    } },
    "@/lib/admin-order-contacts": { readAdminOrderContacts: async ids => {
      state.directoryReads++; assert.ok(ids.every(id => id === "user_buyer"));
      if (state.gates.contacts) await state.gates.contacts.promise;
      return new Map([["user_buyer", "buyer@example.invalid"]]);
    } },
  };
  const compiled = ts.transpileModule(readFileSync(new URL("../lib/order-reads.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    assert.ok(name in deps, `Unexpected ${name}`); return deps[name];
  }, mod, mod.exports);
  return { state, read: mod.exports.readOrderOverview };
}

test("tickets and events start before either completes; only fully read data passes a fresh final authorization", async () => {
  const tickets = deferred(), events = deferred();
  const h = harness({ gates: { tickets, events } });
  let finished = false;
  const work = h.read("admin").then(value => { finished = true; return value; });
  await tick();
  assert.deepEqual(h.state.calls.map(call => call.table), ["orders", "tickets", "events"]);
  assert.equal(h.state.roleReads, 1); assert.equal(finished, false);
  events.resolve(); await tick();
  assert.equal(h.state.roleReads, 1); assert.equal(finished, false);
  tickets.resolve();
  const result = await work;
  assert.deepEqual(result, { ok: true, orders: views.orderViews(h.state.orders, [], h.state.events) });
  assert.equal(h.state.roleReads, 2);
  assert.doesNotMatch(JSON.stringify(result), /buyer_clerk_id|user_buyer|qr_token/);
});

test("revocation during either parallel read denies buffered data; each subsequent request checks the current role again", async () => {
  for (const delayed of ["tickets", "events"]) {
    const gate = deferred(), h = harness({ gates: { [delayed]: gate } });
    const work = h.read("admin"); await tick(); h.state.roles = ["admin", "user"];
    gate.resolve(); assert.deepEqual(await work, { ok: false, status: 403 });
    const reads = h.state.calls.length;
    h.state.roles = ["user"];
    assert.deepEqual(await h.read("admin"), { ok: false, status: 403 });
    assert.equal(h.state.calls.length, reads); assert.equal(h.state.directoryReads, 0);
  }
});

test("personal reads still explicitly filter the verified actor even for admin; contacts remain admin-only with their final recheck", async () => {
  const h = harness(); h.state.orders[0].buyer_clerk_id = "user_admin";
  assert.equal((await h.read("buyer", { contacts: true })).ok, true);
  assert.deepEqual(h.state.calls[0].filters, [["buyer_clerk_id", "user_admin"]]);
  assert.equal(h.state.calls[0].columns.includes("buyer_clerk_id"), false); assert.equal(h.state.directoryReads, 0);
  const contacts = deferred(), enriched = harness({ gates: { contacts } });
  const work = enriched.read("admin", { contacts: true }); await tick();
  assert.equal(enriched.state.roleReads, 2); assert.equal(enriched.state.directoryReads, 1);
  enriched.state.roles = ["admin", "admin", "user"]; contacts.resolve();
  assert.deepEqual(await work, { ok: false, status: 403 }); assert.equal(enriched.state.roleReads, 3);
});

test("both streams retain complete pagination with bounded concurrent 50-ID chunks", async () => {
  const h = harness({ orders: Array.from({ length: 51 }, (_, i) => order(i + 1)), pageSize: 7 });
  const result = await h.read("admin");
  assert.equal(result.ok, true); assert.equal(result.orders.length, 51);
  const ticketCalls = h.state.calls.filter(call => call.table === "tickets");
  assert.deepEqual(ticketCalls.map(call => call.ids.length), [50, 1]);
  const eventCalls = h.state.calls.filter(call => call.table === "events");
  assert.equal(eventCalls[0].ids.length, 50); assert.ok(eventCalls.some(call => call.ids.length === 1));
  assert.deepEqual(h.state.maximum, { tickets: 2, events: 2 });
  assert.equal(h.state.roleReads, 2);
});

test("large overviews overlap at most three chunks per stream and still recheck revoked access", async () => {
  const tickets = deferred(), events = deferred();
  const h = harness({ orders: Array.from({ length: 201 }, (_, i) => order(i + 1)), gates: { tickets, events }, pageSize: 7 });
  const work = h.read("admin");
  await tick();
  assert.deepEqual(h.state.active, { tickets: 3, events: 3 });
  assert.equal(h.state.roleReads, 1);
  tickets.resolve(); events.resolve();
  const result = await work;
  assert.equal(result.ok, true);
  assert.equal(result.orders.length, 201);
  assert.deepEqual(h.state.maximum, { tickets: 3, events: 3 });
  assert.equal(h.state.roleReads, 2);
});

test("configuration, authorization and partial-read failures never become a successful empty list", async () => {
  const unconfigured = harness({ configured: false });
  assert.deepEqual(await unconfigured.read("admin"), { ok: false, status: 503 });
  assert.equal(unconfigured.state.sessionReads, 0);
  const denied = harness({ roles: ["user"] });
  assert.deepEqual(await denied.read("admin"), { ok: false, status: 403 }); assert.equal(denied.state.calls.length, 0);
  for (const table of ["orders", "tickets", "events"]) {
    const h = harness({ fail: table }); assert.deepEqual(await h.read("admin"), { ok: false, status: 502 });
    assert.equal(h.state.directoryReads, 0);
  }
  const empty = harness({ orders: [] });
  assert.deepEqual(await empty.read("admin"), { ok: true, orders: [] });
  assert.deepEqual(empty.state.calls.map(call => call.table), ["orders"]); assert.equal(empty.state.roleReads, 2);
});
