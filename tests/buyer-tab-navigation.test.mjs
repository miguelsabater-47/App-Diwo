import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as buyerNavigation from "../lib/buyer-navigation.ts";

function harness(t, initialPath = "/") {
  const previousGlobals = { window: globalThis.window, document: globalThis.document };
  t.after(() => { for (const [key, value] of Object.entries(previousGlobals)) {
    if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
  } });
  const state = { pathname: initialPath, enabled: true, pending: false, refreshes: 0, reloads: 0,
    auth: { isLoaded: true, userId: "user_a", sessionId: "session_a" } };
  const slots = [], scheduled = [], listeners = new Map();
  let cursor = 0;
  const start = work => { state.pending = true; work(); };
  const router = { refresh: () => state.refreshes++ };
  globalThis.window = { location: { reload: () => state.reloads++ } };
  globalThis.document = { hidden: false,
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name); } };
  const dependencies = {
    "@/lib/buyer-navigation": buyerNavigation,
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

test("preloads only the other buyer tab and refreshes in the background without hiding the current view", t => {
  const h = harness(t);
  assert.equal(h.render().props.children, "private-view"); h.effects();
  assert.equal(h.render().props.value, true);
  assert.equal(h.state.refreshes, 0);
  h.state.pathname = "/ticket";
  h.render(); h.effects();
  assert.equal(h.state.refreshes, 1);
  assert.equal(h.render().props.children, "private-view"); h.effects();
  assert.equal(h.render().props.value, false, "Do not prefetch data that a pending refresh will discard");
  h.state.pending = false; h.render(); h.effects();
  assert.equal(h.render().props.value, true, "Re-enable full Link prefetch after refresh clears Router Cache");
  h.render(); h.effects();
  assert.equal(h.state.refreshes, 1, "No refresh loop after server reconciliation");
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
