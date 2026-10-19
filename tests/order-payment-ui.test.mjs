import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const originalFetch = globalThis.fetch;
after(() => {
  if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
  else delete globalThis.navigator;
  globalThis.fetch = originalFetch;
});
function load(path, dependencies) {
  const compiled = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    if (name === "react/jsx-runtime") return jsx;
    assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name];
  }, mod, mod.exports);
  return mod.exports;
}
function nodes(node) {
  if (!node || typeof node !== "object") return [];
  if (typeof node.type === "function") return nodes(node.type(node.props));
  return [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
}
function text(node) {
  if (node == null || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map(text).join(" ");
  return typeof node === "object" ? (typeof node.type === "function" ? text(node.type(node.props)) : text(node.props?.children)) : String(node);
}
const { OrderSummary } = load("../components/order-summary.tsx", {});
function harness(overrides = {}) {
  const state = [];
  const effects = [];
  let index = 0;
  const copied = [];
  const toasts = [];
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: {
    writeText: async value => { copied.push(value); },
  } } });
  globalThis.fetch = () => { throw new Error("Payment instructions must never send writes"); };
  const Component = load("../components/order-payment-details.tsx", {
    sonner: { toast: Object.fromEntries(["success", "error"].map(type => [type, (message, options) => toasts.push({ type, message, options })])) },
    "@/components/buyer-flow-link": { BuyerFlowLink: "a" },
    react: {
      useState: initial => { const slot = index++; if (!(slot in state)) state[slot] = initial; return [state[slot], value => { state[slot] = value; }]; },
      useRef: initial => { const slot = index++; return state[slot] ?? (state[slot] = { current: initial }); },
      useEffect: callback => effects.push(callback),
    },
    "next/link": { default: "a" }, "@/components/ui/button": { Button: "button" }, "@/components/order-summary": { OrderSummary },
    "lucide-react": Object.fromEntries(["ArrowLeft", "ArrowRight", "CircleCheck", "Copy", "Smartphone", "ClipboardList"].map(name => [name, "svg"])),
  }).OrderPaymentDetails;
  const props = { preview: false, requestCreated: true, reference: "DIWO-ABCDEF123456", quantity: 2,
    totalCents: 1000, phone: "600000000", ...overrides };
  const render = () => { index = 0; effects.length = 0; return Component(props); };
  const find = predicate => { const found = nodes(render()).find(predicate); assert.ok(found); return found; };
  return { copied, toasts, render, find, props, effects: () => effects.forEach(callback => callback()) };
}

