import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { ticketNavigation } from "../lib/ticket-gallery.ts";
import { withRequestDeadline } from "../lib/request-deadline.ts";

function load(path, deps) {
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", source)(name => {
    if (name === "react/jsx-runtime") return jsx;
    assert.ok(name in deps, `Unexpected ${name}`); return deps[name];
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
const icons = Object.fromEntries(["ArrowRight", "CircleCheck", "Clock3", "CircleX", "UserRound"].map(name => [name, "svg"]));
const { ConfirmedOrderCard } = load("../components/confirmed-order-card.tsx", { "next/link": { default: "a" }, "lucide-react": icons });
const { CancelledOrderCard } = load("../components/cancelled-order-card.tsx", { "lucide-react": icons });
const first = { id: "11111111-1111-4111-8111-111111111111", position: 1, name: "Juan Calvo Vera", status: "valid" };
const second = { id: "22222222-2222-4222-8222-222222222222", position: 2, name: "Lucía Gómez", status: "valid" };
const order = { id: "order", eventId: "event", reference: "DIWO-ABCDEF123456", quantity: 2, totalCents: 1000,
  status: "confirmed", actualEvent: true, technical: false, eventTitle: "DIWO X 2.0", names: [first.name, second.name], tickets: [second, first] };

test("closed card shows the exact reference, quantity, amount and attendee list without artwork or actions", () => {
  for (const status of ["cancelled", "rejected"]) {
    const view = CancelledOrderCard({ order: { ...order, status } });
    const content = text(view).replace(/\s+/g, " ");
    for (const value of ["Solicitud cancelada", order.reference, "2 entradas", "Importe total", "10,00", `1 × ${first.name}`, `1 × ${second.name}`, "Esta solicitud ha sido cancelada."]) {
      assert.ok(content.includes(value), value);
    }
    assert.equal(nodes(view).some(node => ["img", "a", "button"].includes(node.type)), false);
    assert.equal(nodes(view).find(node => node.props?.className === "diwo-pending-state is-cancelled").type, "p");
    assert.equal(nodes(view).filter(node => node.type === "li").length, 2);
    assert.equal(view.props.children.at(-1).props.children, "Esta solicitud ha sido cancelada.");
  }
  const single = CancelledOrderCard({ order: { ...order, reference: "KVQV", quantity: 1, totalCents: 500, names: ["Álex de la Peña"] } });
  assert.match(text(single), /1\s+entrada/);
  assert.match(text(single), /5,00/);
  assert.match(text(single), /KVQV/);
  assert.deepEqual(nodes(single).filter(node => node.type === "li").map(node => text(node).replace(/\s+/g, " ")), ["1 × Álex de la Peña"]);
  assert.match(text(CancelledOrderCard({ order: { ...order, technical: true } })), /Prueba técnica conservada/);
});

test("closed card preserves the existing dark card background and uses a translucent red status", () => {
  const css = readFileSync(new URL("../components/ticket-request.css", import.meta.url), "utf8");
  assert.match(css, /\.diwo-cancelled-card\s*\{[^}]*background:\s*var\(--card\)/);
  assert.match(css, /\.diwo-pending-state\.is-cancelled\s*\{[^}]*background:\s*rgb\(248 113 113 \/ 12%\);\s*color:\s*#f87171/);
});

test("confirmed personal order follows reference and each entire attendee row links to its exact ticket in position order", () => {
  const view = ConfirmedOrderCard({ order });
  const content = text(view).replace(/\s+/g, " ");
  for (const value of ["Entradas disponibles", "DIWO-ABCDEF123456", "2 entradas", "10,00", first.name, second.name]) assert.ok(content.includes(value), value);
  const links = nodes(view).filter(node => node.type === "a");
  assert.deepEqual(links.map(link => link.props.href), [`/ticket/${first.id}`, `/ticket/${second.id}`]);
  assert.deepEqual(links.map(link => link.props["aria-label"]), ["Ver entrada de Juan Calvo Vera, 1 de 2", "Ver entrada de Lucía Gómez, 2 de 2"]);
  assert.equal(links.every(link => link.props.className === "diwo-issued-entry"), true);
  assert.equal(links.every(link => text(link).includes("Ver entrada")), true);
  assert.equal(order.tickets[0].id, second.id, "Rendering never reorders the source projection");
  assert.equal(nodes(view).some(node => node.type === "img" || node.type === "button" || node.props?.href?.startsWith("/request")), false);
  assert.equal(nodes(view).filter(node => node.props?.className?.includes("is-available")).length, 1);
});

test("used/revoked and retained technical entries stay readable but cannot all appear available", () => {
  for (const status of ["used", "revoked"]) {
    const view = ConfirmedOrderCard({ order: { ...order, tickets: [{ ...first, status }, { ...second, status }] } });
    assert.equal(text(view).includes("Entradas disponibles"), false);
    assert.equal(nodes(view).filter(node => node.type === "a").length, 2);
    assert.equal(nodes(view).filter(node => node.props?.className === `diwo-issued-entry-state is-${status}`).length, 2);
    assert.match(text(view), status === "used" ? /Entradas utilizadas/ : /Entradas anuladas/);
  }
  const mixed = ConfirmedOrderCard({ order: { ...order, tickets: [first, { ...second, status: "revoked" }] } });
  assert.match(text(mixed), /Entradas disponibles/); assert.match(text(mixed), /Anulada · No permite el acceso/);
  for (const flags of [{ technical: true }, { actualEvent: false }]) {
    const view = ConfirmedOrderCard({ order: { ...order, ...flags } });
    assert.equal(text(view).includes("Entradas disponibles"), false);
    if (flags.technical) assert.match(text(view), /Prueba técnica conservada/);
  }
  const single = ConfirmedOrderCard({ order: { ...order, quantity: 1, totalCents: 500, tickets: [first] } });
  assert.match(text(single), /1\s+entrada/); assert.match(text(single), /5,00/);
});

test("overview uses confirmed design only for paid orders and preserves pending/closed/error/empty and buyer authorization scope", async () => {
  let result = { ok: true, orders: [order, { ...order, id: "pending", status: "pending" }, { ...order, id: "closed", status: "cancelled" }, { ...order, id: "rejected", status: "rejected" }] };
  const Page = load("../app/ticket/page.tsx", {
    "@clerk/nextjs/server": { auth: async () => ({ userId: "user_verified" }) },
    "next/navigation": { redirect: () => { throw new Error("unexpected redirect"); } },
    "@/lib/local-access": { hasConfiguredClerkKeys: () => true },
    "@/lib/order-reads": { readOrderOverview: async scope => { assert.equal(scope, "buyer"); return result; } },
    "@/components/confirmed-order-card": { ConfirmedOrderCard },
    "@/components/cancelled-order-card": { CancelledOrderCard },
    "@/components/pending-order-card": { PendingOrderCard: "pending-order" },
    "@/components/tickets-heading": { TicketsHeading: load("../components/tickets-heading.tsx", {}).TicketsHeading },
    "@/components/empty-tickets": { EmptyTickets: "empty" }, "@/components/refresh-orders": { RefreshOrders: "refresh" },
  }).default;
  const view = await Page(); assert.match(text(view), /SOLICITUDES Y ENTRADAS/);
  assert.equal(nodes(view).filter(node => node.props?.className === "diwo-issued-card").length, 1);
  assert.equal(nodes(view).filter(node => node.type === "pending-order").length, 1);
  assert.match(text(view), /solicitud ha sido cancelada/);
  assert.equal(nodes(view).filter(node => node.props?.className === "diwo-pending-card diwo-cancelled-card").length, 2);
  result = { ok: false, status: 502 };
  assert.equal(nodes(await Page()).some(node => node.type === "a"), false);
  result = { ok: true, orders: [] }; assert.equal((await Page()).type, "empty");
});

test("clicking the second overview row opens the actual gallery at Entrada 2 de 2, never the first or another order", async () => {
  const links = nodes(ConfirmedOrderCard({ order })).filter(node => node.type === "a");
  const id = links[1].props.href.slice("/ticket/".length);
  const Page = load("../app/ticket/[id]/page.tsx", {
    "@clerk/nextjs/server": { auth: async () => ({ userId: "user_verified" }) },
    "next/navigation": { redirect: () => { throw new Error("unexpected redirect"); }, notFound: () => { throw new Error("unexpected notFound"); } },
    "@/lib/local-access": { hasConfiguredClerkKeys: () => true, isLocalPaymentPreview: () => false },
    "@/lib/app-authorization": { requireAdminAccess: async () => ({ ok: false }) },
    "@/lib/owned-ticket-reader": { readOwnedTicket: async target => ({ ok: true, technical: false, ticket: {
      ...[first, second].find(ticket => ticket.id === target), orderId: order.id, eventId: order.eventId,
    } }) },
    "@/lib/order-reads": { readOrderOverview: async scope => {
      assert.equal(scope, "buyer"); return { ok: true, orders: [{ ...order, id: "other", tickets: [{ id: "foreign", position: 1 }] }, order] };
    } },
    "@/lib/ticket-gallery": { ticketNavigation }, "@/components/owned-ticket-detail": { OwnedTicketDetail: "detail" },
  }).default;
  const detail = await Page({ params: Promise.resolve({ id }) });
  assert.equal(detail.props.result.ticket.id, second.id); assert.equal(detail.props.navigation.current, 1);
  assert.deepEqual(detail.props.navigation.hrefs, [`/ticket/${first.id}`, `/ticket/${second.id}`]);
  const react = { useRef: value => ({ current: value }), useState: value => [typeof value === "function" ? value() : value, () => {}], useEffect() {}, useCallback: fn => fn };
  const { TicketPager } = load("../components/ticket-pager.tsx", { react });
  const { TicketGallery } = load("../components/ticket-gallery.tsx", {
    react, "@clerk/nextjs": { useAuth: () => ({ userId: "user_verified", isLoaded: true }) },
    "@/components/owned-ticket-card": { OwnedTicketCard: "ticket-card" },
    "@/components/owned-ticket-actions": { OwnedTicketActions: "ticket-actions" },
    "@/components/ticket-pager": { TicketPager },
    "@/lib/ticket-carousel-model": { ticketIdFromHref: href => href.slice("/ticket/".length), carouselTicket: () => null },
    "@/lib/request-deadline": { withRequestDeadline },
  });
  const tree = TicketGallery({ initial: detail.props.result, navigation: detail.props.navigation, adjacent: detail.props.adjacent });
  const rendered = nodes(tree);
  assert.equal(text(rendered.find(node => node.type === "h1")), "Entrada 2 de 2");
  const active = rendered.find(node => node.props?.className === "diwo-ticket-slide");
  assert.equal(active.props.children.props.result.ticket.id, second.id);
  assert.equal(rendered.find(node => node.props?.["aria-current"] === "page").props.href, `/ticket/${second.id}`);
});
