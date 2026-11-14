import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { createRequire } from "node:module";

// Exercise the installed SDK's actual retry/cancellation implementation, not a
// reimplementation of it. This internal helper is not part of its public API;
// loading it only in tests makes SDK changes fail visibly without patching it.
const require = createRequire(import.meta.url);
const { reverificationErrorResponse } = require("@clerk/nextjs/server");
const { isReverificationCancelledError } = require("@clerk/nextjs/errors");
const clerkReactPath = require.resolve("@clerk/shared/react");
const clerkModule = { exports: {} };
new Function("require", "module", "exports", `${readFileSync(clerkReactPath, "utf8")}\nmodule.exports.testReverificationHandler = createReverificationHandler;`)(
  createRequire(clerkReactPath), clerkModule, clerkModule.exports,
);
const realReverification = clerkModule.exports.testReverificationHandler;

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

test("accepts an empty request stream from the HTTP adapter but rejects any actual body", async () => {
  const { dependencies, deleted } = fixture();
  const emptyStream = new ReadableStream({ start(controller) { controller.close(); } });
  const response = await handleAccountDeletion(request({ body: emptyStream, duplex: "half" }), dependencies);
  assert.equal(response.status, 200);
  assert.deepEqual(deleted, ["user_self"]);
  assert.equal((await handleAccountDeletion(request({ body: " " }), dependencies)).status, 400);
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

// Clerk unwraps fetch Responses before returning from useReverification.
// An identity mock hides regressions where callers try to parse JSON twice.
const useReverification = callback => async () => {
  const result = await callback();
  return result instanceof Response ? result.json() : result;
};

test("warning modal has two buttons, focuses Cancel and prevents double deletion", async () => {
  const states = [], refs = []; let cursor = 0, refCursor = 0, writes = 0, resolve;
  const { DeleteAccount } = load("../components/delete-account.tsx", {
    react: {
      useState: initial => { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = value; }]; },
      useRef: initial => { const i = refCursor++; return refs[i] ??= { current: initial }; },
    },
    "@clerk/nextjs": { useClerk: () => ({ signOut: async () => {} }), useReverification },
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

async function submitDeletion({ fetch, signOut = async () => {}, reverify = useReverification, cancelled = false }) {
  const states = [true, false, null], events = [];
  let stateIndex = 0;
  const { DeleteAccount } = load("../components/delete-account.tsx", {
    react: {
      useState: () => {
        const i = stateIndex++;
        return [states[i], value => { states[i] = value; }];
      },
      useRef: initial => ({ current: initial }),
    },
    "@clerk/nextjs": {
      useClerk: () => ({ signOut: async () => { events.push("signOut"); await signOut(); } }),
      useReverification: reverify,
    },
    "@clerk/nextjs/errors": { isReverificationCancelledError: () => cancelled },
    "@/components/ui/button": { Button: "button" },
  });
  const previousFetch = globalThis.fetch, previousWindow = globalThis.window;
  globalThis.fetch = fetch;
  globalThis.window = { location: { replace: path => { events.push(`replace:${path}`); } } };
  try {
    const modal = nodes(DeleteAccount()).find(node => node.type === "dialog");
    await nodes(modal).filter(node => node.type === "button")[1].props.onClick();
    return { events, message: states[2], busy: states[1] };
  } finally { globalThis.fetch = previousFetch; globalThis.window = previousWindow; }
}

for (const signOutFails of [false, true]) test(`confirmed deletion clears local state and replaces the page with login (signOutFails=${signOutFails})`, async () => {
  let writes = 0;
  const result = await submitDeletion({
    fetch: async () => { writes++; return Response.json({ deleted: true }); },
    signOut: async () => { if (signOutFails) throw new Error("local signout unavailable"); },
  });
  assert.deepEqual(result.events, ["signOut", "replace:/sign-in"]);
  assert.equal(result.message, null);
  assert.equal(writes, 1);
});

test("failed or malformed deletion never signs out, redirects or automatically retries", async () => {
  for (const [body, status] of [
    [{ error: "operation_not_authorized" }, 403],
    [{ error: "authentication_required" }, 401],
    [{ error: "account_deletion_unconfirmed" }, 502],
    [{ deleted: true }, 502],
    [{ deleted: false }, 200], [{ deleted: "true" }, 200], [{}, 200], [null, 200],
  ]) {
    let writes = 0;
    const result = await submitDeletion({ fetch: async () => { writes++; return Response.json(body, { status }); } });
    assert.deepEqual(result.events, []);
    assert.match(result.message, status === 403 ? /No se permite/ : /No hemos podido confirmar/);
    assert.equal(result.busy, false);
    assert.equal(writes, 1);
  }
  for (const fetch of [async () => { throw new TypeError("network unavailable"); }, async () => new Response("not JSON")]) {
    const result = await submitDeletion({ fetch });
    assert.deepEqual(result.events, []);
    assert.match(result.message, /No hemos podido confirmar/);
  }
});

test("cancelled reverification does not sign out or claim deletion", async () => {
  let writes = 0;
  const result = await submitDeletion({
    fetch: async () => { writes++; }, cancelled: true,
    reverify: () => async () => { throw new Error("reverification_cancelled"); },
  });
  assert.equal(writes, 0);
  assert.deepEqual(result.events, []);
  assert.match(result.message, /Verificación cancelada/);
});

test("API waits for Clerk deletion before returning success", async () => {
  let finish, started;
  const entered = new Promise(resolve => { started = resolve; });
  const deletion = new Promise(resolve => { finish = resolve; });
  const { dependencies } = fixture({ deleteUser: async () => { started(); await deletion; } });
  let answered = false;
  const pending = handleAccountDeletion(request(), dependencies).then(response => { answered = true; return response; });
  await entered;
  assert.equal(answered, false);
  finish();
  assert.deepEqual(await (await pending).json(), { deleted: true });
});

test("client + API route reverify first, delete the authenticated Clerk identity once, then go to login", async () => {
  const events = [];
  let reverified = false, identityExists = true, requests = 0;
  const { DELETE } = load("../app/api/account/route.ts", {
    "@/lib/account-deletion-core": { handleAccountDeletion },
    "@/lib/local-access": { configuredAppOrigin: () => origin },
    "@/lib/app-authorization": { getCurrentAppAccess: async () => ({ ok: true, role: "user" }) },
    "@clerk/nextjs/server": {
      auth: async () => ({ userId: identityExists ? "user_self" : null, has: config => {
        assert.deepEqual(config, { reverification: "strict" }); return reverified;
      } }),
      reverificationErrorResponse,
      clerkClient: async () => ({ users: { deleteUser: async id => {
        assert.equal(id, "user_self"); assert.equal(reverified, true);
        events.push("deleteUser"); identityExists = false;
      } } }),
    },
  });
  const result = await submitDeletion({
    fetch: async (url, options) => {
      requests++;
      assert.equal(url, "/api/account");
      assert.equal(options.credentials, "same-origin");
      return DELETE(request({ ...options, headers: { ...options.headers, origin } }));
    },
    reverify: realReverification({ openUIComponent: ({ afterVerification, level }) => {
      assert.equal(level, "second_factor");
      assert.equal(identityExists, true, "no deletion before verification");
      events.push("reverify"); reverified = true;
      afterVerification();
    } }),
    signOut: async () => { assert.equal(identityExists, false); events.push("signOut"); },
  });
  assert.deepEqual(events, ["reverify", "deleteUser", "signOut"]);
  assert.deepEqual(result.events, ["signOut", "replace:/sign-in"]);
  assert.equal(requests, 2, "only the refused pre-verification request is retried");
  assert.equal(identityExists, false);
  assert.equal((await DELETE(request())).status, 401, "deleted identity cannot authenticate in this fixture");
});

test("installed Clerk SDK cancellation rejects before a deletion retry", async () => {
  let requests = 0;
  const enhanced = realReverification({ openUIComponent: ({ afterVerificationCancelled }) => afterVerificationCancelled() })(async () => {
    requests++;
    return reverificationErrorResponse("strict");
  });
  await assert.rejects(enhanced(), isReverificationCancelledError);
  assert.equal(requests, 1);
});
