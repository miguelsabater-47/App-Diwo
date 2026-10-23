import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test, after } from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

function load(path, dependencies = {}) {
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
const owned = load("../lib/owned-ticket-model.ts");
const exportsModel = load("../lib/owned-ticket-export.ts");
const model = load("../lib/extra-ticket-model.ts", { "./owned-ticket-model": owned, "./owned-ticket-export": exportsModel });
const admin = load("../lib/admin-ticket-model.ts");
const pagination = load("../lib/order-view-model.ts");
const id = "00000000-0000-4000-8000-000000000001", batch = "00000000-0000-4000-8000-000000000002", event = "00000000-0000-4000-8000-000000000003";
const at = "2026-10-23T18:00:00.000Z", png = "data:image/png;base64,YWJj";
const raw = { ticket_id: id, batch_id: batch, event_id: event, batch_reference: "EX-ABCDEF012345", ticket_position: 1,
  attendee_name: "Synthetic Guest", status: "valid", issued_at: at, used_at: null, revoked_at: null };
const ticket = model.extraTicketRows([raw])[0];
const detail = { ok: true, technical: false, ticket: { id, orderId: batch, eventId: event, orderReference: raw.batch_reference,
  attendeeName: raw.attendee_name, status: "valid", issuedAt: at, usedAt: null, revokedAt: null, qrDataUrl: png,
  eventSlug: "diwo-x-2-2026", eventTitle: "DIWO X 2.0", startsAt: at, endsAt: at, timezone: "Europe/Madrid",
  publicLocation: "Casa de campo en Ceutí", unitPriceCents: 0, currency: "EUR" } };
const originalFetch = globalThis.fetch, originalStorage = globalThis.sessionStorage;
after(() => { globalThis.fetch = originalFetch; globalThis.sessionStorage = originalStorage; });
const deadline = { withRequestDeadline: fn => fn(new AbortController().signal) };
const icons = Object.fromEntries(["ArrowLeft", "Minus", "Plus", "Search", "Share2", "UserRound", "Download"].map(name => [name, "svg"]));
function nodes(node) {
  if (!node || typeof node !== "object") return [];
  if (typeof node.type === "function") return nodes(node.type(node.props));
  return [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
}
function text(node) {
  if (node == null || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map(text).join(" ");
  return typeof node === "object" ? text(node.props?.children) : String(node);
}
function hooks() {
  const slots = [], effects = []; let index = 0;
  return { reset() { index = 0; }, flush() { for (const effect of effects.splice(0)) effect(); }, react: {
    useState(initial) { const slot = index++; if (!(slot in slots)) slots[slot] = typeof initial === "function" ? initial() : initial; return [slots[slot], value => { slots[slot] = typeof value === "function" ? value(slots[slot]) : value; }]; },
    useRef(initial) { const slot = index++; return slots[slot] ?? (slots[slot] = { current: initial }); },
    useEffect(callback, deps) { const slot = index++; if (!slots[slot] || deps.some((value, i) => !Object.is(value, slots[slot][i]))) { slots[slot] = deps; effects.push(callback); } },
  } };
}
function workspace(saved = null) {
  const state = { actor: "user_admin", calls: [], storage: new Map(), fail: false, brokenStorage: false };
  const key = "diwo:extra-draft:user_admin:diwo-x-2-2026";
  if (saved) state.storage.set(key, JSON.stringify(saved));
  globalThis.sessionStorage = { getItem(key) { return state.storage.get(key) ?? null; }, setItem(key, value) { if (state.brokenStorage) throw new Error("storage"); state.storage.set(key, value); }, removeItem(key) { state.storage.delete(key); } };
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "/api/admin/extra-tickets"); assert.equal(options.method, "POST");
    assert.deepEqual(JSON.parse(state.storage.get(key)), JSON.parse(options.body), "Exact draft exists before POST");
    state.calls.push(JSON.parse(options.body));
    if (state.fail) throw new Error("network");
    return { ok: true, json: async () => ({ tickets: state.calls.at(-1).attendeeNames.map((name, index) => ({ ...ticket,
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, name, batchId: state.calls.at(-1).requestId, position: index + 1 })) }) };
  };
  const h = hooks();
  const Component = load("../components/admin-ticket-workspace.tsx", {
    react: h.react, "@clerk/nextjs": { useAuth: () => ({ userId: state.actor, isLoaded: true }) }, "lucide-react": icons,
    "@/components/admin-tickets": { AdminTickets: "general-list" }, "@/components/admin-ticket-list-item": { AdminTicketListItem: "ticket-row" },
    "@/components/animated-attendee-row": { AnimatedAttendeeRow: ({ children }) => jsx.jsx("div", { children }) },
    "@/components/admin-extra-ticket-detail": { AdminExtraTicketDetail: "extra-detail" }, "@/lib/admin-ticket-model": admin,
    "@/lib/extra-ticket-model": model, "@/lib/request-deadline": deadline,
  }).AdminTicketWorkspace;
  const render = () => { h.reset(); return Component({ tickets: [], extras: [] }); };
  const find = predicate => { const node = nodes(render()).find(predicate); assert.ok(node, "Node exists"); return node; };
  const button = label => find(node => node.type === "button" && text(node).trim() === label);
  render(); h.flush(); render();
  return { state, render, button, find, flush: h.flush, key,
    input(value) { find(node => node.type === "input").props.onChange({ target: { value } }); },
    review() { find(node => node.type === "form").props.onSubmit({ preventDefault() {} }); },
  };
}

test("real workspace is visible without the local preview gate and opens actual extra creation", () => {
  const h = workspace();
  assert.equal(h.button("Crear entrada extra").props.disabled, false);
  assert.match(text(h.render()), /Generales|Extras/); assert.doesNotMatch(text(h.render()), /simulad|PRUEBA|cupo.*pendiente/i);
  h.button("Crear entrada extra").props.onClick(); h.input("Synthetic Guest"); h.review();
  assert.match(text(h.render()), /entrada real y su propio QR/); assert.equal(h.state.calls.length, 0);
});

test("explicit issuance persists exact draft first, coalesces double clicks and cannot replay stale success callbacks", async () => {
  const h = workspace(); h.button("Crear entrada extra").props.onClick(); h.input("  Synthetic Guest  "); h.review();
  const issue = h.button("Crear entradas").props.onClick;
  issue(); issue(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.state.calls.length, 1); assert.deepEqual(h.state.calls[0].attendeeNames, ["Synthetic Guest"]);
  assert.equal(h.state.storage.size, 0); assert.equal(h.find(node => node.type === "extra-detail").props.ticket.name, "Synthetic Guest");
  issue(); await new Promise(resolve => setImmediate(resolve)); assert.equal(h.state.calls.length, 1);
});

test("ambiguous issuance locks editing, retries the same ID/payload only on click and survives tab reload", async () => {
  const h = workspace(); h.button("Crear entrada extra").props.onClick(); h.input("Synthetic Guest"); h.review(); h.state.fail = true;
  const staleEdit = h.button("Volver a editar").props.onClick;
  h.button("Crear entradas").props.onClick(); await new Promise(resolve => setImmediate(resolve));
  staleEdit();
  assert.equal(h.button("Volver a editar").props.disabled, true); assert.equal(h.state.calls.length, 1);
  const saved = h.state.calls[0]; h.state.fail = false;
  h.button("Reintentar misma emisión").props.onClick(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.state.calls, [saved, saved]);
  const restored = workspace(saved); assert.equal(restored.state.calls.length, 0);
  restored.button("Reintentar misma emisión").props.onClick(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(restored.state.calls, [saved]);
});

test("storage failure and account changes block issuance and hide previous private names", async () => {
  const h = workspace(); h.button("Crear entrada extra").props.onClick(); h.input("Private Guest"); h.review();
  h.state.brokenStorage = true; h.button("Crear entradas").props.onClick(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.state.calls.length, 0);
  const stale = h.button("Crear entradas").props.onClick; h.state.actor = "user_other"; h.render(); stale();
  assert.doesNotMatch(text(h.render()), /Private Guest/); assert.equal(h.state.calls.length, 0);
});

test("DTOs require exact batch, names, cardinality and status; private fields never survive projection", () => {
  const draft = { requestId: batch, attendeeNames: [ticket.name] };
  assert.deepEqual(model.extraTicketResponse({ tickets: [{ ...ticket, qrToken: "private" }] }, draft), [ticket]);
  for (const row of [{ ...ticket, name: "Other" }, { ...ticket, batchId: event }, { ...ticket, position: 2 }, { ...ticket, status: "used" }]) {
    assert.equal(model.extraTicketResponse({ tickets: [row] }, draft), null);
  }
  assert.equal(model.extraTicketResponse({ tickets: [] }, draft), null);
  for (const field of ["orderId", "eventId", "id", "orderReference", "attendeeName", "unitPriceCents"]) {
    assert.equal(model.extraTicketDetail({ ...detail, ticket: { ...detail.ticket, [field]: "wrong" } }, ticket), null);
  }
  assert.equal(model.extraTicketDetail(detail, ticket).ticket.qrDataUrl, png);
});

test("HTTP mutation requires current admin, exact origin and safe payload; returns only validated safe issuance receipts", async () => {
  const { handleOrderMutation } = load("../lib/order-mutation-core.ts", { "./extra-ticket-model": model });
  const make = (origin = "https://diwo.example.org") => new Request(`${origin}/api/admin/extra-tickets`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ requestId: batch, attendeeNames: [ticket.name] }) });
  let calls = 0;
  const session = role => async () => ({ ok: true, role, client: { rpc: async (name, args) => {
    calls++; assert.equal(name, "issue_extra_tickets"); assert.equal(args.request_id, batch);
    return { error: null, data: [{ ...raw, qr_token: "never-project" }] };
  } } });
  for (const role of ["user", "door_staff"]) assert.equal((await handleOrderMutation(make(), "issue-extras", session(role), "https://diwo.example.org")).status, 403);
  assert.equal(calls, 0);
  assert.equal((await handleOrderMutation(make(), "issue-extras", session("admin"), "https://other.example.org")).status, 403);
  const response = await handleOrderMutation(make(), "issue-extras", session("admin"), "https://diwo.example.org");
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { tickets: [ticket] }); assert.equal(calls, 1);
});

