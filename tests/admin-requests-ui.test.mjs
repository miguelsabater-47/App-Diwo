import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { paymentApproval } from "../lib/order-payment-state.ts";
import { orderClosure } from "../lib/order-closure-state.ts";

const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; });
function load(path, dependencies) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", code)(name => {
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
const model = load("../lib/admin-requests-model.ts", { "./order-payment-state": { paymentApproval }, "./order-closure-state": { orderClosure } });
const source = model.requestDesignExamples()[0];
const row = { ...source, reference: "DIWO-123456ABCDEF" };
const at = "2026-10-17T17:00:00Z";
const receipt = (id = row.id) => ({ order: { id, status: "confirmed", confirmedAt: at, issuedTicketCount: row.quantity } });

function harness(options = {}) {
  const slots = [], effects = [], calls = [];
  let index = 0, refreshes = 0;
  const state = { orders: [row], preview: false, fail: false, wait: null, response: Response.json(receipt()), actor: "user_admin", ...options };
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (state.fail) throw new Error("ambiguous");
    if (state.wait === "pending") return new Promise(resolve => { state.wait = resolve; });
    return state.response;
  };
  const Component = load("../components/admin-requests.tsx", {
    react: {
      useState(initial) { const slot = index++; if (!(slot in slots)) slots[slot] = initial; return [slots[slot], value => { slots[slot] = typeof value === "function" ? value(slots[slot]) : value; }]; },
      useRef(initial) { const slot = index++; return slots[slot] ?? (slots[slot] = { current: initial }); },
      useEffect: callback => effects.push(callback),
    },
    "@clerk/nextjs": { useAuth: () => ({ userId: state.actor, isLoaded: true }) },
    "next/navigation": { useRouter: () => ({ refresh: () => { refreshes++; } }) },
    "next/link": { default: "a" }, "@/components/ui/button": { Button: "button" }, "@/lib/admin-requests-model": model,
    "lucide-react": Object.fromEntries(["ArrowLeft", "ArrowRight", "CalendarDays", "Check", "Clock", "Copy", "Euro", "Search", "Ticket", "UserRound", "X"].map(name => [name, props => jsx.jsx("svg", { ...props, "data-icon": name })])),
  }).AdminRequests;
  const render = () => { index = 0; effects.length = 0; return Component({ orders: state.orders, preview: state.preview }); };
  const find = predicate => { const found = nodes(render()).find(predicate); assert.ok(found); return found; };
  const button = label => find(node => node.type === "button" && text(node).trim() === label);
  return { state, calls, render, find, button, refreshes: () => refreshes, effects: () => { for (const callback of [...effects]) callback(); } };
}

test("request filters keep actual and technical history separate, preserve exact codes and search names/email without accent sensitivity", () => {
  const examples = model.requestDesignExamples();
  const technical = { ...row, id: "history", actualEvent: false, technical: true, status: "confirmed" };
  assert.equal(model.requestRows([...examples, technical], false, "pending", "alvaro").length, 1);
  assert.equal(model.requestRows(examples, false, "pending", "alvaro@example.com")[0].reference, "DIWO-A7K9");
  assert.equal(model.requestRows([technical], false, "confirmed", "").length, 0);
  assert.equal(model.requestRows([technical], true, "confirmed", "").length, 1);
  assert.equal(model.canDecideRequest(technical), false);
  assert.equal(model.requestRows(examples, false, "pending", "")[0].buyerName, "Javier López");
  assert.equal(examples[0].buyerName, "Álvaro García", "Sorting never mutates the source");
});

test("opening confirmation/cancel and returning are read-only; approving requires the bank checkbox and one explicit final click", async () => {
  const h = harness();
  h.button("Confirmar").props.onClick();
  assert.equal(h.calls.length, 0); assert.match(text(h.render()), /¿Seguro que quieres confirmar/);
  assert.equal(h.button("Confirmar y emitir entradas").props.disabled, true);
  await h.button("Confirmar y emitir entradas").props.onClick(); assert.equal(h.calls.length, 0);
  h.button("Volver sin cambios").props.onClick(); assert.equal(h.calls.length, 0);
  h.button("Confirmar").props.onClick();
  // The bank input is the last checkbox: history filtering never authorizes payment.
  const checkboxes = nodes(h.render()).filter(node => node.type === "input" && node.props.type === "checkbox");
  checkboxes.at(-1).props.onChange({ target: { checked: true } });
  await h.button("Confirmar y emitir entradas").props.onClick();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].url, "/api/orders/approve-payment");
  assert.deepEqual(JSON.parse(h.calls[0].init.body), { orderId: row.id });
  assert.equal(h.calls[0].init.credentials, "same-origin");
  assert.match(text(h.render()), /Pago confirmado/);
});

