import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

function load(path, dependencies = {}) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", code)(name => {
    if (name === "react/jsx-runtime") return jsx;
    assert.ok(name in dependencies, name); return dependencies[name];
  }, mod, mod.exports);
  return mod.exports;
}
const { handleAccountDeletion } = load("../lib/account-deletion-core.ts");
const origin = "http://localhost:3000";
const request = (options = {}, suffix = "") => new Request(`${origin}/api/account${suffix}`, {
  method: "DELETE", headers: { origin, "x-diwo-confirm-deletion": "delete-my-account" }, ...options,
});
function fixture(overrides = {}) {
  const deleted = [];
  return { deleted, dependencies: {
    origin, authenticate: async () => ({ userId: "user_self", reverified: true }),
    access: async () => ({ ok: true, role: "user" }),
    reverificationRequired: () => Response.json({ error: "reverification_required" }, { status: 403 }),
    deleteUser: async id => { deleted.push(id); }, ...overrides,
  } };
}

test("deletes only the authenticated user and never accepts a client-selected target", async () => {
  const { dependencies, deleted } = fixture();
  const response = await handleAccountDeletion(request(), dependencies);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { deleted: true });
  assert.deepEqual(deleted, ["user_self"]);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  for (const req of [request({}, "?userId=user_other"), request({ body: JSON.stringify({ userId: "user_other" }) })]) {
    assert.equal((await handleAccountDeletion(req, dependencies)).status, 400);
  }
  assert.deepEqual(deleted, ["user_self"]);
});

test("fails closed for roles, expired sessions, role lookup failure and stale verification", async () => {
  for (const overrides of [
    { access: async () => ({ ok: true, role: "admin" }) },
    { access: async () => ({ ok: true, role: "door_staff" }) },
    { access: async () => ({ ok: false, status: 502, reason: "supabase_session_verification_failed" }) },
    { access: async () => { throw new Error("private upstream details"); } },
    { authenticate: async () => ({ userId: null, reverified: false }) },
    { authenticate: async () => ({ userId: "user_self", reverified: false }) },
  ]) {
    const { dependencies, deleted } = fixture(overrides);
    const response = await handleAccountDeletion(request(), dependencies);
    assert.ok(response.status >= 400);
    assert.deepEqual(deleted, []);
    assert.doesNotMatch(await response.text(), /private upstream/);
  }
});

test("rejects CSRF, missing confirmation, foreign URLs and disabled destinations before authentication", async () => {
  let authenticated = 0;
  const { dependencies, deleted } = fixture({ authenticate: async () => { authenticated++; throw new Error("not reached"); } });
  for (const req of [
    request({ method: "GET" }), request({ headers: {} }),
    request({ headers: { origin: "https://evil.invalid", "x-diwo-confirm-deletion": "delete-my-account" } }),
    request({ headers: { origin, "x-diwo-confirm-deletion": "delete-my-account", "sec-fetch-site": "cross-site" } }),
    new Request("https://evil.invalid/api/account", { method: "DELETE", headers: { origin, "x-diwo-confirm-deletion": "delete-my-account" } }),
  ]) assert.ok((await handleAccountDeletion(req, dependencies)).status >= 400);
  assert.equal((await handleAccountDeletion(request(), { ...dependencies, origin: null })).status, 403);
  assert.equal(authenticated, 0);
  assert.deepEqual(deleted, []);
});

test("ambiguous Clerk failures never retry or expose upstream details", async () => {
  let attempts = 0;
  const { dependencies } = fixture({ deleteUser: async () => { attempts++; throw new Error("secret identity details"); } });
  const response = await handleAccountDeletion(request(), dependencies);
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "account_deletion_unconfirmed" });
  assert.equal(attempts, 1);
});

const nodes = node => !node || typeof node !== "object" ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
const text = node => node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(text).join(" ") : typeof node === "object" ? text(node.props?.children) : String(node);

