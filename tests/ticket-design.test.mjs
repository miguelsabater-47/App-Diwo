import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

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
const { OwnedTicketCard } = load("../components/owned-ticket-card.tsx", {
  "next/image": { default: "img" },
  "lucide-react": { CalendarDays: "svg", Clock3: "svg", MapPin: "svg", UserRound: "svg" },
});
const { OwnedTicketDetail } = load("../components/owned-ticket-detail.tsx", {
  "next/link": { default: "a" },
  "@/components/ticket-gallery": { TicketGallery: ({ initial, designPreview }) => jsx.jsxs("section", { children: [
    jsx.jsx(OwnedTicketCard, { result: initial, designPreview }),
    (designPreview || initial.ticket.status === "valid" && initial.ticket.qrDataUrl) && jsx.jsx("ticket-actions", {
      ticketId: initial.ticket.id, technical: initial.technical, designPreview, cardLayout: true,
    }),
  ] }) },
});
function harness() {
  const state = { local: true, admin: true, checks: 0 };
  const Page = load("../app/ticket/design/page.tsx", {
    "next/navigation": { notFound: () => { throw new Error("not_found"); } },
    "@/lib/local-access": { isLocalPaymentPreview: () => state.local },
    "@/lib/app-authorization": { requireAdminAccess: async () => { state.checks++; return { ok: state.admin }; } },
    "@/components/owned-ticket-detail": { OwnedTicketDetail },
  }).default;
  return { state, Page };
}

test("clean ticket design reuses actual detail, contains no technical labels, stored ticket lookup or invented QR", async () => {
  const { Page } = harness();
  const result = await Page();
  assert.equal(result.props.designPreview, true);
  assert.equal(result.props.result.ticket.qrDataUrl, null);
  const view = nodes(result);
  assert.equal(text(result).toLowerCase().includes("prueba técnica"), false);
  for (const expected of ["Pablo Romero Martínez", "DIWO X 2.0", "31.10.26", "23:30", "Ceutí, Murcia", "Entrada antes de la 1:30", "TK-8F3C2A"]) assert.ok(text(result).includes(expected), expected);
  for (const absent of ["Válida · Sin utilizar", "Evento ficticio", "PRUEBA TÉCNICA"]) assert.equal(text(result).includes(absent), false);
  assert.match(text(result), /\b0?7:00\b/);
  assert.ok(view.some(node => node.props?.["aria-label"] === "Espacio reservado para el QR de la entrada"));
  assert.equal(view.some(node => node.props?.["data-ticket-qr"]), false);
  assert.equal(view.find(node => node.type === "img").props.src, "/imagen entrada.jpg");
  assert.equal(view.find(node => node.type === "img").props.loading, "eager");
  assert.equal(view.find(node => node.type === "article").props.id, "owned-ticket-design");
  assert.equal(view.find(node => node.type === "ticket-actions").props.designPreview, true);
  assert.equal(view.find(node => node.type === "ticket-actions").props.cardLayout, true);
  assert.equal(result.props.navigation.hrefs.length, 2);
});

test("design route fails closed for user/staff, hosted and Production while original technical labels remain intact", async () => {
  const h = harness();
  h.state.admin = false; await assert.rejects(h.Page(), /not_found/);
  h.state.local = false; const calls = h.state.checks;
  await assert.rejects(h.Page(), /not_found/); assert.equal(h.state.checks, calls);
  const sample = await harness().Page();
  const original = OwnedTicketDetail({ result: { ...sample.props.result, technical: true } });
  assert.match(text(original), /PRUEBA TÉCNICA/);
  assert.equal(nodes(original).find(node => node.type === "article").props.id, "owned-ticket-export");
  assert.equal(nodes(original).some(node => node.props?.["aria-label"] === "Espacio reservado para el QR de la entrada"), false);
});

