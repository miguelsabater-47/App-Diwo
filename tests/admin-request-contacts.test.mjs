import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as views from "../lib/order-view-model.ts";
import { primaryVerifiedEmail } from "../lib/admin-contact-model.ts";

function load(path, dependencies) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", code)(name => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name];
  }, mod, mod.exports);
  return mod.exports;
}
function user(id, email, status = "verified") {
  return { id, primaryEmailAddressId: "primary", emailAddresses: [{ id: "primary", emailAddress: email, verification: { status } }], privateMetadata: { neverForward: true } };
}
test("contact mapping uses the exact account's verified primary address, never a name/query match or unverified fallback", () => {
  assert.equal(primaryVerifiedEmail(user("user_a", "a@example.com"), "user_a"), "a@example.com");
  assert.equal(primaryVerifiedEmail(user("user_a", "a@example.com"), "user_b"), null);
  assert.equal(primaryVerifiedEmail(user("user_a", "a@example.com", "unverified"), "user_a"), null);
  assert.equal(primaryVerifiedEmail({ ...user("user_a", "a@example.com"), primaryEmailAddressId: "missing" }, "user_a"), null);
});

test("directory lookup batches exact subject IDs, ignores unexpected accounts and exposes only email strings", async () => {
  const calls = [];
  const directory = load("../lib/admin-order-contacts.ts", {
    "server-only": {}, "@/lib/admin-contact-model": { primaryVerifiedEmail },
    "@clerk/nextjs/server": { clerkClient: async () => ({ users: { getUserList: async params => {
      calls.push(params); return { data: [...params.userId.map((id, index) => user(id, `contact${index}@example.com`)), user("user_other", "other@example.com")] };
    } } }) },
  });
  const ids = Array.from({ length: 51 }, (_, index) => `user_person${index}`);
  const emails = await directory.readAdminOrderContacts([...ids, ids[0], "invalid"]);
  assert.equal(calls.length, 2); assert.equal(calls[0].userId.length, 50); assert.equal(calls[1].userId.length, 1);
  assert.equal(calls[0].limit, 100); assert.equal(emails.size, 51); assert.equal(emails.has("user_other"), false);
});

function reader(roles = ["admin", "admin", "admin"]) {
  const orderId = "00000000-0000-4000-8000-000000000001", eventId = "00000000-0000-4000-8000-000000000002";
  const row = { id: orderId, event_id: eventId, buyer_clerk_id: "user_buyer", buyer_name: "Buyer", attendee_names: ["Buyer"], quantity: 1,
    unit_price_cents: 500, total_cents: 500, currency: "EUR", reference: "DIWO-123456ABCDEF", status: "pending", payment_reported_at: null, confirmed_at: null, created_at: "2026-10-17T12:00:00Z" };
  const state = { roleReads: 0, directoryReads: 0, columns: [], filters: [] };
  const session = { status: "ready", actorId: "user_admin", client: { from(table) {
    const where = [];
    return {
      select(columns) { state.columns.push([table, columns]); return this; }, order() { return this; },
      eq(key, value) { state.filters.push([key, value]); where.push([key, value]); return this; }, in() { return this; },
      async range() {
        let data = table === "orders" ? [row] : table === "events" ? [{ id: eventId, slug: "diwo-x-2-2026" }] : [];
        data = data.filter(item => where.every(([key, value]) => item[key] === value));
        return { data, error: null, count: data.length };
      },
    };
  } } };
  const { readOrderOverview } = load("../lib/order-reads.ts", {
    "server-only": {}, "@/lib/supabase-session": { createSessionSupabaseClient: async () => session },
    "@/lib/app-authorization-core": { readCurrentAppAccess: async () => ({ ok: true, role: roles[Math.min(state.roleReads++, roles.length - 1)] }) },
    "@/lib/order-view-model": views, "@/lib/local-access": { hasConfiguredClerkKeys: () => true },
    "@/lib/admin-order-contacts": { readAdminOrderContacts: async ids => { state.directoryReads++; assert.deepEqual(ids, ["user_buyer"]); return new Map([["user_buyer", "buyer@example.com"]]); } },
  });
  return { state, readOrderOverview };
}
test("only explicit admin contact reads enrich the safe DTO, rechecking current DB admin after the directory response", async () => {
  const h = reader();
  const result = await h.readOrderOverview("admin", { contacts: true });
  assert.equal(result.ok, true); assert.equal(result.orders[0].buyerEmail, "buyer@example.com");
  assert.equal(JSON.stringify(result).includes("user_buyer"), false);
  assert.equal(h.state.directoryReads, 1); assert.equal(h.state.roleReads, 3);
  const revoked = reader(["admin", "admin", "user"]);
  const denied = await revoked.readOrderOverview("admin", { contacts: true });
  assert.deepEqual(denied, { ok: false, status: 403 }); assert.equal(revoked.state.directoryReads, 1);
  const ordinary = reader(["user"]);
  assert.deepEqual(await ordinary.readOrderOverview("admin", { contacts: true }), { ok: false, status: 403 });
  assert.equal(ordinary.state.directoryReads, 0);
});
test("summary/ticket admin reads and personal reads never invoke account-email enrichment or leak the subject column", async () => {
  const h = reader();
  assert.equal((await h.readOrderOverview("admin")).ok, true);
  assert.equal(h.state.directoryReads, 0); assert.equal(h.state.columns[0][1].includes("buyer_clerk_id"), false);
  const own = reader();
  await own.readOrderOverview("buyer", { contacts: true });
  assert.equal(own.state.directoryReads, 0); assert.deepEqual(own.state.filters, [["buyer_clerk_id", "user_admin"]]);
  assert.equal(own.state.columns[0][1].includes("buyer_clerk_id"), false);
});
