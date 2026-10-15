import assert from "node:assert/strict";
import { test } from "node:test";
import { handleOrderMutation } from "../lib/order-mutation-core.ts";

// Synthetic data and injected sessions only; no signed token or hosted writes.
const id = "00000000-0000-4000-8000-000000000001";
const eventId = "00000000-0000-4000-8000-000000000002";
const time = "2026-10-12T10:00:00.000Z";
const payload = { requestId: id, eventId, buyerName: "  Synthetic Buyer  ", attendeeNames: [" Guest One ", "Guest Two"] };
const created = { order_id: id, order_reference: "DIWO-ABCDEF123456", order_status: "pending", ticket_quantity: 2, total_cents: 1000 };
const approved = { order_id: id, order_status: "confirmed", confirmed_at: time, issued_ticket_count: 2 };
const request = (body, overrides = {}) => new Request("http://localhost:3000/api/orders/request", {
  method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" },
  body: JSON.stringify(body), ...overrides,
});
function fixture(role = "user", result = { data: [created], error: null }) {
  const calls = [];
  let sessions = 0;
  const authorize = async () => {
    sessions++;
    return { ok: true, role, client: { rpc: async (name, args) => {
      calls.push({ name, args });
      return result;
    } } };
  };
  return { calls, authorize, sessions: () => sessions };
}
async function expectError(response, status, error) {
  assert.equal(response.status, status);
  assert.deepEqual(await response.json(), { error });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
}

test("buyer operations preserve all three roles and forward only trusted RPC arguments", async () => {
  for (const role of ["user", "door_staff", "admin"]) {
    const f = fixture(role);
    const response = await handleOrderMutation(request(payload), "request", f.authorize);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { order: { id, status: "pending", reference: "DIWO-ABCDEF123456", quantity: 2, totalCents: 1000 } });
    assert.deepEqual(f.calls, [{ name: "create_order_request", args: {
      request_id: id, target_event: eventId, request_buyer_name: "Synthetic Buyer", request_attendee_names: ["Guest One", "Guest Two"],
    } }]);
    assert.equal(f.sessions(), 1);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
});

test("approval is admin-only and a database denial after the gate still wins", async () => {
  for (const role of ["user", "door_staff"]) {
    const f = fixture(role);
    await expectError(await handleOrderMutation(request({ orderId: id }), "approve-payment", f.authorize), 403, "operation_not_authorized");
    assert.equal(f.calls.length, 0);
  }
  const f = fixture("admin", { data: [approved], error: null });
  const response = await handleOrderMutation(request({ orderId: id }), "approve-payment", f.authorize);
  assert.deepEqual(await response.json(), { order: { id, status: "confirmed", confirmedAt: time, issuedTicketCount: 2 } });
  assert.deepEqual(f.calls, [{ name: "approve_order_payment", args: { target_order: id } }]);
  const revoked = fixture("admin", { data: [approved], error: { code: "42501", message: "synthetic-private-error" } });
  await expectError(await handleOrderMutation(request({ orderId: id }), "approve-payment", revoked.authorize), 403, "operation_not_authorized");
});

test("cancellation requires current admin and returns only the same-ID terminal receipt", async () => {
  for (const [operation, status, rpc] of [["cancel", "cancelled", "cancel_order_request"]]) {
    for (const role of ["user", "door_staff"]) {
      const f = fixture(role);
      await expectError(await handleOrderMutation(request({ orderId: id }), operation, f.authorize), 403, "operation_not_authorized");
      assert.equal(f.calls.length, 0);
    }
    const row = { order_id: id, order_status: status, closed_at: time, closed_by: "user_private_admin", qr_token: "private" };
    const f = fixture("admin", { data: [row], error: null });
    for (let attempt = 0; attempt < 2; attempt++) {
      assert.deepEqual(await (await handleOrderMutation(request({ orderId: id }), operation, f.authorize)).json(), {
        order: { id, status, closedAt: time },
      });
    }
    assert.deepEqual(f.calls, Array(2).fill({ name: rpc, args: { target_order: id } }));
    const revoked = fixture("admin", { data: null, error: { code: "42501", message: "private" } });
    await expectError(await handleOrderMutation(request({ orderId: id }), operation, revoked.authorize), 403, "operation_not_authorized");
    for (const invalid of [{ ...row, order_status: "confirmed" }, { ...row, order_id: eventId }, { ...row, closed_at: null }, { ...row, order_status: status === "rejected" ? "cancelled" : "rejected" }]) {
      await expectError(await handleOrderMutation(request({ orderId: id }), operation, fixture("admin", { data: [invalid], error: null }).authorize), 502, "order_operation_failed");
    }
    for (const extra of [{ role: "admin" }, { closedBy: "user_private_admin" }, { status }, { reason: "injected" }]) {
      const f = fixture("admin");
      await expectError(await handleOrderMutation(request({ orderId: id, ...extra }), operation, f.authorize), 400, "invalid_request_body");
      assert.equal(f.calls.length, 0);
    }
  }
});

