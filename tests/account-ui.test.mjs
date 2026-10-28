import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

function load(path, dependencies) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", code)(name => {
    if (name === "react/jsx-runtime") return jsx;
    assert.ok(name in dependencies, name); return dependencies[name];
  }, mod, mod.exports);
  return mod.exports;
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

test("account identity stacks the actual name and email without actionable badges or fabricated profile data", () => {
  const state = { isLoaded: true, user: { fullName: "  Lucía Gómez  ", primaryEmailAddress: { emailAddress: "buyer@example.invalid" } } };
  const { AccountIdentity, AccountActions } = load("../components/account-actions.tsx", {
    "@clerk/nextjs": { useUser: () => state, SignOutButton: "signout" },
    "@/components/ui/button": { Button: "button" },
  });
  const identity = AccountIdentity();
  assert.equal(identity.type, "dl");
  assert.equal(identity.props.className, "diwo-account-identity");
  assert.deepEqual(nodes(identity).filter(node => node.type === "dt").map(text), ["Nombre", "Correo electrónico"]);
  assert.deepEqual(nodes(identity).filter(node => node.type === "dd").map(text), ["Lucía Gómez", "buyer@example.invalid"]);
  assert.equal(nodes(identity).some(node => ["a", "button"].includes(node.type) || node.props?.onClick), false);
  state.isLoaded = false;
  assert.match(text(AccountIdentity()), /Cargando cuenta/);
  assert.equal(AccountIdentity().props.role, "status");
  assert.doesNotMatch(text(AccountIdentity()), /buyer@example|Lucía/);
  state.isLoaded = true;
  state.user = { firstName: "Álex", lastName: "de la Peña" };
  assert.match(text(AccountIdentity()), /Álex de la Peña/);
  state.isLoaded = true; state.user = null;
  assert.match(text(AccountIdentity()), /Correo no disponible/);
  assert.match(text(AccountIdentity()), /Nombre no disponible/);
  assert.doesNotMatch(text(AccountIdentity()), /undefined|buyer@example|Lucía|Álex/);
  const actions = AccountActions();
  assert.deepEqual(nodes(actions).filter(node => node.type === "button").map(text), ["Cerrar sesión"]);
  assert.equal(nodes(actions).find(node => node.type === "signout").props.redirectUrl, "/sign-in");
  assert.equal(nodes(actions).find(node => node.type === "button").props.className, "diwo-account-signout");
  assert.notEqual(nodes(actions).find(node => node.type === "button").props.variant, "outline");
  assert.doesNotMatch(text(actions), /Mi perfil|Configuración de cuenta/);
});

test("DIWO account puts identity immediately before logout, removes ticket link and retains role-specific tools", async () => {
  let signed = true, access = { ok: true, role: "user" }, personalReads = 0;
  const Page = load("../app/account/page.tsx", {
    "@/components/buyer-flow-link": { BuyerFlowLink: "a" },
    "@clerk/nextjs/server": { auth: async () => ({ userId: signed ? "user_buyer" : null }) },
    "next/navigation": { redirect: path => { throw new Error(`redirect:${path}`); } },
    "next/link": { default: "a" }, "@/components/ui/button": { Button: "button" },
    "@/components/account-actions": { AccountIdentity: "identity", AccountActions: "logout" },
    "@/lib/local-access": { hasConfiguredClerkKeys: () => true },
    "@/lib/app-authorization": { getCurrentAppAccess: async () => access },
    "@/lib/order-reads": { readOrderOverview: async scope => { assert.equal(scope, "buyer"); personalReads++; return { ok: true, orders: [] }; } },
    "@/lib/buyer-request-context": { buyerRequestContext: () => ({ eventId: null, recorded: [] }) },
    "@/components/new-order-link": { NewOrderLink: "request" },
  }).default;
  const view = await Page(), all = nodes(view);
  const heading = all.find(node => node.type === "header");
  assert.ok(nodes(heading).some(node => node.type === "h1" && text(node) === "Mi cuenta"));
  const profile = all.find(node => node.props?.className === "diwo-account-profile");
  assert.deepEqual(profile.props.children.map(node => node.type), ["identity", "logout"]);
  assert.equal(view.props.className, "diwo-account");
  assert.equal(heading.props.className, "diwo-account-header");
  assert.deepEqual(all.filter(node => node.type === "a" || node.type === "logout").map(node => node.props.href ?? "logout"), ["logout"]);
  const buttons = all.filter(node => node.type === "button");
  assert.equal(buttons.length, 0);
  assert.equal(all.some(node => node.props?.className === "diwo-account-links"), false);
  assert.equal(personalReads, 0);
  access = { ok: true, role: "admin" };
  const adminView = await Page();
  assert.ok(nodes(adminView).some(node => node.type === "request"));
  assert.doesNotMatch(text(adminView), /Cuenta de administración|La gestión está en el menú inferior/);
  assert.equal(personalReads, 1);
  access = { ok: true, role: "door_staff" };
  assert.equal(nodes(await Page()).some(node => node.props?.href === "/scan"), false, "staff scanner now belongs to the operational dashboard");
  assert.doesNotMatch(text(await Page()), /Tu permiso de puerta está activo/);
  access = { ok: false, status: 503 };
  const denied = nodes(await Page());
  assert.ok(denied.some(node => node.props?.role === "alert"));
  assert.equal(denied.some(node => node.type === "request" || node.props?.href === "/scan"), false);
  assert.equal(denied.filter(node => node.type === "logout").length, 1);
  signed = false;
  await assert.rejects(Page(), /redirect:\/sign-in/);
});

test("account layout removes the gray header box, wraps long identity values and uses the brand yellow logout", () => {
  const css = readFileSync(new URL("../components/app-interface.css", import.meta.url), "utf8");
  const rule = selector => css.match(new RegExp(`(?:^|\\n)${selector.replaceAll(".", "\\.")}\\s*\\{([^}]+)\\}`))?.[1] ?? "";
  assert.doesNotMatch(rule(".diwo-account-header"), /background:|border-radius:|justify-content:/);
  assert.match(rule(".diwo-account-identity"), /display:\s*grid/);
  assert.match(rule(".diwo-account-identity"), /text-align:\s*left/);
  assert.match(rule(".diwo-account-identity dd"), /overflow-wrap:\s*anywhere/);
  assert.match(rule(".diwo-account-signout"), /background:\s*var\(--diwo-yellow\)/);
  assert.match(rule(".diwo-account-signout"), /color:\s*#000/);
  assert.match(css, /\.diwo-account-signout:focus-visible\s*\{[^}]*outline:/);
});

test("global cursor rule covers actionable controls but excludes disabled controls and text inputs", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /:where\(button,\s*a\[href\],\s*\[role="button"\],[\s\S]*?\):not\(:disabled\):not\(\[aria-disabled="true"\]\)\s*\{\s*cursor:\s*pointer;/);
  assert.doesNotMatch(css, /input\s*\{\s*cursor:\s*pointer/);
});
