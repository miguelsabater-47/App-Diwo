import assert from "node:assert/strict";
import { test } from "node:test";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { readQrImage, qrImageErrorMessage } from "../lib/qr-image-reader.ts";

const file = (type="image/png",size=1) => new Blob([new Uint8Array(size)],{ type });
function image(text) {
  const qr=QRCode.create(text),size=(qr.modules.size+8)*6,data=new Uint8ClampedArray(size*size*4);
  for (let y=0;y<size;y++) for (let x=0;x<size;x++) {
    const row=Math.floor(y/6)-4,col=Math.floor(x/6)-4;
    const dark=row>=0 && col>=0 && row<qr.modules.size && col<qr.modules.size && qr.modules.get(row,col);
    data.set([dark?0:255,dark?0:255,dark?0:255,255],(y*size+x)*4);
  }
  return { data,width:size,height:size };
}
function fixture(pixels=image("DIWO-REHEARSAL-v1:synthetic:valid")) {
  const state={ closed:0,opened:0,drawn:0,decoded:0 };
  const bitmap={ width:pixels.width,height:pixels.height,close:() => state.closed++ };
  const context={ fillRect() {},drawImage() { state.drawn++; },getImageData:() => pixels };
  const canvas={ width:0,height:0,getContext:() => context };
  const deps={ bitmap:async () => { state.opened++; return bitmap; },canvas:() => canvas,decoder:async () => { state.decoded++; return jsQR; } };
  return { state,bitmap,canvas,context,deps,pixels };
}
test("image pixel decoder reads synthetic QR and releases bitmap, canvas and pixel copies", async () => {
  const token="DIWO-REHEARSAL-v1:synthetic:valid",f=fixture(image(token));
  assert.equal(await readQrImage(file(),() => true,f.deps),token);
  assert.equal(f.state.closed,1); assert.equal(f.canvas.width,0); assert.equal(f.canvas.height,0);
  assert.ok(f.pixels.data.every(n => n===0));
});
test("file allowlist and size bounds reject before any image decoder work", async () => {
  const f=fixture();
  for (const type of ["image/svg+xml","image/gif","text/html","", "application/octet-stream"]) await assert.rejects(readQrImage(file(type),() => true,f.deps),/qr_image_type/);
  for (const size of [0,5*1024*1024+1]) await assert.rejects(readQrImage(file("image/png",size),() => true,f.deps),/qr_image_size/);
  assert.equal(f.state.opened,0);
});
test("oversized dimensions and malformed decoding release acquired image resources", async () => {
  const f=fixture(); f.bitmap.width=8193;
  await assert.rejects(readQrImage(file(),() => true,f.deps),/qr_image_dimensions/);
  assert.equal(f.state.closed,1); assert.equal(f.state.drawn,0);
  const context=fixture(); context.canvas.getContext=() => null;
  await assert.rejects(readQrImage(file(),() => true,context.deps),/qr_image_context/);
  assert.equal(context.state.closed,1); assert.equal(context.canvas.width,0);
  const decode=fixture(); decode.deps.decoder=async () => { throw Error("private detail"); };
  await assert.rejects(readQrImage(file(),() => true,decode.deps)); assert.equal(decode.state.closed,1);
  assert.equal(qrImageErrorMessage(Error("private detail")).includes("private detail"),false);
});
test("blank image yields no token, decode throws still wipes pixels, large frame is bounded", async () => {
  const blank=fixture({ data:new Uint8ClampedArray(80*80*4).fill(255),width:80,height:80 });
  assert.equal(await readQrImage(file(),() => true,blank.deps),null); assert.equal(blank.state.closed,1);
  const fail=fixture(); fail.deps.decoder=async () => () => { throw Error("decoder failed"); };
  await assert.rejects(readQrImage(file(),() => true,fail.deps)); assert.ok(fail.pixels.data.every(n => n===0)); assert.equal(fail.state.closed,1);
  const large=fixture(); large.bitmap.width=3200; large.bitmap.height=2000;
  large.deps.decoder=async () => () => { assert.equal(large.canvas.width,1600); assert.equal(large.canvas.height,1000); return null; };
  assert.equal(await readQrImage(file(),() => true,large.deps),null);
});
test("cancelled bitmap load or lazy decoder cannot return a late token or retain image resources", async () => {
  let current=true,resolve; const f=fixture();
  f.deps.bitmap=() => new Promise(yes => { resolve=yes; });
  const pending=readQrImage(file(),() => current,f.deps); current=false; resolve(f.bitmap);
  assert.equal(await pending,null); assert.equal(f.state.closed,1); assert.equal(f.state.drawn,0);
  const g=fixture(); current=true;
  let resolveDecoder; g.deps.decoder=() => new Promise(yes => { resolveDecoder=yes; });
  const decoding=readQrImage(file(),() => current,g.deps); await new Promise(yes => setImmediate(yes)); current=false; resolveDecoder(jsQR);
  assert.equal(await decoding,null); assert.equal(g.state.closed,1); assert.equal(g.state.drawn,0);
});
