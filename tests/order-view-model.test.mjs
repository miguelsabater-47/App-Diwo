import assert from "node:assert/strict";
import { test } from "node:test";
import { orderReadScope, readOrderPages, orderViews, orderSummary, technicalEventId } from "../lib/order-view-model.ts";

const id = "00000000-0000-4000-8000-000000000001";
const eventId = "00000000-0000-4000-8000-000000000002";
const at = "2026-10-12T12:00:00.000Z";
const order = { id, event_id: eventId, reference: "DIWO-ABCDEF123456", buyer_name: "Synthetic Buyer",
  attendee_names: ["Guest One", "Guest Two"], quantity: 2, unit_price_cents: 500, total_cents: "1000", currency: "EUR",
  status: "confirmed", payment_reported_at: at, confirmed_at: at, created_at: at };
const tickets = [1, 2].map((position) => ({ id: `00000000-0000-4000-8000-00000000000${position + 2}`,
  order_id: id, event_id: eventId, ticket_position: position, attendee_name: order.attendee_names[position - 1],
  status: "valid", issued_at: at, used_at: null, revoked_at: null }));
const events = [{ id: eventId, slug: "diwo-x-2-2026" }];

test("personal read always binds signed actor, including admin; administrative scope denies other roles", () => {
  for (const role of ["user", "door_staff", "admin"]) {
    assert.deepEqual(orderReadScope(role, "user_fixture_buyer", "buyer"), { buyerId: "user_fixture_buyer" });
    assert.deepEqual(orderReadScope(role, "user_fixture_buyer", "admin"), role === "admin" ? { buyerId: null } : null);
  }
  assert.equal(orderReadScope("admin", "__PLACEHOLDER__", "buyer"), null);
  assert.equal(orderReadScope("owner", "user_fixture_buyer", "admin"), null);
});

test("pagination honors exact count even with lower server limits and fails on drifting or duplicate pages", async () => {
  const data = Array.from({ length: 1001 }, (_, i) => ({ id: `fixture-${i}` }));
  const offsets = [];
  assert.deepEqual(await readOrderPages(async (from, to) => {
    offsets.push(from);
    return { data: data.slice(from, Math.min(to + 1, from + 200)), error: null, count: data.length };
  }), data);
  assert.deepEqual(offsets, [0, 200, 400, 600, 800, 1000]);
  for (const result of [{ data: [], error: null, count: 1 }, { data: [], error: null, count: null },
    { data: [{ id: 'same' }, { id: 'same' }], error: null, count: 2 }]) {
    await assert.rejects(readOrderPages(async () => result), /order_read_changed/);
  }
  let call = 0;
  await assert.rejects(readOrderPages(async () => ({ data: [{ id: `fixture-${call++}` }], error: null, count: call === 1 ? 2 : 3 })), /order_read_changed/);
});

test("safe projection strips private columns and preserves used/annulled history and paid money", () => {
  const rows = orderViews([{ ...order, buyer_clerk_id: "user_fixture_private" }], tickets.map((t, i) => ({ ...t,
    status: i ? "revoked" : "used", used_at: i ? null : at, revoked_at: i ? at : null, qr_token: "private-fixture" })), events);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tickets[0].status, "used");
  assert.equal(rows[0].tickets[1].status, "revoked");
  assert.equal(JSON.stringify(rows).includes("private"), false);
  assert.deepEqual(orderSummary(rows), { pending: 0, paidOrders: 1, totalCents: 1000, issued: 2, used: 1, unused: 0 });
});

test("inconsistent foreign tickets, count/name/price mismatches and duplicate identities fail closed", () => {
  for (const changed of [{ event_id: id }, { attendee_name: "Other" }, { ticket_position: 3 }, { status: "used" }]) {
    assert.equal(orderViews([order], [{ ...tickets[0], ...changed }, tickets[1]], events), null);
  }
  assert.equal(orderViews([order], [tickets[0]], events), null);
  assert.equal(orderViews([order], [tickets[0], tickets[0]], events), null);
  assert.equal(orderViews([order, order], tickets, events), null);
  assert.equal(orderViews([{ ...order, total_cents: "1" }], tickets, events), null);
  assert.equal(orderViews([{ ...order, status: "pending", confirmed_at: null }], tickets, events), null);
});

test("technical fixtures stay visibly marked and never inflate actual-event statistics", () => {
  const rows = orderViews([{ ...order, event_id: technicalEventId }], tickets.map((t) => ({ ...t, event_id: technicalEventId })), [{ id: technicalEventId, slug: "diwo-technical-test-20261012" }]);
  assert.equal(rows[0].technical, true);
  assert.equal(rows[0].actualEvent, false);
  assert.deepEqual(orderSummary(rows), { pending: 0, paidOrders: 0, totalCents: 0, issued: 0, used: 0, unused: 0 });
});
