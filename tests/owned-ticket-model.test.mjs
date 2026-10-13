import assert from "node:assert/strict";
import { test } from "node:test";
import { ownedTicket, ticketId } from "../lib/owned-ticket-model.ts";

const id = "00000000-0000-4000-8000-000000000001";
const stamp = "2026-10-31T21:00:00.000Z";
const row = { id, order_id: id, event_id: id, attendee_name: "Guest", status: "valid", issued_at: stamp,
  used_at: null, revoked_at: null, qr_token: "a".repeat(64), event_slug: "diwo-x-2-2026", event_title: "DIWO X 2.0",
  starts_at: stamp, ends_at: "2026-11-01T06:00:00.000Z", timezone: "Europe/Madrid",
  public_location: "Casa de campo en Ceutí", unit_price_cents: 500, currency: "EUR", order_reference: "DIWO-ABC123" };

test("accepts strict UUID detail and 64 lowercase hex token while returning safe model", () => {
  assert.equal(ticketId(id), true);
  const safe = ownedTicket(row);
  assert.equal(safe.status, "valid");
  assert.equal(safe.qrToken, row.qr_token);
  assert.equal(JSON.stringify(safe).includes("buyer_clerk"), false);
});

test("rejects malformed IDs, invalid token and inconsistent row", () => {
  assert.equal(ticketId("not-a-ticket"), false);
  for (const bad of ["A".repeat(64), "a".repeat(63), null]) assert.equal(ownedTicket({ ...row, qr_token: bad }), null);
  assert.equal(ownedTicket({ ...row, attendee_name: " " }), null);
});

test("used and revoked tickets expose history but never a QR token", () => {
  for (const [status, fields] of [["used", { used_at: stamp }], ["revoked", { revoked_at: stamp }]]) {
    const safe = ownedTicket({ ...row, ...fields, status, qr_token: null });
    assert.equal(safe.status, status);
    assert.equal(safe.qrToken, null);
  }
});

test("retained fictional event is readable without replacing its public metadata", () => {
  const technical = { ...row, event_id: "9d560641-aacf-4d25-8d65-94960bba59b2",
    event_slug: "diwo-technical-test-20261012", public_location: "Evento ficticio de integración",
    event_title: "PRUEBA TÉCNICA — NO VÁLIDA PARA DIWO X 2.0",
    starts_at: "2020-01-02T22:00:00.000Z", ends_at: "2020-01-03T06:00:00.000Z" };
  assert.equal(ownedTicket(technical)?.publicLocation, technical.public_location);
  assert.equal(ownedTicket({ ...technical, event_id: id }), null);
  assert.equal(ownedTicket({ ...row, public_location: "Private exact address" }), null);
});
