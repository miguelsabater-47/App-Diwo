import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as model from "../lib/door-staff-model.ts";

const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; });
const id = "a".repeat(64), at = "2026-10-15T20:00:00.123456Z";
function load(file, deps) {
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", code)(name => {
    if (name === "react/jsx-runtime") return jsx;
    assert.ok(name in deps, `Unexpected ${name}`); return deps[name];
  }, mod, mod.exports);
  return mod.exports;
}
const text = n => n == null || typeof n === "boolean" ? "" : Array.isArray(n) ? n.map(text).join(" ") : typeof n === "object" ? text(n.props?.children) : String(n);
const nodes = n => !n || typeof n !== "object" ? [] : [n, ...[n.props?.children].flat(Infinity).flatMap(nodes)];
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(options = {}) {
  const calls = [], slots = [], effects = [], cleanups = [];
  let index = 0;
  const state = { rows: [], candidateRole: "user", candidateVersion: null, listFails: false, mutation: "ok", resolveWrite: null, actor: "admin", ...options };
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "/api/door-staff"); const body = init.body ? JSON.parse(init.body) : null; calls.push(body);
    if (!body) return state.listFails ? Response.json({ error: "staff_configuration_required" }, { status: 503 }) : Response.json({ staff: state.rows });
    if (body.action === "lookup") return Response.json({ candidate: { staffId: id, name: "Synthetic Person", email: body.email, role: state.candidateRole, version: state.candidateVersion } });
    if (state.mutation === "wait") return new Promise(resolve => { state.resolveWrite = resolve; });
    if (state.mutation === "network") throw Error("synthetic ambiguity");
    if (state.mutation === "conflict") return Response.json({ error: "staff_state_changed" }, { status: 409 });
    return Response.json({ member: { staffId: state.mutation === "wrong-id" ? "b".repeat(64) : id, role: body.action === "grant" ? "door_staff" : "user", version: at } });
  };
  const Manager = load("../components/door-staff-manager.tsx", {
    react: {
      useState(initial) { const n = index++; if (!(n in slots)) slots[n] = initial; return [slots[n], value => { slots[n] = typeof value === "function" ? value(slots[n]) : value; }]; },
      useRef(initial) { const n = index++; return slots[n] ?? (slots[n] = { current: initial }); },
      useEffect(fn, deps) { const n = index++; if (!slots[n] || deps.some((v, i) => !Object.is(v, slots[n][i]))) { slots[n] = deps; effects.push(() => { const cleanup = fn(); if (cleanup) cleanups.push(cleanup); }); } },
    },
    "@/components/ui/button": { Button: "button" }, "@/lib/door-staff-model": model,
    "@clerk/nextjs": { useAuth: () => ({ userId: state.actor, isLoaded: true }) },
  }).DoorStaffManager;
  const render = () => { index = 0; const tree = Manager(); while (effects.length) effects.shift()(); return tree; };
  const button = label => { const found = nodes(render()).find(n => n.type === "button" && text(n) === label); assert.ok(found, `Missing ${label}`); return found; };
  const input = () => nodes(render()).find(n => n.type === "input");
  const lookup = async () => {
    input().props.onChange({ target: { value: "person@example.invalid" } });
    await nodes(render()).find(n => n.type === "form").props.onSubmit({ preventDefault() {} }); render();
  };
  const ready = async () => { render(); await tick(); render(); };
  return { state, calls, render, button, input, lookup, ready, cleanup: () => cleanups.forEach(fn => fn()) };
}
test("initial load is read-only; unavailable list is never presented as a verified empty list", async () => {
  const h = harness({ listFails: true }); await h.ready();
  assert.deepEqual(h.calls, [null]); assert.ok(text(h.render()).includes("aún no está activada"));
  assert.equal(text(h.render()).includes("No hay personal de puerta asignado."), false);
  assert.equal(h.button("Añadir correo").props.disabled, true);
  h.state.listFails = false; await h.button("Actualizar personal").props.onClick();
  assert.ok(text(h.render()).includes("No hay personal de puerta asignado."));
});
test("lookup alone never grants; editing email invalidates preview, admin and existing staff cannot be granted", async () => {
  const h = harness(); await h.ready(); await h.lookup();
  assert.deepEqual(h.calls.map(c => c?.action ?? "list"), ["list", "lookup"]);
  assert.equal(h.button("Confirmar acceso").props.disabled, false);
  h.input().props.onChange({ target: { value: "different@example.invalid" } });
  assert.equal(text(h.render()).includes("Confirmar acceso"), false);
  for (const role of ["admin", "door_staff"]) {
    const other = harness({ candidateRole: role, candidateVersion: at }); await other.ready(); await other.lookup();
    assert.equal(text(other.render()).includes("Confirmar acceso"), false);
  }
});
test("one explicit grant uses only preview identity/version and blocks double/stale callbacks until refresh", async () => {
  const h = harness({ mutation: "wait" }); await h.ready(); await h.lookup();
  const grant = h.button("Confirmar acceso").props.onClick;
  const pending = grant(); await grant();
  assert.equal(h.calls.filter(c => c?.action === "grant").length, 1);
  assert.deepEqual(h.calls.at(-1), { action: "grant", email: "person@example.invalid", staffId: id, version: null });
  h.state.resolveWrite(Response.json({ member: { staffId: id, role: "door_staff", version: at } })); await pending;
  await grant(); assert.equal(h.calls.filter(c => c?.action === "grant").length, 1);
  assert.ok(text(h.render()).includes("Acceso de puerta concedido"));
  assert.equal(h.button("Añadir correo").props.disabled, true);
  await h.button("Actualizar personal").props.onClick(); assert.equal(h.input().props.disabled, false);
});
test("removal requires confirmation; back is read-only and unavailable Clerk users remain revocable", async () => {
  const h = harness({ rows: [{ staffId: id, name: "Cuenta no disponible", email: null, version: at }] }); await h.ready();
  h.button("Retirar acceso").props.onClick(); assert.equal(h.calls.length, 1);
  h.button("Volver").props.onClick(); assert.equal(h.calls.length, 1);
  h.button("Retirar acceso").props.onClick();
  await h.button("Confirmar retirada").props.onClick();
  assert.deepEqual(h.calls.at(-1), { action: "revoke", staffId: id, version: at });
  assert.ok(text(h.render()).includes("conserva sus compras y entradas"));
});
test("ambiguous/conflicting/invalid mutation receipts require refresh and never retry or announce success", async () => {
  for (const mutation of ["network", "conflict", "wrong-id"]) {
    const h = harness({ mutation }); await h.ready(); await h.lookup();
    const grant = h.button("Confirmar acceso").props.onClick;
    await grant(); await grant();
    assert.equal(h.calls.filter(c => c?.action === "grant").length, 1);
    assert.equal(text(h.render()).includes("Acceso de puerta concedido"), false);
    assert.ok(text(h.render()).includes("Actualiza"));
  }
});
test("a changed account cannot reuse an old grant callback or display an old account's mutation result", async () => {
  const h = harness(); await h.ready(); await h.lookup();
  const grant = h.button("Confirmar acceso").props.onClick;
  h.state.actor = "other"; h.render(); await grant();
  assert.equal(h.calls.filter(call => call?.action === "grant").length, 0);
  assert.match(text(h.render()), /sesión ha cambiado/);
  assert.equal(text(h.render()).includes("Synthetic Person"), false);

  const pending = harness({ mutation: "wait" }); await pending.ready(); await pending.lookup();
  const work = pending.button("Confirmar acceso").props.onClick();
  pending.state.actor = "other"; pending.render();
  pending.state.resolveWrite(Response.json({ member: { staffId: id, role: "door_staff", version: at } }));
  await work;
  assert.equal(text(pending.render()).includes("Acceso de puerta concedido"), false);
});
test("withdrawal confirmation initially focuses the safe back action and explains preserved buyer access", async () => {
  const h = harness({ rows: [{ staffId: id, name: "Synthetic Person", email: "person@example.invalid", version: at }] });
  await h.ready(); h.button("Retirar acceso").props.onClick();
  const back = h.button("Volver");
  assert.ok(back.props.ref);
  assert.equal(h.button("Confirmar retirada").props.ref, undefined);
  assert.match(text(h.render()), /Conservará su cuenta y sus propias entradas/);
  assert.equal(h.calls.filter(call => call?.action === "revoke").length, 0);
});
test("staff page and reader gate independently; layout adds no duplicate menu, route has no legacy handler", async () => {
  let access = { ok: false, status: 401 };
  const Page = load("../app/admin/staff/page.tsx", {
    "next/navigation": { redirect(path) { throw Error(`redirect:${path}`); }, notFound() { throw Error("notFound"); } },
    "@/lib/app-authorization": { requireAdminAccess: async () => access }, "@/components/door-staff-manager": { DoorStaffManager: "manager" },
  }).default;
  await assert.rejects(Page(), /redirect/);
  access = { ok: false, status: 403 }; await assert.rejects(Page(), /notFound/);
  access = { ok: false, status: 503 }; assert.equal(nodes(await Page()).some(n => n.type === "manager"), false);
  access = { ok: true, role: "admin" }; assert.ok(nodes(await Page()).some(n => n.type === "manager"));
  const Layout = load("../app/admin/layout.tsx", {
    "next/link": { default: "a" }, "@clerk/nextjs/server": { auth: async () => ({ userId: "synthetic" }) },
    "next/navigation": { notFound() {}, redirect() {} }, "@/lib/local-access": { hasConfiguredClerkKeys: () => true },
    "@/lib/app-authorization": { requireAdminAccess: async () => access }, "@/components/nav-button": { NavButton: "nav-button" },
  }).default;
  assert.equal(nodes(await Layout({ children: "safe" })).some(n => n.type === "nav" || n.type === "nav-button"), false,
    "Admin layout must not add a second navigation bar");
  const route = load("../app/api/door-staff/route.ts", { "@/lib/door-staff": { runDoorStaff: request => request } });
  const request = {}; assert.equal(await route.GET(request), request); assert.equal(await route.POST(request), request);
});
