import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import * as requestState from "../lib/order-request-state.ts";

test("sales reader loads the authenticated aggregate and fails closed on RPC failure without deriving capacity from personal tickets", async () => {
  const eventId = "00000000-0000-4000-8000-000000000002";
  const event = { id: eventId, slug: "diwo-x-2-2026", is_published: true, unit_price_cents: 500,
    currency: "EUR", timezone: "Europe/Madrid", sales_open_at: "2020-01-01T00:00:00Z", title: "DIWO X 2.0",
    public_location: "Casa de campo en Ceutí", starts_at: "2026-10-31T22:30:00Z", ends_at: "2026-11-01T06:00:00Z",
    arrival_from: "2026-10-31T22:30:00Z", arrival_until: "2026-11-01T00:30:00Z" };
  let result = { data: [{ capacity: 131, remaining_tickets: 17 }], error: null };
  let row = event, calls = 0;
  const chain = { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: row, error: null }; } };
  const deps = { "server-only": {}, "@/lib/order-request-state": requestState,
    "@/lib/supabase-session": { createSessionSupabaseClient: async () => ({ status: "ready", client: {
      from: table => { assert.equal(table, "events"); return chain; },
      rpc: async (name, args) => { calls++; assert.equal(name, "get_event_ticket_availability"); assert.deepEqual(args, { target_event: eventId }); return result; },
    } }) } };
  const code = ts.transpileModule(readFileSync(new URL("../lib/order-sales.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", code)(name => { assert.ok(name in deps); return deps[name]; }, mod, mod.exports);
  const read = mod.exports.getOrderSalesAvailability;
  assert.deepEqual(await read(), { state: "open", eventId, remainingTickets: 17 });
  result = { data: [{ capacity: 131, remaining_tickets: 0 }], error: null };
  assert.deepEqual(await read(), { state: "open", eventId, remainingTickets: 0 });
  for (const bad of [{ data: [], error: null }, { data: null, error: { code: "failure" } }]) {
    result = bad; assert.deepEqual(await read(), { state: "unavailable", eventId: null });
  }
  row = null; const before = calls;
  assert.deepEqual(await read(), { state: "unpublished", eventId: null }); assert.equal(calls, before);
});
