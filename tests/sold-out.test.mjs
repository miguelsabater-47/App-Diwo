import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

function load(path, dependencies) {
  const compiled = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    if (name === "react/jsx-runtime") return jsx;
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, mod, mod.exports);
  return mod.exports;
}

test("sold-out applies in all environments only to a verified user with a successful empty personal read", async () => {
  let result = { ok: true, orders: [] }, reads = 0;
  const { showSoldOut } = load("../lib/sold-out.ts", {
    "server-only": {},
    "@/lib/order-reads": { readOrderOverview: async scope => { assert.equal(scope, "buyer"); reads++; return result; } },
  });
  const user = { ok: true, role: "user" };
  assert.equal(await showSoldOut(user), true);
  for (const status of ["pending", "confirmed", "cancelled", "rejected"]) {
    result = { ok: true, orders: [{ status }] };
    assert.equal(await showSoldOut(user), false, `${status} history remains available`);
  }
  result = { ok: false, status: 502 };
  assert.equal(await showSoldOut(user), false, "Read failure cannot classify a buyer as empty");
  result = { ok: true, orders: [] };
  const before = reads;
  for (const access of [{ ok: true, role: "admin" }, { ok: true, role: "door_staff" }, { ok: false, status: 401 }, { ok: false, status: 503 }]) {
    assert.equal(await showSoldOut(access), false);
  }
  assert.equal(reads, before, "Ineligible roles do not even read personal orders");
  const source = readFileSync(new URL("../lib/sold-out.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /process\.env|isLocalPaymentPreview|NODE_ENV|VERCEL/, "No local-only gate may disable the screen on the hosted web");
});

test("sold-out uses existing identity and logout, without ticket navigation or new purchase actions", () => {
  const { SoldOut } = load("../components/sold-out.tsx", {
    "next/image": { default: "img" }, "@/components/account-actions": { AccountActions: "logout" },
  });
  const nodes = node => !node || typeof node !== "object" ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
  const text = node => node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(text).join(" ") : typeof node === "object" ? text(node.props?.children) : String(node);
  const tree = SoldOut();
  assert.equal(nodes(tree).find(node => node.type === "img").props.src, "/brand/diwo-club.svg");
  assert.equal(nodes(tree).filter(node => node.type === "h1").length, 1);
  assert.match(text(tree), /SOLD\s*OUT/);
  assert.match(text(tree), /Entradas agotadas/);
  assert.match(text(tree), /Las solicitudes están cerradas/);
  assert.equal(nodes(tree).filter(node => node.type === "logout").length, 1);
  assert.equal(nodes(tree).some(node => ["a", "nav", "form", "input"].includes(node.type)), false);
});
