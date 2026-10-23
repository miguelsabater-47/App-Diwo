import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import QRCode from "qrcode";
import jsQR from "jsqr";
import * as model from "../lib/extra-ticket-prototype.ts";
import { ticketId } from "../lib/owned-ticket-model.ts";
import { shareTicketImage } from "../lib/owned-ticket-export.ts";

function load(path, dependencies) {
  const compiled = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    if (name === "react/jsx-runtime") return jsx;
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, mod, mod.exports);
  return mod.exports;
}
const nodes = node => !node || typeof node !== "object" ? [] : typeof node.type === "function" ? nodes(node.type(node.props)) : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
const text = node => node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(text).join(" ") : typeof node === "object" ? text(typeof node.type === "function" ? node.type(node.props) : node.props?.children) : String(node);
const { AdminTicketListItem } = load("../components/admin-ticket-list-item.tsx", {});

function hooks() {
  const slots = [], effects = []; let index = 0;
  return { effects, reset() { index = 0; effects.length = 0; }, react: {
    useState(initial) { const slot = index++; if (!(slot in slots)) slots[slot] = typeof initial === "function" ? initial() : initial; return [slots[slot], value => { slots[slot] = typeof value === "function" ? value(slots[slot]) : value; }]; },
    useRef(initial) { const slot = index++; return slots[slot] ?? (slots[slot] = { current: initial }); },
    useEffect(callback, dependencies) {
      const slot = index++, previous = slots[slot];
      if (!previous || !dependencies || dependencies.some((value, i) => !Object.is(value, previous[i]))) effects.push(callback);
      slots[slot] = dependencies;
    },
  } };
}

function harness() {
  const h = hooks();
  const Component = load("../components/extra-ticket-prototype.tsx", {
    react: h.react,
    "next/image": { default: "img" }, "lucide-react": new Proxy({}, { get: () => "svg" }),
    "@/components/animated-attendee-row": { AnimatedAttendeeRow: "attendee-row" },
    "@/components/admin-ticket-list-item": { AdminTicketListItem },
    "@/lib/extra-ticket-prototype": model, "@/components/extra-ticket-prototype-detail": { ExtraTicketPrototypeDetail: "detail" },
  }).ExtraTicketPrototype;
  const render = () => { h.reset(); return Component(); };
  const find = predicate => { const node = nodes(render()).find(predicate); assert.ok(node, "Expected UI node"); return node; };
  const button = label => find(node => node.type === "button" && text(node).replace(/\s+/g, " ").trim() === label);
  const input = (i, value) => nodes(render()).filter(node => node.type === "input" && node.props.id?.startsWith("guest-"))[i].props.onChange({ target: { value } });
  render(); for (const effect of h.effects) effect();
  return { render, find, button, input, effects: h.effects };
}

test("prototype identities cannot enter genuine ticket routes and QR decodes only to an explicitly invalid local namespace", () => {
  const tickets = model.initialPrototypeTickets();
  for (const ticket of tickets) assert.equal(ticketId(ticket.id), false);
  const extra = tickets.find(ticket => ticket.kind === "extra");
  const payload = model.prototypeQrPayload(extra);
  assert.match(payload, /^DIWO:LOCAL:NOT-VALID-FOR-ENTRY:local-extra-/);
  assert.doesNotMatch(payload, /^[a-f0-9]{64}$/);
  const qr = QRCode.create(payload, { errorCorrectionLevel: "M" });
  const scale = 5, margin = 4, width = (qr.modules.size + margin * 2) * scale;
  const pixels = new Uint8ClampedArray(width * width * 4).fill(255);
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
    const row = Math.floor(y / scale) - margin, col = Math.floor(x / scale) - margin;
    if (row >= 0 && col >= 0 && row < qr.modules.size && col < qr.modules.size && qr.modules.get(row, col)) {
      const i = (y * width + x) * 4; pixels[i] = pixels[i + 1] = pixels[i + 2] = 0;
    }
  }
  assert.equal(jsQR(pixels, width, width)?.data, payload);
  for (const ticket of tickets.filter(ticket => ticket.status !== "valid")) assert.throws(() => model.prototypeQrPayload(ticket));
  assert.throws(() => model.prototypeQrPayload({ ...extra, id: "a".repeat(64) }));
});

