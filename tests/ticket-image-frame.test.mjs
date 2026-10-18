import assert from "node:assert/strict";
import { after, test } from "node:test";
import { frameTicketImage } from "../lib/ticket-image-frame.ts";

const previousImage = globalThis.Image, previousDocument = globalThis.document;
after(() => {
  if (previousImage === undefined) delete globalThis.Image; else globalThis.Image = previousImage;
  if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
});
function setup({ width = 1000, height = 1600, available = true } = {}) {
  const calls = [];
  const context = { fillStyle: "", fillRect: (...args) => calls.push(["fill", context.fillStyle, ...args]), drawImage: (...args) => calls.push(["draw", ...args]) };
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
test("JPG keeps its output format; remote sources, invalid geometry and unavailable canvas fail without a fake image", async () => {
  const { calls } = setup();
  await frameTicketImage("data:image/jpeg;base64,dGlja2V0", "jpg");
  assert.deepEqual(calls.at(-1), ["encode", "image/jpeg", 0.96]);
  await assert.rejects(frameTicketImage("https://example.com/private", "png"), /invalid_ticket_raster/);
  setup({ width: 0 }); await assert.rejects(frameTicketImage("data:image/png;base64,dGlja2V0", "png"), /invalid_ticket_dimensions/);
  setup({ available: false }); await assert.rejects(frameTicketImage("data:image/png;base64,dGlja2V0", "png"), /ticket_canvas_unavailable/);
});
