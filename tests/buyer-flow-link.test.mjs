import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as policy from "../lib/buyer-navigation.ts";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { PrefetchKind, PrefetchCacheEntryStatus } from "next/dist/client/components/router-reducer/router-reducer-types.js";

function harness() {
  const state = { enabled: true, pathname: "/" };
  const deps = {
    "react/jsx-runtime": jsx, react: { useContext: () => state.prefetchContext ?? { enabled: state.enabled, homeHref: "/" } },
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

test("Home namespace affects only enabled buyer Home links, never QR, admin, payment or form URLs", () => {
  const { state, Link } = harness(); state.pathname = "/ticket";
  state.prefetchContext = { enabled: true, homeHref: "/?_buyer_nav=synthetic-current-document" };
  assert.equal(Link({ href: "/" }).props.href, state.prefetchContext.homeHref);
  for (const path of ["/account", "/ticket", "/request", "/admin", "/scan", "/ticket/00000000-0000-4000-8000-000000000001",
    "/ticket/payment/00000000-0000-4000-8000-000000000001", "/ticket/preview", "/?untrusted=1"]) {
    assert.equal(Link({ href: path }).props.href, path);
  }
  state.prefetchContext.enabled = false;
  assert.equal(Link({ href: "/" }).props.href, "/");
  assert.equal(Link({ href: "/" }).props.prefetch, false);
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

// Run the installed Next 15 cache implementation, not a mock that assumes a
// full-prefetch request necessarily upgrades the initial document's cache entry.
function nextCache() {
  const require = createRequire(import.meta.url), mod = { exports: {} }, reads = [];
  const data = { flightData: [{ isRootRender: true, seedData: ["", {}, {}, null, false] }], couldBeIntercepted: false, prerendered: false, staleTime: -1 };
  const deps = {
    "./router-reducer-types": { PrefetchKind, PrefetchCacheEntryStatus },
    "./reducers/prefetch-reducer": { prefetchQueue: { enqueue: work => Promise.resolve().then(work) } },
    "./fetch-server-response": { fetchServerResponse: async url => { reads.push(url.href); return data; } },
  };
  runInNewContext(readFileSync(require.resolve("next/dist/client/components/router-reducer/prefetch-cache-utils.js"), "utf8"), {
    module: mod, exports: mod.exports, URL, process: { env: { NODE_ENV: "production", __NEXT_CLIENT_ROUTER_DYNAMIC_STALETIME: "0", __NEXT_CLIENT_ROUTER_STATIC_STALETIME: "300" } },
    require: name => { assert.ok(name in deps, name); return deps[name]; },
  });
  return { ...mod.exports, data, reads };
}

test("returning Home from tickets/account reuses full data instead of the initial document's loading-only cache", async () => {
  for (const from of ["/ticket", "/account"]) {
    for (const initial of ["/", "/?_buyer_nav=previous-document"]) {
      const { state, Link } = harness();
      state.pathname = from;
      state.prefetchContext = { enabled: true, homeHref: "/?_buyer_nav=current-document" };
      const cache = nextCache(), prefetchCache = new Map(), tree = [];
      cache.createSeededPrefetchCacheEntry({ url: new URL(initial, "https://app.example.invalid"), tree, prefetchCache,
        data: cache.data, kind: PrefetchKind.AUTO });
      const link = Link({ href: "/" });
      assert.equal(link.props.prefetch, true);
      const args = { url: new URL(link.props.href, "https://app.example.invalid"), tree, prefetchCache, kind: PrefetchKind.FULL };
      await cache.getOrCreatePrefetchCacheEntry(args).data;
      const revisited = cache.getOrCreatePrefetchCacheEntry(args);
      assert.equal(revisited.status, "reusable", `${initial} -> ${from} -> Inicio must reuse page data, not just loading.tsx`);
      assert.equal(revisited.kind, PrefetchKind.FULL);
    }
  }
});
