import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as buyerNavigation from "../lib/buyer-navigation.ts";
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types.js";

function harness(t, initialPath = "/") {
  const previousGlobals = { window: globalThis.window, document: globalThis.document };
  t.after(() => { for (const [key, value] of Object.entries(previousGlobals)) {
    if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
  } });
  const state = { pathname: initialPath, enabled: true, pending: false, refreshes: 0, reloads: 0, prefetches: [],
    auth: { isLoaded: true, userId: "user_a", sessionId: "session_a" } };
  const slots = [], scheduled = [], listeners = new Map();
  let cursor = 0;
  const start = work => { state.pending = true; work(); };
  const router = { refresh: () => state.refreshes++, prefetch: (path, options) => state.prefetches.push([path, options]) };
  globalThis.window = { location: { reload: () => state.reloads++ } };
  globalThis.document = { hidden: false,
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name); } };
  const dependencies = {
    "@/lib/buyer-navigation": buyerNavigation,
    "next/dist/client/components/router-reducer/router-reducer-types": { PrefetchKind },
    "react/jsx-runtime": jsx,
    react: {
      createContext: () => ({ Provider: "prefetch-provider" }),
      useRef: value => { const i = cursor++; return slots[i] ??= { current: value }; },
      useTransition: () => [state.pending, start],
      useEffect: (fn, deps) => {
        const i = cursor++, old = slots[i];
        if (!old || deps.some((value, n) => !Object.is(value, old.deps[n]))) {
          scheduled.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; });
        }
      },
    },
    "@clerk/nextjs": { useAuth: () => state.auth },
    "next/navigation": { usePathname: () => state.pathname, useRouter: () => router },
  };
  const source = readFileSync(new URL("../components/buyer-tab-navigation.tsx", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", code)(name => {
    assert.ok(name in dependencies, name); return dependencies[name];
  }, mod, mod.exports);
  return { state, listeners,
    render: () => { cursor = 0; return mod.exports.BuyerTabNavigation({ enabled: state.enabled, children: "private-view" }); },
    effects: () => { for (const fn of scheduled.splice(0)) fn(); },
    unmount: () => slots.forEach(slot => slot?.cleanup?.()),
  };
}

test("repeated navigation among prefetched overviews never clears Router Cache or disables prefetch", t => {
  const h = harness(t);
  assert.equal(h.render().props.children, "private-view"); h.effects();
  assert.equal(h.render().props.value, true);
  assert.equal(h.state.refreshes, 0);
  for (let round = 0; round < 10; round++) {
    for (const path of ["/ticket", "/", "/account", "/ticket", "/account", "/"]) {
      h.state.pathname = path;
      assert.equal(h.render().props.children, "private-view"); h.effects();
      assert.equal(h.render().props.value, true);
      assert.equal(h.state.refreshes, 0, `${path} must reuse full prefetch, not clear the other pages`);
    }
  }
});

test("form and fresh payment pages do not trigger a second read; returning to the overview revalidates", t => {
  const h = harness(t); h.render(); h.effects();
  h.state.pathname = "/request"; h.render(); h.effects();
  assert.equal(h.state.refreshes, 0);
  h.state.pending = false; h.render(); h.effects();
  h.state.pathname = "/ticket/payment/00000000-0000-4000-8000-000000000001"; h.render(); h.effects();
  assert.equal(h.state.refreshes, 0);
  assert.equal(h.render().props.value, true);
  h.state.pathname = "/ticket"; h.render(); h.effects();
  assert.equal(h.state.refreshes, 1);
  assert.equal(h.render().props.value, false, "Wait for the necessary workflow refresh before re-arming prefetch");
  h.state.pending = false; h.render(); h.effects();
  assert.equal(h.render().props.value, true);
  for (const path of ["/", "/ticket", "/account", "/"]) {
    h.state.pathname = path; h.render(); h.effects();
    assert.equal(h.state.refreshes, 1, "One workflow return must not cause a refresh on each subsequent click");
  }
});

test("leaving a request directly for account or Inicio still refreshes after possible submission changes", t => {
  const h = harness(t, "/request"); h.render(); h.effects();
  h.state.pathname = "/account"; h.render(); h.effects();
  assert.equal(h.state.refreshes, 1);
  h.state.pending = false; h.render(); h.effects();
  h.state.pathname = "/request"; h.render(); h.effects();
  assert.equal(h.state.refreshes, 1, "Do not refresh an editable form on entry");
  h.state.pathname = "/"; h.render(); h.effects();
  assert.equal(h.state.refreshes, 2);
});