test("closure operations keep HTTP/session boundaries and never retry an ambiguous or conflicting write", async () => {
  for (const operation of ["cancel"]) {
    const f = fixture("admin");
    for (const headers of [{ "content-type": "application/json" }, { origin: "https://other.example", "content-type": "application/json" }]) {
      await expectError(await handleOrderMutation(request({ orderId: id }, { headers }), operation, f.authorize), 403, "request_origin_not_allowed");
    }
    await expectError(await handleOrderMutation(request({ orderId: id }, { headers: { origin: "http://localhost:3000", "content-type": "text/plain" } }), operation, f.authorize), 415, "json_request_required");
    assert.equal(f.sessions(), 0);
    await expectError(await handleOrderMutation(request({ orderId: id }), operation, async () => ({ ok: false, status: 401, reason: "authentication_required" })), 401, "authentication_required");
    for (const orderId of [null, "bad", "", 1]) {
      await expectError(await handleOrderMutation(request({ orderId }), operation, f.authorize), 400, "invalid_request_body");
    }
    assert.equal(f.calls.length, 0);
    const conflict = fixture("admin", { data: null, error: { code: "22023", message: "order_not_pending" } });
    await expectError(await handleOrderMutation(request({ orderId: id }), operation, conflict.authorize), 409, "order_not_pending");
    assert.equal(conflict.calls.length, 1);
    const ambiguous = fixture("admin", { data: null, error: { code: "UNKNOWN", message: "private" } });
    await expectError(await handleOrderMutation(request({ orderId: id }), operation, ambiguous.authorize), 502, "order_operation_failed");
    assert.equal(ambiguous.calls.length, 1);
  }
});

test("payment notice stays pending and a confirmed order without a notice is a safe result", async () => {
  for (const [status, reportedAt] of [["pending", time], ["confirmed", null]]) {
    const f = fixture("user", { data: [{ order_id: id, order_status: status, payment_reported_at: reportedAt }], error: null });
    const response = await handleOrderMutation(request({ orderId: id }), "report-payment", f.authorize);
    assert.deepEqual(await response.json(), { order: { id, status, paymentReportedAt: reportedAt } });
    assert.deepEqual(f.calls, [{ name: "report_order_payment", args: { target_order: id } }]);
  }
});

test("anonymous, incomplete configuration and invalid role lookup cannot call writers", async () => {
  for (const [status, reason] of [[401, "authentication_required"], [503, "local_configuration_required"],
    [503, "supabase_configuration_required"], [502, "supabase_session_verification_failed"]]) {
    await expectError(await handleOrderMutation(request(payload), "request", async () => ({ ok: false, status, reason })), status, reason);
  }
  await expectError(await handleOrderMutation(request(payload), "request", async () => { throw Error("synthetic-private-token"); }), 502, "order_operation_failed");
});

test("cross-site, missing Origin, nonlocal Host and non-JSON requests fail before session access", async () => {
  const f = fixture();
  for (const origin of [undefined, "null", "https://other.example", "http://localhost:3000.evil.example"]) {
    const headers = { "content-type": "application/json", ...(origin ? { origin } : {}) };
    await expectError(await handleOrderMutation(request(payload, { headers }), "request", f.authorize), 403, "request_origin_not_allowed");
  }
  await expectError(await handleOrderMutation(new Request("http://other.example/api/orders/request", {
    method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" }, body: JSON.stringify(payload),
  }), "request", f.authorize), 403, "request_origin_not_allowed");
  await expectError(await handleOrderMutation(request(payload, { headers: {
    origin: "http://localhost:3000", "content-type": "application/json", "sec-fetch-site": "cross-site",
  } }), "request", f.authorize), 403, "request_origin_not_allowed");
  for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data"]) {
    await expectError(await handleOrderMutation(request(payload, { headers: { origin: "http://localhost:3000", "content-type": type } }), "request", f.authorize), 415, "json_request_required");
  }
  await expectError(await handleOrderMutation(request(payload, { headers: {
    origin: "http://localhost:3000", "content-type": "application/json", "content-encoding": "gzip",
  } }), "request", f.authorize), 415, "json_request_required");
  await expectError(await handleOrderMutation(new Request("http://localhost:3000/api/orders/request"), "request", f.authorize), 405, "method_not_allowed");
  assert.equal(f.sessions(), 0);
});

