import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { ticketNavigation } from "../lib/ticket-gallery.ts";

const previousWindow = globalThis.window, previousElement = globalThis.Element;
after(() => {
  if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
  if (previousElement === undefined) delete globalThis.Element; else globalThis.Element = previousElement;
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
test("gallery uses only the current confirmed own order, preserves used/revoked positions and never exposes QR or other orders", () => {
  const ticket = { id: "second", orderId: "owned", eventId: "event" };
  const tickets = [{ id: "second", position: 2, status: "used" }, { id: "first", position: 1, status: "revoked" }];
  const order = { id: "owned", eventId: "event", status: "confirmed", tickets };
  assert.deepEqual(ticketNavigation([{ ...order, id: "different", tickets: [{ id: "secret", position: 1 }] }, order], ticket), {
    current: 1, hrefs: ["/ticket/first", "/ticket/second"],
  });
  assert.equal(tickets[0].id, "second", "No source-array mutation");
  for (const value of [{ ...order, status: "pending" }, { ...order, eventId: "foreign" }, { ...order, tickets: [] },
    { ...order, tickets: [tickets[0], tickets[0]] }]) assert.equal(ticketNavigation([value], ticket), null);
});

test("pager supports mouse drag/touch swipe plus accessible dots, ignores scroll/control gestures and does not cross boundaries", () => {
  const routes = [];
  globalThis.window = { location: { replace: () => { throw new Error("Must not reload the document"); } }, matchMedia: () => ({ matches: true }) };
  globalThis.Element = class { closest() { return false; } };
  const { TicketPager } = load("../components/ticket-pager.tsx", { react: { useRef: initial => ({ current: initial }), useState: initial => [initial, () => {}], useEffect() {} } });
  const select = (index, settled) => { routes.push(["/ticket/a", "/ticket/b", "/ticket/c"][index]); settled(); };
  const render = () => TicketPager({ navigation: { current: 1, hrefs: ["/ticket/a", "/ticket/b", "/ticket/c"] }, children: "card", onSelect: select });
  const view = render();
  const captured = new Set();
  let prevented = 0;
  const surface = { setPointerCapture: id => captured.add(id), hasPointerCapture: id => captured.has(id), releasePointerCapture: id => captured.delete(id),
    getBoundingClientRect: () => ({ width: 320, height: 400 }) };
  const event = (x, y, target = {}, pointerType = "touch") => ({ target, currentTarget: surface, pointerType,
    pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y, preventDefault: () => { prevented++; } });
  const all = nodes(view);
  const swipe = (dx, dy = 0, target = {}, pointerType = "touch") => {
    // A successful gesture changes the document; use fresh component state next.
    const current = nodes(render()).find(node => node.props?.onPointerDown);
    current.props.onPointerDown(event(100, 100, target, pointerType));
    current.props.onPointerMove(event(100 + dx, 100 + dy, target, pointerType));
    current.props.onPointerUp(event(100 + dx, 100 + dy, target, pointerType));
  };
  swipe(-80); swipe(80); swipe(-20); swipe(-80, 150);
  swipe(-80, 0, {}, "mouse");
  const control = new Element(); control.closest = () => true; swipe(-80, 0, control);
  assert.deepEqual(routes, ["/ticket/c", "/ticket/a", "/ticket/c"]);
  assert.equal(prevented, 1, "Only a mouse drag prevents native selection; controls and touch stay native");
  assert.equal(captured.size, 0);
  assert.equal(all.filter(node => node.type === "a").length, 3);
  assert.equal(all.find(node => node.props?.["aria-current"] === "page").props.href, "/ticket/b");
  let dotPrevented = false;
  all.find(node => node.type === "a").props.onClick({ button: 0, preventDefault: () => { dotPrevented = true; } });
  assert.equal(dotPrevented, true); assert.equal(routes.at(-1), "/ticket/a");
  const first = TicketPager({ navigation: { current: 0, hrefs: ["/ticket/a", "/ticket/b"] }, children: "card", onSelect: select });
  const firstGesture = nodes(first).find(node => node.props?.onPointerDown);
  firstGesture.props.onPointerDown(event(100, 100));
  firstGesture.props.onPointerUp(event(200, 100));
  firstGesture.props.onPointerDown(event(100, 100, {}, "mouse"));
  firstGesture.props.onPointerCancel(event(100, 100, {}, "mouse"));
  firstGesture.props.onPointerUp(event(0, 100, {}, "mouse"));
  assert.equal(routes.length, 4); assert.equal(captured.size, 0);
  assert.equal(nodes(TicketPager({ children: "card", onSelect: select })).some(node => node.type === "a"), false);
});

test("drag exposes the incoming card progressively, locks actions and completes navigation only after the slide transition", () => {
  const routes = [], slots = [], timers = new Map();
  let index = 0, sequence = 0;
  const react = {
    useRef: initial => { const slot = index++; return slots[slot] ?? (slots[slot] = { current: initial }); },
    useState: initial => { const slot = index++; if (!(slot in slots)) slots[slot] = initial; return [slots[slot], value => { slots[slot] = value; }]; },
    useEffect() {},
  };
  globalThis.window = { location: { replace: () => { throw new Error("Must not reload the document"); } }, matchMedia: () => ({ matches: false }),
    setTimeout: callback => { const key = ++sequence; timers.set(key, callback); return key; }, clearTimeout: key => timers.delete(key) };
  globalThis.Element = class { closest() { return false; } };
  const { TicketPager } = load("../components/ticket-pager.tsx", { react });
  const render = () => { index = 0; return TicketPager({ navigation: { current: 0, hrefs: ["/ticket/a", "/ticket/b"] },
    children: jsx.jsx("article", { "data-ticket-id": "a" }), next: jsx.jsx("article", { "data-ticket-id": "b" }), actions: jsx.jsx("button", { children: "Download" }),
    onSelect: (target, settled) => { routes.push(["/ticket/a", "/ticket/b"][target]); settled(); } }); };
  const captured = new Set(), surface = { setPointerCapture: key => captured.add(key), hasPointerCapture: key => captured.has(key), releasePointerCapture: key => captured.delete(key),
    getBoundingClientRect: () => ({ width: 320, height: 400 }) };
  const event = x => ({ target: {}, currentTarget: surface, pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, clientX: x, clientY: 100, preventDefault() {} });
  let view = render();
  let viewport = nodes(view).find(node => node.props?.onPointerDown);
  viewport.props.onPointerDown(event(200));
  viewport.props.onPointerMove(event(180));
  viewport.props.onPointerUp(event(180));
  view = render();
  const returning = nodes(view).find(node => node.props?.className === "diwo-ticket-track");
  assert.equal(returning.props.style.transform, "translate3d(0px, 0, 0)");
  const backTarget = {}; returning.props.onTransitionEnd({ target: backTarget, currentTarget: backTarget, propertyName: "transform" });
  assert.equal(routes.length, 0); assert.equal(timers.size, 0);
  view = render(); viewport = nodes(view).find(node => node.props?.onPointerDown);
  viewport.props.onPointerDown(event(200));
  viewport.props.onPointerMove(event(120));
  view = render();
  assert.equal(nodes(view).find(node => node.props?.className === "diwo-ticket-track").props.style.transform, "translate3d(-80px, 0, 0)");
  const incoming = nodes(view).find(node => node.props?.className === "diwo-ticket-slide diwo-ticket-slide-next");
  assert.equal(incoming.props.children.props["data-ticket-id"], "b");
  assert.equal(incoming.props["aria-hidden"], "true");
  assert.equal(nodes(view).find(node => node.type === "div" && node.props?.children?.type === "button").props.inert, true);
  viewport = nodes(view).find(node => node.props?.onPointerUp);
  viewport.props.onPointerUp(event(120));
  view = render();
  const track = nodes(view).find(node => node.props?.className === "diwo-ticket-track");
  assert.equal(track.props.style.transform, "translate3d(-336px, 0, 0)");
  assert.equal(routes.length, 0, "No hard cut before the incoming card finishes sliding");
  const target = {}; track.props.onTransitionEnd({ target, currentTarget: target, propertyName: "transform" });
  assert.deepEqual(routes, ["/ticket/b"]); assert.equal(timers.size, 0); assert.equal(captured.size, 0);
});

function pagerHarness({ reduced = true, throwOnSelect = false, heights = {} } = {}) {
  const slots = [], effects = [], timers = new Map(), routes = [], decoded = [], imageNodes = new Map();
  const hrefs = ["/ticket/a", "/ticket/b", "/ticket/c"];
  let slot = 0, current = 1, timerId = 0;
  const react = {
    useRef: initial => { const index = slot++; return slots[index] ?? (slots[index] = { current: initial }); },
    useState: initial => { const index = slot++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { slots[index] = value; }]; },
    useEffect: callback => { effects.push(callback); },
  };
  globalThis.window = { matchMedia: () => ({ matches: reduced }),
    setTimeout: callback => { timers.set(++timerId, callback); return timerId; }, clearTimeout: id => timers.delete(id) };
  globalThis.Element = class { closest() { return false; } };
  const captured = new Set();
  const surface = { getBoundingClientRect: () => ({ width: 320, height: 400 }),
    setPointerCapture: id => captured.add(id), hasPointerCapture: id => captured.has(id), releasePointerCapture: id => captured.delete(id) };
  const { TicketPager } = load("../components/ticket-pager.tsx", { react });
  const card = index => jsx.jsx("article", { "data-ticket-id": hrefs[index] }, hrefs[index]);
  const render = () => {
    slot = 0; effects.length = 0;
    return TicketPager({ navigation: { current, hrefs }, children: card(current), previous: card(current - 1), next: card(current + 1), actions: "actions",
      onSelect: (index, settled) => { if (throwOnSelect) throw new Error("selection_failed"); current = index; routes.push(index); settled(); } });
  };
  const event = (dx = 0, dy = 0, timeStamp = 0, pointerId = 1) => ({ target: {}, currentTarget: surface,
    clientX: 200 + dx, clientY: 100 + dy, pointerId, pointerType: "touch", isPrimary: true, button: 0,
    timeStamp, cancelable: true, preventDefault() {} });
  const viewport = () => nodes(render()).find(node => node.props?.onPointerDown);
  return { render, viewport, event, timers, routes, surface, decoded, captured,
    flush: () => { for (const callback of [...timers.values()]) callback(); },
    mountImages: view => {
      for (const node of nodes(view).filter(node => node.props?.className?.startsWith("diwo-ticket-slide"))) {
        if (!node.props.ref) continue;
        if (!imageNodes.has(node.key)) imageNodes.set(node.key, { src: node.key, decode: async () => { decoded.push(node.key); } });
        node.props.ref.current = { ...surface, getBoundingClientRect: () => ({ width: 320, height: heights[node.key] ?? 400 }), querySelectorAll: () => [imageNodes.get(node.key)] };
      }
      for (const callback of effects) callback();
    },
  };
}

test("a horizontal swipe tolerates later vertical drift, while genuine vertical scroll remains native", () => {
  const h = pagerHarness();
  let view = h.viewport();
  view.props.onPointerDown(h.event());
  view.props.onPointerMove(h.event(-15, 4, 20));
  view.props.onPointerMove(h.event(-50, 60, 100));
  view.props.onPointerUp(h.event(-50, 65, 120));
  assert.deepEqual(h.routes, [2]);
  view = h.viewport();
  view.props.onPointerDown(h.event());
  view.props.onPointerMove(h.event(5, 40, 20));
  view.props.onPointerUp(h.event(80, 120, 100));
  assert.deepEqual(h.routes, [2]);
  assert.equal(h.captured.size, 0);
});

test("rightward swipe keeps viewport height stable even when the previous ticket is shorter; cancellation unlocks the next gesture", () => {
  const h = pagerHarness({ reduced: false, heights: { "/ticket/a": 280, "/ticket/b": 600, "/ticket/c": 720 } });
  h.mountImages(h.render());
  let view = h.viewport();
  view.props.onPointerDown(h.event());
  view.props.onPointerMove(h.event(80, 5, 100));
  assert.equal(h.viewport().props.style.height, 600, "Dragging must not shrink the document and move its scroll position");
  view.props.onPointerCancel(h.event(80, 5, 110));
  h.flush();
  assert.equal(h.viewport().props.style.height, undefined);
  assert.equal(h.captured.size, 0);
  view = h.viewport();
  view.props.onPointerDown(h.event());
  view.props.onPointerMove(h.event(80, 5, 200));
  view.props.onPointerUp(h.event(80, 5, 210));
  assert.equal(h.viewport().props.style.height, 600, "Keep the same height through the horizontal transition");
  h.flush();
  assert.deepEqual(h.routes, [0]);
  assert.equal(h.viewport().props.style.height, undefined);
  assert.equal(h.captured.size, 0);
  const css = readFileSync(new URL("../components/owned-ticket.css", import.meta.url), "utf8");
  assert.match(css, /\.diwo-ticket-viewport\s*\{[^}]*overflow:\s*clip/);
  assert.match(css, /\.diwo-ticket-viewport\s*\{[^}]*overflow-anchor:\s*none/);
});

test("short deliberate flicks and modest drags select once; slow short movement does not", () => {
  for (const [distance, elapsed, expected] of [[-28, 40, 1], [-28, 400, 0], [-40, 400, 1], [-12, 15, 0]]) {
    const h = pagerHarness();
    const view = h.viewport();
    view.props.onPointerDown(h.event());
    view.props.onPointerMove(h.event(distance, 2, elapsed));
    view.props.onPointerUp(h.event(distance, 2, elapsed));
    assert.equal(h.routes.length, expected, `${distance}px in ${elapsed}ms`);
  }
});

test("a new swipe can interrupt snap-back; unrelated lost capture cannot cancel the active pointer", () => {
  const h = pagerHarness({ reduced: false });
  let view = h.viewport();
  view.props.onPointerDown(h.event()); view.props.onPointerMove(h.event(-20, 0, 400)); view.props.onPointerUp(h.event(-20, 0, 400));
  assert.equal(h.timers.size, 1);
  view = h.viewport();
  view.props.onPointerDown(h.event());
  assert.equal(h.timers.size, 0, "Old snap-back fallback must not finish a later gesture");
  view.props.onPointerMove(h.event(-40, 0, 400));
  view.props.onLostPointerCapture(h.event(0, 0, 410, 2));
  view.props.onPointerUp(h.event(-40, 0, 420));
  h.flush();
  assert.deepEqual(h.routes, [2]);
  assert.equal(h.timers.size, 0);
});

test("capture/selection errors release the motion lock rather than disabling all subsequent gestures", () => {
  const h = pagerHarness();
  const view = h.viewport();
  const capture = h.surface.setPointerCapture;
  h.surface.setPointerCapture = () => { throw new Error("pointer_no_longer_active"); };
  assert.doesNotThrow(() => view.props.onPointerDown(h.event()));
  h.surface.setPointerCapture = capture;
  view.props.onPointerDown(h.event()); view.props.onPointerUp(h.event(-50, 0, 400));
  assert.deepEqual(h.routes, [2]);
  const failing = pagerHarness({ throwOnSelect: true });
  const failed = failing.viewport();
  failed.props.onPointerDown(failing.event());
  assert.doesNotThrow(() => failed.props.onPointerUp(failing.event(-50, 0, 400)));
  assert.equal(nodes(failing.render()).find(node => node.props?.children === "actions").props.inert, false);
});

test("neighbor images decode before selection and slide/card keys follow the ticket instead of its slot", () => {
  const h = pagerHarness();
  const before = h.render(); h.mountImages(before);
  assert.equal(h.decoded.length, 3, "Prepare the current and both adjacent cards before any drag");
  const incoming = nodes(before).find(node => node.props?.className === "diwo-ticket-slide diwo-ticket-slide-next");
  const view = h.viewport(); view.props.onPointerDown(h.event()); view.props.onPointerUp(h.event(-50, 0, 400));
  const after = h.render(); h.mountImages(after);
  const active = nodes(after).find(node => node.props?.className === "diwo-ticket-slide");
  assert.equal(active.key, incoming.key);
  assert.equal(active.props.children.key, incoming.props.children.key);
  assert.equal(active.props.inert, undefined);
  assert.equal(active.props["aria-hidden"], undefined);
  assert.equal(h.decoded.length, 3, "Do not decode the prepared image again when its slide becomes active");
  const css = readFileSync(new URL("../components/owned-ticket.css", import.meta.url), "utf8");
  assert.match(css, /touch-action:\s*pan-y pinch-zoom/);
  assert.match(css, /-webkit-user-select:\s*none/);
});

test("actual ticket route asks only for buyer overview and withholds gallery when ownership mapping cannot be read", async () => {
  const current = { id: "00000000-0000-4000-8000-000000000001", orderId: "owned", eventId: "event" };
  let result = { ok: true, orders: [{ id: "owned", eventId: "event", status: "confirmed", tickets: [{ id: current.id, position: 1 }] }] };
  const Page = load("../app/ticket/[id]/page.tsx", {
    "@clerk/nextjs/server": { auth: async () => ({ userId: "user_verified" }) },
    "next/navigation": { redirect() {}, notFound() {} }, "@/lib/local-access": { hasConfiguredClerkKeys: () => true, isLocalPaymentPreview: () => false },
    "@/lib/app-authorization": { requireAdminAccess: async () => ({ ok: false }) },
    "@/lib/owned-ticket-reader": { readOwnedTicket: async () => ({ ok: true, ticket: current }) },
    "@/lib/order-reads": { readOrderOverview: async scope => { assert.equal(scope, "buyer"); return result; } },
    "@/lib/ticket-gallery": { ticketNavigation }, "@/components/owned-ticket-detail": { OwnedTicketDetail: "detail" },
  }).default;
  const props = { params: Promise.resolve({ id: current.id }) };
  assert.deepEqual((await Page(props)).props.navigation, { current: 0, hrefs: [`/ticket/${current.id}`] });
  result = { ok: false };
  assert.equal((await Page(props)).props.navigation, null);
});

test("opening a ticket does not block on neighbor reads; the client loads neighbors through its signed endpoint", async () => {
  const current = "00000000-0000-4000-8000-000000000002", previous = "00000000-0000-4000-8000-000000000001", next = "00000000-0000-4000-8000-000000000003";
  const calls = [];
  const Page = load("../app/ticket/[id]/page.tsx", {
    "@clerk/nextjs/server": { auth: async () => ({ userId: "user_verified" }) },
    "next/navigation": { redirect() {}, notFound() {} },
    "@/lib/local-access": { hasConfiguredClerkKeys: () => true, isLocalPaymentPreview: () => false },
    "@/lib/app-authorization": { requireAdminAccess: async () => ({ ok: false }) },
    "@/lib/owned-ticket-reader": { readOwnedTicket: async id => { calls.push(id); return { ok: true, technical: false,
      ticket: { id, orderId: id === next ? "different-order" : "owned", eventId: "event" } }; } },
    "@/lib/order-reads": { readOrderOverview: async scope => { assert.equal(scope, "buyer"); return { ok: true, orders: [{ id: "owned", eventId: "event", status: "confirmed",
      tickets: [previous, current, next].map((id, position) => ({ id, position: position + 1 })) }] }; } },
    "@/lib/ticket-gallery": { ticketNavigation }, "@/components/owned-ticket-detail": { OwnedTicketDetail: "detail" },
  }).default;
  const view = await Page({ params: Promise.resolve({ id: current }) });
  assert.deepEqual(calls, [current]);
  assert.equal(view.props.adjacent, undefined);
  assert.deepEqual(view.props.navigation.hrefs, [previous, current, next].map(id => `/ticket/${id}`));
});

test("opening retained fixtures redirects only their verified local admin to the clean design; real/foreign/Production remain unchanged", async () => {
  const id = "00000000-0000-4000-8000-000000000002";
  const state = { local: true, admin: true, signed: true, roleChecks: 0, reads: 0,
    detail: { ok: true, technical: true, ticket: { id, orderId: "owned", eventId: "event" } } };
  const Page = load("../app/ticket/[id]/page.tsx", {
    "@clerk/nextjs/server": { auth: async () => ({ userId: state.signed ? "user_verified" : null }) },
    "next/navigation": { redirect: path => { throw new Error(`redirect:${path}`); }, notFound: () => { throw new Error("not_found"); } },
    "@/lib/local-access": { hasConfiguredClerkKeys: () => true, isLocalPaymentPreview: () => state.local },
    "@/lib/app-authorization": { requireAdminAccess: async () => { state.roleChecks++; return { ok: state.admin }; } },
    "@/lib/owned-ticket-reader": { readOwnedTicket: async () => { state.reads++; return state.detail; } },
    "@/lib/order-reads": { readOrderOverview: async scope => {
      assert.equal(scope, "buyer"); return { ok: true, orders: [{ id: "owned", eventId: "event", status: "confirmed",
        tickets: [{ id: "first", position: 1 }, { id, position: 2 }] }] };
    } },
    "@/lib/ticket-gallery": { ticketNavigation }, "@/components/owned-ticket-detail": { OwnedTicketDetail: "detail" },
  }).default;
  const props = { params: Promise.resolve({ id }) };
  await assert.rejects(Page(props), /redirect:\/ticket\/design\?entry=2/);
  assert.equal(state.reads, 1); assert.equal(state.roleChecks, 1);
  const original = await Page({ ...props, searchParams: Promise.resolve({ original: "1" }) });
  assert.equal(original.props.result.technical, true); assert.equal(state.roleChecks, 1);
  state.local = false;
  assert.equal((await Page(props)).props.result.technical, true); assert.equal(state.roleChecks, 1);
  state.local = true; state.admin = false;
  assert.equal((await Page(props)).props.result.technical, true);
  state.admin = true; state.detail = { ...state.detail, technical: false };
  assert.equal((await Page(props)).props.result.technical, false);
  state.detail = { ok: false, status: 404 };
  const checks = state.roleChecks;
  await assert.rejects(Page(props), /not_found/); assert.equal(state.roleChecks, checks);
  state.signed = false; const reads = state.reads;
  await assert.rejects(Page(props), /redirect:\/sign-in/); assert.equal(state.reads, reads);
});