test("workflow return warms every overview only after its necessary refresh completes", t => {
  const h = harness(t, "/ticket/payment/00000000-0000-4000-8000-000000000001");
  h.render(); h.effects();
  assert.deepEqual(h.state.prefetches, []);
  h.state.pathname = "/ticket"; h.render(); h.effects();
  assert.equal(h.state.refreshes, 1);
  h.render(); h.effects();
  assert.deepEqual(h.state.prefetches, [], "Never warm routes while the refresh can still discard them");
  h.state.pending = false; h.render(); h.effects();
  assert.deepEqual(h.state.prefetches, [["/", { kind: PrefetchKind.FULL }], ["/account", { kind: PrefetchKind.FULL }]]);
  h.state.pathname = "/"; h.render(); h.effects();
  assert.equal(h.state.refreshes, 1);
  assert.equal(h.state.prefetches.length, 2, "Overview transitions neither clear nor repeatedly warm the cache");
});

test("a completed refresh never warms private routes after account change, on admin or inside an editable form", t => {
  for (const mode of ["identity", "admin", "request"]) {
    const h = harness(t); h.render(); h.effects();
    h.listeners.get("visibilitychange")(); h.render(); h.effects();
    if (mode === "identity") h.state.auth.sessionId = "different-session";
    if (mode === "admin") { h.state.pathname = "/admin"; h.state.enabled = false; }
    if (mode === "request") h.state.pathname = "/request";
    h.state.pending = false; h.render(); h.effects();
    assert.deepEqual(h.state.prefetches, [], mode);
  }
});

test("admin, scanner, mocks and disabled roles do not get full buyer prefetches or refresh loops", t => {
  const h = harness(t, "/admin"); h.state.enabled = false;
  for (const path of ["/admin", "/admin/requests", "/scan", "/", "/ticket"]) {
    h.state.pathname = path; h.render(); h.effects();
    assert.equal(h.render().props.value, false);
  }
  assert.equal(h.state.refreshes, 0);
  h.state.enabled = true;
  for (const path of ["/ticket/preview", "/ticket/design", "/ticket/payment/preview"]) {
    h.state.pathname = path; h.render(); h.effects();
    assert.equal(h.render().props.value, false);
  }
});

test("account, request and real payment pages enable outgoing buyer prefetch, but editing a form never triggers visibility refresh", t => {
  const h = harness(t, "/account");
  assert.equal(h.render().props.value, true); h.effects();
  h.state.pathname = "/request";
  assert.equal(h.render().props.value, true); h.effects();
  h.listeners.get("visibilitychange")?.();
  h.render(); h.effects();
  assert.equal(h.state.refreshes, 0);
  h.state.pathname = "/ticket/payment/00000000-0000-4000-8000-000000000001";
  assert.equal(h.render().props.value, true); h.effects();
  assert.equal(h.state.refreshes, 0, "Payment already performs a fresh server read; do not duplicate it on entry");
});

test("leaving account for scanner or a QR detail does not refresh those excluded screens", t => {
  const h = harness(t, "/account"); h.render(); h.effects();
  for (const pathname of ["/scan", "/ticket/00000000-0000-4000-8000-000000000001", "/admin"]) {
    h.state.pathname = pathname;
    assert.equal(h.render().props.value, false); h.effects();
    assert.equal(h.state.refreshes, 0);
  }
});

test("account or session switch hides old content synchronously and clears Router Cache by document reload", t => {
  const h = harness(t); h.render(); h.effects();
  h.state.auth = { isLoaded: true, userId: "user_b", sessionId: "session_b" };
  assert.notEqual(h.render().props.children, "private-view"); h.effects();
  assert.equal(h.state.reloads, 1);
  h.render(); h.effects(); assert.equal(h.state.reloads, 1);
});

test("returning to a visible tab revalidates; hidden tabs do not refresh and listeners are cleaned up", t => {
  const h = harness(t); h.render(); h.effects();
  globalThis.document.hidden = true;
  h.listeners.get("visibilitychange")();
  assert.equal(h.state.refreshes, 0);
  globalThis.document.hidden = false;
  h.listeners.get("visibilitychange")(); assert.equal(h.state.refreshes, 1);
  h.state.auth.sessionId = null;
  assert.notEqual(h.render().props.children, "private-view"); h.effects();
  h.unmount(); assert.equal(h.listeners.size, 0);
});

test("sign-out never resets the account binding, even if another account signs in before the reload finishes", t => {
  const h = harness(t); h.render(); h.effects();
  h.state.auth = { isLoaded: true, userId: null, sessionId: null };
  assert.notEqual(h.render().props.children, "private-view"); h.effects();
  h.state.auth = { isLoaded: true, userId: "user_b", sessionId: "session_b" };
  assert.notEqual(h.render().props.children, "private-view"); h.effects();
  assert.equal(h.state.reloads, 1);
});

test("a new session for the same account also discards prefetched payloads", t => {
  const h = harness(t); h.render(); h.effects();
  h.state.auth.sessionId = "session_a_new";
  assert.notEqual(h.render().props.children, "private-view"); h.effects();
  assert.equal(h.state.reloads, 1);
});
