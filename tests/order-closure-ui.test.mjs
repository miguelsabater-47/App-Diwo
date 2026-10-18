import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { orderClosure } from "../lib/order-closure-state.ts";
import { paymentApproval } from "../lib/order-payment-state.ts";

const id = "00000000-0000-4000-8000-000000000001", at = "2026-10-15T12:00:00.000Z";
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; });
const load = (path, dependencies) => {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", code)(name => {
    if (name === "react/jsx-runtime") return jsx;
    assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name];
  }, mod, mod.exports);
  return mod.exports;
};
const nodes = node => !node || typeof node !== "object" ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
const text = node => node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(text).join(" ") : typeof node === "object" ? text(node.props?.children) : String(node);
function harness() {
  const slots = []; let index = 0, refreshes = 0;
  const calls = [];
  const state = { response: Response.json({ order: { id, status: "cancelled", closedAt: at } }), fail: false, resolve: null };
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (state.fail) throw Error("synthetic ambiguity");
    if (state.resolve === "wait") return new Promise(resolve => { state.resolve = resolve; });
    return state.response;
  };
  const Component = load("../components/approve-order-payment.tsx", {
    react: {
      useState(initial) { const n = index++; if (!(n in slots)) slots[n] = initial; return [slots[n], value => { slots[n] = typeof value === "function" ? value(slots[n]) : value; }]; },
      useRef(initial) { const n = index++; return slots[n] ?? (slots[n] = { current: initial }); },
      useEffect() {},
    },
    "next/navigation": { useRouter: () => ({ refresh() { refreshes++; } }) },
    "@/components/ui/button": { Button: "button" },
    "@/lib/order-payment-state": { paymentApproval }, "@/lib/order-closure-state": { orderClosure },
  }).ApproveOrderPayment;
  const render = () => { index = 0; return Component({ orderId: id, quantity: 2 }); };
  const button = label => { const b = nodes(render()).find(n => n.type === "button" && text(n) === label); assert.ok(b, `Missing ${label}`); return b; };
  return { state, calls, render, button, refreshes: () => refreshes };
}

