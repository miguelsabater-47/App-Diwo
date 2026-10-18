import assert from "node:assert/strict";
import { test } from "node:test";
import { loginEmail, loginError, passwordSignIn, isAuthScreen } from "../lib/login-flow.ts";

test("email step validates locally without looking up or creating an account", () => {
  assert.equal(loginEmail("  guest@example.com  "), "guest@example.com");
  for (const value of ["", "guest", "guest@", "guest @example.com", "guest@example.com\nother"]) assert.equal(loginEmail(value), null);
});
test("password login activates only Clerk complete session and preserves the account destination", async () => {
  const calls = [];
  const client = { create: async params => { calls.push(params); return { status: "complete", createdSessionId: "sess_verified" }; } };
  const result = await passwordSignIn(client, async data => calls.push(data), "guest@example.com", "secret-password");
  assert.equal(result, "complete");
  assert.deepEqual(calls, [{ strategy: "password", identifier: "guest@example.com", password: "secret-password" }, { session: "sess_verified" }]);
});
test("intermediate Clerk factors continue natively without activating a session", async () => {
  for (const status of ["needs_identifier", "needs_first_factor", "needs_second_factor", "needs_new_password", "needs_client_trust"]) {
    let activated = 0;
    assert.equal(await passwordSignIn({ create: async () => ({ status, createdSessionId: "untrusted_partial" }) }, async () => { activated++; }, "guest@example.com", "password"), "continue");
    assert.equal(activated, 0);
  }
});
test("malformed completion, failed credentials and failed activation never report success or retry", async () => {
  for (const result of [{ status: "complete", createdSessionId: null }, { status: "complete", createdSessionId: "" }, { status: null }, { status: "unexpected" }]) {
    let activated = 0;
    await assert.rejects(passwordSignIn({ create: async () => result }, async () => { activated++; }, "guest@example.com", "password"));
    assert.equal(activated, 0);
  }
  let calls = 0;
  await assert.rejects(passwordSignIn({ create: async () => { calls++; throw new Error("private backend data"); } }, async () => {}, "guest@example.com", "password"));
  assert.equal(calls, 1);
  await assert.rejects(passwordSignIn({ create: async () => ({ status: "complete", createdSessionId: "sess_verified" }) }, async () => { throw new Error("network"); }, "guest@example.com", "password"));
});
test("a superseded password attempt cannot activate a session", async () => {
  let resolve, activated = 0;
  const pending = new Promise(yes => { resolve = yes; });
  let current = true;
  const result = passwordSignIn({ create: () => pending }, async () => { activated++; }, "guest@example.com", "password", () => current);
  current = false;
  resolve({ status: "complete", createdSessionId: "sess_verified" });
  assert.equal(await result, "cancelled");
  assert.equal(activated, 0);
});
test("superseded activation completion cannot report login success", async () => {
  let finishActivation;
  let current = true;
  const activation = new Promise(resolve => { finishActivation = resolve; });
  const attempt = passwordSignIn(
    { create: async () => ({ status: "complete", createdSessionId: "sess_verified" }) },
    () => activation, "qa@example.invalid", "synthetic", () => current,
  );
  await new Promise(resolve => setImmediate(resolve));
  current = false;
  finishActivation();
  assert.equal(await attempt, "cancelled");
});
test("credential errors use the same clear message without disclosing whether an account exists", () => {
  const expected = "El correo electrónico o la contraseña no son correctos. Revisa los datos e inténtalo de nuevo.";
  for (const code of ["form_identifier_not_found", "form_password_incorrect", "form_password_or_identifier_incorrect"]) {
    assert.equal(loginError({ errors: [{ code, longMessage: "Private detail" }] }), expected);
    assert.equal(loginError({ code }), expected);
  }
  for (const error of [null, new Error("private service error"), { code: "unexpected_error" }]) {
    assert.equal(loginError(error), "No hemos podido iniciar sesión en este momento. Inténtalo de nuevo más tarde.");
  }
});

test("safe errors never render raw provider messages or distinguish absent accounts from wrong passwords", () => {
  const first = loginError({ errors: [{ code: "form_identifier_not_found", longMessage: "Private email" }] });
  assert.equal(first, loginError({ errors: [{ code: "form_password_incorrect" }] }));
  assert.equal(loginError({ message: "private token" }).includes("private"), false);
  assert.match(loginError({ errors: [{ code: "too_many_requests" }] }), /Espera/);
  assert.match(loginError({ code: "network_error" }), /conexión/);
});
test("auth-only presentation does not capture unrelated paths or change buyer/admin navigation", () => {
  for (const path of ["/sign-in", "/sign-in/clerk", "/sign-in/clerk/factor-one", "/sign-up", "/sign-up/verify-email-address", "/sso-callback"]) assert.equal(isAuthScreen(path), true);
  for (const path of ["/", "/account", "/ticket", "/admin", "/request", "/sign-in-other", "/sign-up-other"]) assert.equal(isAuthScreen(path), false);
});
test("independent matrix activates only current complete nonempty sessions", async () => {
  for (const status of [null, "needs_identifier", "needs_first_factor", "needs_second_factor", "needs_new_password", "needs_client_trust", "abandoned", "complete"]) {
    for (const session of [null, undefined, "", "sess_verified"]) {
      for (const current of [false, true]) {
        const calls = [];
        const attempt = passwordSignIn({ create: async () => ({ status, createdSessionId: session }) }, async value => calls.push(value), "qa@example.invalid", "synthetic", () => current);
        const complete = current && status === "complete" && session === "sess_verified";
        const partial = current && ["needs_identifier", "needs_first_factor", "needs_second_factor", "needs_new_password", "needs_client_trust"].includes(status);
        if (!current) assert.equal(await attempt, "cancelled");
        else if (complete) assert.equal(await attempt, "complete");
        else if (partial) assert.equal(await attempt, "continue");
        else await assert.rejects(attempt);
        assert.deepEqual(calls, complete ? [{ session: "sess_verified" }] : []);
      }
    }
  }
});