test("confirmation is informational, announces success and never takes focus or behaves like a button", () => {
  for (const props of [{}, { preview: true }, { requestCreated: false }]) {
    const h = harness(props);
    const view = h.render();
    const success = nodes(view).find(node => node.props?.className === "diwo-payment-success");
    const calls = [];
    if (success?.props.ref) success.props.ref.current = { focus: options => calls.push(options) };
    h.effects();
    assert.deepEqual(calls, []);
    if (success) {
      assert.equal(success.props.role, props.preview ? undefined : "status");
      assert.equal(success.props.tabIndex, undefined);
      assert.equal(success.props.onClick, undefined);
      assert.equal(success.type, "div");
    }
  }
  const css = readFileSync(new URL("../components/ticket-request.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /\.diwo-payment-success:focus/);
});

test("real payment screen has success after submission, shared no-action total, numbered steps and navigation; no reporting button", async () => {
  const h = harness();
  const view = h.render(), content = text(view);
  assert.match(content, /Solicitud registrada/);
  assert.equal(nodes(view)[1].props.className, "diwo-payment-success");
  assert.equal(nodes(view)[1].type, "div");
  const heading = h.find(node => node.props?.className === "diwo-payment-title");
  assert.equal(nodes(heading).some(node => node.type === "br"), false);
  for (const expected of ["Realiza el pago", "por Bizum",
    "Concepto del Bizum", "En el concepto del Bizum pega este código.", "Espera la aprobación"]) assert.ok(content.includes(expected), expected);
  for (const absent of ["PASO 2 DE 3", "Indica tu nombre", "HE REALIZADO EL PAGO", "Ya he realizado el Bizum", "REALIZAR SOLICITUD"]) assert.equal(content.includes(absent), false);
  const summary = h.find(node => node.type === "aside");
  assert.match(text(summary), /10,00/); assert.match(text(summary), /2\s+entradas/);
  assert.equal(nodes(summary).some(node => node.type === "button"), false);
  assert.equal(h.find(node => node.props?.className === "diwo-payment-steps").props.children.length, 3);
  assert.equal(h.find(node => node.type === "a").props.href, "/ticket");
  await h.find(node => node.props?.["aria-label"] === "Copiar número de Bizum").props.onClick();
  // onClick intentionally discards the promise; clipboard write runs before resolution.
  assert.deepEqual(h.copied, ["600000000"]);
  await h.find(node => node.props?.["aria-label"] === "Copiar concepto del Bizum").props.onClick();
  assert.deepEqual(h.copied, ["600000000", "DIWO-ABCDEF123456"]);
  await Promise.resolve();
  assert.deepEqual(h.toasts.map(({ type, message }) => [type, message]), [["success", "Número copiado"], ["success", "Concepto copiado"]]);
  assert.ok(h.toasts.every(({ options }) => options.id === "diwo-payment-copy" && options.position === "top-center" && options.duration > 0));
  assert.doesNotMatch(text(h.render()), /copiado/);
  assert.equal(nodes(h.render()).some(node => node.props?.className === "diwo-payment-feedback"), false);
});

test("prototype shows requested success design without a live status announcement, order writes or preview/back/attendee controls", async () => {
  const h = harness({ preview: true });
  for (const removed of ["Vista previa", "Código de ejemplo", "Volver a los nombres", "Conseguir entradas", "asistentes"]) {
    assert.equal(text(h.render()).includes(removed), false, removed);
  }
  assert.match(text(h.render()), /Solicitud registrada/);
  assert.equal(h.find(node => node.props?.className === "diwo-payment-success").props.role, undefined);
  await h.find(node => node.props?.["aria-label"] === "Copiar concepto del Bizum").props.onClick();
  assert.deepEqual(h.copied, ["DIWO-A7K9"]);
  assert.equal(nodes(h.render()).some(node => node.type === "details"), false);
  assert.equal(h.find(node => node.type === "a").props.href, "/ticket");
  assert.equal(h.find(node => node.props?.className === "diwo-payment-title").type, "h1");
});

test("missing/invalid recipient is not fabricated and denied clipboard has a manual-copy fallback", async () => {
  const missing = harness({ phone: null });
  assert.equal(nodes(missing.render()).some(node => node.props?.["aria-label"] === "Copiar número de Bizum"), false);
  assert.match(text(missing.render()), /No realices el pago/);
  const h = harness();
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async () => { throw new Error("denied"); } } } });
  await h.find(node => node.props?.["aria-label"] === "Copiar concepto del Bizum").props.onClick();
  await Promise.resolve();
  assert.equal(h.toasts.length, 1);
  assert.equal(h.toasts[0].type, "error");
  assert.match(h.toasts[0].message, /selecciona el texto/);
  assert.doesNotMatch(text(h.render()), /No hemos podido copiar/);
  assert.match(text(h.render()), /DIWO-ABCDEF123456/);
});

test("clipboard success is announced only after the browser confirms the write", async () => {
  const h = harness();
  let resolve;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: () => new Promise(done => { resolve = done; }) } } });
  h.find(node => node.props?.["aria-label"] === "Copiar número de Bizum").props.onClick();
  assert.deepEqual(h.toasts, []);
  resolve(); await Promise.resolve();
  assert.equal(h.toasts[0].message, "Número copiado");
});
