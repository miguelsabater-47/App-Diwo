import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as requestState from "../lib/order-request-state.ts";
import * as buyerContext from "../lib/buyer-request-context.ts";

const originalStorage = globalThis.sessionStorage;
after(() => { if (originalStorage === undefined) delete globalThis.sessionStorage; else globalThis.sessionStorage = originalStorage; });
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
const { PendingOrderCard } = load("../components/pending-order-card.tsx", {
  "next/link": { default: "a" }, "next/image": { default: "img" }, "lucide-react": { Clock3: "svg", Hourglass: "svg", ArrowRight: "svg" },
});
const { TicketsHeading } = load("../components/tickets-heading.tsx", {});
const id = "00000000-0000-4000-8000-000000000001", eventId = "00000000-0000-4000-8000-000000000002";
const order = { id, reference: "DIWO-ABCDEF123456", quantity: 2, totalCents: 1000, names: ["First attendee", "Second attendee"],
  actualEvent: true, technical: false, eventTitle: "DIWO X 2.0" };

test("pending card follows reference with the existing poster, exact request data and a per-request instructions link", () => {
  const view = PendingOrderCard({ order });
  const content = text(view);
  for (const expected of ["Solicitud pendiente", "DIWO-ABCDEF123456", "First attendee", "Second attendee", "10,00"]) assert.ok(content.includes(expected), expected);
  const all = nodes(view);
  assert.equal(text(all.find(node => node.props?.className === "diwo-pending-reference")).replace(/\s/g, ""), "#DIWO-ABCDEF123456");
  assert.equal(all.find(node => node.type === "img").props.src, "/foto-de-perfil-wpp.jpg");
  assert.equal(all.find(node => node.type === "img").props.height, 350);
  assert.equal(content.includes("Estamos revisando tu solicitud"), false);
  assert.equal(all.find(node => node.type === "a").props.href, `/ticket/payment/${id}`);
  assert.match(text(all.find(node => node.type === "a")), /Ver instrucciones de pago/);
  assert.equal(content.includes("Ver solicitud"), false);
  assert.match(all.find(node => node.type === "a").props["aria-label"], /DIWO-ABCDEF123456/);
  assert.equal(all.some(node => node.type === "button"), false);
  assert.equal(content.includes("confirmado"), false, "Pending cannot imply paid/issued");
  const second = PendingOrderCard({ order: { ...order, id: eventId, reference: "DIWO-111111111111", quantity: 1, totalCents: 500, names: ["Third attendee"] } });
  assert.equal(nodes(second).find(node => node.type === "a").props.href, `/ticket/payment/${eventId}`);
  assert.match(text(second), /5,00/); assert.equal(text(second).includes("Second attendee"), false);
});

test("technical/other-event pending requests cannot masquerade as actual-party artwork or admissions", () => {
  for (const flags of [{ technical: true }, { actualEvent: false }]) {
    const view = PendingOrderCard({ order: { ...order, ...flags } });
    assert.equal(nodes(view).some(node => node.type === "img"), false);
    if (flags.technical) assert.match(text(view), /Prueba técnica conservada/);
  }
});

test("pending overview prototype is local current-admin only and uses the same card without orders or draft IDs", async () => {
  const state = { local: true, admin: true, checks: 0 };
  const Page = load("../app/ticket/preview/page.tsx", {
    "next/navigation": { notFound: () => { throw new Error("not_found"); } },
    "@/lib/local-access": { isLocalPaymentPreview: () => state.local },
    "@/lib/app-authorization": { requireAdminAccess: async () => { state.checks++; return { ok: state.admin }; } },
    "@/components/pending-order-card": { PendingOrderCard }, "@/components/tickets-heading": { TicketsHeading },
    "@/components/new-order-link": { NewOrderLink: "new-order" },
  }).default;
  const view = await Page();
  assert.match(text(view), /SOLICITUDES Y ENTRADAS/);
  assert.equal(nodes(view).find(node => node.type === "a").props.href, "/ticket/payment/preview?quantity=2");
  assert.equal(nodes(view).some(node => node.type === "new-order" || node.props?.href === "/request"), false);
  state.admin = false; await assert.rejects(Page(), /not_found/);
  state.local = false; const calls = state.checks;
  await assert.rejects(Page(), /not_found/); assert.equal(state.checks, calls);
});

test("yellow new-request action retains exact acknowledged-draft clearing and never drops an ambiguous request", () => {
  const removed = [];
  const draft = JSON.stringify({ requestId: id, eventId, buyerName: "Buyer", attendeeNames: ["Buyer"] });
  globalThis.sessionStorage = { getItem: () => draft, removeItem: key => removed.push(key) };
  const { NewOrderLink } = load("../components/new-order-link.tsx", {
    "@clerk/nextjs": { useAuth: () => ({ userId: "user_current" }) },
    "@/components/buyer-flow-link": { BuyerFlowLink: "a" },
    "@/components/ui/button": { Button: "button" }, "lucide-react": { Ticket: "svg" }, "@/lib/order-request-state": requestState,
    "@/lib/buyer-request-context": buyerContext,
  });
  const recorded = [{ id, eventId, buyerName: "Buyer", names: ["Buyer"], status: "pending" }];
  const button = NewOrderLink({ eventId, recorded });
  assert.match(button.props.className, /diwo-home-cta/); assert.match(text(button), /SOLICITAR MÁS ENTRADAS/);
  const link = nodes(button).find(node => node.type === "a");
  assert.equal(link.props.href, "/request");
  assert.equal(removed.length, 0, "Rendering/prefetching the link must not clear any draft");
  assert.equal(link.props.onClick, undefined, "Modifier clicks must not clear this tab's draft");
  link.props.onNavigate();
  assert.deepEqual(removed, [`diwo.order-submission.v1.user_current.${eventId}`]);
  removed.length = 0;
  nodes(NewOrderLink({ eventId, recorded: [] })).find(node => node.type === "a").props.onNavigate();
  assert.equal(removed.length, 0);
  for (const changed of [{ ...recorded[0], eventId: id }, { ...recorded[0], names: ["Different payload"] }, { ...recorded[0], buyerName: "Another buyer" }]) {
    nodes(NewOrderLink({ eventId, recorded: [changed] })).find(node => node.type === "a").props.onNavigate(); assert.equal(removed.length, 0);
  }
});