test("admin page loads general and extra guarded readers in hosted mode and fails closed on either error", async () => {
  let ok = true;
  const page = load("../app/admin/tickets/page.tsx", { "@/lib/order-reads": { readOrderOverview: async scope => { assert.equal(scope, "admin"); return { ok: true, orders: [] }; } },
    "@/lib/admin-ticket-model": { adminTickets: () => [] }, "@/lib/extra-ticket-reader": { readAdminExtraTickets: async () => ({ ok, tickets: [ticket] }) },
    "@/components/admin-ticket-workspace": { AdminTicketWorkspace: "workspace" }, "@/components/refresh-orders": { RefreshOrders: "refresh" } }).default;
  const view = await page(); assert.equal(view.type, "workspace"); assert.deepEqual(view.props.extras, [ticket]);
  assert.equal("allowExtraPreview" in view.props, false);
  ok = false; assert.equal((await page()).props.role, "alert");
});

test("extra API middleware exception is exact and cannot open other admin endpoints or nested routes", () => {
  const { isConfiguredExtraTicketApi } = load("../lib/local-access.ts");
  for (const path of ["/api/admin/extra-tickets", `/api/admin/extra-tickets/${id}`, `/api/admin/extra-tickets/${id}/`]) assert.equal(isConfiguredExtraTicketApi(path), true);
  for (const path of ["/api/admin", "/api/admin/extra-tickets-other", "/api/admin/extra-tickets/not-a-uuid", `/api/admin/extra-tickets/${id}/qr`]) assert.equal(isConfiguredExtraTicketApi(path), false);
});

