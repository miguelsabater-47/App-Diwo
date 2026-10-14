import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as flow from "../lib/login-flow.ts";

const source = readFileSync(new URL("../components/login-screen.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
let values, refs, index, calls, session, loaded, authenticated, authReady;
const react = {
  useState(initial) { const slot = index++; if (!(slot in values)) values[slot] = initial; return [values[slot], next => { values[slot] = typeof next === "function" ? next(values[slot]) : next; }]; },
  useRef(initial) { const slot = index++; return refs[slot] ?? (refs[slot] = { current: initial }); },
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
  if (name === "@clerk/nextjs") return { useAuth: () => ({ isLoaded: authReady, isSignedIn: authenticated }), useSignIn: () => ({ isLoaded: loaded, signIn: session, setActive: async data => calls.push(["activate", data]) }), SignIn: NativeSignIn };
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
}
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
test("password submit is single flight and preserves completed account navigation", async () => {
  reset(); emailStep();
  control("Contraseña").props.onChange({ target: { value: "password" } });
  const submit = find(node => node.type === "form").props.onSubmit;
  submit({ preventDefault() {} }); submit({ preventDefault() {} });
  await settle();
  assert.equal(calls.filter(([name]) => name === "create").length, 1);
  assert.deepEqual(calls.find(([name]) => name === "activate"), ["activate", { session: "sess_verified" }]);
  assert.ok(calls.some(([name, path]) => name === "replace" && path === "/account"));
});
test("Google uses Clerk redirect callback, not a fabricated local session", async () => {
  reset(); control("Continuar con Google").props.onClick(); await settle();
  assert.deepEqual(calls[0], ["google", { strategy: "oauth_google", redirectUrl: "/sso-callback", redirectUrlComplete: "/account" }]);
  assert.equal(calls.some(([name]) => name === "activate"), false);
});
test("recovery and extra factors hand off to native Clerk without premature activation", async () => {
  reset(); emailStep(); control("Recuperar contraseña").props.onClick(); await settle();
  assert.equal(calls[0][1].strategy, "reset_password_email_code");
  assert.ok(calls.some(([name, path]) => name === "push" && path === "/sign-in/clerk"));
  reset(); session.create = async () => ({ status: "needs_second_factor" }); emailStep();
  control("Contraseña").props.onChange({ target: { value: "password" } });
  find(node => node.type === "form").props.onSubmit({ preventDefault() {} }); await settle();
  assert.equal(calls.some(([name]) => name === "activate"), false);
  assert.ok(calls.some(([name, path]) => name === "push" && path === "/sign-in/clerk"));
  assert.ok(descendants(render({ nativePath: "/sign-in/clerk" })).some(node => node.type === NativeSignIn && node.props.path === "/sign-in/clerk"));
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
test("an existing signed-in session keeps the previous account redirect instead of offering another login", () => {
  reset(); authenticated = true;
  assert.equal(descendants(render()).some(node => node.type === "form"), false);
  assert.ok(calls.some(([name, path]) => name === "replace" && path === "/account"));
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
  assert.ok(calls.some(([name, path]) => name === "replace" && path === "/account"));
});
