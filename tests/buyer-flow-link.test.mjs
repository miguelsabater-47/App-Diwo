import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as policy from "../lib/buyer-navigation.ts";

function harness() {
  const state = { enabled: true, pathname: "/" };
  const deps = {
    "react/jsx-runtime": jsx, react: { useContext: () => state.enabled },
    "next/link": { default: "a" }, "next/navigation": { usePathname: () => state.pathname },
    "@/components/buyer-tab-navigation": { BuyerTabPrefetch: {} }, "@/lib/buyer-navigation": policy,
  };
  const code = ts.transpileModule(readFileSync(new URL("../components/buyer-flow-link.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", code)(name => {
    assert.ok(name in deps, name); return deps[name];
  }, mod, mod.exports);
  return { state, Link: mod.exports.BuyerFlowLink };
}

test("full prefetch covers only exact buyer destinations in an enabled session and never the current page", () => {
  const { state, Link } = harness();
  for (const path of ["/", "/ticket", "/account", "/request"]) {
    assert.equal(Link({ href: path }).props.prefetch, path !== state.pathname);
    assert.equal(policy.isBuyerFlowPage(path), true);
  }
  state.pathname = "/account";
  assert.equal(Link({ href: "/" }).props.prefetch, true);
  assert.equal(Link({ href: "/account" }).props.prefetch, false);
  state.enabled = false;
  for (const path of ["/", "/ticket", "/account", "/request"]) assert.equal(Link({ href: path }).props.prefetch, false);
});

test("payment gets native shell prefetch only; paid/cancelled state is still read on the server at entry", () => {
  const { Link } = harness();
  const payment = "/ticket/payment/00000000-0000-4000-8000-000000000001";
  assert.equal(policy.isBuyerFlowPage(payment), true);
  assert.equal(policy.isBuyerCachedPage(payment), false);
  assert.equal(Link({ href: payment }).props.prefetch, undefined);
  for (const path of ["/admin", "/admin/scan", "/scan", "/ticket/00000000-0000-4000-8000-000000000001",
    "/ticket/design", "/ticket/preview", "/ticket/payment/preview", "/ticket/payment/invalid", "/request?preview=1", "https://example.invalid/account"]) {
    assert.equal(policy.isBuyerFlowPage(path), false, path);
    assert.equal(Link({ href: path }).props.prefetch, undefined, path);
  }
});

test("prefetch/render never executes navigation actions and preserves native Link props and refs", () => {
  const { Link } = harness();
  let actions = 0;
  const onNavigate = () => actions++, ref = { current: null };
  const view = Link({ href: "/request", onNavigate, ref, className: "cta", "aria-label": "Solicitar entradas", children: "Solicitar" });
  assert.equal(actions, 0);
  assert.equal(view.props.onNavigate, onNavigate);
  assert.equal(view.props.ref, ref);
  assert.equal(view.props.className, "cta");
  assert.equal(view.props["aria-label"], "Solicitar entradas");
  assert.equal(view.props.href, "/request");
  view.props.onNavigate(); assert.equal(actions, 1);
});
