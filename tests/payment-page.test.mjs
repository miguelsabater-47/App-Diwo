import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

function load(path, dependencies) {
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", source)(name => {
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
const id = "00000000-0000-4000-8000-0000000000ab";
const other = "00000000-0000-4000-8000-000000000002";
const order = { id, status: "pending", reference: "DIWO-ABCDEF123456", quantity: 3, totalCents: 1500,
  names: ["One", "Two", "Three"], actualEvent: true, technical: false, eventTitle: "DIWO X 2.0", tickets: [] };
function harness() {
  const state = { configured: true, signed: true, localPreview: true, admin: true, adminChecks: 0, reads: 0,
    result: { ok: true, orders: [order] } };
  const navigation = {
    redirect: path => { throw new Error(`redirect:${path}`); }, notFound: () => { throw new Error("not_found"); },
  };
  const dependencies = {
    "@clerk/nextjs/server": { auth: async () => ({ userId: state.signed ? "user_verified" : null }) },
    "next/navigation": navigation,
    "@/lib/local-access": { hasConfiguredClerkKeys: () => state.configured, isLocalPaymentPreview: () => state.localPreview },
    "@/lib/app-authorization": { requireAdminAccess: async () => { state.adminChecks++; return { ok: state.admin }; } },
    "@/lib/order-reads": { readOrderOverview: async scope => { state.reads++; assert.equal(scope, "buyer"); return state.result; } },
    "@/lib/order-payment-state": { paymentPhone: () => "600000000" },
    "@/components/order-payment-details": { OrderPaymentDetails: "payment-details" },
    "@/components/refresh-orders": { RefreshOrders: "refresh" },
  };
  const Page = load("../app/ticket/payment/[id]/page.tsx", dependencies).default;
  const open = (value = id, quantity) => Page({ params: Promise.resolve({ id: value }), searchParams: Promise.resolve({ quantity }) });
  return { state, open, dependencies };
}

test("persistent payment read uses current actor's personal scope, exact owned order amount/reference; no query-driven substitution", async () => {
  const h = harness();
  h.state.result.orders = [order, { ...order, id: other, reference: "DIWO-111111111111", quantity: 1, totalCents: 500 }];
  const first = nodes(await h.open(id.toUpperCase(), "999")).find(node => node.type === "payment-details");
  assert.equal(first.props.reference, "DIWO-ABCDEF123456"); assert.equal(first.props.quantity, 3); assert.equal(first.props.totalCents, 1500);
  const second = nodes(await h.open(other)).find(node => node.type === "payment-details");
  assert.equal(second.props.reference, "DIWO-111111111111"); assert.equal(second.props.totalCents, 500);
  assert.equal(first.props.preview, false); assert.equal(first.props.requestCreated, true);
  assert.equal(h.state.reads, 2); assert.equal(h.state.adminChecks, 0);
});

test("foreign/missing/malformed, anonymous and closed orders never reveal payment instructions", async () => {
  const h = harness();
  await assert.rejects(h.open("invalid"), /not_found/); assert.equal(h.state.reads, 0);
  await assert.rejects(h.open(other), /not_found/);
  h.state.signed = false; await assert.rejects(h.open(), /redirect:\/sign-in/);
  h.state.signed = true; h.state.configured = false; await assert.rejects(h.open(), /redirect:\/setup/);
  h.state.configured = true;
  for (const status of ["confirmed", "cancelled", "rejected"]) {
    h.state.result = { ok: true, orders: [{ ...order, status }] };
    await assert.rejects(h.open(), /redirect:\/ticket$/);
  }
  h.state.result = { ok: false, status: 502 };
  const failed = await h.open(); assert.equal(failed.props.role, "alert");
  assert.equal(nodes(failed).some(node => node.type === "payment-details"), false);
});

test("clean prototype is local current-admin only and cannot read orders or accept arbitrary payment data", async () => {
  const h = harness();
  const preview = await h.open("preview", "151");
  assert.equal(preview.props.preview, true); assert.equal(preview.props.quantity, 151); assert.equal(preview.props.totalCents, 75500);
  assert.equal(preview.props.requestCreated, undefined); assert.equal(preview.props.reference, "A7K9");
  assert.equal(h.state.reads, 0); assert.equal(h.state.adminChecks, 1);
  for (const bad of ["0", "-1", "1.5", "99999999999999999999999999999", ["2", "3"], "<script>"]) await assert.rejects(h.open("preview", bad), /not_found/);
  h.state.admin = false; await assert.rejects(h.open("preview"), /not_found/);
  h.state.localPreview = false;
  const checks = h.state.adminChecks;
  await assert.rejects(h.open("preview"), /not_found/); assert.equal(h.state.adminChecks, checks);
  assert.equal(h.state.reads, 0);
});

test("Mis entradas exposes one yellow link per pending request, none for paid/cancelled history; header has no form-back link", async () => {
  const h = harness();
  h.state.result.orders = [order, { ...order, id: other, reference: "DIWO-111111111111" },
    { ...order, id: "paid", status: "confirmed" }, { ...order, id: "closed", status: "cancelled" }];
  const { PendingOrderCard } = load("../components/pending-order-card.tsx", { "next/link": { default: "a" }, "next/image": { default: "img" },
    "lucide-react": { ArrowRight: "svg", Clock3: "svg", Hourglass: "svg" } });
  const { TicketsHeading } = load("../components/tickets-heading.tsx", {});
  const Page = load("../app/ticket/page.tsx", { ...h.dependencies, "next/link": { default: "a" },
    "@/components/pending-order-card": { PendingOrderCard }, "@/components/tickets-heading": { TicketsHeading },
    "@/components/confirmed-order-card": { ConfirmedOrderCard: "confirmed-order" },
    "@/components/cancelled-order-card": { CancelledOrderCard: "cancelled-order" },
    "@/components/ui/button": { Button: "button" }, "@/components/empty-tickets": { EmptyTickets: "empty" },
    "@/components/new-order-link": { NewOrderLink: "new-order" },
  }).default;
  const links = nodes(await Page()).filter(node => node.type === "a" && node.props.href?.startsWith("/ticket/payment/"));
  assert.deepEqual(links.map(node => node.props.href), [`/ticket/payment/${id}`, `/ticket/payment/${other}`]);
  const Header = load("../components/auth-header.tsx", {
    "@/components/buyer-flow-link": { BuyerFlowLink: "a" },
    "next/navigation": { usePathname: () => `/ticket/payment/${id}` }, "next/image": { default: "img" }, "next/link": { default: "a" },
    "@clerk/nextjs": { useUser: () => ({ user: { firstName: "User" } }) }, "lucide-react": { ArrowLeft: "svg" },
  }).default;
  assert.match(text(Header()), /Instrucciones de pago/);
  assert.equal(nodes(Header()).find(node => node.props?.["aria-label"] === "Volver a Mis entradas").props.href, "/ticket");
  assert.equal(nodes(Header()).some(node => node.type === "a" && ["/request", "/"].includes(node.props.href)), false);
});