test("fake card uses the existing poster/schedule projection without private tokens or QR for terminal states", () => {
  for (const ticket of model.initialPrototypeTickets()) {
    const result = model.prototypeTicketCard(ticket, "data:image/png;base64,ZmFrZQ==");
    assert.equal(result.ticket.qrDataUrl !== null, ticket.status === "valid");
    assert.equal("qrToken" in result.ticket, false);
    assert.equal(result.ticket.unitPriceCents, ticket.kind === "extra" ? 0 : 500);
    assert.equal(result.ticket.startsAt, "2026-10-31T22:30:00.000Z");
    assert.equal(result.ticket.endsAt, "2026-11-01T06:00:00.000Z");
  }
});

test("extra creation trims names and validates every attendee before adding any row", () => {
  const created = model.createPrototypeExtras(["  Person One  ", "Person Two"], 2);
  assert.deepEqual(created.map(ticket => [ticket.id, ticket.name]), [["local-extra-0002", "Person One"], ["local-extra-0003", "Person Two"]]);
  for (const names of [[], [""], [" "], ["Valid", "bad\u0000name"], ["x".repeat(121)]]) assert.throws(() => model.createPrototypeExtras(names, 2));
  for (const start of [0, 1, -1, 1.5, NaN]) assert.throws(() => model.createPrototypeExtras(["Guest"], start));
});

test("types and lifecycle filters are independent; list is production copy with no Update or rehearsal notices", () => {
  const h = harness();
  assert.match(text(h.render()), /Gestión de entradas/);
  assert.doesNotMatch(text(h.render()), /Actualizar|simula|prueba local|vista previa|sin datos reales/i);
  const types = h.find(node => node.props?.["aria-label"] === "Tipo de entrada");
  const statuses = h.find(node => node.props?.["aria-label"] === "Estado de entradas");
  assert.deepEqual(nodes(types).filter(node => node.type === "button").map(text), ["Generales 4", "Extras 1"]);
  assert.deepEqual(nodes(statuses).filter(node => node.type === "button").map(text), ["Todas 4", "Sin usar 2", "Utilizadas 1", "Anuladas 1"]);
  h.button("Sin usar 2").props.onClick();
  assert.equal(nodes(h.render()).filter(node => node.type === "article").length, 2);
  h.button("Extras 1").props.onClick();
  assert.equal(h.button("Todas 1").props["aria-pressed"], true);
  assert.equal(nodes(h.render()).filter(node => node.type === "article").length, 1);
  h.find(node => node.type === "input" && node.props.type === "search").props.onChange({ target: { value: "nonexistent" } });
  assert.match(text(h.render()), /Sin coincidencias/);
});

test("switching general/extra preserves the control structure and never refocuses the heading", () => {
  const h = harness();
  const controls = () => nodes(h.render()).filter(node => node.props?.["aria-label"] === "Tipo de entrada" ||
    node.props?.["aria-label"] === "Estado de entradas" || node.props?.className === "diwo-admin-request-search" ||
    node.props?.className === "diwo-admin-history").map(node => [node.type, node.props.className, node.props["aria-label"]]);
  const before = controls();
  assert.equal(before.length, 3);
  const list = () => h.find(node => node.props?.className === "diwo-admin-ticket-list diwo-prototype-list");
  list().props.ref.current = { getBoundingClientRect: () => ({ height: 480 }) };
  h.button("Extras 1").props.onClick();
  assert.deepEqual(controls(), before);
  assert.equal(list().props.style.minHeight, 480, "A short extras list cannot collapse the page scroll range");
  assert.equal(h.effects.length, 0, "Changing only type must not run the focus effect");
  assert.doesNotMatch(text(h.render()), /histórico técnico/i);
  h.button("Generales 4").props.onClick();
  assert.deepEqual(controls(), before);
  assert.equal(h.effects.length, 0);
});

