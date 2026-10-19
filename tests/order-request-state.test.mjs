import assert from "node:assert/strict";
import { test } from "node:test";
import { salesAvailability, parseRequestDraft, requestReceipt } from "../lib/order-request-state.ts";

const id = "00000000-0000-4000-8000-000000000001";
const eventId = "00000000-0000-4000-8000-000000000002";
const event = { id: eventId, slug: "diwo-x-2-2026", is_published: true, unit_price_cents: 500,
  currency: "EUR", timezone: "Europe/Madrid", sales_open_at: "2026-10-12T14:00:00+02:00",
  title: "DIWO X 2.0", public_location: "Casa de campo en Ceutí", starts_at: "2026-10-31T22:30:00Z",
  ends_at: "2026-11-01T06:00:00Z", arrival_from: "2026-10-31T22:30:00Z", arrival_until: "2026-11-01T00:30:00Z" };
const draft = { requestId: id, eventId, buyerName: "Synthetic Buyer", attendeeNames: ["Guest One", "Guest Two"] };

test("actual sales use the configured published opening, not a fixed October15 estimate or technical event", () => {
  const opening = Date.parse(event.sales_open_at);
  assert.deepEqual(salesAvailability(null, opening), { state: "unpublished", eventId: null });
  assert.deepEqual(salesAvailability(event, opening - 1), { state: "closed", eventId });
  assert.deepEqual(salesAvailability(event, opening), { state: "open", eventId });
  assert.deepEqual(salesAvailability({ ...event, sales_open_at: "2026-10-10T00:00:00Z" }, opening), { state: "open", eventId });
  for (const changed of [{ slug: "diwo-technical-test-20261012" }, { sales_open_at: "invalid" },
    { sales_open_at: event.starts_at },
    { is_published: false }, { unit_price_cents: 1 }, { currency: "USD" }, { timezone: "UTC" }, { id: "invalid" },
    { starts_at: "2020-01-02T22:00Z" }, { public_location: "Unexpected location" }]) {
    assert.deepEqual(salesAvailability({ ...event, ...changed }, opening), { state: "unavailable", eventId: null });
  }
});

test("confirmed schedule is 23:30 Madrid through 07:00 next day; stale 23:00 is rejected", () => {
  const clock = value => new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(value));
  assert.equal(clock(event.starts_at), "23:30");
  assert.equal(clock(event.ends_at), "07:00");
  assert.deepEqual(salesAvailability({ ...event, starts_at: "2026-10-31T22:00:00Z" }, Date.parse(event.sales_open_at)),
    { state: "unavailable", eventId: null });
  const lateOpening = { ...event, sales_open_at: "2026-10-31T22:15:00Z" };
  assert.deepEqual(salesAvailability(lateOpening, Date.parse(lateOpening.sales_open_at)), { state: "open", eventId });
  assert.deepEqual(salesAvailability({ ...event, sales_open_at: event.starts_at }, Date.parse(event.starts_at)),
    { state: "unavailable", eventId: null });
});

test("submission recovery retains original UUID and exact names, including many attendees", () => {
  assert.deepEqual(parseRequestDraft(JSON.stringify(draft), eventId), draft);
  const largeGroup = { ...draft, attendeeNames: Array.from({ length: 151 }, (_, i) => `Guest ${i}`) };
  assert.deepEqual(parseRequestDraft(JSON.stringify(largeGroup), eventId), largeGroup);
  assert.equal(parseRequestDraft(JSON.stringify(draft), id), null);
  for (const bad of [null, {}, { ...draft, role: "admin" }, { ...draft, requestId: "bad" },
    { ...draft, buyerName: " " }, { ...draft, attendeeNames: [] }, { ...draft, attendeeNames: [null] },
    { ...draft, attendeeNames: ["\u0000"] }]) assert.equal(parseRequestDraft(JSON.stringify(bad), eventId), null);
  assert.equal(parseRequestDraft("{", eventId), null);
});

test("receipt verification ties all states to exact submission, derived count/price and safe projection", () => {
  for (const status of ["pending", "confirmed", "cancelled", "rejected"]) {
    const order = { id, reference: "DIWO-ABCDEF123456", status, quantity: 2, totalCents: 1000 };
    assert.deepEqual(requestReceipt({ order: { ...order, qr_token: "synthetic-private-qr" } }, draft), order);
    for (const changed of [{ id: eventId }, { quantity: 1 }, { totalCents: 1 }, { reference: "bad" }, { status: "paid" }]) {
      assert.equal(requestReceipt({ order: { ...order, ...changed } }, draft), null);
    }
  }
});

test("receipts preserve four-character references and legacy references without truncation", () => {
  for (const reference of ["A7K9", "2345", "WXYZ", "DIWO-ABCDEF123456"]) {
    const order = { id, reference, status: "pending", quantity: 2, totalCents: 1000 };
    assert.deepEqual(requestReceipt({ order }, draft), order);
  }
  for (const reference of ["A7K", "A7K99", "a7k9", "A0K9", "A1K9", "AIK9", "AOK9", "DIWO-A7K9", " A7K9", "A7K9\n", null]) {
    assert.equal(requestReceipt({ order: { id, reference, status: "pending", quantity: 2, totalCents: 1000 } }, draft), null);
  }
});
