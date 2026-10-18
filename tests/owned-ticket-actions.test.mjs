import assert from "node:assert/strict";
import { test, after } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as helpers from "../lib/owned-ticket-export.ts";

// Exercise component click handlers without claiming a rendered-browser review.
const compiled = ts.transpileModule(readFileSync(new URL("../components/owned-ticket-actions.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
const id = "9d560641-aacf-4d25-8d65-94960bba59b2";
const qr = "data:image/png;base64,YWJj";
const original = {
  fetch: globalThis.fetch, document: globalThis.document, window: globalThis.window,
  navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
};
let states, refs, index, downloads, latest, images, decodes, shareCalls, qrImage, shareTimeout, card, designCard, frames;
const react = {
  useState(value) {
    const position = index++;
    if (!(position in states)) states[position] = value;
    return [states[position], next => { states[position] = next; }];
  },
  useRef(value) {
    const position = index++;
    return refs[position] ?? (refs[position] = { current: value });
  },
};
function captureImage(format, node) {
  if (node === designCard) assert.equal(decodes, 0, "Design never loads a private QR");
  else { assert.equal(decodes, 1); assert.equal(qrImage.src, qr); }
  images.push(format);
  return `data:image/${format === "png" ? "png" : "jpeg"};base64,YWJj`;
}
const moduleObject = { exports: {} };
new Function("require", "module", "exports", compiled)(specifier => {
  if (specifier === "react") return react;
  if (specifier === "react/jsx-runtime") return jsx;
  if (specifier === "html-to-image") return {
    toPng: async node => captureImage("png", node), toJpeg: async node => captureImage("jpg", node),
  };
  if (specifier.includes("owned-ticket-export")) return helpers;
  if (specifier === "@/lib/ticket-image-frame") return { frameTicketImage: async (dataUrl, format) => {
    frames.push(format); return dataUrl;
  } };
  if (specifier === "@/components/ui/button") return { Button: () => null };
  if (specifier === "lucide-react") return { Download: "svg", Share2: "svg", LoaderCircle: "svg" };
  throw new Error(`Unexpected component dependency: ${specifier}`);
}, moduleObject, moduleObject.exports);

function buttons(props = {}) {
  index = 0;
  return moduleObject.exports.OwnedTicketActions({ ticketId: id, technical: true, ...props }).props.children;
}
function reset() {
  states = []; refs = []; downloads = []; images = []; frames = []; decodes = 0; shareCalls = 0;
  latest = { ok: true, ticket: { id, status: "valid", qrDataUrl: qr } };
  qrImage = { src: "old-image", decode: async () => { decodes++; } };
  card = { getAttribute: name => name === "data-ticket-id" ? id : null, querySelector: () => qrImage };
  designCard = { getAttribute: name => name === "data-ticket-id" ? id : null, querySelector: () => null };
  globalThis.document = {
    getElementById: name => name === "owned-ticket-design" ? designCard : card,
    fonts: { ready: Promise.resolve() },
    createElement: () => ({ click() { downloads.push(this.download); } }),
  };
  shareTimeout = null;
  globalThis.window = {
    setTimeout: (callback, delay) => { if (delay === 15000) { shareTimeout = callback; return 1; } callback(); return 2; },
    clearTimeout: () => { shareTimeout = null; },
  };
  globalThis.fetch = async url => String(url).startsWith("/api/tickets/")
    ? { ok: true, json: async () => latest } : original.fetch(url);
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
}
after(() => {
  globalThis.fetch = original.fetch;
  if (original.document === undefined) delete globalThis.document;
  else globalThis.document = original.document;
  if (original.window === undefined) delete globalThis.window;
  else globalThis.window = original.window;
  if (original.navigator) Object.defineProperty(globalThis, "navigator", original.navigator);
  else delete globalThis.navigator;
});
async function settle() {
  for (let attempt = 0; attempt < 50; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 2));
    if (!states[0]) return;
  }
  throw new Error("Export did not settle");
}
async function click(position) {
  buttons()[position].props.onClick();
  await settle();
}

test("PNG and JPG use the fresh QR, await decode and download the selected format", async () => {
  for (const [position, extension] of [[0, "png"], [1, "jpg"]]) {
    reset();
    await click(position);
    assert.deepEqual(images, [extension]);
    assert.deepEqual(frames, [extension]);
    assert.deepEqual(downloads, [`diwo-entrada-9d560641.${extension}`]);
  }
});
test("design buttons download/share the QR-free mock with distinct filename and never call the ticket API", async () => {
  for (const share of [false, true]) {
    reset();
    let apiCalls = 0;
    globalThis.fetch = async url => {
      if (String(url).startsWith("/api/")) { apiCalls++; throw new Error("Design must never request a real ticket"); }
      return original.fetch(url);
    };
    if (share) {
      navigator.canShare = () => true;
      navigator.share = async data => {
        shareCalls++;
        assert.equal(data.files[0].name, "diwo-diseno-9d560641.png");
        assert.equal(data.title, "Diseño de entrada DIWO");
        assert.match(data.text, /sin QR/i);
      };
    }
    const actions = buttons({ designPreview: true, cardLayout: true });
    assert.equal(actions[0].props.disabled, false); assert.equal(actions[1].props.disabled, false);
    actions[share ? 0 : 1].props.onClick(); await settle();
    assert.deepEqual(images, ["png"]); assert.deepEqual(frames, ["png"]); assert.equal(apiCalls, 0); assert.equal(decodes, 0);
    assert.deepEqual(downloads, share ? [] : ["diwo-diseno-9d560641.png"]);
    assert.equal(shareCalls, share ? 1 : 0);
  }
});
test("design export refuses a private QR instead of bypassing the real ticket freshness check", async () => {
  reset();
  designCard.querySelector = () => qrImage;
  buttons({ designPreview: true, cardLayout: true })[1].props.onClick(); await settle();
  assert.deepEqual(images, []); assert.deepEqual(downloads, []); assert.equal(shareCalls, 0);
  assert.match(states[1], /No hemos podido preparar/);
});
test("new ticket layout has exactly share and lossless PNG download, preserving real export behavior", async () => {
  reset();
  const layout = buttons({ cardLayout: true });
  assert.equal(layout[0].props["aria-label"], "Compartir entrada");
  assert.equal(layout[1].props["aria-label"], "Descargar entrada PNG");
  assert.equal(layout[2], null);
  layout[1].props.onClick(); await settle();
  assert.deepEqual(images, ["png"]); assert.deepEqual(downloads, ["diwo-entrada-9d560641.png"]);
});
test("switching the visible ticket before or during preparation never exports another attendee with the old QR", async () => {
  reset();
  card.getAttribute = () => "other-ticket";
  buttons()[0].props.onClick(); await settle();
  assert.equal(qrImage.src, "old-image"); assert.deepEqual(images, []);
  reset();
  let ready;
  document.fonts.ready = new Promise(resolve => { ready = resolve; });
  buttons()[0].props.onClick();
  for (let attempt = 0; attempt < 50 && !decodes; attempt++) await new Promise(resolve => setTimeout(resolve, 2));
  assert.equal(decodes, 1);
  card = { getAttribute: () => "other-ticket", querySelector: () => qrImage };
  ready(); await settle();
  assert.deepEqual(images, []); assert.deepEqual(downloads, []); assert.match(states[1], /ha cambiado/);
});
test("terminal and mismatched export never rasterizes or downloads", async () => {
  for (const change of [{ status: "used" }, { status: "revoked" }, { id: "other" }, { qrDataUrl: "https://third-party.example/qr" }]) {
    reset();
    Object.assign(latest.ticket, change);
    await click(0);
    assert.equal(images.length, 0);
    assert.equal(downloads.length, 0);
    assert.match(states[1], /ya no/);
  }
});
test("unsupported native sharing downloads PNG for manual sharing", async () => {
  reset();
  await click(2);
  assert.equal(downloads.length, 1);
  assert.match(states[1], /manualmente/);
});
test("one click prepares the fresh image and opens native sharing with quiet cancellation", async () => {
  reset();
  navigator.canShare = () => true;
  navigator.share = () => {
    shareCalls++;
    return Promise.reject(new DOMException("Cancelled", "AbortError"));
  };
  await click(2);
  assert.equal(shareCalls, 1);
  assert.equal(downloads.length, 0);
  assert.equal(buttons()[2].props["aria-label"], "Compartir entrada");
  assert.equal(buttons()[3], null, "no preparation prompt or fourth action is added");
  assert.equal(states[1], null);
  assert.equal(states[2], null);
  assert.equal(downloads.length, 0);
});
async function waitForNativeShare() {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (shareCalls === 1) return;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  throw new Error("First click did not open native sharing");
}
test("pending native sharing times out and restores controls without automatic download", async () => {
  reset();
  navigator.canShare = () => true;
  navigator.share = () => { shareCalls++; return new Promise(() => {}); };
  buttons()[2].props.onClick();
  await waitForNativeShare();
  assert.equal(shareCalls, 1);
  assert.equal(buttons()[0].props.children, "Descargar entrada PNG");
  assert.equal(buttons()[1].props.children, "Descargar entrada JPG");
  assert.equal(buttons()[2].props["aria-busy"], true);
  shareTimeout();
  await settle();
  assert.equal(buttons()[0].props.disabled, false);
  assert.equal(buttons()[2].props["aria-busy"], false);
  assert.match(states[1], /demasiado.*descargar/i);
  assert.equal(downloads.length, 0);
});
test("late native completion after timeout cannot change a newer download", async () => {
  for (const outcome of ["resolve", "reject"]) {
    reset();
    let resolveShare, rejectShare, resolveRead;
    const pendingShare = new Promise((resolve, reject) => { resolveShare = resolve; rejectShare = reject; });
    navigator.canShare = () => true;
    navigator.share = () => { shareCalls++; return pendingShare; };
    buttons()[2].props.onClick();
    await waitForNativeShare();
    shareTimeout();
    await settle();
    assert.equal(shareTimeout, null);
    decodes = 0;
    globalThis.fetch = url => String(url).startsWith("/api/tickets/")
      ? new Promise(resolve => { resolveRead = resolve; }) : original.fetch(url);
    buttons()[0].props.onClick();
    if (outcome === "resolve") resolveShare();
    else rejectShare(new DOMException("Late native rejection", "NotAllowedError"));
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(buttons()[0].props.disabled, true);
    assert.equal(states[1], null);
    assert.equal(downloads.length, 0);
    resolveRead({ ok: true, json: async () => latest });
    await settle();
    assert.deepEqual(downloads, ["diwo-entrada-9d560641.png"]);
  }
});
test("a browser activation refusal falls back to download without a second preparation click", async () => {
  reset();
  navigator.canShare = () => true;
  navigator.share = () => { shareCalls++; return Promise.reject(new DOMException("Activation expired", "NotAllowedError")); };
  await click(2);
  assert.equal(shareCalls, 1);
  assert.deepEqual(downloads, ["diwo-entrada-9d560641.png"]);
  assert.match(states[1], /descargado.*manualmente/);
  assert.equal(buttons()[2].props.disabled, false);
});
test("first click waits for the fresh read, image decode and fonts before sharing", async () => {
  reset();
  let read, decode, fonts;
  const calls = [];
  document.fonts.ready = new Promise(resolve => { fonts = resolve; });
  qrImage.decode = () => new Promise(resolve => { decode = () => { decodes++; resolve(); }; });
  globalThis.fetch = (url, options) => String(url).startsWith("/api/tickets/")
    ? (calls.push([url, options]), new Promise(resolve => { read = resolve; })) : original.fetch(url);
  navigator.canShare = () => true;
  navigator.share = async data => {
    shareCalls++;
    assert.equal(data.files[0].type, "image/png");
    assert.equal(await data.files[0].text(), "abc");
  };
  const handler = buttons()[2].props.onClick;
  handler(); handler();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].cache, "no-store");
  assert.equal(calls[0][1].credentials, "same-origin");
  read({ ok: true, json: async () => latest });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(shareCalls, 0);
  decode();
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(images.length, 0);
  fonts();
  await settle();
  assert.equal(shareCalls, 1);
  assert.deepEqual(images, ["png"]);
  assert.deepEqual(downloads, []);
  assert.equal(shareTimeout, null);
});
