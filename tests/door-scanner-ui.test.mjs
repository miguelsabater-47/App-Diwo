import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as model from "../lib/door-scan-model.ts";
import * as feedback from "../lib/door-scan-feedback.ts";
import { createDoorScanDevelopmentState } from "../lib/door-scan-development-model.ts";
import { withRequestDeadline } from "../lib/request-deadline.ts";

const event = { id: "00000000-0000-4000-8000-000000000001", title: "Synthetic event", used: 1, pending: 2, total: 3 };
const receipt = { outcome: "admitted", ticketId: "00000000-0000-4000-8000-000000000002", name: "Synthetic Person", usedAt: "2026-10-18T10:00:00Z" };
const tick = () => new Promise(resolve => setImmediate(resolve));
const nodes = node => !node || typeof node !== "object" ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
const text = node => node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(text).join(" ") : typeof node === "object" ? text(node.props?.children) : String(node);
function harness(options = {}) {
  const slots = [], effects = [], cameras = [], writes = [], polls = [], reads = [];
  const state = { read: "ready", wait: false, resolve: null, development: null, nodeEnv: "test", event, receipt, ...options };
  const doc = { hidden: false, addEventListener(name, fn) { this[name] = fn; }, removeEventListener(name) { delete this[name]; } };
  let index = 0;
  const deps = {
    "react/jsx-runtime": jsx,
    react: {
      useState(initial) { const slot = index++; if (!(slot in slots)) slots[slot] = initial; return [slots[slot], value => { slots[slot] = typeof value === "function" ? value(slots[slot]) : value; }]; },
      useRef(initial) { const slot = index++; return slots[slot] ?? (slots[slot] = { current: initial }); },
      useEffect(fn, values) { const slot = index++; if (!slots[slot] || values.some((value, i) => !Object.is(value, slots[slot].values[i]))) { const previous = slots[slot]; slots[slot] = { values }; effects.push(() => { previous?.cleanup?.(); slots[slot].cleanup = fn(); }); } },
    },
    "@/components/ui/button": { Button: "button" }, "lucide-react": { ScanLine: "svg", Check: "svg", X: "svg", CircleAlert: "svg" },
    "@/lib/door-scan-model": model, "@/lib/door-scan-feedback": feedback,
    "@/lib/request-deadline": { withRequestDeadline },
    "@/lib/qr-frame-reader": { createQrFrameReader: () => state.reader ?? Promise.resolve({ dispose() {} }) },
    "@/lib/door-camera-session": { createDoorCameraSession(config) { cameras.push(config); return { start: async () => config.ready(), stop() {} }; } },
  };
  const fetch = async (url, init) => {
    assert.equal(url, "/api/door-scan");
    if (init.method === "POST") {
      writes.push(JSON.parse(init.body));
      if (state.wait) return new Promise(resolve => { state.resolve = resolve; });
      if (state.postError) throw new Error("network");
      return Response.json({ result: state.receipt });
    }
    reads.push(url);
    if (state.read === "network") throw new Error("network");
    if (state.read === "denied") return Response.json({ error: "operation_not_authorized" }, { status: 403 });
    return Response.json({ event: state.read === "empty" ? null : state.event });
  };
  const code = ts.transpileModule(readFileSync(new URL("../components/door-scanner.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", "document", "navigator", "fetch", "setTimeout", "clearTimeout", "process", code)(name => {
    assert.ok(name in deps, `Unexpected ${name}`); return deps[name];
  }, mod, mod.exports, doc, { mediaDevices: {} }, fetch, callback => { polls.push(callback); return polls.length; }, () => {}, { env: { NODE_ENV: state.nodeEnv } });
  const render = () => {
    index = 0; const tree = mod.exports.DoorScanner({ development: state.development });
    for (const node of nodes(tree)) if (node.props?.ref && typeof node.props.ref === "object") node.props.ref.current = node.type === "video" ? {} : { focus() {} };
    while (effects.length) effects.shift()(); return tree;
  };
  const button = label => { const found = nodes(render()).find(node => node.type === "button" && text(node) === label); assert.ok(found, `Missing ${label}`); return found; };
  return { state, writes, reads, cameras, doc, render, button,
    ready: async () => { render(); await tick(); render(); },
    poll: async () => { const callback = polls.shift(); assert.ok(callback); await callback(); render(); },
    cleanup: () => { for (const slot of slots) slot?.cleanup?.(); },
  };
}

test("missing event, network and denied permissions never enable a camera or attempt an admission", async () => {
  for (const read of ["empty", "network", "denied"]) {
    const h = harness({ read }); await h.ready();
    const label = "Abrir escáner";
    assert.equal(h.button(label).props.disabled, true);
    await h.button(label).props.onClick();
    assert.equal(h.cameras.length, 0); assert.equal(h.writes.length, 0);
    assert.equal(text(h.render()).includes("Entrada validada"), false);
    h.cleanup();
  }
});

test("older mobile AbortSignal APIs cannot prevent event verification and opening the camera", async () => {
  const any = Object.getOwnPropertyDescriptor(AbortSignal, "any"), timeout = Object.getOwnPropertyDescriptor(AbortSignal, "timeout");
  Object.defineProperty(AbortSignal, "any", { configurable: true, value: undefined });
  Object.defineProperty(AbortSignal, "timeout", { configurable: true, value: undefined });
  const h = harness();
  try {
    await h.ready();
    assert.equal(h.reads.length, 1);
    assert.equal(h.button("Abrir escáner").props.disabled, false);
    await h.button("Abrir escáner").props.onClick();
    assert.equal(h.cameras.length, 1);
    assert.deepEqual(h.writes, []);
  } finally { h.cleanup(); Object.defineProperty(AbortSignal, "any", any); Object.defineProperty(AbortSignal, "timeout", timeout); }
});

test("opening camera starts in the click handler without waiting for asynchronous decoder preparation", async () => {
  let finish;
  const h = harness({ reader: new Promise(resolve => { finish = resolve; }) }); await h.ready();
  const opening = h.button("Abrir escáner").props.onClick();
  const openedSynchronously = h.cameras.length;
  finish({ dispose() {} }); await opening;
  assert.equal(openedSynchronously, 1, "Keep media permission request inside the user gesture");
  assert.deepEqual(h.writes, []); h.cleanup();
});

test("camera errors distinguish permission, busy camera and missing device without admitting anyone", async () => {
  for (const [name, message] of [["NotAllowedError", /permiso/i], ["NotReadableError", /otra aplicación/i], ["NotFoundError", /encontrado.*cámara/i]]) {
    const h = harness(); await h.ready(); await h.button("Abrir escáner").props.onClick();
    h.cameras[0].failure(new DOMException("PRIVATE DEVICE DETAILS", name));
    assert.match(text(h.render()), message);
    assert.doesNotMatch(text(h.render()), /PRIVATE DEVICE DETAILS/);
    assert.deepEqual(h.writes, []); h.cleanup();
  }
});

function snapshot(node) {
  if (node == null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(snapshot);
  return { type: node.type, props: Object.fromEntries(Object.entries(node.props).filter(([key, value]) => key !== "ref" && typeof value !== "function").map(([key, value]) => [key, key === "children" ? snapshot(value) : value])) };
}

test("development injects the exact live UI for every response, with zero backend calls and no visible test controls", async () => {
  for (const outcome of ["admitted", "already_used", "revoked", "unknown", "connection_error"]) {
    const development = createDoorScanDevelopmentState({ enabled: true, outcome }, { nodeEnv: "development", host: "localhost:3000", developmentKeys: true, localOrigin: true, role: "admin" });
    const mocked = harness({ development, nodeEnv: "development" }); await mocked.ready();
    const live = harness({ event: development.event, receipt: development.result, postError: development.connectionError });
    await live.ready(); await live.button("Abrir escáner").props.onClick();
    live.cameras[0].codes([{ rawValue: "a".repeat(64) }]); await tick();
    assert.deepEqual(snapshot(mocked.render()), snapshot(live.render()), `Different live/mocked UI for ${outcome}`);
    assert.equal(mocked.reads.length, 0); assert.equal(mocked.writes.length, 0);
    assert.equal(nodes(mocked.render()).some(node => node.type === "select"), false);
    assert.doesNotMatch(text(mocked.render()), /ejemplo|fictici|prototipo|revisión visual|vista local|ensayo/i);
    await mocked.button("Abrir escáner").props.onClick();
    mocked.cameras[0].codes([{ rawValue: "a".repeat(64) }]); await tick(); await mocked.poll();
    assert.equal(mocked.reads.length, 0); assert.equal(mocked.writes.length, 0);
    assert.equal(live.writes.length, 1);
    mocked.cleanup(); live.cleanup();
  }
});

test("disabled mocks restore the real transport; production ignores injected development data even if supplied", async () => {
  const context = { nodeEnv: "development", host: "localhost:3000", developmentKeys: true, localOrigin: true, role: "admin" };
  const enabled = createDoorScanDevelopmentState({ enabled: true, outcome: "admitted" }, context);
  const disabled = createDoorScanDevelopmentState({ enabled: false, outcome: "admitted" }, context);
  assert.equal(disabled, null);
  for (const options of [{ development: disabled, nodeEnv: "development" }, { development: enabled, nodeEnv: "production" }]) {
    const h = harness(options); await h.ready();
    assert.equal(h.reads.length, 1); assert.equal(text(h.render()).includes("Entrada validada"), false);
    await h.button("Abrir escáner").props.onClick(); h.cameras[0].codes([{ rawValue: "a".repeat(64) }]); await tick();
    assert.equal(h.writes.length, 1); assert.deepEqual(h.writes[0], { eventId: event.id, token: "a".repeat(64) });
    h.cleanup();
  }
});

test("polling restores only readiness, not a camera/write; counters have no misleading capacity progress", async () => {
  const h = harness({ read: "network" }); await h.ready();
  h.state.read = "ready"; await h.poll();
  assert.equal(h.button("Abrir escáner").props.disabled, false);
  assert.equal(h.cameras.length, 0); assert.equal(h.writes.length, 0);
  assert.doesNotMatch(text(h.render()), /Válidas =|actualizados cada|Muestra una sola entrada\.|Pulsa Abrir escáner/);
  const counters=nodes(h.render()).find(node=>node.props?.className==="diwo-door-counters");
  assert.deepEqual(nodes(counters).filter(node=>node.type==="dd").map(text),["1","2","3"]);
  assert.equal(nodes(h.render()).some(node => node.type === "progress"), false);
  await h.button("Abrir escáner").props.onClick();
  h.doc.hidden = true; h.doc.visibilitychange();
  h.cameras[0].codes([{ rawValue: "a".repeat(64) }]); await tick();
  assert.equal(h.writes.length, 0); h.cleanup();
});

test("access result precedes camera and restarting requires a new explicit click", async () => {
  const h = harness(); await h.ready(); await h.button("Abrir escáner").props.onClick();
  h.cameras[0].codes([{ rawValue: "a".repeat(64) }]); await tick();
  const all = nodes(h.render());
  const resultIndex = all.findIndex(node => node.props?.className?.startsWith("diwo-door-result "));
  assert.ok(resultIndex > 0); assert.ok(resultIndex < all.findIndex(node => node.type === "video"));
  assert.match(text(all[resultIndex]), /Entrada validada/);
  assert.equal(h.writes.length, 1); assert.equal(h.cameras.length, 1);
  await h.poll(); assert.equal(h.writes.length, 1); assert.equal(h.cameras.length, 1);
  assert.equal(h.button("Abrir escáner").props.disabled, false);
  assert.equal(nodes(h.render()).find(node => node.props?.className === "diwo-door-camera").props.hidden, true);
  await h.button("Abrir escáner").props.onClick();
  assert.equal(h.cameras.length, 2);
  assert.equal(h.writes.length, 1, "Opening the actual scanner does not register an admission");
  assert.equal(text(h.render()).includes("Entrada validada"), false);
  assert.equal(nodes(h.render()).find(node => node.props?.className === "diwo-door-camera is-running").props.hidden, false);
  h.button("Detener cámara").props.onClick();
  h.cleanup();
});

test("losing permission during an admission preserves checking lock and never presents an obsolete success or repeats the write", async () => {
  const h = harness({ wait: true }); await h.ready();
  const start = h.button("Abrir escáner").props.onClick;
  await start(); h.cameras[0].codes([{ rawValue: "a".repeat(64) }]); await tick();
  h.state.read = "denied"; await h.poll();
  assert.equal(h.button("Comprobando acceso…").props.disabled, true);
  await start(); assert.equal(h.writes.length, 1);
  h.state.resolve(Response.json({ result: receipt })); await tick();
  assert.equal(text(h.render()).includes("Entrada validada"), false);
  assert.match(text(h.render()), /No se ha podido comprobar/);
  assert.equal(h.button("Abrir escáner").props.disabled, true);
  assert.equal(h.writes.length, 1); h.cleanup();
});
