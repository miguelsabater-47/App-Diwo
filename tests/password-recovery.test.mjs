import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { loginEmail } from "../lib/login-flow.ts";
import { recoveryError } from "../lib/password-recovery.ts";

function nodes(node) {
  if (!node || typeof node !== "object") return [];
  return [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
}
function harness(t) {
  const originalWindow = globalThis.window;
  t.after(() => { if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow; });
  const state = { loaded: true, authLoaded: true, signedIn: false, calls: [], task: false };
  const slots = [], effects = [];
  let cursor = 0;
  const client = {
    id: "attempt_1",
    create: async params => { state.calls.push(["create", params]); return { id: client.id, status: "needs_first_factor" }; },
    attemptFirstFactor: async params => { state.calls.push(["verify", params]); return { status: "complete", createdSessionId: "session_verified" }; },
  };
  state.activate = async params => {
    state.calls.push(["activate", params.session]);
    await params.navigate({ session: { currentTask: state.task ? { key: "choose-organization" } : null } });
  };
  globalThis.window = { location: {
    replace: path => state.calls.push(["replace", path]), assign: path => state.calls.push(["assign", path]),
  } };
  const deps = {
    "react/jsx-runtime": jsx,
    react: {
      useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], next => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }]; },
      useRef: initial => { const i = cursor++; return slots[i] ??= { current: initial }; },
      useEffect: (fn, dependencies) => {
        const i = cursor++, old = slots[i];
        if (!old || dependencies.some((value, n) => !Object.is(value, old.dependencies[n]))) {
          effects.push(() => { old?.cleanup?.(); slots[i] = { dependencies, cleanup: fn() }; });
        }
      },
    },
    "next/link": { default: "a" }, "next/image": { default: "img" },
    "@clerk/nextjs": { useAuth: () => ({ isLoaded: state.authLoaded, isSignedIn: state.signedIn }), useSignIn: () => ({ isLoaded: state.loaded, signIn: client, setActive: params => state.activate(params) }) },
    "lucide-react": Object.fromEntries(["ArrowLeft", "Eye", "EyeOff", "Mail"].map(name => [name, "svg"])),
    "@/lib/login-flow": { loginEmail }, "@/lib/password-recovery": { recoveryError },
  };
  const code = ts.transpileModule(readFileSync(new URL("../components/password-recovery-screen.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", code)(name => { assert.ok(name in deps, name); return deps[name]; }, mod, mod.exports);
  function render() {
    cursor = 0;
    const view = mod.exports.PasswordRecoveryScreen();
    for (const node of nodes(view)) if (node.type === "input" && node.props.ref) node.props.ref.current ??= { value: "", focus() {} };
    for (const effect of effects.splice(0)) effect();
    return nodes(view);
  }
  function find(predicate) { const node = render().find(predicate); assert.ok(node, "Expected control"); return node; }
  const field = name => find(node => node.type === "input" && node.props.name === name);
  return { state, client, render, find, field,
    email: value => field("email").props.onChange({ target: { value } }),
    submit: () => find(node => node.type === "form").props.onSubmit({ preventDefault() {} }),
    click: label => find(node => node.type === "button" && (node.props.children === label || node.props["aria-label"] === label)).props.onClick(),
    unmount: () => slots.forEach(slot => slot?.cleanup?.()),
  };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
async function start(h) { h.email("  guest@example.com  "); h.submit(); await settle(); }
function fill(h) { h.field("code").props.ref.current.value = "123456"; h.field("password").props.ref.current.value = "synthetic-new-password"; }

test("recovery starts with email only and never contacts Clerk on render or invalid input", t => {
  const h = harness(t);
  assert.deepEqual(h.render().filter(node => node.type === "input").map(node => node.props.name), ["email"]);
  assert.equal(h.render().some(node => node.props?.["aria-label"] === "Continuar con Google"), false);
  h.email("invalid"); h.submit();
  assert.equal(h.find(node => node.props?.role === "alert").props.children, "Introduce un correo electrónico válido.");
  assert.deepEqual(h.state.calls, []);
  assert.equal(h.find(node => node.type === "a").props.href, "/sign-in");
});

test("explicit send uses the installed Core 2 strategy; reset requires both the code and chosen password", async t => {
  const h = harness(t); await start(h);
  assert.deepEqual(h.state.calls, [["create", { strategy: "reset_password_email_code", identifier: "guest@example.com" }]]);
  assert.deepEqual(h.render().filter(node => node.type === "input").map(node => node.props.name), ["code", "password"]);
  assert.equal(h.field("password").props.autoComplete, "new-password");
  h.submit(); await settle(); assert.equal(h.state.calls.length, 1);
  h.field("code").props.ref.current.value = "123456"; h.submit(); await settle(); assert.equal(h.state.calls.length, 1);
  fill(h); h.submit(); await settle();
  assert.deepEqual(h.state.calls.slice(1), [
    ["verify", { strategy: "reset_password_email_code", code: "123456", password: "synthetic-new-password" }],
    ["activate", "session_verified"], ["replace", "/"],
  ]);
});

test("readiness gates send and double submits cannot send two emails or verify twice", async t => {
  const h = harness(t); h.email("guest@example.com");
  for (const key of ["loaded", "authLoaded"]) {
    h.state[key] = false; h.submit(); assert.deepEqual(h.state.calls, []); h.state[key] = true;
  }
  let finish;
  h.client.create = params => { h.state.calls.push(["create", params]); return new Promise(resolve => { finish = resolve; }); };
  h.submit(); h.submit(); assert.equal(h.state.calls.length, 1);
  finish({ id: h.client.id, status: "needs_first_factor" }); await settle(); fill(h);
  h.client.attemptFirstFactor = params => { h.state.calls.push(["verify", params]); return new Promise(resolve => { finish = resolve; }); };
  h.submit(); h.submit(); assert.equal(h.state.calls.filter(([name]) => name === "verify").length, 1);
  finish({ status: "complete", createdSessionId: "verified" }); await settle();
  assert.equal(h.state.calls.filter(([name]) => name === "activate").length, 1);
});

test("rejected email sends and unexpected creation statuses never claim a code was sent", async t => {
  for (const response of ["rejected", "unexpected"]) {
    const h = harness(t);
    h.client.create = async () => {
      if (response === "rejected") throw { errors: [{ code: "form_identifier_not_found", longMessage: "PRIVATE ACCOUNT" }] };
      return { status: "complete", id: h.client.id, createdSessionId: "not-a-reset" };
    };
    await start(h);
    assert.equal(h.field("email").props.value.trim(), "guest@example.com");
    assert.equal(h.render().some(node => node.type === "input" && node.props.name === "code"), false);
    assert.ok(h.render().some(node => node.props?.role === "alert"));
    assert.deepEqual(h.state.calls, []);
  }
});

test("bad and expired codes keep the form retryable; resend and changing email are explicit", async t => {
  const h = harness(t); await start(h); fill(h);
  for (const code of ["form_code_incorrect", "verification_expired"]) {
    h.client.attemptFirstFactor = async () => { throw { errors: [{ code, longMessage: "PRIVATE PROVIDER DETAIL" }] }; };
    h.submit(); await settle();
    assert.equal(h.find(node => node.props?.role === "alert").props.children, recoveryError({ code }));
    assert.equal(h.find(node => node.type === "button" && node.props.type === "submit").props.disabled, false);
  }
  h.click("Reenviar código"); await settle();
  assert.equal(h.state.calls.filter(([name]) => name === "create").length, 2);
  assert.equal(h.field("code").props.ref.current.value, "");
  const password = h.field("password").props.ref.current;
  h.click("Mostrar contraseña"); assert.equal(h.field("password").props.type, "text");
  h.click("Cambiar correo");
  assert.equal(password.value, ""); assert.equal(h.field("email").props.value, "guest@example.com");
  assert.equal(h.state.calls.some(([name]) => name === "activate" || name === "replace"), false);
});

test("MFA and device verification continue with Clerk, never activate an incomplete attempt", async t => {
  for (const status of ["needs_second_factor", "needs_client_trust", "needs_new_password"]) {
    const h = harness(t); await start(h); fill(h);
    h.client.attemptFirstFactor = async () => ({ status, createdSessionId: "not-verified" });
    const password = h.field("password").props.ref.current;
    h.submit(); await settle();
    assert.equal(password.value, "");
    assert.deepEqual(h.state.calls.filter(([name]) => name !== "create"), [["assign", "/sign-in/clerk"]]);
    assert.ok(h.render().some(node => node.type === "a" && node.props.href === "/sign-in/clerk"));
  }
});

test("session tasks are preserved and no document navigation races activation", async t => {
  for (const task of [false, true]) {
    const h = harness(t); h.state.task = task; await start(h); fill(h);
    const activate = h.state.activate;
    let finish;
    h.state.activate = async params => { h.state.signedIn = true; await new Promise(resolve => { finish = resolve; }); await activate(params); };
    h.submit(); await settle(); h.render();
    assert.equal(h.state.calls.some(([name]) => name === "replace"), false);
    finish(); await settle(); h.render();
    assert.deepEqual(h.state.calls.filter(([name]) => name === "replace"), [["replace", task ? "/sign-in/clerk" : "/"]]);
  }
});

test("unknown statuses, missing session and replaced attempts fail closed", async t => {
  for (const mode of ["unknown", "missing-session", "replaced-attempt"]) {
    const h = harness(t); await start(h); fill(h);
    if (mode === "replaced-attempt") h.client.id = "different_attempt";
    h.client.attemptFirstFactor = async () => ({ status: mode === "unknown" ? "unexpected" : "complete" });
    h.submit(); await settle();
    assert.ok(h.render().some(node => node.props?.role === "alert"));
    assert.equal(h.state.calls.some(([name]) => ["activate", "replace", "assign"].includes(name)), false);
  }
});

test("activation failure offers native continuation without resubmitting the used code", async t => {
  const h = harness(t); await start(h); fill(h);
  h.state.activate = async () => { throw new Error("PRIVATE SESSION DETAIL"); };
  h.submit(); await settle();
  assert.equal(h.render().some(node => node.type === "form"), false);
  assert.ok(h.render().some(node => node.type === "a" && node.props.href === "/sign-in/clerk"));
  assert.ok(h.render().some(node => node.props?.role === "alert"));
  assert.equal(h.state.calls.some(([name]) => name === "replace"), false);
});

test("late reset response after leaving the screen cannot activate or navigate", async t => {
  const h = harness(t); await start(h); fill(h);
  let finish;
  h.client.attemptFirstFactor = () => new Promise(resolve => { finish = resolve; });
  h.submit(); h.unmount(); finish({ status: "complete", createdSessionId: "verified" }); await settle();
  assert.deepEqual(h.state.calls.map(([name]) => name), ["create"]);
});

test("existing sessions do not send recovery emails and redirect only once", t => {
  const h = harness(t); h.state.signedIn = true; h.render(); h.render();
  assert.deepEqual(h.state.calls, [["replace", "/"]]);
});

test("safe recovery messages explain code/password/network failures without provider details or account enumeration", () => {
  for (const code of ["form_code_incorrect", "verification_expired", "form_password_pwned", "form_password_length_too_short", "form_password_validation_failed", "too_many_requests", "network_error", "form_identifier_not_found", "unexpected"]) {
    const message = recoveryError({ errors: [{ code, longMessage: "PRIVATE DATA" }] });
    assert.doesNotMatch(message, /PRIVATE DATA|form_|guest@example|no existe/);
    assert.ok(message.length > 10);
  }
});