test("creating multiple extras reviews names once, opens their card and stale confirmation cannot duplicate issuance", () => {
  const h = harness(); h.button("Crear entrada extra").props.onClick();
  h.input(0, "First Guest"); h.find(node => node.props?.["aria-label"] === "Añadir una entrada").props.onClick(); h.input(1, "Second Guest");
  h.find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  assert.match(text(h.render()), /First Guest/); assert.match(text(h.render()), /Second Guest/);
  const confirm = h.button("Crear 2 entradas").props.onClick;
  confirm(); confirm();
  const detail = h.find(node => node.type === "detail");
  assert.equal(detail.props.ticket.name, "First Guest");
  assert.equal(detail.props.ticket.id, "local-extra-0002");
  detail.props.onBack();
  assert.equal(h.button("Extras 3").props["aria-pressed"], true);
  assert.equal(nodes(h.render()).filter(node => node.type === "article").length, 3);
  h.button("Crear entrada extra").props.onClick(); h.input(0, "Third Guest");
  h.find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  confirm(); assert.ok(h.button("Crear 1 entrada"));
  h.button("Volver a editar").props.onClick(); confirm();
  assert.ok(h.find(node => node.type === "form"));
});

test("extras reuse the request quantity selector and attendee fields without buyer/payment semantics", () => {
  const h = harness(); h.button("Crear entrada extra").props.onClick();
  const add = () => h.find(node => node.type === "button" && node.props["aria-label"] === "Añadir una entrada");
  const remove = () => h.find(node => node.type === "button" && node.props["aria-label"] === "Quitar una entrada");
  const quantity = () => h.find(node => node.type === "output" && node.props["aria-label"] === "Cantidad de entradas").props.children;
  const inputs = () => nodes(h.render()).filter(node => node.type === "input" && node.props.name?.startsWith("extra-attendee-"));
  assert.equal(remove().props.disabled, true); assert.equal(quantity(), 1);
  assert.doesNotMatch(text(h.find(node => node.type === "form")), /invitaci[oó]n|sin pago|resumen|Bizum/i);
  assert.equal(nodes(h.render()).some(node => node.props?.className === "diwo-request-summary"), false);
  assert.equal(h.button("REVISAR ENTRADAS").props.className, "diwo-request-submit");
  h.input(0, "First Guest"); add().props.onClick(); h.input(1, "Removed Guest");
  assert.equal(quantity(), 2);
  assert.deepEqual(inputs().map(node => node.props.value), ["First Guest", "Removed Guest"]);
  for (const input of inputs()) {
    assert.equal(input.props.className, "diwo-request-input");
    assert.equal(input.props.required, true); assert.equal(input.props.maxLength, 120);
    assert.equal(input.props["aria-describedby"], "extra-attendees-help");
  }
  remove().props.onClick(); assert.equal(quantity(), 1);
  assert.deepEqual(inputs().map(node => node.props.value), ["First Guest"]);
  add().props.onClick(); assert.deepEqual(inputs().map(node => node.props.value), ["First Guest", ""]);
  h.input(1, "Second Guest");
  const staleAdd = add().props.onClick, staleRemove = remove().props.onClick;
  h.find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  staleAdd(); staleRemove();
  assert.match(text(h.render()), /First Guest/); assert.match(text(h.render()), /Second Guest/);
  assert.ok(h.button("Crear 2 entradas"));
  assert.doesNotMatch(text(h.render()), /comprador|Bizum|5,00/);
});

