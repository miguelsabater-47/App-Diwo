import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { createDoorScanDevelopmentState } from "../lib/door-scan-development-model.ts";
import { doorEvent, scanResult } from "../lib/door-scan-model.ts";

const context = { nodeEnv: "development", host: "localhost:3000", developmentKeys: true, localOrigin: true, role: "admin" };
const config = { enabled: true, outcome: "admitted" };
function load(file, deps, env = {}) {
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", "process", code)(name => {
    if (name === "react/jsx-runtime") return jsx;
    assert.ok(name in deps, `Unexpected ${name}`); return deps[name];
  }, mod, mod.exports, { env });
  return mod.exports;
}
const nodes = node => !node || typeof node !== "object" ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];

test("development configuration is ignored for production, foreign hosts/origins/keys, missing roles and unsupported states", () => {
  for (const change of [{ nodeEnv: "production" }, { nodeEnv: "test" }, { host: "127.0.0.1:3000" }, { host: "localhost:3001" }, { host: "diwo.invalid" }, { host: null }, { developmentKeys: false }, { localOrigin: false }, { role: "user" }, { role: "" }]) {
    assert.equal(createDoorScanDevelopmentState(config, { ...context, ...change }), null);
  }
  assert.equal(createDoorScanDevelopmentState({ ...config, enabled: false }, context), null);
  assert.equal(createDoorScanDevelopmentState({ ...config, outcome: "unsupported" }, context), null);
  for (const role of ["admin", "door_staff"]) for (const outcome of ["admitted", "already_used", "revoked", "unknown", "connection_error"]) {
    const source = createDoorScanDevelopmentState({ ...config, outcome }, { ...context, role });
    assert.deepEqual(doorEvent(source.event), source.event);
    if (source.result) assert.deepEqual(scanResult(source.result), source.result);
    else assert.equal(source.connectionError, true);
    assert.doesNotMatch(JSON.stringify(source), /qr_token|token|subject|role/);
  }
});

test("server resolver uses local configuration only and fails closed outside authorized development context", async () => {
  const state = { nodeEnv: "development", host: "localhost:3000", enabled: true, developmentKeys: true, localOrigin: true };
  let headerReads = 0;
  function resolver() {
    return load("../lib/door-scan-development.ts", {
      "server-only": {},
      "next/headers": { headers: async () => { headerReads++; return { get: () => state.host }; } },
      "./local-access": { hasDevelopmentClerkKeys: () => state.developmentKeys, configuredAppOrigin: () => state.localOrigin ? "http://localhost:3000" : null },
      "./door-scan-development-config": { doorScanDevelopmentConfig: { ...config, enabled: state.enabled } },
      "./door-scan-development-model": { createDoorScanDevelopmentState },
    }, { NODE_ENV: state.nodeEnv }).getDoorScanDevelopmentState;
  }
  assert.ok(await resolver()("admin")); assert.ok(await resolver()("door_staff"));
  assert.equal(await resolver()("user"), null);
  for (const change of [{ host: "other.invalid" }, { developmentKeys: false }, { localOrigin: false }]) {
    const original = { ...state }; Object.assign(state, change);
    assert.equal(await resolver()("admin"), null); Object.assign(state, original);
  }
  state.nodeEnv = "production"; headerReads = 0;
  assert.equal(await resolver()("admin"), null); assert.equal(headerReads, 0);
  state.nodeEnv = "development"; state.enabled = false;
  assert.equal(await resolver()("admin"), null); assert.equal(headerReads, 0);
});

test("real scanner routes keep independent permission gates, inject the same component and remount between mock/live sources", async () => {
  for (const [path, gate, role] of [["../app/admin/scan/page.tsx", "requireAdminAccess", "admin"], ["../app/scan/page.tsx", "requireDoorAccess", "door_staff"]]) {
    const source = createDoorScanDevelopmentState(config, { ...context, role });
    let access = { ok: false, status: 401 }, mocked = source, resolutions = 0;
    const Page = load(path, {
      "next/link": { default: "a" }, "lucide-react": { ArrowLeft: "svg" },
      "next/navigation": { redirect: path => { throw new Error(`redirect:${path}`); }, notFound: () => { throw new Error("notFound"); } },
      "@/lib/app-authorization": { [gate]: async () => access },
      "@/components/door-scanner": { DoorScanner: "scanner" },
      "@/lib/door-scan-development": { getDoorScanDevelopmentState: async actualRole => { assert.equal(actualRole, role); resolutions++; return mocked; } },
    }).default;
    await assert.rejects(Page(), /redirect:\/sign-in/);
    access = { ok: false, status: 403 }; await assert.rejects(Page(), /notFound/);
    access = { ok: false, status: 503 }; assert.equal(nodes(await Page()).some(node => node.type === "scanner"), false);
    assert.equal(resolutions, 0);
    access = { ok: true, role };
    const simulated = nodes(await Page()).find(node => node.type === "scanner");
    assert.deepEqual(simulated.props.development, source);
    mocked = null;
    const live = nodes(await Page()).find(node => node.type === "scanner");
    assert.equal(live.props.development, null); assert.equal(live.key, "live");
    assert.notEqual(simulated.key, live.key, "Switching sources unmounts the old camera/state, never mixing fake events with live check-in");
  }
});
