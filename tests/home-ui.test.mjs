import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as buyerContext from "../lib/buyer-request-context.ts";
import { Suspense } from "react";
import * as buyerNavigation from "../lib/buyer-navigation.ts";

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
  for (const value of ["HALLOWEEN", "HOUSE PARTY", "La Peste Negra", "31.10.26", "Ceutí, Murcia", "23:30–07:00", "Acceso hasta la 01:30", "Hielo y vasos para todos, y cóctel de bienvenida para los 50 primeros", "+4 djs"]) assert.ok(copy.includes(value), value);
  assert.equal(copy.includes("5 € por entrada"), false);
  assert.equal(copy.includes("Un Bizum por solicitud"), false);
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

test("outside-dashboard navigation has two tabs, but the request flow has no bottom navigation", () => {
  let pathname = "/";
  const Navigation = load("../components/app-navigation.tsx", {
    "@/components/admin-tab-link": { AdminTabLink: "admin-link" },
    react: { useContext: () => ({ enabled: pathname === "/" || pathname === "/ticket", homeHref: "/" }) },
    "@/components/buyer-tab-navigation": { BuyerTabPrefetch: {} },
    "next/link": { default: "a" },
    "next/navigation": { usePathname: () => pathname },
    "lucide-react": { Home: "svg", Ticket: "svg", UserRound: "svg" },
  }).AppNavigation;
  for (const path of ["/", "/ticket", "/ticket/preview", "/account"]) {
    pathname = path;
    const tree = nodes(Navigation());
    const links = tree.filter(node => node.type === "a");
    const track = tree.find(node => node.props?.className === "diwo-app-navigation-items");
    assert.equal(track.props.style["--tab-count"], 2);
    assert.equal(track.props.style["--tab-index"], path.startsWith("/ticket") ? 1 : 0);
    assert.equal(track.props["data-active-tab"], path === "/account" ? "false" : "true");
    assert.deepEqual(links.map(node => node.props.href), ["/", "/ticket"]);
    for (const link of links) assert.equal(link.props.prefetch, path === "/ticket/preview" ? undefined :
      (path === "/" || path === "/ticket") && link.props["aria-current"] !== "page");
    assert.equal(links.find(node => node.props["aria-current"] === "page")?.props.href,
      path === "/" ? "/" : path === "/account" ? undefined : "/ticket");
  }
  for (const path of ["/request", "/request/", "/admin", "/admin/requests", "/scan", "/sign-in"]) {
    pathname = path;
    assert.equal(Navigation(), null);
  }
});

test("bottom Inicio and header brand use the same fully prefetched Home destination from tickets and account", () => {
  let pathname = "/ticket";
  const context = { enabled: true, homeHref: "/?_buyer_nav=synthetic-document" };
  const shared = {
    react: { useContext: () => context }, "next/navigation": { usePathname: () => pathname }, "next/link": { default: "a" },
    "@/components/buyer-tab-navigation": { BuyerTabPrefetch: {} },
  };
  const { BuyerFlowLink } = load("../components/buyer-flow-link.tsx", { ...shared, "@/lib/buyer-navigation": buyerNavigation });
  const { AppNavigation } = load("../components/app-navigation.tsx", { ...shared,
    "@/components/admin-tab-link": { AdminTabLink: "admin-link" },
    "lucide-react": { Home: "svg", Ticket: "svg", LayoutDashboard: "svg", ClipboardList: "svg", ScanLine: "svg", UsersRound: "svg" },
  });
  const { default: Header } = load("../components/auth-header.tsx", { ...shared,
    "@/components/buyer-flow-link": { BuyerFlowLink }, "next/image": { default: "img" },
    "@clerk/nextjs": { useUser: () => ({ user: null }) }, "lucide-react": { ArrowLeft: "svg" },
  });
  for (const path of ["/ticket", "/account"]) {
    pathname = path;
    const bottom = nodes(AppNavigation({ role: "user" })).find(node => node.type === "a" && text(node).includes("Inicio"));
    const brand = Header().props.children[0];
    const header = BuyerFlowLink(brand.props);
    assert.equal(bottom.props.href, context.homeHref); assert.equal(bottom.props.prefetch, true);
    assert.equal(header.props.href, context.homeHref); assert.equal(header.props.prefetch, true);
  }
  pathname = "/request";
  const requestBack = BuyerFlowLink(Header().props.children[0].props);
  assert.equal(requestBack.props.href, context.homeHref, "The request back link must preserve the warmed Home destination");
  assert.equal(requestBack.props.prefetch, true);
  assert.equal(AppNavigation({ role: "user" }), null);
  context.enabled = false;
  assert.equal(BuyerFlowLink({ href: "/" }).props.href, "/");
  assert.equal(nodes(AppNavigation({ role: "admin" })).some(node => node.props?.href?.includes("_buyer_nav")), false);
});

