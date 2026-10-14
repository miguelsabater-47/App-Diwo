import assert from "node:assert/strict";
import { test, after } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as flow from "../lib/login-flow.ts";

const source = readFileSync(new URL("../components/login-screen.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
let values, refs, index, calls, session, loaded, authenticated, authReady, activate;
const react = {
  useState(initial) { const slot = index++; if (!(slot in values)) values[slot] = initial; return [values[slot], next => { values[slot] = typeof next === "function" ? next(values[slot]) : next; }]; },
  useRef(initial) { const slot = index++; return refs[slot] ?? (refs[slot] = { current: initial }); },
  useCallback(callback) { index++; return callback; },
  useEffect(callback, dependencies) { index++; if (dependencies?.[0] === true && dependencies?.[1] === true) callback(); },
};
const NativeSignIn = () => null;
const moduleObject = { exports: {} };
new Function("require", "module", "exports", compiled)(name => {
  if (name === "react") return react;
  if (name === "react/jsx-runtime") return jsx;
  if (name === "next/link") return { default: "a" };
  if (name === "next/image") return { default: "img" };
  if (name === "next/navigation") return { useRouter: () => ({ replace: path => calls.push(["replace", path]), push: path => calls.push(["push", path]), refresh: () => calls.push(["refresh"]) }) };
  if (name === "@clerk/nextjs") return { useAuth: () => ({ isLoaded: authReady, isSignedIn: authenticated }), useSignIn: () => ({ isLoaded: loaded, signIn: session, setActive: data => activate(data) }), SignIn: NativeSignIn };
  if (name === "lucide-react") return { ArrowLeft: "svg", Mail: "svg", Eye: "svg", EyeOff: "svg", LoaderCircle: "svg" };
  if (name.includes("login-flow")) return flow;
  throw new Error(`Unexpected dependency ${name}`);
}, moduleObject, moduleObject.exports);
function render(props = {}) {
  index = 0;
  return moduleObject.exports.LoginScreen(props);
}
function descendants(node) {
  if (!node || typeof node !== "object") return [];
  const children = [node.props?.children].flat(Infinity);
  return [node, ...children.flatMap(descendants)];
}
function find(predicate) { const result = descendants(render()).find(predicate); assert.ok(result, "Expected control exists"); return result; }
function control(label) { return find(node => node.type !== "section" && node.props?.["aria-label"] === label); }
function reset() {
  values = []; refs = []; calls = []; loaded = true; authenticated = false; authReady = true;
  session = { create: async params => { calls.push(["create", params]); return { status: "complete", createdSessionId: "sess_verified" }; }, authenticateWithRedirect: async params => calls.push(["google", params]) };
  activate = async data => calls.push(["activate", data]);
  globalThis.window = { location: { href: "http://localhost:3000/sign-in", replace: path => calls.push(["document-replace", path]) }, history: { pushState() {}, back() {} } };
}
after(() => { delete globalThis.window; });
async function settle() { for (let attempt = 0; attempt < 30; attempt++) await new Promise(resolve => setTimeout(resolve, 1)); }
function emailStep() {
  control("Correo electrónico").props.onChange({ target: { value: "guest@example.com" } });
  find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
}
test("email continue is local; password/back/change email clear sensitive state", () => {
  reset(); emailStep();
  assert.deepEqual(calls, []);
  control("Contraseña").props.onChange({ target: { value: "private-password" } });
  control("Mostrar contraseña").props.onClick();
  assert.equal(control("Contraseña").props.type, "text");
  control("Cambiar correo").props.onClick();
  assert.equal(control("Correo electrónico").props.value, "guest@example.com");
  emailStep();
  assert.equal(control("Contraseña").props.value, "");
  assert.equal(control("Contraseña").props.type, "password");
  control("Volver").props.onClick();
  assert.equal(control("Correo electrónico").props.autoComplete, "email");
});
test("password remains editable and visibility usable when the SDK becomes unavailable", () => {
  reset(); emailStep();
  control("Contraseña").props.onChange({ target: { value: "synthetic" } });
  loaded = false;
  assert.notEqual(control("Contraseña").props.disabled, true);
  assert.notEqual(control("Mostrar contraseña").props.disabled, true);
  control("Mostrar contraseña").props.onClick();
  assert.equal(control("Contraseña").props.type, "text");
  control("Ocultar contraseña").props.onClick();
  assert.equal(control("Contraseña").props.type, "password");
  assert.equal(control("Iniciar sesión").props.disabled, true);
  assert.equal(calls.some(([name]) => name === "create"), false);
});
test("pending and rejected attempts cannot lock edits or visibility, but still suppress duplicate sends", async () => {
  reset(); emailStep();
  let reject;
  session.create = params => { calls.push(["create", params]); return new Promise((resolve, fail) => { reject = fail; }); };
  control("Contraseña").props.onChange({ target: { value: "synthetic-first" } });
  find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  assert.notEqual(control("Contraseña").props.disabled, true);
  assert.notEqual(control("Mostrar contraseña").props.disabled, true);
  control("Contraseña").props.onChange({ target: { value: "synthetic-correction" } });
  control("Mostrar contraseña").props.onClick();
  assert.equal(control("Contraseña").props.type, "text");
  find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  assert.equal(calls.filter(([name]) => name === "create").length, 1);
  assert.equal(calls.find(([name]) => name === "create")[1].password, "synthetic-first");
  reject({ errors: [{ code: "form_password_incorrect" }] }); await settle();
  assert.notEqual(control("Contraseña").props.disabled, true);
  assert.equal(control("Contraseña").props.value, "synthetic-correction");
  assert.equal(control("Iniciar sesión").props.disabled, false);
  control("Ocultar contraseña").props.onClick();
  assert.equal(control("Contraseña").props.type, "password");
  session.create = async params => { calls.push(["create", params]); throw { code: "form_password_incorrect" }; };
  find(node => node.type === "form").props.onSubmit({ preventDefault() {} }); await settle();
  assert.equal(calls.filter(([name]) => name === "create").length, 2);
  assert.equal(calls.filter(([name]) => name === "create")[1][1].password, "synthetic-correction");
});
test("visibility preserves a DOM-autofilled value without remounting or transmitting it", () => {
  reset(); emailStep();
  const input = control("Contraseña");
  const ref = input.props.ref;
  ref.current = { value: "synthetic-autofill" };
  let prevented = 0;
  const toggle = control("Mostrar contraseña");
  assert.equal(toggle.props["aria-controls"], "diwo-password");
  toggle.props.onPointerDown({ button: 0, preventDefault() { prevented++; } });
  toggle.props.onPointerDown({ button: 2, preventDefault() { prevented++; } });
  assert.equal(prevented, 1);
  assert.equal(control("Contraseña").props.type, "password");
  control("Mostrar contraseña").props.onClick();
  assert.equal(control("Contraseña").props.value, "synthetic-autofill");
  assert.equal(control("Contraseña").props.type, "text");
  assert.equal(control("Contraseña").props.ref, ref);
  control("Ocultar contraseña").props.onClick();
  assert.equal(control("Contraseña").props.value, "synthetic-autofill");
  assert.equal(control("Contraseña").props.type, "password");
  assert.deepEqual(calls, []);
});
test("explicit submit reads the current autofilled DOM value even without a React change event", async () => {
  reset(); emailStep();
  control("Contraseña").props.ref.current = { value: "synthetic-autofill", focus() {} };
  find(node => node.type === "form").props.onSubmit({ preventDefault() {} }); await settle();
  assert.equal(calls.find(([name]) => name === "create")?.[1].password, "synthetic-autofill");
  assert.deepEqual(calls.filter(([name]) => name === "document-replace"), [["document-replace", "/"]]);
});
test("password completion opens Home once without racing a router refresh", async () => {
  reset(); emailStep();
  control("Contraseña").props.onChange({ target: { value: "password" } });
  const submit = find(node => node.type === "form").props.onSubmit;
  submit({ preventDefault() {} }); submit({ preventDefault() {} });
  await settle();
  assert.equal(calls.filter(([name]) => name === "create").length, 1);
  assert.deepEqual(calls.find(([name]) => name === "activate"), ["activate", { session: "sess_verified" }]);
  assert.deepEqual(calls.filter(([name]) => name === "document-replace"), [["document-replace", "/"]]);
  assert.equal(calls.some(([name]) => name === "replace" || name === "refresh"), false);
  authenticated = true; render(); render();
  assert.equal(calls.filter(([name]) => name === "document-replace").length, 1);
});
test("Google uses Clerk redirect callback, not a fabricated local session", async () => {
  reset(); control("Continuar con Google").props.onClick(); await settle();
  assert.deepEqual(calls[0], ["google", { strategy: "oauth_google", redirectUrl: "/sso-callback", redirectUrlComplete: "/" }]);
  assert.equal(calls.some(([name]) => name === "activate"), false);
});
test("auth becoming active during pending activation cannot trigger an early or duplicate navigation", async () => {
  reset();
  let finish;
  activate = data => { calls.push(["activate", data]); authenticated = true; return new Promise(resolve => { finish = resolve; }); };
  emailStep(); control("Contraseña").props.onChange({ target: { value: "synthetic" } });
  find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  render();
  assert.equal(calls.some(([name]) => ["document-replace", "replace", "refresh"].includes(name)), false);
  finish(); await settle(); render();
  assert.deepEqual(calls.filter(([name]) => name === "document-replace"), [["document-replace", "/"]]);
  assert.equal(calls.some(([name]) => name === "refresh"), false);
});
test("recovery opens native Clerk without a reset API call, including when SDK is not ready", () => {
  reset(); emailStep();
  session.create = () => new Promise(() => {});
  const recovery = control("Recuperar contraseña");
  assert.equal(recovery.type, "a");
  assert.equal(recovery.props.href, "/sign-in/clerk");
  assert.equal(recovery.props.disabled, undefined);
  assert.deepEqual(calls, []);
  loaded = false;
  assert.equal(control("Recuperar contraseña").props.href, "/sign-in/clerk");
  assert.deepEqual(calls, []);
});
test("extra factors hand off to native Clerk without premature activation", async () => {
  reset(); session.create = async () => ({ status: "needs_second_factor" }); emailStep();
  control("Contraseña").props.onChange({ target: { value: "password" } });
  find(node => node.type === "form").props.onSubmit({ preventDefault() {} }); await settle();
  assert.equal(calls.some(([name]) => name === "activate"), false);
  assert.ok(calls.some(([name, path]) => name === "push" && path === "/sign-in/clerk"));
  assert.ok(descendants(render({ nativePath: "/sign-in/clerk" })).some(node => node.type === NativeSignIn && node.props.path === "/sign-in/clerk"));
  assert.ok(descendants(render({ nativePath: "/sign-in/clerk" })).some(node => node.type === NativeSignIn && node.props.forceRedirectUrl === "/"));
});
test("native Clerk owns signed-in continuation and session tasks without a competing custom redirect", () => {
  reset(); authenticated = true;
  const tree = descendants(render({ nativePath: "/sign-in/clerk" }));
  assert.ok(tree.some(node => node.type === NativeSignIn && node.props.forceRedirectUrl === "/"));
  assert.equal(calls.some(([name]) => name === "document-replace" || name === "replace" || name === "refresh"), false);
});
test("a correct password awaiting device trust is handed to Clerk rather than treated as failed", async () => {
  reset(); session.create = async () => ({ status: "needs_client_trust", createdSessionId: "not-yet-verified" });
  emailStep(); control("Contraseña").props.onChange({ target: { value: "synthetic-new-password" } });
  find(node => node.type === "form").props.onSubmit({ preventDefault() {} }); await settle();
  assert.equal(calls.some(([name]) => name === "activate"), false);
  assert.ok(calls.some(([name, path]) => name === "push" && path === "/sign-in/clerk"));
  assert.equal(descendants(render()).some(node => node.props?.role === "alert"), false);
});
test("failed credentials are safe, controls recover, and existing registration remains available", async () => {
  reset(); session.create = async () => { throw { errors: [{ code: "form_password_incorrect", longMessage: "Private detail" }] }; };
  emailStep(); control("Contraseña").props.onChange({ target: { value: "wrong" } });
  find(node => node.type === "form").props.onSubmit({ preventDefault() {} }); await settle();
  const alert = find(node => node.props?.role === "alert");
  assert.equal(alert.props.children.includes("Private"), false);
  assert.equal(control("Iniciar sesión").props.disabled, false);
  assert.ok(descendants(render()).some(node => node.props?.href === "/sign-up"));
});
test("failed activation shows a safe error without navigation or retry", async () => {
  reset();
  activate = async data => { calls.push(["activate", data]); throw { code: "network_error" }; };
  emailStep(); control("Contraseña").props.onChange({ target: { value: "synthetic" } });
  find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  await settle(); render(); render();
  assert.equal(calls.filter(([name]) => name === "create").length, 1);
  assert.equal(calls.filter(([name]) => name === "activate").length, 1);
  assert.equal(calls.some(([name]) => ["document-replace", "replace", "refresh", "push"].includes(name)), false);
  assert.equal(find(node => node.props?.role === "alert").props.children, "No hemos podido conectar. Comprueba tu conexión e inténtalo de nuevo.");
  assert.equal(control("Iniciar sesión").props.disabled, false);
});
test("an existing signed-in session opens Home once and provides a document-link escape", () => {
  reset(); authenticated = true;
  assert.equal(descendants(render()).some(node => node.type === "form"), false);
  render(); render();
  assert.deepEqual(calls.filter(([name]) => name === "document-replace"), [["document-replace", "/"]]);
  const escape = descendants(render()).find(node => node.type === "a" && node.props?.href === "/");
  assert.ok(escape);
  assert.equal(calls.some(([name]) => name === "replace" || name === "refresh"), false);
  assert.equal(calls.some(([name]) => name === "create" || name === "google"), false);
});
test("independent readiness gates both hooks but authenticated redirect does not wait for sign-in initialization", () => {
  for (const [signInReady, authLoaded] of [[false, true], [true, false], [false, false]]) {
    reset(); loaded = signInReady; authReady = authLoaded;
    assert.equal(control("Continuar con Google").props.disabled, true);
    control("Correo electrónico").props.onChange({ target: { value: "qa@example.invalid" } });
    find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
    control("Continuar con Google").props.onClick();
    assert.deepEqual(calls, []);
    assert.ok(control("Correo electrónico"));
  }
  reset(); loaded = false; authenticated = true;
  assert.equal(descendants(render()).some(node => node.type === "form"), false);
  assert.ok(calls.some(([name, path]) => name === "document-replace" && path === "/"));
});
