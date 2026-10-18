import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

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

test("attendee Home uses original hero, approved information and existing request destination", () => {
  const AttendeeHome = load("../components/attendee-home.tsx", {
    "next/link": { default: "a" },
    "next/image": { default: "img" },
    "lucide-react": Object.fromEntries(["CalendarDays", "MapPin", "Ticket", "Clock3", "CupSoda", "Shirt", "Disc3"].map(name => [name, "svg"])),
  }).AttendeeHome;
  const result = AttendeeHome();
  const tree = nodes(result);
  const copy = text(result);
  assert.equal(tree.find(node => node.type === "img").props.src, "/hero inicio interfaz.jpg");
  assert.equal(tree.find(node => node.type === "img").props.alt, "");
  for (const value of ["HALLOWEEN", "HOUSE PARTY", "La Peste Negra", "31.10.26", "Ceutí, Murcia", "23:30–07:00", "Acceso hasta la 01:30", "45 primeros", "+4 djs", "5 €"]) assert.ok(copy.includes(value), value);
  assert.equal(tree.filter(node => node.type === "a" && node.props.href === "/request").length, 1);
  assert.ok(copy.includes("CONSEGUIR ENTRADAS"));
  assert.equal(tree.some(node => node.props?.href?.startsWith("/admin")), false);
  assert.equal(tree.some(node => node.type === "button" || node.type === "form"), false);
  assert.equal(tree.filter(node => node.type === "article").length, 4);
  assert.deepEqual(tree.filter(node => node.type === "a").map(node => node.props.href), ["/request"]);
  for (const node of tree) {
    assert.equal(Object.entries(node.props ?? {}).some(([key, value]) => /^on[A-Z]/.test(key) && typeof value === "function"), false);
  }
  assert.equal(tree.filter(node => node.type === "h1").length, 1);
});

test("outside-dashboard navigation has two tabs, preserving request activity and hidden routes", () => {
  let pathname = "/";
  const Navigation = load("../components/app-navigation.tsx", {
    "next/link": { default: "a" },
    "next/navigation": { usePathname: () => pathname },
    "lucide-react": { Home: "svg", Ticket: "svg", UserRound: "svg" },
  }).AppNavigation;
  for (const path of ["/", "/ticket", "/ticket/preview", "/request", "/account"]) {
    pathname = path;
    const links = nodes(Navigation()).filter(node => node.type === "a");
    assert.deepEqual(links.map(node => node.props.href), ["/", "/ticket"]);
    assert.equal(links.find(node => node.props["aria-current"] === "page")?.props.href,
      path === "/" ? "/" : path === "/account" ? undefined : "/ticket");
  }
  for (const path of ["/admin", "/admin/requests", "/scan", "/sign-in"]) {
    pathname = path;
    assert.equal(Navigation(), null);
  }
});

test("header avatar opens actual account; no fabricated identity or profile dropdown", () => {
  let pathname = "/", user = { firstName: "Miguel", hasImage: false };
  const Header = load("../components/auth-header.tsx", {
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
