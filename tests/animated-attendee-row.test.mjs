import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

const originalWindow = globalThis.window;
after(() => { if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow; });
const compiled = ts.transpileModule(readFileSync(new URL("../components/animated-attendee-row.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
function harness({ reduced = false, supported = true, fail = false } = {}) {
  const slots = [], animations = [], listeners = new Set();
  let index = 0, effects = [];
  const preference = { matches: reduced, addEventListener: (_name, fn) => listeners.add(fn), removeEventListener: (_name, fn) => listeners.delete(fn) };
  globalThis.window = { matchMedia: () => preference };
  const node = { getBoundingClientRect: () => ({ height: 112 }) };
  if (supported) node.animate = (frames, options) => {
    if (fail) throw new Error("animation_failed");
    const animation = { frames, options, cancelled: false, cancel() { this.cancelled = true; } }; animations.push(animation); return animation;
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    if (name === "react/jsx-runtime") return jsx;
    assert.equal(name, "react");
    return { useRef: initial => { const slot = index++; return slots[slot] ?? (slots[slot] = { current: initial === null ? node : initial }); },
      useLayoutEffect: (fn, deps) => {
        const slot = index++, previous = slots[slot];
        if (!previous || deps.some((value, position) => value !== previous.deps[position])) {
          slots[slot] = { deps, cleanup: previous?.cleanup }; effects.push(() => { slots[slot].cleanup?.(); slots[slot].cleanup = fn(); });
        }
      } };
  }, mod, mod.exports);
  return { animations, listeners,
    render: props => { index = 0; effects = []; const row = mod.exports.AnimatedAttendeeRow({ children: "Attendee fields", ...props }); effects.forEach(fn => fn()); return row; },
    reduce: () => { preference.matches = true; for (const fn of listeners) fn(); },
    unmount: () => { for (const slot of slots) slot?.cleanup?.(); },
  };
}

test("adding expands height once in 180ms ease-in-out; typing and rerenders never restart it", () => {
  const h = harness(); h.render({});
  assert.equal(h.animations.length, 1);
  const animation = h.animations[0];
  assert.deepEqual(animation.frames.map(frame => frame.height), ["0px", "112px"]);
  assert.deepEqual(animation.options, { duration: 180, easing: "ease-in-out", fill: "none" });
  h.render({ children: "Edited name" }); assert.equal(h.animations.length, 1);
  h.unmount(); assert.equal(animation.cancelled, true); assert.equal(h.listeners.size, 0);
});

test("removing collapses a non-focusable visual row, calls the latest completion and ignores late completion after unmount", () => {
  const h = harness(); let old = 0, latest = 0;
  const row = h.render({ exiting: true, onExited: () => old++ });
  assert.equal(row.props.inert, true); assert.equal(row.props["aria-hidden"], true);
  assert.deepEqual(h.animations[0].frames.map(frame => frame.height), ["112px", "0px"]);
  assert.equal(h.animations[0].options.fill, "forwards");
  h.render({ exiting: true, onExited: () => latest++ });
  assert.equal(h.animations.length, 1);
  const finish = h.animations[0].onfinish; finish();
  assert.equal(old, 0); assert.equal(latest, 1);
  finish(); assert.equal(latest, 1);
  h.unmount(); finish(); assert.equal(latest, 1);
});

test("reduced motion, absent APIs and animation errors remove snapshots immediately without gating the real form", () => {
  for (const options of [{ reduced: true }, { supported: false }, { fail: true }]) {
    const h = harness(options); let completed = 0;
    h.render({ exiting: true, onExited: () => completed++ });
    assert.equal(completed, 1); assert.equal(h.animations.length, 0);
  }
  const h = harness(); let completed = 0;
  h.render({ exiting: true, onExited: () => completed++ }); h.reduce();
  assert.equal(completed, 1); assert.equal(h.animations[0].cancelled, true); h.unmount();
  const first = harness(); first.render({ animate: false }); assert.equal(first.animations.length, 0);
});