test("design gallery selects two examples without generating tickets or accepting arbitrary positions", async () => {
  const { Page } = harness();
  for (const entry of ["1", "2"]) {
    const view = await Page({ searchParams: Promise.resolve({ entry }) });
    assert.equal(view.props.navigation.current, Number(entry) - 1);
    assert.equal(view.props.navigation.hrefs.length, 2);
    assert.equal(view.props.result.ticket.attendeeName, "Pablo Romero Martínez");
    assert.equal(view.props.result.ticket.qrDataUrl, null);
  }
  for (const entry of ["0", "3", "5", "-1", ["1", "2"], "<script>"]) {
    await assert.rejects(Page({ searchParams: Promise.resolve({ entry }) }), /not_found/);
  }
});

test("actual detail keeps the exact private QR only for a valid ticket; used/revoked never expose QR or export controls", async () => {
  const sample = (await harness().Page()).props.result;
  const qr = "data:image/png;base64,dGVzdA=="; // Test image string, not a generated admission QR.
  const valid = OwnedTicketDetail({ result: { ...sample, ticket: { ...sample.ticket, qrDataUrl: qr } } });
  assert.equal(text(valid).includes("Válida · Sin utilizar"), false);
  assert.equal(nodes(valid).find(node => node.props?.["data-ticket-qr"]).props.src, qr);
  assert.equal(nodes(valid).find(node => node.type === "ticket-actions").props.designPreview, false);
  for (const status of ["used", "revoked"]) {
    const view = OwnedTicketDetail({ result: { ...sample, ticket: { ...sample.ticket, status, qrDataUrl: null,
      usedAt: status === "used" ? "2026-11-01T00:00:00Z" : null,
      revokedAt: status === "revoked" ? "2026-10-20T12:00:00Z" : null } } });
    assert.equal(nodes(view).some(node => node.props?.["data-ticket-qr"] || node.type === "ticket-actions"), false);
    assert.match(text(view), status === "used" ? /Entrada utilizada/ : /Anulada/);
  }
});

test("shared real ticket design personalizes attendee, order reference, ticket ID and QR without copying prototype data", async () => {
  const example = (await harness().Page()).props.result;
  const cases = [
    { attendeeName: "First attendee", id: "11111111-0000-4000-8000-000000000001", orderId: "order-one", orderReference: "DIWO-111111111111", qrDataUrl: "data:image/png;base64,b25l" },
    { attendeeName: "Second attendee", id: "22222222-0000-4000-8000-000000000002", orderId: "order-two", orderReference: "DIWO-222222222222", qrDataUrl: "data:image/png;base64,dHdv" },
  ];
  for (const input of cases) {
    const view = OwnedTicketDetail({ result: { ...example, ticket: { ...example.ticket, ...input } } });
    const all = nodes(view), content = text(view);
    assert.ok(content.includes(input.attendeeName)); assert.ok(content.includes(input.orderReference));
    assert.equal(content.includes("Pablo Romero Martínez"), false); assert.equal(content.includes("DIWO-A7K9"), false);
    assert.equal(all.find(node => node.type === "article").props["data-ticket-id"], input.id);
    assert.equal(all.find(node => node.props?.["data-ticket-qr"]).props.src, input.qrDataUrl);
    assert.equal(all.find(node => node.type === "ticket-actions").props.ticketId, input.id);
    assert.equal(all.find(node => node.type === "ticket-actions").props.designPreview, false);
  }
});

test("adjacent slide is the real next card with no duplicate export ID or active QR selector", async () => {
  const sample = await harness().Page();
  const view = OwnedTicketDetail(sample.props);
  const next = nodes(OwnedTicketCard({ result: view.props.adjacent.next, designPreview: true, active: false }));
  const article = next.find(node => node.type === "article");
  assert.equal(article.props.id, undefined);
  assert.equal(article.props["data-ticket-id"], sample.props.adjacent.next.ticket.id);
  assert.equal(next.some(node => node.type === "ticket-actions" || node.props?.["data-ticket-qr"]), false);
  const active = nodes(OwnedTicketCard({ result: view.props.initial, designPreview: true })).find(node => node.type === "article");
  assert.equal(active.props.id, "owned-ticket-design");
  assert.notEqual(active.props["data-ticket-id"], article.props["data-ticket-id"]);
});
