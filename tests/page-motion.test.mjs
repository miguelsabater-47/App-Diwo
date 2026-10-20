import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as motionModel from "../lib/page-motion-model.ts";

const originalWindow = globalThis.window;
after(() => { if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow; });
const source = readFileSync(new URL("../components/page-motion.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness({ reduced = false, supported = true, animationError = false } = {}) {
  const animations = [], listeners = new Set(), traversals = new Set(), slots = [];
  const preference = { matches: reduced, addEventListener: (_event, callback) => listeners.add(callback), removeEventListener: (_event, callback) => listeners.delete(callback) };
  globalThis.window = { location: { pathname: "/" },
    addEventListener: (name, callback, capture) => { assert.equal(name, "popstate"); assert.equal(capture, true); traversals.add(callback); },
    removeEventListener: (_name, callback) => traversals.delete(callback),
    matchMedia: query => { assert.equal(query, "(prefers-reduced-motion: reduce)"); return preference; } };
  let index = 0, pending = [];
  const node = supported ? { animate: (frames, options) => {
    if (animationError) throw new Error("animation_unavailable");
    const result = { frames, options, cancelled: false, cancel() { this.cancelled = true; } };
    animations.push(result); return result;
  } } : {};
  const effect = phase => (callback, deps) => {
    const slot = index++;
    if (!slots[slot] || deps.some((value, position) => value !== slots[slot].deps[position])) {
      const previous = slots[slot]; slots[slot] = { deps, cleanup: previous?.cleanup };
      pending.push({ slot, callback, phase });
    }
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    if (name === "react/jsx-runtime") return jsx;
    if (name === "@/lib/page-motion-model") return motionModel;
    if (name === "@/lib/scroll-reveal") return { startScrollReveal: () => () => {} };
    assert.equal(name, "react", "No animation library, router, request or navigation dependencies");
    return { useRef: initial => { const slot = index++; return slots[slot] ?? (slots[slot] = { current: initial === null ? node : initial }); },
      useLayoutEffect: effect(0), useEffect: effect(1) };
  }, mod, mod.exports);
  return { animations, listeners, preference, traversals,
    render: (pathname, children = jsx.jsx("section", { children: "Page content" })) => {
      index = 0; pending = []; window.location.pathname = pathname;
      const view = mod.exports.PageMotion({ pathname, children });
      for (const item of pending.sort((a, b) => a.phase - b.phase)) { slots[item.slot].cleanup?.(); slots[item.slot].cleanup = item.callback(); }
      assert.equal(view.props.children, children, "Never clone, defer or replace the page content");
      assert.equal(view.key, null, "Do not remount forms or cached content with a pathname key");
      assert.equal(view.props.style, undefined, "Content is visible without animation support or JavaScript effects");
      return view;
    },
    reduce: () => { preference.matches = true; for (const callback of listeners) callback(); },
    pop: pathname => { window.location.pathname = pathname; for (const callback of traversals) callback({}); },
    unmount: () => { for (const slot of slots) slot?.cleanup?.(); },
  };
}

test("incoming pages slide directionally without fading, scaling, remounting or exit waits", () => {
  const h = harness();
  for (const path of ["/", "/ticket", "/", "/account", "/request", "/ticket/payment/example", "/admin/requests"]) {
    assert.equal(h.render(path).props["data-motion"], "enabled");
    const animation = h.animations.at(-1);
    assert.equal(animation.frames[1].transform, "translate(0, 0)");
    assert.equal(animation.frames.some(frame => "opacity" in frame || frame.transform.includes("scale")), false);
    assert.equal(animation.options.duration, 280);
    assert.equal(animation.options.delay, undefined);
    assert.equal(animation.options.fill, undefined);
  }
  assert.equal(h.animations.length, 7);
  assert.equal(h.animations.slice(0, -1).every(animation => animation.cancelled), true);
  assert.equal(h.listeners.size, 1);
  h.render("/admin/requests", jsx.jsx("section", { children: "Updated live data" }));
  assert.equal(h.animations.length, 7, "Revalidation and form edits on the same route do not restart the animation");
  h.unmount();
  assert.equal(h.listeners.size, 0);
  assert.equal(h.traversals.size, 0);
  assert.equal(h.animations.at(-1).cancelled, true);
});

test("browser back enters from the left even against tab order; forward traversal enters from the right", () => {
  const h = harness();
  h.render("/"); h.render("/account"); h.render("/ticket");
  h.pop("/account"); h.render("/account");
  assert.equal(h.animations.at(-1).frames[0].transform, "translateX(-40px)");
  h.pop("/ticket"); h.render("/ticket");
  assert.equal(h.animations.at(-1).frames[0].transform, "translateX(40px)");
  h.render("/request"); h.render("/");
  assert.equal(h.animations.at(-1).frames[0].transform, "translateX(-40px)");
  h.unmount();
});

test("QR details, ticket design and scanner routes stay static, including trailing slashes", () => {
  const h = harness();
  for (const path of ["/ticket/00000000-0000-4000-8000-000000000001", "/ticket/design", "/scan", "/admin/scan", "/admin/scan/live"]) {
    for (const route of [path, `${path}/`]) assert.equal(h.render(route).props["data-motion"], "disabled");
  }
  assert.equal(h.animations.length, 0);
  assert.equal(h.render("/ticket/preview").props["data-motion"], "enabled");
});

test("reduced motion and unavailable animation APIs keep pages immediately visible and cancel active motion", () => {
  for (const options of [{ reduced: true }, { supported: false }, { animationError: true }]) {
    const h = harness(options);
    h.render("/"); h.render("/ticket");
    assert.equal(h.animations.length, 0);
    assert.equal(h.listeners.size, 0);
  }
  const h = harness(); h.render("/"); h.reduce();
  assert.equal(h.animations[0].cancelled, true);
  h.render("/ticket");
  assert.equal(h.animations.length, 1);
  assert.equal(h.listeners.size, 0);
});

test("one menu indicator slides between tabs without opacity or press scaling; reduced motion disables it", () => {
  const css = readFileSync(new URL("../components/app-interface.css", import.meta.url), "utf8");
  const indicator = css.match(/\.diwo-app-navigation-items::before\s*\{([^}]+)\}/)?.[1];
  assert.ok(indicator);
  assert.match(indicator, /transform:\s*translateX/);
  assert.match(indicator, /transition:\s*transform 280ms cubic-bezier/);
  assert.doesNotMatch(indicator, /opacity:|scale:/);
  assert.doesNotMatch(css, /\.diwo-app-tab::before|\.diwo-app-tab:active/);
  assert.match(css, /data-motion="enabled"[^}]*:not\(:disabled\):not\(\[aria-disabled="true"\]\):active\s*\{\s*scale:\s*0\.95/);
  const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(reduced, /\.diwo-app-tab, \.diwo-app-navigation-items::before,[^{]*\{\s*transition:\s*none/);
  assert.match(reduced, /data-motion="enabled"[^}]*:not\(:disabled\):not\(\[aria-disabled="true"\]\):active\s*\{\s*scale:\s*none/);
});