test("cancellation has its own modal and valid same-order receipt; no paid/technical row receives an action", async () => {
  const h = harness({ response: Response.json({ order: { id: row.id, status: "cancelled", closedAt: at } }) });
  h.button("Cancelar").props.onClick();
  assert.equal(h.calls.length, 0); assert.match(text(h.render()), /no devuelve dinero/i);
  await h.button("Confirmar cancelación").props.onClick();
  assert.equal(h.calls[0].url, "/api/orders/cancel"); assert.match(text(h.render()), /Solicitud cancelada/);
  for (const changed of [{ status: "confirmed" }, { technical: true }, { actualEvent: false }]) {
    const item = { ...row, ...changed };
    assert.equal(model.canDecideRequest(item), false);
  }
});

test("list and detail use the same operator lock and settled IDs; duplicate/stale callbacks never repeat a write", async () => {
  const h = harness({ wait: "pending" });
  const staleCancel = h.button("Cancelar").props.onClick;
  h.button("Confirmar").props.onClick();
  nodes(h.render()).filter(node => node.type === "input" && node.props.type === "checkbox").at(-1).props.onChange({ target: { checked: true } });
  const confirm = h.button("Confirmar y emitir entradas").props.onClick;
  const pending = confirm(); await confirm(); staleCancel();
  assert.equal(h.calls.length, 1);
  h.state.wait(Response.json(receipt())); await pending;
  await confirm(); staleCancel(); assert.equal(h.calls.length, 1);
});

test("ambiguous/denied/wrong-order/malformed replies lock writes until an explicit fresh authorized read, never success or auto retry", async () => {
  for (const kind of ["network", "denied", "wrong-id", "invalid-json"]) {
    const h = harness(); h.button("Cancelar").props.onClick();
    if (kind === "network") h.state.fail = true;
    if (kind === "denied") h.state.response = Response.json({ error: "denied" }, { status: 403 });
    if (kind === "wrong-id") h.state.response = Response.json({ order: { id: "wrong", status: "cancelled", closedAt: at } });
    if (kind === "invalid-json") h.state.response = new Response("{");
    const confirm = h.button("Confirmar cancelación").props.onClick;
    await confirm(); await confirm();
    assert.equal(h.calls.length, 1); assert.equal(text(h.render()).includes("Solicitud cancelada."), false);
    assert.equal(h.button("Confirmar cancelación").props.disabled, true);
    h.button("Cerrar").props.onClick(); h.button("Confirmar").props.onClick(); assert.equal(h.calls.length, 1);
    h.button("Actualizar").props.onClick(); assert.equal(h.refreshes(), 1);
    h.state.orders = [{ ...row }]; h.render(); h.effects();
    assert.equal(h.button("Confirmar").props.disabled, false);
  }
});

test("detail has only date/quantity/total and a prominent copyable concept, with user icons on grey instead of green attendee checks", () => {
  const h = harness();
  h.find(node => node.props?.["aria-label"] === `Ver solicitud ${row.reference}`).props.onClick();
  const detail = h.find(node => node.type === "aside");
  const pending = nodes(detail).find(node => node.props?.["aria-label"] === "Solicitud pendiente");
  assert.ok(pending);
  assert.equal(text(pending), "");
  assert.equal(nodes(pending).some(node => node.props?.["data-icon"] === "Clock"), true);
  for (const expected of [row.reference, "10,00", "Fecha de solicitud", "Entradas solicitadas", "Importe total", "alvaro@example.com"]) assert.ok(text(detail).includes(expected), expected);
  for (const absent of ["Pagado", "Pago por Bizum", "no ha comunicado", "Pendiente de confirmar"]) assert.equal(text(detail).includes(absent), false);
  const attendees = nodes(detail).find(node => node.props?.className === "diwo-admin-request-attendees");
  assert.equal(nodes(attendees).filter(node => node.props?.["data-icon"] === "UserRound").length, 2);
  assert.equal(nodes(attendees).some(node => node.props?.["data-icon"] === "Check"), false);
});

