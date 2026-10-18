import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as model from "../lib/admin-ticket-model.ts";

const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; });
const at = "2026-10-17T17:00:00Z";
const row = { id: "00000000-0000-4000-8000-000000000001", position: 1, name: "Álvaro García", status: "valid", issuedAt: at, usedAt: null, revokedAt: null, reference: "DIWO-123456ABCDEF", buyerName: "Miguel", eventTitle: "DIWO X 2.0", technical: false };
const receipt = id => ({ ticket: { id, status: "revoked", revokedAt: at } });
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
function harness(options = {}) {
  const slots = [], effects = [], calls = [];
  let index = 0;
  const state = { tickets: [row], actor: "admin", fail: false, wait: false, response: Response.json(receipt(row.id)), ...options };
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (state.fail) throw new Error("network");
    if (state.wait) return new Promise(resolve => { state.resolve = resolve; });
    return state.response;
  };
  const dependencies = {
    react: {
      useState(initial) { const slot = index++; if (!(slot in slots)) slots[slot] = initial; return [slots[slot], value => { slots[slot] = typeof value === "function" ? value(slots[slot]) : value; }]; },
      useRef(initial) { const slot = index++; return slots[slot] ?? (slots[slot] = { current: initial }); },
      useEffect(callback) { effects.push(callback); },
    },
    "react/jsx-runtime": jsx,
    "@clerk/nextjs": { useAuth: () => ({ userId: state.actor, isLoaded: true }) },
    "@/lib/admin-ticket-model": model,
    "lucide-react": Object.fromEntries(["ArrowLeft", "Search", "Ticket"].map(name => [name, props => jsx.jsx("svg", { ...props, "data-icon": name })])),
  };
  const code = ts.transpileModule(readFileSync(new URL("../components/admin-tickets.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", code)(name => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name];
  }, mod, mod.exports);
  const render = () => { index = 0; effects.length = 0; return mod.exports.AdminTickets({ tickets: state.tickets }); };
  const find = predicate => { const found = nodes(render()).find(predicate); assert.ok(found); return found; };
  const button = label => find(node => node.type === "button" && text(node).trim() === label);
  const effectsNow = () => { for (const callback of [...effects]) callback(); };
  render(); effectsNow();
  return { state, calls, render, find, button, effects: effectsNow,
    open: (name = row.name) => find(node => node.type === "button" && node.props["aria-label"]?.startsWith(`Ver entrada de ${name},`)).props.onClick({ currentTarget: { isConnected: false } }),
    filter: label => find(node => node.type === "button" && text(node).startsWith(label)).props.onClick(),
  };
}

test("compact cards open a readonly detail; search and state filters preserve each individual entry", () => {
  const h = harness({ tickets: [row, { ...row, id: "used", name: "Claudia", status: "used", usedAt: at }] });
  assert.equal(nodes(h.render()).filter(node => node.type === "article").length, 2);
  assert.equal(text(h.find(node => node.type === "article")).includes("Anular"), false);
  h.open();
  const detail = h.find(node => node.type === "aside");
  for (const expected of [row.name, row.reference, row.id, row.buyerName, "Sin usar", "Emitida"]) assert.ok(text(detail).includes(expected));
  h.find(node => node.props?.["aria-label"] === "Volver a entradas").props.onClick();
  h.filter("Utilizadas");
  assert.equal(nodes(h.render()).filter(node => node.type === "article").length, 1);
  h.open("Claudia");
  assert.equal(text(h.find(node => node.type === "aside")).includes("Anular entrada"), false);
  h.filter("Todas");
  h.find(node => node.type === "input" && node.props.type === "search").props.onChange({ target: { value: "alvaro" } });
  assert.equal(nodes(h.render()).filter(node => node.type === "article").length, 1);
  h.find(node => node.type === "input" && node.props.type === "search").props.onChange({ target: { value: "missing" } });
  assert.match(text(h.render()), /Sin coincidencias/);
  h.button("Limpiar búsqueda").props.onClick();
  assert.equal(nodes(h.render()).filter(node => node.type === "article").length, 2);
  assert.equal(h.calls.length, 0);
});

test("technical tickets stay separate and readonly; revoked/used tickets never offer annulment", () => {
  const h = harness({ tickets: [{ ...row, technical: true }] });
  assert.equal(nodes(h.render()).filter(node => node.type === "article").length, 0);
  h.find(node => node.type === "input" && node.props.type === "checkbox").props.onChange({ target: { checked: true } });
  h.open();
  assert.match(text(h.find(node => node.type === "aside")), /PRUEBA TÉCNICA/);
  assert.equal(text(h.find(node => node.type === "aside")).includes("Anular entrada"), false);
  for (const status of ["used", "revoked"]) {
    const other = harness({ tickets: [{ ...row, status }] }); other.open();
    assert.equal(text(other.find(node => node.type === "aside")).includes("Anular entrada"), false);
  }
});

test("annulment requires explicit confirmation; exact receipt updates only the targeted ticket and never repeats stale callbacks", async () => {
  const h = harness({ tickets: [row, { ...row, id: "sibling", name: "Carlos" }], wait: true });
  h.open(); h.button("Anular entrada").props.onClick();
  assert.equal(h.calls.length, 0);
  h.button("Volver sin cambios").props.onClick(); assert.equal(h.calls.length, 0);
  h.button("Anular entrada").props.onClick();
  const confirm = h.button("Confirmar anulación").props.onClick;
  const pending = confirm(); await confirm();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url, "/api/tickets/revoke");
  assert.deepEqual(JSON.parse(h.calls[0].init.body), { ticketId: row.id });
  h.state.resolve(Response.json(receipt(row.id))); await pending; await confirm();
  assert.equal(h.calls.length, 1);
  assert.match(text(h.find(node => node.type === "aside")), /Anulada/);
  h.open("Carlos");
  assert.match(text(h.find(node => node.type === "aside")), /Sin usar/);
  assert.match(text(h.find(node => node.type === "aside")), /Anular entrada/);
});

test("network/denied/malformed/wrong-ticket replies lock all writes including stale callbacks without success or automatic retry", async () => {
  for (const response of ["network", Response.json({ error: "denied" }, { status: 403 }), new Response("{"), Response.json(receipt("wrong"))]) {
    const h = harness({ fail: response === "network", response });
    h.open(); h.button("Anular entrada").props.onClick();
    const confirm = h.button("Confirmar anulación").props.onClick;
    await confirm(); await confirm();
    assert.equal(h.calls.length, 1);
    assert.equal(text(h.render()).includes("Entrada anulada."), false);
    assert.match(text(h.render()), /Actualiza/);
    h.button("Anular entrada").props.onClick();
    assert.equal(h.button("Confirmar anulación").props.disabled, true);
    await h.button("Confirmar anulación").props.onClick();
    assert.equal(h.calls.length, 1);
  }
});

test("changing accounts prevents a stale confirmation and discards a previous account's in-flight result", async () => {
  const h = harness(); h.open(); h.button("Anular entrada").props.onClick();
  const stale = h.button("Confirmar anulación").props.onClick;
  h.state.actor = "other"; h.render(); h.effects(); await stale();
  assert.equal(h.calls.length, 0); assert.match(text(h.render()), /sesión ha cambiado/);
  const pending = harness({ wait: true }); pending.open(); pending.button("Anular entrada").props.onClick();
  const work = pending.button("Confirmar anulación").props.onClick();
  pending.state.actor = "other"; pending.render(); pending.effects();
  pending.state.resolve(Response.json(receipt(row.id))); await work;
  assert.equal(text(pending.render()).includes("Entrada anulada."), false);
});
