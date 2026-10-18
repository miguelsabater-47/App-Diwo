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

test("account email is a non-actionable right-aligned badge; profile modal controls are removed and logout preserved", () => {
  const state = { isLoaded: true, user: { primaryEmailAddress: { emailAddress: "buyer@example.invalid" } } };
  const { AccountEmail, AccountActions } = load("../components/account-actions.tsx", {
    "@clerk/nextjs": { useUser: () => state, SignOutButton: "signout" },
    "@/components/ui/button": { Button: "button" },
  });
  const email = AccountEmail();
  assert.match(text(email), /buyer@example\.invalid/);
  for (const style of ["ml-auto", "text-right", "border", "rounded-xl", "break-all"]) assert.ok(email.props.className.includes(style), style);
  assert.equal(nodes(email).some(node => ["a", "button"].includes(node.type) || node.props?.onClick), false);
  state.isLoaded = false;
  assert.match(text(AccountEmail()), /Cargando cuenta/);
  assert.doesNotMatch(text(AccountEmail()), /buyer@example/);
  state.isLoaded = true; state.user = null;
  assert.match(text(AccountEmail()), /Correo no disponible/);
  const actions = AccountActions();
  assert.deepEqual(nodes(actions).filter(node => node.type === "button").map(text), ["Cerrar sesión"]);
  assert.equal(nodes(actions).find(node => node.type === "signout").props.redirectUrl, "/sign-in");
  assert.doesNotMatch(text(actions), /Mi perfil|Configuración de cuenta/);
});

test("buyer account shows email beside heading and Inicio, Mis entradas, logout in that order with existing colors", async () => {
  let signed = true, access = { ok: true, role: "user" }, personalReads = 0;
  const Page = load("../app/account/page.tsx", {
    "@/components/buyer-flow-link": { BuyerFlowLink: "a" },
    "@clerk/nextjs/server": { auth: async () => ({ userId: signed ? "user_buyer" : null }) },
    "next/navigation": { redirect: path => { throw new Error(`redirect:${path}`); } },
    "next/link": { default: "a" }, "@/components/ui/button": { Button: "button" },
    "@/components/account-actions": { AccountEmail: "email", AccountActions: "logout" },
    "@/lib/local-access": { hasConfiguredClerkKeys: () => true },
    "@/lib/app-authorization": { getCurrentAppAccess: async () => access },
    "@/lib/order-reads": { readOrderOverview: async scope => { assert.equal(scope, "buyer"); personalReads++; return { ok: true, orders: [] }; } },
    "@/lib/buyer-request-context": { buyerRequestContext: () => ({ eventId: null, recorded: [] }) },
    "@/components/new-order-link": { NewOrderLink: "request" },
  }).default;
  const view = await Page(), all = nodes(view);
  const heading = all.find(node => node.type === "header");
  assert.ok(nodes(heading).some(node => node.type === "h1" && text(node) === "Mi cuenta"));
  assert.ok(nodes(heading).some(node => node.type === "email"));
  assert.deepEqual(all.filter(node => node.type === "a" || node.type === "logout").map(node => node.props.href ?? "logout"), ["/", "/ticket", "logout"]);
  const buttons = all.filter(node => node.type === "button");
  assert.equal(buttons[0].props.variant ?? "default", "default");
  assert.equal(buttons[1].props.variant, "secondary");
  assert.equal(personalReads, 0);
  access = { ok: true, role: "admin" };
  assert.ok(nodes(await Page()).some(node => node.type === "request"));
  assert.equal(personalReads, 1);
  access = { ok: true, role: "door_staff" };
  assert.ok(nodes(await Page()).some(node => node.props?.href === "/scan"));
  access = { ok: false, status: 503 };
  assert.ok(nodes(await Page()).some(node => node.props?.role === "alert"));
  signed = false;
  await assert.rejects(Page(), /redirect:\/sign-in/);
});

test("global cursor rule covers actionable controls but excludes disabled controls and text inputs", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /:where\(button,\s*a\[href\],\s*\[role="button"\],[\s\S]*?\):not\(:disabled\):not\(\[aria-disabled="true"\]\)\s*\{\s*cursor:\s*pointer;/);
  assert.doesNotMatch(css, /input\s*\{\s*cursor:\s*pointer/);
});
