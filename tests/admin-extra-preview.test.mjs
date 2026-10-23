import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

test("the fictional standalone preview stays local-only while real management uses its separate guarded page", async () => {
  let allowed = false;
  const mod = { exports: {} };
  const dependencies = {
    "react/jsx-runtime": jsx,
    "next/navigation": { notFound() { throw new Error("not_found"); } },
    "@/lib/local-access": { isLocalPaymentPreview: () => allowed },
    "@/components/extra-ticket-prototype": { ExtraTicketPrototype: "prototype" },
    "@/components/extra-ticket-prototype.css": {},
  };
  const code = ts.transpileModule(readFileSync(new URL("../app/preview/extra-tickets/page.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function("require", "module", "exports", code)(name => { assert.ok(name in dependencies); return dependencies[name]; }, mod, mod.exports);
  await assert.rejects(mod.exports.default, /not_found/);
  allowed = true;
  const view = await mod.exports.default();
  assert.equal(view.type, "prototype");
  assert.deepEqual(view.props, {}, "No real tickets, tokens or access grants reach the prototype");
});
