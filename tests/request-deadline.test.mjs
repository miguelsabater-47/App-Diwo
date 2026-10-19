import assert from "node:assert/strict";
import { test } from "node:test";
import { withRequestDeadline } from "../lib/request-deadline.ts";

test("deadline covers a request and its body without newer static AbortSignal APIs", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal;
  assert.equal(await withRequestDeadline(async current => { signal = current; return "body"; }, 1000), "body");
  t.mock.timers.tick(1000);
  assert.equal(signal.aborted, false, "Completion clears the timer");
});
test("timeout aborts exactly once and never retries the operation", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const work = withRequestDeadline(signal => {
    calls++;
    return new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  }, 1000);
  const rejected = assert.rejects(work, { name: "TimeoutError" });
  t.mock.timers.tick(1000); await rejected;
  assert.equal(calls, 1);
});
test("parent cancellation aborts pending work and an already-cancelled parent prevents it", async () => {
  const parent = new AbortController();
  let calls = 0;
  const operation = signal => {
    calls++;
    return new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  };
  const work = withRequestDeadline(operation, 1000, parent.signal);
  const rejected = assert.rejects(work, { name: "AbortError" });
  parent.abort(); await rejected;
  await assert.rejects(withRequestDeadline(operation, 1000, parent.signal), { name: "AbortError" });
  assert.equal(calls, 1);
});

test("older browsers without AbortSignal.reason still report timeouts instead of a silent cancellation", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const work = withRequestDeadline(signal => {
    Object.defineProperty(signal, "reason", { value: undefined });
    return new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
  }, 1000);
  const rejected = assert.rejects(work, { name: "TimeoutError" });
  t.mock.timers.tick(1000); await rejected;
});
