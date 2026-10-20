import assert from "node:assert/strict";
import { test } from "node:test";
import { advanceMotionHistory, motionPath, pageMotionEnabled } from "../lib/page-motion-model.ts";

test("navigation model tracks bounded route strings, tab directions and semantic parent returns without browser state", () => {
  const history = { paths: [], index: 0, pop: false };
  for (const [path, expected] of [["/", "initial"], ["/ticket", "forward"], ["/", "back"], ["/request", "forward"], ["/", "back"], ["/ticket/payment/id", "forward"], ["/ticket", "back"]]) {
    assert.equal(advanceMotionHistory(history, path), expected);
  }
  for (let index = 0; index < 100; index++) advanceMotionHistory(history, `/page/${index}`);
  assert.equal(history.paths.length, 64);
  assert.equal(history.index, 63);
});

test("pop traversal, same-path entries and unknown bookmarked predecessors do not poison the next navigation", () => {
  const h = { paths: [], index: 0, pop: false };
  advanceMotionHistory(h, "/"); advanceMotionHistory(h, "/account"); advanceMotionHistory(h, "/ticket");
  h.pop = true; assert.equal(advanceMotionHistory(h, "/account"), "back");
  h.pop = true; assert.equal(advanceMotionHistory(h, "/ticket"), "forward");
  h.pop = true; assert.equal(advanceMotionHistory(h, "/ticket"), "initial");
  assert.equal(advanceMotionHistory(h, "/request"), "forward");
  h.pop = true; assert.equal(advanceMotionHistory(h, "/outside-record"), "back");
  assert.equal(h.pop, false);
});

test("normalization and motion exclusions preserve QR and scanner immediacy", () => {
  assert.equal(motionPath("/"), "/"); assert.equal(motionPath("/request/"), "/request");
  for (const path of ["/ticket/a", "/ticket/design", "/scan", "/admin/scan", "/admin/scan/child"]) assert.equal(pageMotionEnabled(path), false);
  for (const path of ["/", "/ticket", "/ticket/preview", "/request", "/ticket/payment/a", "/admin/requests"]) assert.equal(pageMotionEnabled(path), true);
});
