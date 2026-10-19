import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

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
const icons = Object.fromEntries(["Home", "Ticket", "LayoutDashboard", "ClipboardList", "ScanLine", "UsersRound"].map(name => [name, "svg"]));

test("verified admin has one five-tab menu in requested order; users/staff retain buyer navigation and customer mocks stay faithful", () => {
  let pathname = "/admin";
  const { AppNavigation } = load("../components/app-navigation.tsx", {
    "@/components/admin-tab-link": { AdminTabLink: "a" },
    react: { useContext: () => false },
    "@/components/buyer-tab-navigation": { BuyerTabPrefetch: {} },
    "next/link": { default: "a" }, "next/navigation": { usePathname: () => pathname }, "lucide-react": icons,
  });
  const hrefs = ["/admin", "/admin/requests", "/admin/scan", "/admin/tickets", "/admin/staff"];
  const labels = ["Resumen", "Solicitudes", "Escáner", "Entradas", "Personal"];
  for (const path of hrefs) {
    pathname = path;
    const all = nodes(AppNavigation({ role: "admin" }));
    assert.equal(all.filter(node => node.type === "nav").length, 1);
    const links = all.filter(node => node.type === "a");
    assert.deepEqual(links.map(node => node.props.href), hrefs);
    assert.ok(links.every(link => link.props.prefetch === undefined));
    assert.deepEqual(links.map(link => text(link).trim()), labels);
    assert.equal(links.find(node => node.props["aria-current"] === "page").props.href, path);
  }
  pathname = "/account";
  assert.equal(nodes(AppNavigation({ role: "admin" })).filter(node => node.type === "a").length, 5);
  for (const role of ["user", "door_staff"]) assert.deepEqual(nodes(AppNavigation({ role })).filter(node => node.type === "a").map(node => node.props.href), ["/", "/ticket"]);
  pathname = "/admin/scan";
  assert.equal(AppNavigation({ role: "user" }), null); assert.equal(AppNavigation({ role: null }), null);
  pathname = "/ticket/preview";
  assert.equal(nodes(AppNavigation({ role: "admin" })).filter(node => node.type === "a").length, 2);
  pathname = "/ticket/design"; assert.equal(AppNavigation({ role: "admin" }), null);
});

test("shell navigation role comes only from current server access; failures cannot default to admin", async () => {
  let access = { ok: true, role: "admin" };
  const Layout = load("../app/layout.tsx", {
    "@clerk/nextjs": { ClerkProvider: "provider" }, "@clerk/localizations": { esES: {} },
    "./globals.css": {}, "@/components/login-screen.css": {}, "@/components/app-interface.css": {},
    "@/components/ticket-request.css": {}, "@/components/owned-ticket.css": {},
    "@/components/admin-requests.css": {},
    "@/components/admin-tickets.css": {}, "@/components/admin-staff.css": {}, "@/components/door-scanner.css": {},
    "@/components/app-chrome": { AppChrome: "chrome" }, "@/components/ui/sonner": { Toaster: "toaster" },
    "@/lib/local-access": { hasConfiguredClerkKeys: () => true }, "@/components/local-setup-notice": { LocalSetupNotice: "setup" },
    "@/lib/app-authorization": { getCurrentAppAccess: async () => access },
  }).default;
  for (const role of ["admin", "door_staff", "user"]) {
    access = { ok: true, role };
    assert.equal(nodes(await Layout({ children: "content" })).find(node => node.type === "chrome").props.role, role);
  }
  access = { ok: false, status: 503 };
  assert.equal(nodes(await Layout({ children: "content" })).find(node => node.type === "chrome").props.role, null);
});