test("local design actions simulate UI results without an API write or a false real ticket emission claim", async () => {
  const h = harness({ preview: true });
  h.button("Confirmar").props.onClick();
  nodes(h.render()).filter(node => node.type === "input" && node.props.type === "checkbox").at(-1).props.onChange({ target: { checked: true } });
  await h.button("Confirmar y emitir entradas").props.onClick();
  assert.equal(h.calls.length, 0); assert.match(text(h.render()), /Simulación realizada/);
  assert.match(text(h.render()), /no.*emitido entradas reales/i);
});

test("request cards expose amount and detail; empty search can be cleared without a write", () => {
  const h = harness();
  assert.equal(nodes(h.render()).some(node => node.type === "select"), false);
  const card = h.find(node => node.type === "article");
  assert.ok(text(card).includes("10,00"));
  assert.equal(text(card).includes("Ver detalle"), false);
  assert.equal(text(card).includes("Cancelar"), true);
  assert.equal(text(card).includes("Pendiente"), false);
  h.find(node => node.props?.["aria-label"] === `Ver solicitud ${row.reference}`).props.onClick();
  assert.ok(text(h.find(node => node.type === "aside")).includes("Asistentes"));
  h.find(node => node.type === "input" && node.props.type === "search").props.onChange({ target: { value: "no-match" } });
  assert.match(text(h.render()), /Sin coincidencias/);
  h.button("Limpiar búsqueda").props.onClick();
  assert.ok(text(h.find(node => node.type === "article")).includes(row.buyerName));
  assert.equal(h.calls.length, 0);
});

test("confirmed cards have no bottom actions and still open their detail", () => {
  const h = harness();
  h.state.orders = [{ ...row, status: "confirmed", confirmedAt: at }];
  h.find(node => node.type === "button" && text(node).startsWith("Confirmadas")).props.onClick();
  const card = h.find(node => node.type === "article");
  assert.equal(nodes(card).some(node => node.props?.className?.includes("diwo-admin-request-actions")), false);
  h.find(node => node.props?.["aria-label"] === `Ver solicitud ${row.reference}`).props.onClick();
  const detail = h.find(node => node.type === "aside");
  assert.match(text(detail), /Confirmada/);
  assert.equal(text(detail).includes("Cancelar solicitud"), false);
  assert.equal(h.calls.length, 0);
});

test("requests server page keeps layout-independent admin reads and a separate local-admin-only design mode", async () => {
  const state = { local: true, admin: true, reads: 0, result: { ok: true, orders: [row] } };
  const Page = load("../app/admin/requests/page.tsx", {
    "next/navigation": { notFound: () => { throw new Error("not_found"); } },
    "@/lib/order-reads": { readOrderOverview: async (kind, options) => { state.reads++; assert.equal(kind, "admin"); assert.equal(options.contacts, true); return state.result; } },
    "@/lib/app-authorization": { requireAdminAccess: async () => ({ ok: state.admin }) },
    "@/lib/local-access": { isLocalPaymentPreview: () => state.local }, "@/lib/admin-requests-model": model,
    "@/components/admin-requests": { AdminRequests: "requests" }, "@/components/refresh-orders": { RefreshOrders: "refresh" },
  }).default;
  assert.equal((await Page()).props.orders[0].id, row.id);
  const prototype = await Page({ searchParams: Promise.resolve({ preview: "1" }) });
  assert.equal(prototype.props.preview, true); assert.equal(state.reads, 1);
  state.admin = false; await assert.rejects(Page({ searchParams: Promise.resolve({ preview: "1" }) }), /not_found/);
  state.local = false; await assert.rejects(Page({ searchParams: Promise.resolve({ preview: "1" }) }), /not_found/);
  await assert.rejects(Page({ searchParams: Promise.resolve({ preview: "2" }) }), /not_found/);
  state.result = { ok: false, status: 403 };
  assert.equal((await Page()).props.role, "alert");
});
