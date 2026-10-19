import assert from "node:assert/strict";
import { after, test } from "node:test";
import { ticketImageLayers } from "../lib/ticket-image-layers.ts";

const originals = Object.fromEntries(["Image", "window", "getComputedStyle"].map(key => [key, globalThis[key]]));
after(() => {
  for (const [key, value] of Object.entries(originals)) {
    if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
  }
});
const qr = "data:image/png;base64,YWJj";
function setup({ design = false, failDecode = false, missingPoster = false, missingQr = false, otherQr = false, externalPoster = false, invalidQr = false } = {}) {
  const loaded = [];
  globalThis.window = { location: { href: "https://diwo.example/ticket/synthetic", origin: "https://diwo.example" } };
  globalThis.getComputedStyle = () => ({ borderTopLeftRadius: "18px" });
  globalThis.Image = class {
    naturalWidth = 320; naturalHeight = 320;
    async decode() {
      loaded.push(this.src);
      if (failDecode) throw new Error("decode_failed");
      if (!this.src.startsWith("data:")) { this.naturalWidth = 1400; this.naturalHeight = 840; }
      else if (invalidQr) this.naturalHeight = 100;
    }
  };
  const element = (left, top, width, height) => ({ getBoundingClientRect: () => ({ left, top, width, height }) });
  const artwork = { ...element(101, 51, 498, 299), src: externalPoster ? "https://external.example/image" : "/imagen entrada.jpg" };
  const privateImage = { ...element(120, 450, 180, 180), src: otherQr ? "data:image/png;base64,b2xk" : qr };
  const selectors = {
    ".diwo-ticket-art": missingPoster ? null : artwork,
    ".diwo-ticket-artwork": element(100, 50, 500, 300),
    ".diwo-ticket-order": element(400, 60, 190, 20),
    "[data-ticket-qr]": design || missingQr ? null : privateImage,
  };
  const card = { ...element(100, 50, 500, 800), querySelector: selector => selectors[selector] };
  return { card, loaded, selectors };
}

test("snapshot independently decodes the public poster and exact fresh private QR with card-relative geometry", async () => {
  const { card, loaded } = setup();
  const result = await ticketImageLayers(card, qr);
  assert.deepEqual(loaded, ["https://diwo.example/imagen%20entrada.jpg", qr]);
  assert.deepEqual(result.images.map(({ image, ...rect }) => ({ ...rect, source: image.src })), [
    { x: 1, y: 1, width: 498, height: 299, kind: "artwork", radius: 18, source: loaded[0] },
    { x: 20, y: 400, width: 180, height: 180, kind: "qr", radius: 0, source: qr },
  ]);
  assert.deepEqual(result.reference, { x: 300, y: 10, width: 190, height: 20 });
});

test("QR-free design only decodes its poster; it never borrows a private image", async () => {
  const { card, loaded } = setup({ design: true });
  assert.deepEqual((await ticketImageLayers(card, null)).images.map(layer => layer.kind), ["artwork"]);
  assert.equal(loaded.length, 1);
  await assert.rejects(ticketImageLayers(setup().card, null), /unexpected_private_qr_in_design/);
});

test("missing, mismatched, remote or undecodable images cannot produce a complete ticket", async () => {
  for (const [options, error] of [
    [{ missingPoster: true }, /ticket_artwork_missing/],
    [{ missingQr: true }, /ticket_qr_image_mismatch/],
    [{ otherQr: true }, /ticket_qr_image_mismatch/],
    [{ externalPoster: true }, /unexpected_ticket_artwork_source/],
    [{ failDecode: true }, /decode_failed/],
    [{ invalidQr: true }, /invalid_ticket_qr_dimensions/],
  ]) {
    await assert.rejects(ticketImageLayers(setup(options).card, qr), error);
  }
  await assert.rejects(ticketImageLayers(setup().card, "https://external.example/private-qr"), /ticket_qr_image_mismatch/);
  const { card, selectors } = setup();
  selectors[".diwo-ticket-order"].getBoundingClientRect = () => ({ left: -50, top: 60, width: 100, height: 20 });
  await assert.rejects(ticketImageLayers(card, qr), /invalid_ticket_image_layout/);
});
