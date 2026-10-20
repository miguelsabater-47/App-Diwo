import assert from "node:assert/strict";
import { after, test } from "node:test";
import { startScrollReveal } from "../lib/scroll-reveal.ts";

const originalWindow = globalThis.window;
after(() => { if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow; });
function harness({ reduced = false, supported = true } = {}) {
  const animations = [], observed = new Set(), listeners = new Set();
  let intersect, mutation, disconnected = false, mutationDisconnected = false;
  const preference = { matches: reduced, addEventListener: (_name, fn) => listeners.add(fn), removeEventListener: (_name, fn) => listeners.delete(fn) };
  const element = (top, annotated = true) => ({ nodeType: 1, matches: () => annotated,
    getBoundingClientRect: () => ({ top }), querySelectorAll: () => [],
    animate: (frames, options) => { const animation = { frames, options, cancel() { this.cancelled = true; } }; animations.push(animation); return animation; } });
  const visible = element(100), below = element(1200), privateQr = element(1300, false);
  const children = new Set([visible, below, privateQr]);
  const root = { contains: node => children.has(node), querySelectorAll: () => [...children].filter(node => node.matches()) };
  globalThis.window = { innerHeight: 800,
    IntersectionObserver: supported ? class {
      constructor(callback, options) { intersect = callback; assert.equal(options.threshold, 0.1); }
      observe(node) { observed.add(node); } unobserve(node) { observed.delete(node); }
      disconnect() { disconnected = true; observed.clear(); }
    } : undefined,
    MutationObserver: class {
      constructor(callback) { mutation = callback; }
      observe(node, options) { assert.equal(node, root); assert.deepEqual(options, { childList: true, subtree: true }); }
      disconnect() { mutationDisconnected = true; }
    },
  };
  return { root, preference, animations, observed, visible, below, privateQr, listeners,
    enter: node => intersect?.([{ target: node, isIntersecting: true }]),
    add: top => { const node = element(top); children.add(node); mutation([{ addedNodes: [node], removedNodes: [] }]); return node; },
    remove: node => { children.delete(node); mutation([{ addedNodes: [], removedNodes: [node] }]); },
    reduce: () => { preference.matches = true; for (const fn of listeners) fn(); },
    disconnected: () => disconnected && mutationDisconnected,
  };
}

test("only annotated below-fold blocks reveal once; above-fold content and private QR remain untouched", () => {
  const h = harness(), stop = startScrollReveal(h.root, h.preference);
  assert.deepEqual([...h.observed], [h.below]);
  h.enter(h.below); h.enter(h.below); h.enter(h.visible); h.enter(h.privateQr);
  assert.equal(h.animations.length, 1);
  assert.deepEqual(h.animations[0].frames, [{ opacity: 0.65, transform: "translateY(10px)" }, { opacity: 1, transform: "translateY(0)" }]);
  assert.equal(h.animations[0].options.duration, 240);
  assert.equal(h.animations[0].options.delay, undefined);
  stop(); assert.equal(h.disconnected(), true); assert.equal(h.animations[0].cancelled, true);
  assert.equal(h.listeners.size, 0);
});

test("streamed cards are observed without scrolling listeners; removed blocks and route cleanup cannot animate later", () => {
  const h = harness(), stop = startScrollReveal(h.root, h.preference);
  const streamed = h.add(1100); assert.equal(h.observed.has(streamed), true);
  h.remove(streamed); assert.equal(h.observed.has(streamed), false);
  h.enter(streamed); assert.equal(h.animations.length, 0);
  stop(); h.enter(h.below); assert.equal(h.animations.length, 0);
});

test("reduced motion and missing IntersectionObserver leave all content visible; changing the preference cancels active reveals", () => {
  for (const options of [{ reduced: true }, { supported: false }]) {
    const h = harness(options); startScrollReveal(h.root, h.preference)();
    assert.equal(h.observed.size, 0); assert.equal(h.animations.length, 0);
  }
  const h = harness(), stop = startScrollReveal(h.root, h.preference);
  h.enter(h.below); h.reduce();
  assert.equal(h.disconnected(), true); assert.equal(h.animations[0].cancelled, true);
  h.enter(h.below); assert.equal(h.animations.length, 1); stop();
});
