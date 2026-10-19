import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as exportHelpers from "../lib/owned-ticket-export.ts";
import * as ticketModel from "../lib/owned-ticket-model.ts";
import { withRequestDeadline } from "../lib/request-deadline.ts";

const original = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
after(() => { for (const [key, value] of Object.entries(original)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } });
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
const carouselModel = load("../lib/ticket-carousel-model.ts", { "./owned-ticket-export": exportHelpers, "./owned-ticket-model": ticketModel });
const ids = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000003"];
function entry(index) {
  return { ok: true, technical: false, ticket: { id: ids[index], orderId: "10000000-0000-4000-8000-000000000001", eventId: "20000000-0000-4000-8000-000000000001",
    attendeeName: `Attendee ${index + 1}`, status: "valid", issuedAt: "2026-10-17T12:00:00Z", usedAt: null, revokedAt: null,
    eventSlug: "diwo-x-2-2026", eventTitle: "DIWO X 2.0", startsAt: "2026-10-31T22:30:00Z", endsAt: "2026-11-01T06:00:00Z",
    timezone: "Europe/Madrid", publicLocation: "Casa de campo en Ceutí", unitPriceCents: 500, currency: "EUR",
    orderReference: "DIWO-123456ABCDEF", qrDataUrl: "data:image/png;base64,YWJj" } };
}
function nodes(node) {
  if (!node || typeof node !== "object") return [];
  return [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
}
function harness({ prototype = false, response = entry(2) } = {}) {
  const slots = [], effects = [], urls = [], requests = [];
  const actor = { userId: "user_verified", isLoaded: true };
  let index = 0;
  const react = {
    useRef: initial => { const slot = index++; return slots[slot] ?? (slots[slot] = { current: initial }); },
      useState: initial => { const slot = index++; if (!(slot in slots)) slots[slot] = typeof initial === "function" ? initial() : initial; return [slots[slot], value => { slots[slot] = typeof value === "function" ? value(slots[slot]) : value; }]; },
    useCallback: callback => callback,
    useEffect: callback => effects.push(callback),
  };
  globalThis.window = { history: { replaceState: (_state, _unused, href) => urls.push(href) },
    location: { replace: () => { throw new Error("No document navigation"); }, reload: () => { throw new Error("No document reload"); } },
    addEventListener() {}, removeEventListener() {} };
  globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  globalThis.fetch = async (url, options) => { requests.push([url, options]); return response?.httpStatus
    ? { ok: false, status: response.httpStatus } : { ok: true, status: 200, json: async () => response }; };
  const { TicketGallery } = load("../components/ticket-gallery.tsx", {
    react, "@clerk/nextjs": { useAuth: () => actor }, "@/components/owned-ticket-card": { OwnedTicketCard: "card" }, "@/components/owned-ticket-actions": { OwnedTicketActions: "actions" },
    "@/components/ticket-pager": { TicketPager: "pager" }, "@/lib/ticket-carousel-model": carouselModel,
    "@/lib/request-deadline": { withRequestDeadline },
  });
  const hrefs = prototype ? ["/ticket/design?entry=1", "/ticket/design?entry=2"] : ids.map(id => `/ticket/${id}`);
  return { urls, requests, actor,
    render: () => { index = 0; effects.length = 0; return TicketGallery({ initial: entry(0), navigation: { current: 0, hrefs },
      adjacent: { next: entry(1) }, designPreview: prototype }); },
    effects: () => { for (const callback of [...effects]) callback(); },
  };
}

test("cached selection switches card, export identity, counter and URL in place without document navigation or page fetch", () => {
  const h = harness({ prototype: true });
  let view = h.render(); h.effects();
  let settled = 0; view.props.onSelect(1, () => { settled++; });
  view = h.render(); h.effects();
  assert.equal(settled, 1); assert.equal(view.props.navigation.current, 1);
  assert.equal(view.props.children.props.result.ticket.id, ids[1]);
  assert.equal(view.props.children.props.active, true);
  assert.equal(nodes(view.props.actions).find(node => node.type === "actions").props.ticketId, ids[1]);
  assert.equal(view.props.previous.props.result.ticket.id, ids[0]);
  assert.deepEqual(h.urls, ["/ticket/design?entry=2"]); assert.equal(h.requests.length, 0);
});

test("restoring a bookmarked/history URL selects its verified cached ticket rather than the original first card", () => {
  const h = harness();
  window.location.pathname = `/ticket/${ids[1]}`; window.location.search = "";
  const view = h.render();
  assert.equal(view.props.navigation.current, 1);
  assert.equal(view.props.children.props.result.ticket.id, ids[1]);
  assert.equal(nodes(view.props.actions).find(node => node.type === "actions").props.ticketId, ids[1]);
  assert.equal(h.urls.length, 0); assert.equal(h.requests.length, 0);
});

test("uncached entry uses only the signed personal JSON API, validates the same order and never copies another request into the card", async () => {
  for (const foreign of [false, true]) {
    const data = entry(2); if (foreign) data.ticket.orderId = "foreign-order";
    const h = harness({ response: data });
    let view = h.render(); let settled = 0;
    view.props.onSelect(2, () => { settled++; });
    await new Promise(resolve => setImmediate(resolve));
    view = h.render();
    assert.equal(settled, 1); assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0][0], `/api/tickets/${ids[2]}`);
    assert.equal(h.requests[0][1].credentials, "same-origin"); assert.equal(h.requests[0][1].cache, "no-store");
    assert.equal(view.props.navigation.current, foreign ? 0 : 2);
    assert.equal(view.props.children.props.result.ticket.id, foreign ? ids[0] : ids[2]);
    assert.equal(h.urls.length, foreign ? 0 : 1);
  }
});

