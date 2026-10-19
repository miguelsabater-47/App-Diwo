import assert from "node:assert/strict";
import { after, test } from "node:test";
import { frameTicketImage } from "../lib/ticket-image-frame.ts";

const previousImage = globalThis.Image, previousDocument = globalThis.document;
after(() => {
  if (previousImage === undefined) delete globalThis.Image; else globalThis.Image = previousImage;
  if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
});
function setup({ width = 1000, height = 1600, available = true, blankQr = false } = {}) {
  const calls = [];
  const context = { fillStyle: "", fillRect: (...args) => calls.push(["fill", context.fillStyle, ...args]), drawImage: (...args) => calls.push(["draw", ...args]) };
  for (const method of ["save", "restore", "beginPath", "moveTo", "lineTo", "quadraticCurveTo", "closePath", "clip"]) {
    context[method] = (...args) => calls.push([method, ...args]);
  }
  context.getImageData = (...args) => {
    calls.push(["pixels", ...args]);
    return { data: new Uint8ClampedArray(blankQr ? [255, 255, 255, 255] : [0, 0, 0, 255, 255, 255, 255, 255]) };
  };
  const canvas = { width: 0, height: 0, getContext: type => { assert.equal(type, "2d"); return available ? context : null; },
    toDataURL: (...args) => { calls.push(["encode", ...args]); return "data:image/png;base64,cGFkZGVk"; } };
  globalThis.Image = class { naturalWidth = width; naturalHeight = height; async decode() { calls.push(["decode", this.src]); } };
  globalThis.document = { createElement: type => { assert.equal(type, "canvas"); return canvas; } };
  return { calls, canvas };
}
test("export adds 8 percent black margin on all sides, preserving the original ticket pixels and aspect", async () => {
  const { calls, canvas } = setup();
  await frameTicketImage("data:image/png;base64,dGlja2V0", "png");
  assert.equal(canvas.width, 1160); assert.equal(canvas.height, 1760);
  assert.deepEqual(calls.find(call => call[0] === "fill"), ["fill", "#000000", 0, 0, 1160, 1760]);
  const draw = calls.find(call => call[0] === "draw");
  assert.equal(draw.length, 4, "No destination width/height: never rescale or stretch QR pixels");
  assert.deepEqual(draw.slice(2), [80, 80]);
  assert.deepEqual(calls.at(-1), ["encode", "image/png", 0.96]);
});

function layers() {
  return {
    width: 500, height: 800,
    images: [
      { x: 1, y: 1, width: 498, height: 299, radius: 18, kind: "artwork", image: { src: "poster", naturalWidth: 1400, naturalHeight: 840 } },
      { x: 20, y: 400, width: 180, height: 180, radius: 0, kind: "qr", image: { src: "verified-qr", naturalWidth: 320, naturalHeight: 320 } },
    ],
    reference: { x: 300, y: 10, width: 190, height: 20 },
  };
}

test("images omitted by the DOM renderer are painted directly, then the reference is restored above the poster", async () => {
  for (const format of ["png", "jpg"]) {
    const { calls } = setup();
    const snapshot = layers();
    await frameTicketImage("data:image/png;base64,Ymxhbms=", format, snapshot);
    const draws = calls.filter(call => call[0] === "draw");
    assert.deepEqual(draws.map(call => call[1].src), ["data:image/png;base64,Ymxhbms=", "poster", "verified-qr", "data:image/png;base64,Ymxhbms="]);
    assert.deepEqual(draws[2].slice(2), [120, 880, 360, 360]);
    assert.deepEqual(draws[3].slice(2), [600, 20, 380, 40, 680, 100, 380, 40]);
    assert.ok(calls.findIndex(call => call[0] === "clip") < calls.indexOf(draws[1]));
    assert.deepEqual(calls.find(call => call[0] === "pixels"), ["pixels", 120, 880, 360, 360]);
    assert.deepEqual(calls.at(-1), ["encode", format === "png" ? "image/png" : "image/jpeg", 0.96]);
  }
});

test("blank QR pixels or resized layout fail instead of producing an apparently valid ticket file", async () => {
  const blank = setup({ blankQr: true });
  await assert.rejects(frameTicketImage("data:image/png;base64,Ymxhbms=", "png", layers()), /ticket_qr_raster_blank/);
  assert.equal(blank.calls.some(call => call[0] === "encode"), false);
  setup();
  await assert.rejects(frameTicketImage("data:image/png;base64,Ymxhbms=", "png", { ...layers(), height: 810 }), /ticket_raster_layout_changed/);
});
test("JPG keeps its output format; remote sources, invalid geometry and unavailable canvas fail without a fake image", async () => {
  const { calls } = setup();
  await frameTicketImage("data:image/jpeg;base64,dGlja2V0", "jpg");
  assert.deepEqual(calls.at(-1), ["encode", "image/jpeg", 0.96]);
  await assert.rejects(frameTicketImage("https://example.com/private", "png"), /invalid_ticket_raster/);
  setup({ width: 0 }); await assert.rejects(frameTicketImage("data:image/png;base64,dGlja2V0", "png"), /invalid_ticket_dimensions/);
  setup({ available: false }); await assert.rejects(frameTicketImage("data:image/png;base64,dGlja2V0", "png"), /ticket_canvas_unavailable/);
});