test("navigation is separated by a safe-area-aware black gradient that cannot intercept content clicks", () => {
  const css = readFileSync(new URL("../components/app-interface.css", import.meta.url), "utf8");
  const shade = css.match(/\.diwo-app-navigation-shade\s*\{([^}]+)\}/)?.[1];
  assert.ok(shade);
  assert.match(shade, /position:\s*fixed/);
  assert.match(shade, /linear-gradient\(to top,\s*#000/);
  assert.match(shade, /#000 0,\s*#000 calc\(84px \+ env\(safe-area-inset-bottom\)\),\s*transparent 100%/, "The opaque region must cover the navigation plus its bottom safe area, not a percentage of the gradient");
  assert.match(shade, /safe-area-inset-bottom/);
  assert.match(shade, /pointer-events:\s*none/);
  assert.match(css, /\.diwo-app-main-request\s*\{[^}]*padding-bottom:\s*calc\(24px \+ env\(safe-area-inset-bottom\)\)/);
});

test("shared header stays in document flow for admin, buyer and door staff screens", () => {
  let pathname = "/";
  const { AppChrome } = load("../components/app-chrome.tsx", {
    "next/navigation": { usePathname: () => pathname },
    "@clerk/nextjs": { useAuth: () => ({ isLoaded: true, isSignedIn: true }), RedirectToSignIn: "redirect" },
    "@/components/auth-header": { default: "auth-header" },
    "@/components/app-navigation": { AppNavigation: "navigation" },
    "@/lib/login-flow": { isAuthScreen: () => false },
    "@/components/buyer-tab-navigation": { BuyerTabNavigation: "buyer-navigation" },
    "@/components/page-motion": { PageMotion: "page-motion" },
  });
  for (const role of ["admin", "user", "door_staff"]) {
    for (const route of role === "admin" ? ["/admin", "/admin/requests", "/admin/scan", "/admin/tickets", "/admin/staff", "/account"] : ["/", "/ticket", "/account"]) {
      pathname = route;
      const tree = nodes(AppChrome({ role, children: "page-content" }));
      const header = tree.find(node => node.props?.className === "diwo-app-header-shell");
      assert.equal(header?.props.children.type, "auth-header", `${role}: ${route}`);
      const main = tree.find(node => node.type === "main");
      assert.equal(main.props.children.type, "page-motion");
      assert.equal(main.props.children.props.pathname, route);
      assert.equal(main.props.children.props.children, "page-content");
      assert.equal(main.props.children.key, null);
      assert.equal(nodes(main).some(node => node.type === "navigation" || node.type === "auth-header"), false);
    }
  }
  const css = readFileSync(new URL("../components/app-interface.css", import.meta.url), "utf8");
  const headerStyles = css.match(/\.diwo-app-header-shell\s*\{([^}]+)\}/)?.[1];
  assert.ok(headerStyles);
  assert.match(headerStyles, /position:\s*static/);
  assert.match(headerStyles, /padding-top:\s*env\(safe-area-inset-top\)/);
  assert.doesNotMatch(headerStyles, /(?:^|;)\s*(?:top|z-index):/);
  assert.match(css, /\.diwo-app-navigation\s*\{[^}]*position:\s*fixed/);
});

test("Home request action has a subtle static yellow glow scoped away from other buttons and navigation", () => {
  const css = readFileSync(new URL("../components/app-interface.css", import.meta.url), "utf8");
  const glow = css.match(/\.diwo-home \.diwo-home-cta\s*\{([^}]+)\}/)?.[1];
  assert.ok(glow);
  assert.match(glow, /box-shadow:\s*0 0 16px rgb\(252 233 33 \/ 12%\)/);
  assert.doesNotMatch(glow, /animation:|filter:|transform:/);
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
  for (const path of ["/request", "/request/"]) {
    pathname = path;
    tree = nodes(Header());
    assert.ok(text(Header()).includes("Conseguir entradas"));
    assert.equal(tree.some(node => node.type === "img" && node.props.src === "/brand/diwo-club.svg"), false);
    const back = tree.find(node => node.props?.["aria-label"] === "Volver a Inicio");
    assert.ok(back);
    assert.equal(back.props.href, "/");
    assert.equal(back.props.className, "diwo-request-back");
    assert.equal(tree.some(node => node.props?.href === "/account" || node.props?.className === "diwo-app-avatar"), false);
    assert.equal(Header().props.children[2].type, "span");
    assert.equal(Header().props.children[2].props["aria-hidden"], "true");
  }
  pathname = "/ticket/payment/preview";
  tree = nodes(Header());
  assert.equal(tree.some(node => node.type === "img" && node.props.src === "/brand/diwo-club.svg"), false);
  assert.equal(tree.find(node => node.props?.["aria-label"] === "Volver a Mis entradas").props.href, "/ticket/preview");
  assert.equal(tree.find(node => node.props?.className === "diwo-app-header-title").props.children, "Instrucciones de pago");
  assert.equal(tree.some(node => node.type === "a" && node.props.href === "/"), false);
  for (const path of ["/ticket/payment/preview", "/ticket/payment/preview/", "/ticket/payment/00000000-0000-4000-8000-000000000001", "/ticket/payment/00000000-0000-4000-8000-000000000001/"]) {
    pathname = path;
    const header = Header();
    tree = nodes(header);
    assert.equal(tree.some(node => node.props?.href === "/account" || node.props?.className === "diwo-app-avatar"), false);
    assert.equal(tree.some(node => node.type === "img" && node.props.src === user?.imageUrl), false);
    assert.equal(header.props.children[2].type, "span");
    assert.equal(header.props.children[2].props["aria-hidden"], "true");
    assert.equal(header.props.children[2].props.tabIndex, undefined);
    assert.equal(header.props.children[1].props.children, "Instrucciones de pago");
    assert.ok(tree.some(node => node.props?.["aria-label"] === "Volver a Mis entradas"));
  }
  for (const path of ["/ticket/design", "/ticket/00000000-0000-4000-8000-000000000001", "/ticket/00000000-0000-4000-8000-000000000001/"]) {
    pathname = path;
    const header = Header();
    tree = nodes(header);
    assert.equal(tree.some(node => node.props?.href === "/account" || node.props?.className === "diwo-app-avatar"), false);
    assert.equal(header.props.children[2].type, "span");
    assert.equal(header.props.children[2].props["aria-hidden"], "true");
    assert.equal(header.props.children[1].props.children, "Mis entradas");
    assert.equal(tree.find(node => node.props?.["aria-label"] === "Volver a Mis entradas").props.href, "/ticket");
  }
  for (const path of ["/", "/account", "/ticket", "/admin", "/admin/requests"]) {
    pathname = path;
    assert.ok(nodes(Header()).some(node => node.props?.href === "/account" && node.props?.className === "diwo-app-avatar"));
  }
});
