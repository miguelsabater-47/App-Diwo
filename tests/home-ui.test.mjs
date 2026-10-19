import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as buyerContext from "../lib/buyer-request-context.ts";
import { Suspense } from "react";

function load(path, dependencies) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const moduleObject = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    if (name === "react/jsx-runtime") return jsx;
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, moduleObject, moduleObject.exports);
  return moduleObject.exports;
}
function nodes(node) {
  if (!node || typeof node !== "object") return [];
  return [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
}
function text(node) {
  if (node == null || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map(text).join(" ");
  return typeof node === "object" ? text(node.props?.children) : String(node);
}

function attendeeHome() {
  return load("../components/attendee-home.tsx", {
    "next/image": { default: "img" },
    "lucide-react": Object.fromEntries(["CalendarDays", "MapPin", "Clock3", "CupSoda", "Shirt", "Disc3"].map(name => [name, "svg"])),
    "@/components/new-order-link": { NewOrderLink: "new-order-action" },
    "@/lib/buyer-request-context": buyerContext,
  }).AttendeeHome;
}

test("attendee Home keeps original artwork/information and one shared new-request action", () => {
  const AttendeeHome = attendeeHome();
  const result = AttendeeHome();
  const tree = nodes(result);
  const copy = text(result);
  assert.equal(tree.find(node => node.type === "img").props.src, "/hero inicio interfaz.jpg");
  assert.equal(tree.find(node => node.type === "img").props.alt, "");
  for (const value of ["HALLOWEEN", "HOUSE PARTY", "La Peste Negra", "31.10.26", "Ceutí, Murcia", "23:30–07:00", "Acceso hasta la 01:30", "45 primeros", "+4 djs", "5 €"]) assert.ok(copy.includes(value), value);
  const action = tree.filter(node => node.type === "new-order-action");
  assert.equal(action.length, 1); assert.equal(action[0].props.label, "CONSEGUIR ENTRADAS");
  assert.equal(tree.some(node => node.props?.href?.startsWith("/admin")), false);
  assert.equal(tree.some(node => node.type === "button" || node.type === "form"), false);
  assert.equal(tree.filter(node => node.type === "article").length, 4);
  assert.equal(tree.some(node => node.type === "a"), false);
  for (const node of tree) {
    assert.equal(Object.entries(node.props ?? {}).some(([key, value]) => /^on[A-Z]/.test(key) && typeof value === "function"), false);
  }
  assert.equal(tree.filter(node => node.type === "h1").length, 1);
});

test("Home copy distinguishes pending, ready, closed and unknown requests without claiming payment or inventing another purchase action", () => {
  const Home = attendeeHome();
  for (const [state, title, label] of [["pending", "Tienes 1 solicitud de entradas pendiente", "SOLICITAR MÁS ENTRADAS"], ["ready", "Tu solicitud ya está aceptada", "SOLICITAR MÁS ENTRADAS"], ["closed", "¿Quieres solicitar entradas?", "SOLICITAR ENTRADAS"]]) {
    const context = { state, eventId: "event", recorded: [{ id: "owned", eventId: "event", buyerName: "Buyer", names: ["Buyer"], status: state === "ready" ? "confirmed" : state === "pending" ? "pending" : "cancelled" }] };
    const tree = Home({ requestContext: context });
    assert.match(text(tree), new RegExp(title.replace(/[?]/g, "\\?")));
    const actions = nodes(tree).filter(node => node.type === "new-order-action");
    assert.equal(actions.length, 1); assert.equal(actions[0].props.label, label);
    assert.equal(actions[0].props.eventId, context.eventId);
    if (state === "pending") assert.equal(text(tree).includes("entradas ya están listas"), false);
  }
  const failed = Home({ requestContext: null });
  assert.match(text(failed), /No hemos podido actualizar/);
  assert.equal(text(failed).includes("¿Aún no tienes"), false);
});

test("buyer Home renders its shell before personal orders; admin/anonymous/error access cannot start buyer queries", async () => {
  let access = { ok: true, role: "user" }, result = { ok: true, orders: [] }, reads = 0;
  const Page = load("../app/page.tsx", {
    react: { Suspense },
    "next/link": { default: "a" }, "next/navigation": { redirect: path => { throw new Error(`redirect:${path}`); } },
    "@/components/ui/button": { Button: "button" }, "@/lib/local-access": { hasConfiguredClerkKeys: () => true },
    "@/lib/app-authorization": { getCurrentAppAccess: async () => access },
    "@/lib/order-reads": { readOrderOverview: async scope => { assert.equal(scope, "buyer"); reads++; return result; } },
    "@/lib/buyer-request-context": buyerContext, "@/components/attendee-home": { AttendeeHome: "home", renderHomeRequest: context => context },
  }).default;
  const page = await Page();
  assert.equal(reads, 0, "A heavy order read must not block the Home shell");
  const boundary = page.props.requestSection;
  assert.equal(boundary?.type, Suspense);
  assert.equal(nodes(boundary.props.fallback).some(node => node.type === "a" || node.type === "button"), false);
  assert.equal((await boundary.props.children.type()).state, "none");
  result = { ok: false, status: 502 };
  assert.equal(await boundary.props.children.type(), null);
  assert.equal(reads, 2);
  access = { ok: true, role: "admin" }; await assert.rejects(Page(), /redirect:\/admin/);
  access = { ok: false, status: 401 }; await assert.rejects(Page(), /redirect:\/sign-in/);
  access = { ok: false, status: 503 }; await Page(); assert.equal(reads, 2);
});

test("outside-dashboard navigation has two tabs; requesting entries selects neither tab and changes no href", () => {
  let pathname = "/";
  const Navigation = load("../components/app-navigation.tsx", {
    "@/components/admin-tab-link": { AdminTabLink: "admin-link" },
    react: { useContext: () => pathname === "/" || pathname === "/ticket" },
    "@/components/buyer-tab-navigation": { BuyerTabPrefetch: {} },
    "next/link": { default: "a" },
    "next/navigation": { usePathname: () => pathname },
    "lucide-react": { Home: "svg", Ticket: "svg", UserRound: "svg" },
  }).AppNavigation;
  for (const path of ["/", "/ticket", "/ticket/preview", "/request", "/account"]) {
    pathname = path;
    const links = nodes(Navigation()).filter(node => node.type === "a");
    assert.deepEqual(links.map(node => node.props.href), ["/", "/ticket"]);
    for (const link of links) assert.equal(link.props.prefetch, path === "/ticket/preview" ? undefined :
      (path === "/" || path === "/ticket") && link.props["aria-current"] !== "page");
    assert.equal(links.find(node => node.props["aria-current"] === "page")?.props.href,
      path === "/" ? "/" : ["/account", "/request"].includes(path) ? undefined : "/ticket");
  }
  for (const path of ["/admin", "/admin/requests", "/scan", "/sign-in"]) {
    pathname = path;
    assert.equal(Navigation(), null);
  }
});

test("header avatar opens actual account; no fabricated identity or profile dropdown", () => {
  let pathname = "/", user = { firstName: "Miguel", hasImage: false };
  const Header = load("../components/auth-header.tsx", {
    "@/components/buyer-flow-link": { BuyerFlowLink: "a" },
    "next/link": { default: "a" }, "next/image": { default: "img" },
    "next/navigation": { usePathname: () => pathname },
    "@clerk/nextjs": { useUser: () => ({ isLoaded: true, user }), SignedIn: "signed-in", SignedOut: "signed-out", UserButton: "profile-menu" },
    "lucide-react": { LogIn: "svg", ArrowLeft: "svg" },
    "@/components/ui/button": { Button: "button" },
    "@/components/nav-button": { NavButton: "nav-button" },
    "@/app/assets/logo.png": { default: { width: 56, height: 30 } },
  }).default;
  let tree = nodes(Header());
  const account = tree.find(node => node.type === "a" && node.props.href === "/account");
  assert.ok(account);
  assert.equal(account.props["aria-label"], "Mi cuenta");
  assert.ok(text(account).includes("M"));
  assert.ok(text(Header()).includes("INICIO"));
  user = { firstName: "Ana", hasImage: true, imageUrl: "https://images.clerk.dev/avatar-test.png" };
  tree = nodes(Header());
  assert.ok(tree.some(node => node.type === "img" && node.props.src === user.imageUrl));
  assert.equal(tree.find(node => node.props?.["aria-label"] === "Mi cuenta").props.href, "/account");
  user = null;
  assert.ok(nodes(Header()).some(node => node.props?.href === "/account"));
  assert.equal(text(Header()).includes("undefined"), false);
  pathname = "/account";
  assert.ok(text(Header()).includes("MI CUENTA"));
  for (const overview of ["/ticket", "/ticket/", "/ticket/preview", "/ticket/preview/"]) {
    pathname = overview;
    const header = Header();
    const title = header.props.children[1];
    assert.equal(title.props.className, "diwo-app-header-title");
    assert.equal(title.props.children, "MIS ENTRADAS");
    assert.notEqual(title.props["aria-hidden"], true);
    assert.equal(header.props.children[0].props["aria-label"], "Ir a inicio");
    assert.equal(header.props.children[2].props["aria-label"], "Mi cuenta");
  }
  pathname = "/request";
  tree = nodes(Header());
  assert.ok(text(Header()).includes("Conseguir entradas"));
  assert.ok(tree.some(node => node.type === "img" && node.props.src === "/brand/diwo-club.svg"));
  assert.equal(tree.find(node => node.props?.["aria-label"] === "Ir a inicio").props.href, "/");
  assert.equal(tree.find(node => node.props?.["aria-label"] === "Mi cuenta").props.href, "/account");
  pathname = "/ticket/payment/preview";
  tree = nodes(Header());
  assert.equal(tree.some(node => node.type === "img" && node.props.src === "/brand/diwo-club.svg"), false);
  assert.equal(tree.find(node => node.props?.["aria-label"] === "Volver a Mis entradas").props.href, "/ticket/preview");
  assert.equal(tree.find(node => node.props?.className === "diwo-app-header-title").props.children, "Instrucciones de pago");
  assert.equal(tree.some(node => node.type === "a" && node.props.href === "/"), false);
});