test("mobile gallery can verify and open a ticket without AbortSignal.any or timeout", async () => {
  const any = Object.getOwnPropertyDescriptor(AbortSignal, "any"), timeout = Object.getOwnPropertyDescriptor(AbortSignal, "timeout");
  Object.defineProperty(AbortSignal, "any", { configurable: true, value: undefined });
  Object.defineProperty(AbortSignal, "timeout", { configurable: true, value: undefined });
  try {
    const h = harness(); h.render().props.onSelect(2, () => {});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.requests.length, 1);
    assert.equal(h.render().props.children.props.result.ticket.id, ids[2]);
  } finally { Object.defineProperty(AbortSignal, "any", any); Object.defineProperty(AbortSignal, "timeout", timeout); }
});

test("authorization failure clears cached private cards instead of exposing another cached QR after account/session changes", async () => {
  const h = harness({ response: { httpStatus: 401 } });
  h.render().props.onSelect(1, () => {});
  h.render(); h.effects();
  await new Promise(resolve => setImmediate(resolve));
  const view = h.render();
  assert.equal(view.props.children.type, "p");
  assert.equal(nodes(view.props.actions).some(node => node.type === "actions"), false);
  const before = h.urls.length; view.props.onSelect(0, () => {});
  assert.equal(h.urls.length, before);
});

test("switching the Clerk account clears the old account's card cache without trusting client roles", () => {
  const h = harness({ prototype: true });
  h.render(); h.effects();
  h.actor.userId = "different_account";
  h.render(); h.effects();
  const view = h.render();
  assert.equal(view.props.children.type, "p");
  assert.equal(nodes(view.props.actions).some(node => node.type === "actions"), false);
  view.props.onSelect(1, () => {});
  assert.equal(h.urls.length, 0); assert.equal(h.requests.length, 0);
});

test("API projection parser rejects cross-order/event data and external QR URLs, accepts terminal state and strips private fields", () => {
  const anchor = entry(0), second = entry(1);
  const safe = carouselModel.carouselTicket({ ...second, rawSubject: "not-forwarded", ticket: { ...second.ticket, qrToken: "not-forwarded" } }, ids[1], anchor);
  assert.equal(safe.ticket.attendeeName, "Attendee 2"); assert.equal(JSON.stringify(safe).includes("not-forwarded"), false);
  for (const change of [{ orderId: "other" }, { eventId: "other" }, { id: ids[2] }, { qrDataUrl: "https://example.com/qr" }]) {
    assert.equal(carouselModel.carouselTicket({ ...second, ticket: { ...second.ticket, ...change } }, ids[1], anchor), null);
  }
  const used = carouselModel.carouselTicket({ ...second, ticket: { ...second.ticket, status: "used", usedAt: "2026-11-01T00:00:00Z", qrDataUrl: null } }, ids[1], anchor);
  assert.equal(used.ticket.status, "used"); assert.equal(used.ticket.qrDataUrl, null);
  assert.equal(carouselModel.ticketIdFromHref("/ticket/design?entry=2"), null);
  assert.equal(carouselModel.ticketIdFromHref("https://example.com/qr"), null);
});
