import assert from "node:assert/strict";
import { test } from "node:test";
import { exportTicketImageType, shareTicketImage, freshTicketQr } from "../lib/owned-ticket-export.ts";

test("only PNG and JPEG exports are supported", () => {
  assert.equal(exportTicketImageType("image/png"), "png");
  assert.equal(exportTicketImageType("image/jpeg"), "jpg");
  assert.equal(exportTicketImageType("image/webp"), null);
});

test("export requires the same fresh valid ticket and a local PNG QR", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const qr = "data:image/png;base64,YWJj";
  const result = { ok: true, ticket: { id, status: "valid", qrDataUrl: qr } };
  assert.equal(freshTicketQr(result, id), qr);
  for (const ticket of [
    { ...result.ticket, id: "different" },
    { ...result.ticket, status: "used" },
    { ...result.ticket, status: "revoked" },
    { ...result.ticket, qrDataUrl: null },
    { ...result.ticket, qrDataUrl: "https://example.com/qr" },
  ]) assert.equal(freshTicketQr({ ok: true, ticket }, id), null);
  assert.equal(freshTicketQr({ ok: false }, id), null);
  assert.equal(freshTicketQr(null, id), null);
});

test("prepared native share invokes the platform before any await", async () => {
  let invoked = false;
  const promise = shareTicketImage({ canShare: () => true, share: () => {
    invoked = true; return Promise.resolve();
  } }, {});
  assert.equal(invoked, true);
  assert.equal(await promise, "shared");
});

test("native sharing requires file capability and supports download fallback", async () => {
  assert.equal(await shareTicketImage({ canShare: () => false, share: async () => {} }, {}), "download");
  assert.equal(await shareTicketImage({ canShare: () => true, share: async () => {} }, {}), "shared");
  await assert.rejects(shareTicketImage({ canShare: () => true, share: async () => { throw new Error("failure"); } }, {}));
});
