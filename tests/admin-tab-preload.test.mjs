import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

function harness() {
  const loaded = [], state = { fail: false };
  const code = ts.transpileModule(readFileSync(new URL("../components/admin-tab-link.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", code)(name => {
    if (name === "react/jsx-runtime") return jsx;
    if (name === "next/link") return { default: "a" };
    assert.ok(["@/components/admin-requests", "@/components/admin-tickets", "@/components/door-staff-manager"].includes(name), name);
    loaded.push(name);
    if (state.fail) throw new Error("synthetic_chunk_failure");
    return {};
  }, mod, mod.exports);
  return { loaded, state, Link: mod.exports.AdminTabLink };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test("hover, keyboard focus and touch warm only screen code once, never mount or request private data", async () => {
  const h = harness(), ref = { current: null };
  const view = h.Link({ href: "/admin/requests", className: "tab", children: "Solicitudes", ref });
  assert.deepEqual(h.loaded, [], "Rendering must not start a data request or preload all tabs");
  assert.equal(view.type, "a"); assert.equal(view.props.prefetch, undefined);
  assert.equal(view.props.ref, ref); assert.equal(view.props.className, "tab");
  for (const event of ["onPointerEnter", "onFocus", "onTouchStart"]) view.props[event]({ defaultPrevented: false });
  await tick();
  assert.deepEqual(h.loaded, ["@/components/admin-requests"]);
  for (const [path, module] of [["/admin/tickets", "admin-tickets"], ["/admin/staff", "door-staff-manager"]]) {
    h.Link({ href: path }).props.onFocus({ defaultPrevented: false }); await tick();
    assert.equal(h.loaded.at(-1), `@/components/${module}`);
  }
});

test("scanner, QR, previews, active and disabled links are not warmed, original events and navigation are preserved", async () => {
  const h = harness();
  for (const href of ["/admin/scan", "/scan", "/admin", "/ticket/id", "/admin/requests?preview=1", "https://example.invalid/admin/requests"]) {
    h.Link({ href }).props.onPointerEnter({ defaultPrevented: false });
  }
  h.Link({ href: "/admin/requests", "aria-current": "page" }).props.onFocus({ defaultPrevented: false });
  h.Link({ href: "/admin/requests", "aria-disabled": true }).props.onFocus({ defaultPrevented: false });
  h.Link({ href: "/admin/requests", "aria-disabled": "true" }).props.onFocus({ defaultPrevented: false });
  let events = 0;
  const onNavigate = () => {};
  const view = h.Link({ href: "/admin/requests", onNavigate, onFocus: event => { events++; event.defaultPrevented = true; } });
  view.props.onFocus({ defaultPrevented: false }); await tick();
  assert.equal(events, 1); assert.equal(view.props.onNavigate, onNavigate);
  assert.deepEqual(h.loaded, []);
});

test("a failed code preload is contained and can be retried without intercepting the actual navigation", async () => {
  const h = harness(); h.state.fail = true;
  const view = h.Link({ href: "/admin/tickets" });
  view.props.onPointerEnter({ defaultPrevented: false }); await tick();
  assert.equal(h.loaded.length, 1); assert.equal(view.props.onClick, undefined);
  h.state.fail = false;
  view.props.onFocus({ defaultPrevented: false }); await tick();
  assert.equal(h.loaded.length, 2);
});