test("strict schema rejects identities, roles, prices, missing names and non-v4 submission IDs", async () => {
  const f = fixture();
  for (const body of [null, [], {}, { ...payload, role: "admin" }, { ...payload, buyerClerkId: "user_fixture_other" },
    { ...payload, totalCents: 1 }, { ...payload, quantity: 150 }, { ...payload, requestId: eventId.replace("4000", "1000") },
    { ...payload, eventId: "bad" }, { ...payload, buyerName: "\t " }, { ...payload, attendeeNames: [] },
    { ...payload, attendeeNames: [null] }, { ...payload, attendeeNames: [["Nested"]] },
    { ...payload, attendeeNames: ["\u0000"] }, { ...payload, attendeeNames: [" "] }]) {
    await expectError(await handleOrderMutation(request(body), "request", f.authorize), 400, "invalid_request_body");
  }
  for (const operation of ["report-payment", "approve-payment"]) {
    await expectError(await handleOrderMutation(request({ orderId: id, role: "admin" }), operation, fixture("admin").authorize), 400, "invalid_request_body");
  }
  await expectError(await handleOrderMutation(request(payload, { body: "{" }), "request", f.authorize), 400, "invalid_request_body");
  assert.equal(f.calls.length, 0);
});

test("actual bytes are bounded even when Content-Length is absent or dishonest", async () => {
  const f = fixture();
  for (const length of [undefined, "1", "65537"]) {
    const headers = { origin: "http://localhost:3000", "content-type": "application/json", ...(length ? { "content-length": length } : {}) };
    await expectError(await handleOrderMutation(request(payload, { headers, body: JSON.stringify({ ...payload, buyerName: "é".repeat(40000) }) }), "request", f.authorize), 413, "request_body_too_large");
  }
  assert.equal(f.calls.length, 0);
});

test("retries preserve UUID and normalized payload, including original terminal-order responses", async () => {
  const f = fixture("user", { data: [{ ...created, order_status: "cancelled" }], error: null });
  for (let i = 0; i < 2; i++) {
    const response = await handleOrderMutation(request(payload), "request", f.authorize);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).order.status, "cancelled");
  }
  assert.deepEqual(f.calls[0], f.calls[1]);
  assert.equal(f.sessions(), 2);
});

test("only known database code/message pairs are public and failures never retry", async () => {
  for (const [code, message, status, exposed] of [
    ["22023", "sales_not_open", 409, "sales_not_open"], ["22023", "request_id_conflict", 409, "request_id_conflict"],
    ["22023", "order_not_found", 404, "order_not_found"], ["22023", "order_not_pending", 409, "order_not_pending"],
    ["22023", "invalid_order_request", 400, "invalid_order_request"], ["23514", "order_ticket_count_mismatch", 502, "order_operation_failed"],
    ["22023", "synthetic-private-detail", 502, "order_operation_failed"], ["UNKNOWN", "sales_not_open", 502, "order_operation_failed"],
    ["22023", "toString", 502, "order_operation_failed"],
  ]) {
    const f = fixture("user", { data: [created], error: { code, message, details: "synthetic-private-detail" } });
    await expectError(await handleOrderMutation(request(payload), "request", f.authorize), status, exposed);
    assert.equal(f.calls.length, 1);
  }
  const f = fixture();
  const authorize = async () => ({ ...(await f.authorize()), client: { rpc: async () => { throw Error("synthetic-private-error"); } } });
  await expectError(await handleOrderMutation(request(payload), "request", authorize), 502, "order_operation_failed");
});

test("malformed results fail closed and extra private properties are never returned", async () => {
  for (const row of [null, [], [created, created], [{ ...created, order_id: eventId }],
    [{ ...created, total_cents: 5 }], [{ ...created, ticket_quantity: 3 }], [{ ...created, order_reference: "private" }],
    [{ ...created, total_cents: "9007199254740993" }]]) {
    const f = fixture("user", { data: row, error: null });
    await expectError(await handleOrderMutation(request(payload), "request", f.authorize), 502, "order_operation_failed");
  }
  const f = fixture("user", { data: [{ ...created, total_cents: "1000", qr_token: "synthetic-private-qr", buyer_clerk_id: "user_fixture_private" }], error: null });
  assert.deepEqual(await (await handleOrderMutation(request(payload), "request", f.authorize)).json(), {
    order: { id, status: "pending", reference: "DIWO-ABCDEF123456", quantity: 2, totalCents: 1000 },
  });
  for (const row of [{ ...approved, order_status: "pending" }, { ...approved, confirmed_at: null }, { ...approved, issued_ticket_count: 0 }]) {
    await expectError(await handleOrderMutation(request({ orderId: id }), "approve-payment", fixture("admin", { data: [row], error: null }).authorize), 502, "order_operation_failed");
  }
});
