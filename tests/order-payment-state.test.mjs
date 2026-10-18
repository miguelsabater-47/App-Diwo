import assert from "node:assert/strict";
import { test } from "node:test";
import { approvedBizumPhone, paymentPhone, paymentNotice, paymentApproval } from "../lib/order-payment-state.ts";

test("approved public recipient is the default; explicit recipient overrides must still validate", () => {
  // Synthetic numeric shape, not a collected real recipient.
  assert.equal(paymentPhone("+34 600 000 000"), "+34600000000");
  assert.equal(paymentPhone(undefined), approvedBizumPhone);
  assert.equal(approvedBizumPhone, "638038828");
  for (const value of ["", "Por configurar", "not-a-phone", "600000000-extra", "112"]) {
    assert.equal(paymentPhone(value), null);
  }
});

test("approval UI only acknowledges same confirmed order, exact quantity and original timestamp", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const order = { id, status: "confirmed", issuedTicketCount: 2, confirmedAt: "2026-10-12T12:00:00.000Z" };
  assert.equal(paymentApproval({ order }, id, 2), true);
  for (const changed of [{ id: "other" }, { status: "pending" }, { issuedTicketCount: 3 }, { confirmedAt: null }]) {
    assert.equal(paymentApproval({ order: { ...order, ...changed } }, id, 2), false);
  }
});

test("notice verification never turns pending into paid and ties safe result to the exact order", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const at = "2026-10-12T12:00:00.000Z";
  assert.deepEqual(paymentNotice({ order: { id, status: "pending", paymentReportedAt: at, qr_token: "private-fixture" } }, id), {
    status: "pending", reportedAt: at,
  });
  assert.deepEqual(paymentNotice({ order: { id, status: "confirmed", paymentReportedAt: null } }, id), {
    status: "confirmed", reportedAt: null,
  });
  for (const order of [{ id: "other", status: "pending", paymentReportedAt: at },
    { id, status: "pending", paymentReportedAt: null }, { id, status: "paid", paymentReportedAt: at },
    { id, status: "pending", paymentReportedAt: "1" }, { id, status: "pending" }]) {
    assert.equal(paymentNotice({ order }, id), null);
  }
});
