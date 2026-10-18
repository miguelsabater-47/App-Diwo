import assert from "node:assert/strict";
import { test } from "node:test";
import { buyerRequestContext, buyerRequestCopy, matchesRecordedRequest } from "../lib/buyer-request-context.ts";

const order = { id: "order", eventId: "event", buyerName: "Buyer", names: ["Buyer"], status: "pending",
  actualEvent: true, technical: false, tickets: [], buyer_clerk_id: "never-forward-subject", qr_token: "never-forward-private-qr" };

test("Home derives only the actual event's owned state, never technical or unrelated history", () => {
  assert.equal(buyerRequestContext([]).state, "none");
  assert.equal(buyerRequestContext([{ ...order, technical: true }, { ...order, actualEvent: false }]).state, "none");
  assert.equal(buyerRequestContext([order]).state, "pending");
  const ready = { ...order, status: "confirmed", tickets: [{ status: "valid" }] };
  assert.equal(buyerRequestContext([ready]).state, "ready");
  assert.equal(buyerRequestContext([ready, order]).state, "pending");
  for (const status of ["used", "revoked"]) assert.equal(buyerRequestContext([{ ...ready, tickets: [{ status }] }]).state, "history");
  for (const status of ["cancelled", "rejected"]) assert.equal(buyerRequestContext([{ ...order, status }]).state, "closed");
  const result = buyerRequestContext([order]);
  assert.deepEqual(result.recorded, [{ id: "order", eventId: "event", buyerName: "Buyer", names: ["Buyer"], status: "pending" }]);
  assert.doesNotMatch(JSON.stringify(result), /never-forward|qr_token|buyer_clerk_id/);
  assert.equal(buyerRequestCopy(null).title.includes("Aún no tienes"), false);
});

test("only the exact recorded ID, event and complete payload resolve a retained submission; terminal requests may start another", () => {
  const draft = { requestId: "order", eventId: "event", buyerName: "Buyer", attendeeNames: ["Buyer"] };
  for (const status of ["pending", "confirmed", "cancelled", "rejected"]) assert.equal(matchesRecordedRequest(draft, [{ ...order, status }]), true);
  assert.equal(matchesRecordedRequest(draft, []), false);
  for (const change of [{ id: "other" }, { eventId: "other" }, { buyerName: "Other" }, { names: ["Other"] }, { names: ["Buyer", "Extra"] }, { status: "invalid" }]) {
    assert.equal(matchesRecordedRequest(draft, [{ ...order, ...change }]), false);
  }
});
