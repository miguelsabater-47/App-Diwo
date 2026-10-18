import assert from "node:assert/strict";
import { test } from "node:test";
import { handleOrderMutation } from "../lib/order-mutation-core.ts";
import { adminTickets, filterAdminTickets, revokedTicketReceipt } from "../lib/admin-ticket-model.ts";

const id = "00000000-0000-4000-8000-0000000000ab", time = "2026-10-17T09:00:00.123456Z";
const row = { ticket_id: id, ticket_status: "revoked", revoked_at: time, qr_token: "private", revoked_by: "private" };
const request = (body = { ticketId: id }, origin = "http://localhost:3000") => new Request("http://localhost:3000/api/tickets/revoke", {
  method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body),
});
function session(role = "admin", data = [row], error = null) {
  const calls = [];
  return { calls, authorize: async () => ({ ok: true, role, client: { rpc: async (...args) => {
    calls.push(args); return { data, error };
  } } }) };
}
test("annulment is current-admin only; same-origin strict ticket ID; safe exact receipt", async () => {
  for (const role of ["user", "door_staff"]) {
    const f = session(role); assert.equal((await handleOrderMutation(request(), "revoke-ticket", f.authorize)).status, 403);
    assert.equal(f.calls.length, 0);
  }
  for (const body of [{ ticketId: id, role: "admin" }, { orderId: id }, { ticketId: "bad" }]) {
    const f = session(); assert.equal((await handleOrderMutation(request(body), "revoke-ticket", f.authorize)).status, 400);
    assert.equal(f.calls.length, 0);
  }
  const cross = session(); assert.equal((await handleOrderMutation(request({ ticketId: id }, "https://example.com"), "revoke-ticket", cross.authorize)).status, 403);
  assert.equal(cross.calls.length, 0);
  const f = session(), response = await handleOrderMutation(request({ ticketId: id.toUpperCase() }), "revoke-ticket", f.authorize);
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(f.calls, [["revoke_issued_ticket", { target_ticket: id }]]);
  assert.deepEqual(await response.json(), { ticket: { id, status: "revoked", revokedAt: time } });
});
test("used/missing tickets are explicit failures; malformed or ambiguous responses never succeed or retry", async () => {
  for (const [message, expected] of [["ticket_already_used", 409], ["ticket_not_found", 404]]) {
    const f = session("admin", null, { code: "22023", message });
    assert.equal((await handleOrderMutation(request(), "revoke-ticket", f.authorize)).status, expected);
    assert.equal(f.calls.length, 1);
  }
  for (const data of [[], [row, row], [{ ...row, ticket_status: "used" }], [{ ...row, ticket_id: "00000000-0000-4000-8000-000000000001" }], [{ ...row, revoked_at: null }]]) {
    const f = session("admin", data); assert.equal((await handleOrderMutation(request(), "revoke-ticket", f.authorize)).status, 502);
    assert.equal(f.calls.length, 1);
  }
});
test("admin list preserves individual status/history, searchable accents and validated same-ticket receipt", () => {
  const tickets = [{ id, position: 1, name: "Álvaro", status: "valid", usedAt: null, revokedAt: null, issuedAt: time }];
  const orders = [{ status: "confirmed", tickets, reference: "DIWO-ABCDEF123456", buyerName: "Miguel", eventTitle: "Test", technical: true },
    { status: "pending", tickets: [], reference: "DIWO-000000000000" }];
  const list = adminTickets(orders);
  assert.equal(list.length, 1); assert.equal(list[0].technical, true);
  for (const search of ["alvaro", "MIGUEL", "ABCDEF", "0000000000ab"]) assert.equal(filterAdminTickets(list, search, "all").length, 1);
  assert.equal(filterAdminTickets(list, "", "used").length, 0);
  assert.equal(revokedTicketReceipt({ ticket: { id, status: "revoked", revokedAt: time } }, id), time);
  assert.equal(revokedTicketReceipt({ ticket: { id, status: "used", revokedAt: time } }, id), null);
  assert.equal(revokedTicketReceipt({ ticket: { id, status: "revoked", revokedAt: time } }, "other"), null);
  assert.equal(tickets[0].status, "valid");
});