test("extra reader handles RPC ticket_id pagination and rechecks admin after buffered results", async () => {
  let roles, rows, calls;
  const reset = (roleValues, rawRows) => { roles = [...roleValues]; rows = rawRows; calls = []; };
  const reader = load("../lib/extra-ticket-reader.ts", {
    "server-only": {}, "@/lib/supabase-session": { createSessionSupabaseClient: async () => ({ status: "ready", client: {
      rpc(name) { calls.push(name); return name === "list_extra_tickets" ? { range: async () => ({ data: rows, count: rows.length, error: null }) } : Promise.resolve({ data: rows, error: null }); },
    } }) },
    "@/lib/app-authorization-core": { readCurrentAppAccess: async () => ({ ok: true, role: roles.shift() }) },
    "@/lib/local-access": { hasConfiguredClerkKeys: () => true }, "@/lib/order-view-model": pagination,
    "@/lib/extra-ticket-model": model, "@/lib/owned-ticket-model": owned,
    "@/lib/owned-ticket-qr": { renderOwnedTicketQr: async () => png },
  });
  reset(["admin", "admin"], [raw]); assert.deepEqual(await reader.readAdminExtraTickets(), { ok: true, tickets: [ticket] });
  reset(["admin", "user"], [raw]); assert.equal((await reader.readAdminExtraTickets()).ok, false);
  for (const role of ["user", "door_staff"]) { reset([role], [raw]); assert.equal((await reader.readAdminExtraTickets()).status, 403); assert.equal(calls.length, 0); }
  const rpc = { ...raw, id, order_id: batch, attendee_name: ticket.name, qr_token: "a".repeat(64), event_slug: "diwo-x-2-2026", event_title: "DIWO", starts_at: at, ends_at: at,
    timezone: "Europe/Madrid", public_location: "Casa de campo en Ceutí", unit_price_cents: 0, currency: "EUR", order_reference: raw.batch_reference };
  reset(["admin", "admin"], [rpc]); const result = await reader.readAdminExtraTicket(id); assert.equal(result.ok, true); assert.equal(JSON.stringify(result).includes("a".repeat(64)), false);
  reset(["admin", "user"], [rpc]); assert.equal((await reader.readAdminExtraTicket(id)).ok, false);
});

