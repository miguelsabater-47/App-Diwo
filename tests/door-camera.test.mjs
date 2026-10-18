import assert from "node:assert/strict";
import { test } from "node:test";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { createDoorCameraSession } from "../lib/door-camera-session.ts";
import { createQrFrameReader } from "../lib/qr-frame-reader.ts";

const deferred = () => { let resolve, reject; const promise = new Promise((yes,no) => { resolve=yes; reject=no; }); return { promise,resolve,reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function frame(text, inverted = false, rotated = false) {
  const qr = QRCode.create(text,{ errorCorrectionLevel:"M" }), size = (qr.modules.size + 8) * 6;
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let y=0;y<size;y++) for (let x=0;x<size;x++) {
    const col = Math.floor(x/6)-4, row = Math.floor(y/6)-4;
    const dark = col>=0 && row>=0 && col<qr.modules.size && row<qr.modules.size && qr.modules.get(row,col);
    const value = Boolean(dark) !== inverted ? 0 : 255;
    const position = (rotated ? x*size+(size-1-y) : y*size+x)*4;
    pixels.set([value,value,value,255],position);
  }
  return { data:pixels,width:size,height:size };
}
function readerFixture(image, native) {
  let loads=0, clears=0, drawn=0;
  const canvas = { width:0,height:0,getContext:() => ({
    drawImage() { drawn++; }, getImageData:() => ({ ...image,data:new Uint8ClampedArray(image.data) }), clearRect() { clears++; },
  }) };
  return { deps:{ native,canvas:() => canvas,loadSoftware:async () => { loads++; return jsQR; } },canvas,
    video:{ videoWidth:image.width,videoHeight:image.height }, stats:() => ({ loads,clears,drawn }) };
}
test("software reader decodes real synthetic QR pixels, rotations and inverted colors without native API", async () => {
  for (const [inverted,rotated] of [[false,false],[false,true],[true,false]]) {
    const token = "a".repeat(64), f = readerFixture(frame(token,inverted,rotated));
    const reader = await createQrFrameReader(f.deps);
    assert.deepEqual(await reader.detect(f.video),[{ rawValue:token }]);
    assert.deepEqual(await reader.detect(f.video),[{ rawValue:token }]);
    assert.deepEqual(f.stats(),{ loads:1,clears:2,drawn:2 });
    reader.dispose(); assert.equal(f.canvas.width,0); assert.equal(f.canvas.height,0);
    assert.deepEqual(await reader.detect(f.video),[]);
  }
});
test("native detector avoids software download; partial/broken native APIs fall back locally", async () => {
  class Working { static async getSupportedFormats() { return ["qr_code"]; } async detect() { return [{ rawValue:"synthetic" }]; } }
  const native = readerFixture(frame("synthetic"),Working), reader = await createQrFrameReader(native.deps);
  assert.deepEqual(await reader.detect(native.video),[{ rawValue:"synthetic" }]); assert.equal(native.stats().loads,0); reader.dispose();
  class Broken extends Working { async detect() { throw Error("unavailable"); } }
  class Partial extends Working { static async getSupportedFormats() { throw Error("unavailable"); } }
  class NoQr extends Working { static async getSupportedFormats() { return ["ean_13"]; } }
  for (const Constructor of [Broken,Partial,NoQr]) {
    const f = readerFixture(frame("synthetic"),Constructor), decoder = await createQrFrameReader(f.deps);
    assert.deepEqual(await decoder.detect(f.video),[{ rawValue:"synthetic" }]); assert.equal(f.stats().loads,1); decoder.dispose();
  }
});
test("disposing while native decode or software download is pending suppresses late content", async () => {
  const pending = deferred();
  class Native { static async getSupportedFormats() { return ["qr_code"]; } detect() { return pending.promise; } }
  const f = readerFixture(frame("synthetic"),Native), reader = await createQrFrameReader(f.deps);
  const work = reader.detect(f.video); reader.dispose(); pending.resolve([{ rawValue:"synthetic" }]); assert.deepEqual(await work,[]);
  const load = deferred(), software = readerFixture(frame("synthetic")); software.deps.loadSoftware = () => load.promise;
  const other = await createQrFrameReader(software.deps), decoding = other.detect(software.video); other.dispose(); load.resolve(jsQR);
  assert.deepEqual(await decoding,[]); assert.equal(software.stats().drawn,0);
});
function cameraFixture(changes = {}) {
  const state = { trackStops:0,disposed:0,ready:0,codes:[],failures:0,scheduled:[],cancelled:[],mediaCalls:0,detectCalls:0 };
  const stream = { getTracks:() => [{ stop:() => state.trackStops++ }] };
  const video = { readyState:2,srcObject:null,play:async () => {},...changes.video };
  const deps = {
    video,reader:{ detect:async () => { state.detectCalls++; return changes.codes ?? []; },dispose:() => state.disposed++ },
    media:{ async getUserMedia() { state.mediaCalls++; return stream; } },
    schedule(callback) { state.scheduled.push(callback); return state.scheduled.length; },cancel:id => state.cancelled.push(id),
    ready:() => state.ready++,codes:codes => { assert.equal(state.trackStops,1); state.codes.push(codes); },failure:() => state.failures++,
    ...changes.deps,
  };
  return { state,stream,video,deps,session:createDoorCameraSession(deps) };
}
test("camera stops tracks before publishing one result and never starts twice or auto-retries", async () => {
  const f = cameraFixture({ codes:[{ rawValue:"synthetic" }] }); await f.session.start(); await tick(); await f.session.start(); f.session.stop();
  assert.equal(f.state.mediaCalls,1); assert.equal(f.state.ready,1); assert.equal(f.state.codes.length,1);
  assert.equal(f.state.trackStops,1); assert.equal(f.state.disposed,1); assert.equal(f.state.scheduled.length,0); assert.equal(f.video.srcObject,null);
});
test("camera cancellation handles pending permission/play/decode and clears pending timers", async () => {
  const permission = deferred(), f = cameraFixture(); f.deps.media.getUserMedia = () => permission.promise;
  const starting = f.session.start(); f.session.stop(); permission.resolve(f.stream); await starting;
  assert.equal(f.state.trackStops,1); assert.equal(f.state.ready,0); assert.equal(f.state.codes.length,0);
  const playing = deferred(), p = cameraFixture({ video:{ play:() => playing.promise } }); const play = p.session.start(); await tick();
  p.session.stop(); playing.resolve(); await play; assert.equal(p.state.trackStops,1); assert.equal(p.state.ready,0);
  const decoded = deferred(), d = cameraFixture(); d.deps.reader.detect = () => decoded.promise;
  await d.session.start(); d.session.stop(); decoded.resolve([{ rawValue:"synthetic" }]); await tick(); assert.equal(d.state.codes.length,0);
  const waiting = cameraFixture(); await waiting.session.start(); await tick(); waiting.session.stop();
  assert.deepEqual(waiting.state.cancelled,[1]); await waiting.state.scheduled[0](); assert.equal(waiting.state.detectCalls,1);
});
test("permission, playback and decoder failures stop safely with one failure and no code result", async () => {
  for (const step of ["permission","play","decode"]) {
    const f = cameraFixture();
    const error = async () => { throw Error("private upstream detail"); };
    if (step === "permission") f.deps.media.getUserMedia = error;
    if (step === "play") f.video.play = error;
    if (step === "decode") f.deps.reader.detect = error;
    await f.session.start(); await tick(); await f.session.start();
    assert.equal(f.state.failures,1); assert.equal(f.state.codes.length,0); assert.equal(f.state.disposed,1);
    assert.equal(f.state.trackStops,step === "permission" ? 0 : 1);
  }
});
