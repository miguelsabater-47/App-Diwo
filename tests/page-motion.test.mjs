import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

const originalWindow = globalThis.window;
after(() => { if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow; });
const source = readFileSync(new URL("../components/page-motion.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness({ reduced = false, supported = true, animationError = false } = {}) {
  const animations = [], listeners = new Set();
  const preference = { matches: reduced, addEventListener: (_event, callback) => listeners.add(callback), removeEventListener: (_event, callback) => listeners.delete(callback) };
  globalThis.window = { matchMedia: query => { assert.equal(query, "(prefers-reduced-motion: reduce)"); return preference; } };
  let dependencies, pending, cleanup;
  const ref = { current: supported ? { animate: (frames, options) => {
    if (animationError) throw new Error("animation_unavailable");
    const result = { frames, options, cancelled: false, cancel() { this.cancelled = true; } };
    animations.push(result); return result;
  } } : {} };
  const mod = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    if (name === "react/jsx-runtime") return jsx;
    assert.equal(name, "react", "No animation library, router, request or navigation dependencies");
    return { useRef: () => ref, useEffect: (callback, deps) => {
      if (!dependencies || deps.some((value, index) => value !== dependencies[index])) { dependencies = deps; pending = callback; }
    } };
  }, mod, mod.exports);
  return { animations, listeners, preference,
    render: (pathname, children = jsx.jsx("section", { children: "Page content" })) => {
      const view = mod.exports.PageMotion({ pathname, children });
      if (pending) { cleanup?.(); const callback = pending; pending = null; cleanup = callback(); }
      assert.equal(view.props.children, children, "Never clone, defer or replace the page content");
      assert.equal(view.key, null, "Do not remount forms or cached content with a pathname key");
      assert.equal(view.props.style, undefined, "Content is visible without animation support or JavaScript effects");
      return view;
    },
    reduce: () => { preference.matches = true; for (const callback of listeners) callback(); },
    unmount: () => cleanup?.(),
  };
}

test("incoming content moves only 6px for 160ms; tab changes and browser-back paths animate without exit waits", () => {
  const h = harness();
  for (const path of ["/", "/ticket", "/", "/account", "/request", "/ticket/payment/example", "/admin/requests"]) {
    assert.equal(h.render(path).props["data-motion"], "enabled");
    const animation = h.animations.at(-1);
    assert.deepEqual(animation.frames, [{ opacity: 0.7, transform: "translateY(6px)" }, { opacity: 1, transform: "translateY(0)" }]);
    assert.equal(animation.options.duration, 160);
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
  assert.equal(h.animations.at(-1).cancelled, true);
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

test("menu crossfades only its highlight; presses are quick and disabled for reduced motion", () => {
  const css = readFileSync(new URL("../components/app-interface.css", import.meta.url), "utf8");
  assert.match(css, /\.diwo-app-tab::before\s*\{[^}]*opacity:\s*0;[^}]*pointer-events:\s*none;[^}]*transition:\s*opacity 120ms ease/);
  assert.match(css, /\.diwo-app-tab-active::before\s*\{\s*opacity:\s*1/);
  assert.match(css, /\.diwo-app-tab:active\s*\{\s*scale:\s*0\.98/);
  assert.match(css, /data-motion="enabled"[^}]*:not\(:disabled\):not\(\[aria-disabled="true"\]\):active\s*\{\s*scale:\s*0\.98/);
  const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(reduced, /\.diwo-app-tab, \.diwo-app-tab::before,[^{]*\{\s*transition:\s*none/);
  assert.match(reduced, /data-motion="enabled"[^}]*:not\(:disabled\):not\(\[aria-disabled="true"\]\):active\s*\{\s*scale:\s*none/);
});