function detailHarness(options = {}) {
  const h = hooks(), state = { actor: "user_admin", replies: [], calls: [], changed: [], outcomes: [], ...options };
  globalThis.fetch = async (url, init) => {
    state.calls.push({ url, init });
    const value = state.replies.length ? state.replies.shift() : detail;
    if (value instanceof Error) throw value;
    return { ok: true, json: async () => value };
  };
  const Component = load("../components/admin-extra-ticket-detail.tsx", {
    react: h.react, "@clerk/nextjs": { useAuth: () => ({ userId: state.actor, isLoaded: true }) }, "lucide-react": icons,
    "@/components/owned-ticket-card": { OwnedTicketCard: "real-card" }, "@/lib/extra-ticket-model": model,
    "@/lib/admin-ticket-model": admin, "@/lib/request-deadline": deadline,
    "@/lib/ticket-image-layers": { ticketImageLayers: async () => [] },
    "@/lib/ticket-image-frame": { frameTicketImage: async value => value }, "@/lib/owned-ticket-export": exportsModel,
    "html-to-image": { toPng: async () => png, toJpeg: async () => png },
  }).AdminExtraTicketDetail;
  const render = () => { h.reset(); return Component({ ticket, onBack() {}, onChanged: value => state.changed.push(value), quickShare: state.quick,
    onQuickShareDone: outcome => state.outcomes.push(outcome) }); };
  const find = predicate => { const value = nodes(render()).find(predicate); assert.ok(value); return value; };
  const button = label => find(node => node.type === "button" && text(node).trim() === label);
  const settle = async () => { render(); h.flush(); await new Promise(resolve => setImmediate(resolve)); render(); h.flush(); await new Promise(resolve => setImmediate(resolve)); };
  return { state, render, find, button, settle };
}

test("real extra detail loads only admin endpoint, reads fresh status before export and blocks terminal sharing", async () => {
  const h = detailHarness(); await h.settle();
  assert.equal(h.find(node => node.type === "real-card").props.result.ticket.qrDataUrl, png);
  h.state.replies.push({ ...detail, ticket: { ...detail.ticket, status: "used", usedAt: at, qrDataUrl: null } });
  h.button("COMPARTIR").props.onClick(); await h.settle();
  assert.equal(h.state.calls.length, 2);
  assert.ok(h.state.calls.every(call => call.url === `/api/admin/extra-tickets/${id}`));
  assert.equal(nodes(h.render()).some(node => node.type === "button" && /COMPARTIR|Anular/.test(text(node))), false);
  assert.equal(h.find(node => node.type === "real-card").props.result.ticket.qrDataUrl, null);
});

test("extra annulment requires confirmation and exact receipt; ambiguous writes and stale callbacks never auto-repeat", async () => {
  for (const reply of [{ ticket: { id, status: "revoked", revokedAt: at } }, new Error("network")]) {
    const h = detailHarness(); await h.settle(); h.button("Anular entrada").props.onClick();
    const confirm = h.button("Confirmar anulación").props.onClick;
    h.state.replies.push(reply); confirm(); confirm(); await h.settle(); confirm(); await h.settle();
    const writes = h.state.calls.filter(call => call.init?.method === "POST"); assert.equal(writes.length, 1);
    assert.equal(writes[0].url, "/api/tickets/revoke"); assert.deepEqual(JSON.parse(writes[0].init.body), { ticketId: id });
    if (reply instanceof Error) { assert.equal(h.state.changed.length, 0); assert.equal(h.button("Confirmar anulación").props.disabled, true); }
    else { assert.equal(h.state.changed[0].status, "revoked"); assert.equal(h.find(node => node.type === "real-card").props.result.ticket.qrDataUrl, null); }
  }
});

test("quick share uses same real card offscreen, checks fresh QR, exports once and returns fallback to its parent", async () => {
  const originalDocument = globalThis.document, originalNavigator = globalThis.navigator;
  try {
    const card = { getAttribute: () => id, querySelector: () => ({ src: "", decode: async () => {} }) };
    globalThis.document = { getElementById: () => card, fonts: { ready: Promise.resolve() } };
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
    const h = detailHarness({ quick: true }); await h.settle(); await h.settle();
    const rendered = h.render(); assert.equal(rendered.props.inert, true); assert.equal(rendered.props["aria-hidden"], "true");
    assert.equal(h.state.calls.length, 2, "Initial read plus fresh export check, never a synthetic QR");
    assert.equal(h.state.outcomes.length, 1); assert.equal(h.state.outcomes[0].download.type, "image/png");
    assert.match(h.state.outcomes[0].download.name, /^diwo-extra-/);
    assert.equal(h.find(node => node.type === "real-card").props.result.ticket.id, id);
  } finally { globalThis.document = originalDocument; Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator }); }
});