test("receipt accepts only exact same order, chosen status and valid timestamp", () => {
  const order = { id, status: "cancelled", closedAt: at };
  assert.equal(orderClosure({ order }, id), true);
  for (const value of [null, {}, { order: { ...order, id: "other" } }, { order: { ...order, status: "pending" } }, { order: { ...order, status: "rejected" } }, { order: { ...order, closedAt: null } }, { order: { ...order, closedAt: "not-a-date" } }]) assert.equal(orderClosure(value, id), false);
});
test("choosing/back makes no write; cancellation requires a separate explicit confirmation", async () => {
  for (const [decision, label, confirmation, status] of [["cancel", "Cancelar solicitud", "Confirmar cancelación", "cancelled"]]) {
    const h = harness();
    h.button(label).props.onClick(); assert.equal(h.calls.length, 0);
    assert.ok(text(h.render()).includes("Esta acción no devuelve dinero"));
    h.button("Volver sin cambios").props.onClick(); assert.equal(h.calls.length, 0);
    h.button(label).props.onClick();
    h.state.response = Response.json({ order: { id, status, closedAt: at } });
    await h.button(confirmation).props.onClick();
    assert.equal(h.calls.length, 1); assert.equal(h.calls[0].url, `/api/orders/${decision}`);
    assert.deepEqual(JSON.parse(h.calls[0].options.body), { orderId: id });
    assert.equal(h.calls[0].options.credentials, "same-origin"); assert.equal(h.refreshes(), 1);
    assert.ok(text(h.render()).includes("Su historial se conserva"));
    assert.equal(nodes(h.render()).some(n => n.type === "button" && text(n) === label), false);
    assert.ok(nodes(h.render()).filter(n => n.type === "button").every(n => n.props.disabled));
  }
});
test("one shared singleflight blocks double close and approval while a closure is pending", async () => {
  const h = harness();
  nodes(h.render()).find(n => n.type === "input").props.onChange({ target: { checked: true } });
  const approve = h.button("Aceptar y emitir entradas").props.onClick;
  h.button("Cancelar solicitud").props.onClick();
  const close = h.button("Confirmar cancelación").props.onClick;
  h.state.resolve = "wait";
  const pending = close();
  await close(); await approve();
  assert.equal(h.calls.length, 1);
  assert.ok(nodes(h.render()).filter(n => n.type === "button").every(n => n.props.disabled));
  h.state.resolve(Response.json({ order: { id, status: "cancelled", closedAt: at } })); await pending;
  await close(); await approve(); assert.equal(h.calls.length, 1);
});
test("approval shares the lock, and successful approval prevents later closure", async () => {
  const h = harness();
  const choose = h.button("Cancelar solicitud").props.onClick;
  nodes(h.render()).find(n => n.type === "input").props.onChange({ target: { checked: true } });
  h.state.resolve = "wait";
  const pending = h.button("Aceptar y emitir entradas").props.onClick();
  choose(); assert.equal(text(h.render()).includes("¿Cancelar"), false);
  h.state.resolve(Response.json({ order: { id, status: "confirmed", confirmedAt: at, issuedTicketCount: 2 } }));
  await pending; choose(); assert.equal(h.calls.length, 1); assert.equal(h.refreshes(), 1);
  assert.equal(text(h.render()).includes("¿Cancelar"), false);
});
test("ambiguous/denied/malformed/wrong-order replies never announce success or retry automatically", async () => {
  for (const kind of ["network", "conflict", "forbidden", "wrong-order", "malformed", "wrong-status"]) {
    const h = harness(); h.button("Cancelar solicitud").props.onClick();
    if (kind === "network") h.state.fail = true;
    if (kind === "conflict" || kind === "forbidden") h.state.response = Response.json({ error: "denied" }, { status: kind === "conflict" ? 409 : 403 });
    if (kind === "wrong-order") h.state.response = Response.json({ order: { id: "other", status: "cancelled", closedAt: at } });
    if (kind === "wrong-status") h.state.response = Response.json({ order: { id, status: "rejected", closedAt: at } });
    if (kind === "malformed") h.state.response = new Response("{", { status: 200 });
    await h.button("Confirmar cancelación").props.onClick();
    assert.equal(h.calls.length, 1); assert.equal(h.refreshes(), 0);
    assert.equal(text(h.render()).includes("Solicitud cancelada."), false);
    assert.equal(h.button("Confirmar cancelación").props.disabled, false);
    assert.ok(text(h.render()).includes("Actualiza el estado"));
  }
});
test("page forwards authorized rows to the requests view; cancellation is the only closing API", async () => {
  const h = harness();
  assert.equal(text(h.render()).includes("Rechazar"), false);
  let status = "pending";
  const Page = load("../app/admin/requests/page.tsx", {
    "@/lib/order-reads": { readOrderOverview: async kind => { assert.equal(kind, "admin"); return { ok: true, orders: [{ id, status, quantity: 2, totalCents: 1000, reference: "TECHNICAL", buyerName: "Synthetic", names: ["First", "Second"], tickets: [] }] }; } },
    "@/components/refresh-orders": { RefreshOrders: "refresh" }, "@/components/approve-order-payment": { ApproveOrderPayment: "actions" },
    "next/navigation": { notFound() {} }, "@/lib/app-authorization": { requireAdminAccess: async () => ({ ok: true, role: "admin" }) },
    "@/lib/local-access": { isLocalPaymentPreview: () => false }, "@/lib/admin-requests-model": { requestDesignExamples: () => [] },
    "@/components/admin-requests": { AdminRequests: "requests-view" },
  }).default;
  for (status of ["pending", "confirmed", "cancelled", "rejected"]) assert.equal((await Page()).props.orders[0].status, status);
  for (const decision of ["cancel"]) {
    const route = load(`../app/api/orders/${decision}/route.ts`, { "@/lib/order-mutations": { runOrderMutation: (request, operation) => ({ request, operation }) } });
    const request = {}; assert.deepEqual(await route.POST(request), { request, operation: decision });
  }
  assert.throws(() => readFileSync(new URL("../app/api/orders/reject/route.ts", import.meta.url)), { code: "ENOENT" });
});