test("admin layout retains its independent gate but never renders a second menu or Home gateway", async () => {
  let access = { ok: false, status: 403 };
  const Layout = load("../app/admin/layout.tsx", {
    "@clerk/nextjs/server": { auth: async () => ({ userId: "user_verified" }) },
    "next/navigation": { notFound: () => { throw new Error("not_found"); }, redirect: href => { throw new Error(`redirect:${href}`); } },
    "@/lib/local-access": { hasConfiguredClerkKeys: () => true },
    "@/lib/app-authorization": { requireAdminAccess: async () => access },
  }).default;
  await assert.rejects(Layout({ children: "private" }), /not_found/);
  access = { ok: false, status: 401 }; await assert.rejects(Layout({ children: "private" }), /redirect:\/sign-in/);
  access = { ok: false, status: 503 }; assert.equal((await Layout({ children: "private" })).props.role, "alert");
  access = { ok: true, role: "admin" };
  const view = await Layout({ children: "private" });
  assert.equal(view.props.children, "private");
  assert.equal(nodes(view).some(node => node.type === "nav" || node.type === "a"), false);
});

test("admin transitions reuse the neutral loading UI inside the protected layout without another menu or privileged data", () => {
  const RootLoading = load("../app/loading.tsx", { "lucide-react": { LoaderCircle: "svg" } }).default;
  const AdminLoading = load("../app/admin/loading.tsx", { "../loading": { default: RootLoading } }).default;
  assert.equal(AdminLoading, RootLoading);
  const tree = AdminLoading();
  assert.equal(tree.props.role, "status");
  assert.equal(tree.props["aria-live"], "polite");
  assert.match(text(tree), /Cargando contenido/);
  assert.equal(nodes(tree).some(node => ["nav", "a", "button", "input", "form"].includes(node.type)), false);
});

test("admin scanner has a second current-admin page gate; buyer options and staff's existing scanner remain available", async () => {
  let access = { ok: false, status: 403 };
  const navigation = { notFound: () => { throw new Error("not_found"); }, redirect: href => { throw new Error(`redirect:${href}`); } };
  const Page = load("../app/admin/scan/page.tsx", { "next/navigation": navigation,
    "@/lib/app-authorization": { requireAdminAccess: async () => access }, "@/components/door-scanner": { DoorScanner: "scanner" },
    "@/lib/door-scan-development": { getDoorScanDevelopmentState: async () => null } }).default;
  await assert.rejects(Page(), /not_found/);
  access = { ok: false, status: 401 }; await assert.rejects(Page(), /redirect:\/sign-in/);
  access = { ok: false, status: 503 }; assert.equal(nodes(await Page()).some(node => node.type === "scanner"), false);
  access = { ok: true, role: "admin" }; assert.equal(nodes(await Page()).filter(node => node.type === "scanner").length, 1);
  const Account = load("../app/account/page.tsx", {
    "@/components/buyer-flow-link": { BuyerFlowLink: "a" },
    "@clerk/nextjs/server": { auth: async () => ({ userId: "user_verified" }) }, "next/navigation": navigation,
    "next/link": { default: "a" }, "@/components/ui/button": { Button: "button" }, "@/components/account-actions": { AccountActions: "actions", AccountEmail: "email" },
    "@/lib/local-access": { hasConfiguredClerkKeys: () => true }, "@/lib/app-authorization": { getCurrentAppAccess: async () => access },
    "@/lib/order-reads": { readOrderOverview: async scope => { assert.equal(scope, "buyer"); return { ok: true, orders: [] }; } },
    "@/lib/buyer-request-context": { buyerRequestContext: () => ({ eventId: null, recorded: [] }) },
    "@/components/new-order-link": { NewOrderLink: "new-order-action" },
  }).default;
  for (const role of ["admin", "door_staff", "user"]) {
    access = { ok: true, role };
    const links = nodes(await Account()).filter(node => node.type === "a").map(node => node.props.href);
    assert.ok(links.includes("/ticket")); assert.equal(links.includes("/request"), false);
    assert.equal(links.includes("/"), true);
    assert.equal(nodes(await Account()).some(node => node.type === "new-order-action"), role === "admin");
    assert.equal(links.includes("/scan"), role === "door_staff");
  }
});