test("adding attendees grows below the selector without a new focus effect or vertical auto margins", () => {
  const h = harness(); h.button("Crear entrada extra").props.onClick();
  const heading = h.find(node => node.type === "h1");
  let focuses = 0;
  heading.props.ref.current = { focus(options) { assert.deepEqual(options, { preventScroll: true }); focuses++; } };
  for (const effect of [...h.effects]) effect();
  assert.equal(focuses, 1);
  const add = h.find(node => node.props?.["aria-label"] === "Añadir una entrada").props.onClick;
  add(); h.render();
  assert.equal(h.effects.length, 0); assert.equal(focuses, 1);
  const all = nodes(h.render());
  assert.ok(all.findIndex(node => node.props?.className === "diwo-request-quantity") < all.findIndex(node => node.props?.className === "diwo-request-attendees"));
  assert.equal(all.filter(node => node.type === "input" && node.props.name?.startsWith("extra-attendee-")).length, 2);
  const css = readFileSync(new URL("../components/extra-ticket-prototype.css", import.meta.url), "utf8");
  assert.match(css, /\.diwo-prototype-brand\s*\{[^}]*margin:\s*0 auto/);
  assert.match(css, /\.diwo-prototype\s*>\s*\.diwo-prototype-content\s*\{[^}]*margin-block:\s*0/);
  assert.match(css, /html:has\(\.diwo-prototype-extra-form\)\s*\{\s*overflow-anchor:\s*none/);
});

test("extra rows have an independent square share button that shares without opening detail; double clicks coalesce", () => {
  const h = harness();
  assert.equal(nodes(h.render()).some(node => node.props?.className === "diwo-prototype-quick-share"), false);
  h.button("Extras 1").props.onClick();
  const button = h.find(node => node.type === "button" && node.props["aria-label"]?.startsWith("Compartir entrada de "));
  const article = h.find(node => node.type === "article");
  assert.match(article.props.className, /has-secondary-action/);
  assert.equal(nodes(article.props.children[0]).some(node => node.props?.className === "diwo-prototype-quick-share"), false, "No nested buttons or accidental opening of the detail");
  const share = button.props.onClick;
  share(); share();
  const controllers = nodes(h.render()).filter(node => node.type === "detail");
  assert.equal(controllers.length, 1); assert.equal(controllers[0].props.quickShare, true);
  assert.equal(h.button("Crear entrada extra").props.disabled, true);
  assert.ok(nodes(h.render()).some(node => node.type === "article"), "The list stays on screen");
  controllers[0].props.onQuickShareDone({ message: null, download: null });
  assert.equal(nodes(h.render()).some(node => node.type === "detail"), false);
  assert.equal(h.button("Extras 1").props["aria-pressed"], true);
  h.find(node => node.type === "button" && node.props["aria-label"]?.startsWith("Ver entrada de Invitado")).props.onClick();
  h.find(node => node.type === "detail").props.onAnnul();
  h.find(node => node.type === "detail").props.onBack();
  const revoked = h.find(node => node.props?.className === "diwo-prototype-quick-share");
  assert.equal(revoked.props.disabled, true); share();
  assert.equal(nodes(h.render()).some(node => node.type === "detail"), false, "Stale callbacks cannot share an annulled row");
});

test("standalone local annulment preserves the row and used entries cannot change without any account dependency", () => {
  const h = harness();
  h.find(node => node.type === "button" && node.props["aria-label"]?.startsWith("Ver entrada de Álex Navarro,")).props.onClick();
  h.find(node => node.type === "detail").props.onAnnul();
  assert.equal(h.find(node => node.type === "detail").props.ticket.status, "revoked");
  h.find(node => node.type === "detail").props.onBack();
  assert.ok(h.button("Anuladas 2"));
  h.find(node => node.type === "button" && node.props["aria-label"]?.startsWith("Ver entrada de Dani Ríos,")).props.onClick();
  h.find(node => node.type === "detail").props.onAnnul();
  assert.equal(h.find(node => node.type === "detail").props.ticket.status, "used");
  assert.doesNotMatch(readFileSync(new URL("../components/extra-ticket-prototype.tsx", import.meta.url), "utf8"), /useAuth|@clerk|userId|sign-in/);
});

test("detail renders actual QR pixels through the existing card, offers export, and confirms local annulment", async () => {
  const h = hooks(), ticket = model.initialPrototypeTickets().find(ticket => ticket.kind === "extra");
  const calls = [];
  const Detail = load("../components/extra-ticket-prototype-detail.tsx", {
    react: h.react, qrcode: { default: { toDataURL: async (payload, options) => { calls.push([payload, options]); return "data:image/png;base64,ZmFrZQ=="; } } },
    "lucide-react": new Proxy({}, { get: () => "svg" }), "@/components/owned-ticket-card": { OwnedTicketCard: "card" },
    "@/lib/extra-ticket-prototype": model, "@/lib/ticket-image-layers": {}, "@/lib/ticket-image-frame": {}, "@/lib/owned-ticket-export": {},
  }).ExtraTicketPrototypeDetail;
  let annulled = 0;
  const render = () => { h.reset(); return Detail({ ticket, onBack() {}, onAnnul() { annulled++; } }); };
  render(); for (const effect of h.effects) effect(); await Promise.resolve();
  assert.equal(calls.length, 1); assert.match(calls[0][0], /NOT-VALID-FOR-ENTRY/);
  assert.equal(nodes(render()).find(node => node.type === "card").props.result.ticket.qrDataUrl, "data:image/png;base64,ZmFrZQ==");
  assert.equal(nodes(render()).find(node => node.type === "card").props.displayNumber, "EX0001");
  const button = label => nodes(render()).find(node => node.type === "button" && text(node).trim() === label);
  assert.equal(button("DESCARGAR").props.disabled, false);
  button("Anular entrada").props.onClick(); assert.equal(annulled, 0);
  button("Confirmar anulación").props.onClick(); assert.equal(annulled, 1);
  for (const file of ["../components/extra-ticket-prototype.tsx", "../components/extra-ticket-prototype-detail.tsx", "../lib/extra-ticket-prototype.ts"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /fetch\(|supabase|\.rpc\(|localStorage|sessionStorage|OwnedTicketActions|TicketGallery/);
  }
});

test("local detail exports PNG/JPG and shares with download fallback, without a ticket API or duplicate exports", async () => {
  const h = hooks(), ticket = model.initialPrototypeTickets().find(ticket => ticket.kind === "extra");
  const downloads = [], renders = [], cleanups = [];
  const card = { getAttribute: () => ticket.id };
  const oldDocument = globalThis.document, oldNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const raster = "data:image/png;base64,ZmFrZQ==";
  const Detail = load("../components/extra-ticket-prototype-detail.tsx", {
    react: h.react, qrcode: { default: { toDataURL: async () => raster } },
    "lucide-react": new Proxy({}, { get: () => "svg" }), "@/components/owned-ticket-card": { OwnedTicketCard: "card" },
    "@/lib/extra-ticket-prototype": model,
    "@/lib/ticket-image-layers": { ticketImageLayers: async (node, qr) => { assert.equal(node, card); assert.equal(qr, raster); return {}; } },
    "@/lib/ticket-image-frame": { frameTicketImage: async value => value },
    "@/lib/owned-ticket-export": { shareTicketImage },
    "html-to-image": { toPng: async () => { renders.push("png"); return raster; }, toJpeg: async () => { renders.push("jpg"); return raster; } },
  }).ExtraTicketPrototypeDetail;
  const render = () => { h.reset(); return Detail({ ticket, onBack() {}, onAnnul() {} }); };
  const button = label => nodes(render()).find(node => node.type === "button" && text(node).trim() === label);
  try {
    globalThis.document = { fonts: { ready: Promise.resolve() }, getElementById: () => card, body: { appendChild() {} }, createElement() { return { click() { downloads.push(this.download); }, remove() {} }; } };
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
    render(); for (const effect of h.effects) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); } await Promise.resolve();
    const save = button("DESCARGAR").props.onClick; save(); save();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(renders, ["png"]); assert.deepEqual(downloads, ["diwo-local-EX0001.png"]);
    button("Descargar en JPG").props.onClick(); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(renders, ["png", "jpg"]); assert.equal(downloads[1], "diwo-local-EX0001.jpg");
    button("COMPARTIR").props.onClick(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(downloads.length, 3); assert.match(text(render()), /compartirla desde tu dispositivo/);
    let shared = 0;
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { canShare: () => true, share: async data => { assert.ok(data.files[0] instanceof File); shared++; } } });
    button("COMPARTIR").props.onClick(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(shared, 1); assert.equal(downloads.length, 3);
  } finally {
    cleanups.forEach(cleanup => cleanup()); globalThis.document = oldDocument;
    if (oldNavigator) Object.defineProperty(globalThis, "navigator", oldNavigator); else delete globalThis.navigator;
  }
});

for (const native of [true, false]) test(`quick share captures the card offscreen without focus changes: ${native ? "native sharing once" : "download fallback"}`, async () => {
  const h = hooks(), ticket = model.initialPrototypeTickets().find(ticket => ticket.kind === "extra");
  const card = { getAttribute: () => ticket.id }, raster = "data:image/png;base64,ZmFrZQ==";
  const outcomes = [], cleanups = []; let shares = 0, renders = 0;
  const oldDocument = globalThis.document, oldNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const Detail = load("../components/extra-ticket-prototype-detail.tsx", {
    react: h.react, qrcode: { default: { toDataURL: async () => raster } },
    "lucide-react": new Proxy({}, { get: () => "svg" }), "@/components/owned-ticket-card": { OwnedTicketCard: "card" },
    "@/lib/extra-ticket-prototype": model,
    "@/lib/ticket-image-layers": { ticketImageLayers: async (element, qr) => { assert.equal(element, card); assert.equal(qr, raster); return {}; } },
    "@/lib/ticket-image-frame": { frameTicketImage: async value => value }, "@/lib/owned-ticket-export": { shareTicketImage },
    "html-to-image": { toPng: async () => { renders++; return raster; } },
  }).ExtraTicketPrototypeDetail;
  const render = () => { h.reset(); return Detail({ ticket, quickShare: true, onBack() { assert.fail("Must not open detail"); }, onAnnul() {}, onQuickShareDone: outcome => outcomes.push(outcome) }); };
  try {
    globalThis.document = { fonts: { ready: Promise.resolve() }, getElementById: () => card };
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: native ? { canShare: () => true, share: async data => { assert.ok(data.files[0] instanceof File); shares++; } } : {} });
    let tree = render();
    assert.equal(tree.props["aria-hidden"], "true"); assert.equal(tree.props.inert, true);
    assert.equal(nodes(tree).some(node => node.type === "button" || node.type === "h1"), false);
    for (const effect of [...h.effects]) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); }
    await Promise.resolve(); tree = render();
    assert.equal(nodes(tree).find(node => node.type === "card").props.result.ticket.id, ticket.id);
    for (const effect of [...h.effects]) effect();
    render(); for (const effect of [...h.effects]) effect();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(renders, 1); assert.equal(shares, native ? 1 : 0);
    assert.equal(outcomes.length, 1);
    if (native) assert.deepEqual(outcomes, [{ message: null, download: null }]);
    else { assert.ok(outcomes[0].download instanceof File); assert.match(outcomes[0].message, /guardar la imagen/); }
  } finally {
    cleanups.forEach(cleanup => cleanup()); globalThis.document = oldDocument;
    if (oldNavigator) Object.defineProperty(globalThis, "navigator", oldNavigator); else delete globalThis.navigator;
  }
});