test("warning modal has two buttons, focuses Cancel and prevents double deletion", async () => {
  const states = [], refs = []; let cursor = 0, refCursor = 0, writes = 0, resolve;
  const { DeleteAccount } = load("../components/delete-account.tsx", {
    react: {
      useState: initial => { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = value; }]; },
      useRef: initial => { const i = refCursor++; return refs[i] ??= { current: initial }; },
    },
    "@clerk/nextjs": { useClerk: () => ({ signOut: async () => {} }), useReverification: callback => callback },
    "@clerk/nextjs/errors": { isReverificationCancelledError: () => false },
    "@/components/ui/button": { Button: "button" },
  });
  const render = () => { cursor = 0; refCursor = 0; return DeleteAccount(); };
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "/api/account"); assert.equal(options.method, "DELETE"); assert.equal(options.body, undefined);
    writes++; return new Promise(done => { resolve = done; });
  };
  try {
    let tree = render();
    const modal = nodes(tree).find(node => node.type === "dialog");
    let opened = false, cancelFocused = 0, triggerFocused = 0;
    modal.props.ref.current = {
      showModal() { opened = true; },
      close() { opened = false; modal.props.onClose(); },
    };
    const trigger = nodes(tree).find(node => node.type === "button");
    trigger.props.ref.current = { focus() { triggerFocused++; } };
    const buttons = nodes(modal).filter(node => node.type === "button");
    assert.deepEqual(buttons.map(text), ["Cancelar", "Eliminar cuenta"]);
    buttons[0].props.ref.current = { focus() { cancelFocused++; } };
    assert.equal(nodes(tree).some(node => node.type === "input"), false);
    await buttons[1].props.onClick(); assert.equal(writes, 0, "hidden confirmation cannot delete");
    trigger.props.onClick();
    assert.equal(opened, true); assert.equal(cancelFocused, 1); assert.equal(writes, 0);
    buttons[0].props.onClick();
    assert.equal(opened, false); assert.equal(triggerFocused, 1); assert.equal(writes, 0);
    trigger.props.onClick();
    let prevented = false;
    modal.props.onCancel({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true); assert.equal(opened, false); assert.equal(writes, 0);
    trigger.props.onClick();
    tree = render();
    assert.match(text(tree), /irreversible/);
    assert.match(text(tree), /no borra el historial/);
    const submit = nodes(nodes(tree).find(node => node.type === "dialog")).filter(node => node.type === "button")[1].props.onClick;
    const pending = submit();
    assert.equal(opened, false, "native modal closes before Clerk reverification can appear");
    await submit(); assert.equal(writes, 1);
    assert.equal(nodes(render()).find(node => node.type === "button").props.disabled, true);
    resolve(Response.json({ error: "account_deletion_unconfirmed" }, { status: 502 }));
    await pending;
    assert.match(text(nodes(render()).find(node => node.props?.role === "alert")), /No hemos podido confirmar/);
    assert.equal(writes, 1);
  } finally { globalThis.fetch = previousFetch; }
});

test("successful deletion navigates to login even when clearing local Clerk state fails", async () => {
  let stateIndex = 0, signouts = 0, destination;
  const { DeleteAccount } = load("../components/delete-account.tsx", {
    react: {
      useState: () => [[true, false, null][stateIndex++], () => {}],
      useRef: initial => ({ current: initial }),
    },
    "@clerk/nextjs": {
      useClerk: () => ({ signOut: async () => { signouts++; throw new Error("local signout unavailable"); } }),
      useReverification: callback => callback,
    },
    "@clerk/nextjs/errors": { isReverificationCancelledError: () => false },
    "@/components/ui/button": { Button: "button" },
  });
  const previousFetch = globalThis.fetch, previousWindow = globalThis.window;
  globalThis.fetch = async () => Response.json({ deleted: true });
  globalThis.window = { location: { assign: path => { destination = path; } } };
  try {
    const modal = nodes(DeleteAccount()).find(node => node.type === "dialog");
    await nodes(modal).filter(node => node.type === "button")[1].props.onClick();
    assert.equal(signouts, 1);
    assert.equal(destination, "/sign-in");
  } finally { globalThis.fetch = previousFetch; globalThis.window = previousWindow; }
});
