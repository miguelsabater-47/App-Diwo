import assert from "node:assert/strict";
import { test } from "node:test";
import { loginEmail, loginError, passwordSignIn, recoverPassword, isAuthScreen } from "../lib/login-flow.ts";

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
  for (const status of ["needs_identifier", "needs_first_factor", "needs_second_factor", "needs_new_password"]) {
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
test("recovery uses the installed Clerk email-reset strategy without auto sign-in", async () => {
  const calls = [];
  await recoverPassword({ create: async params => { calls.push(params); return { status: "needs_first_factor" }; } }, "guest@example.com");
  assert.deepEqual(calls, [{ strategy: "reset_password_email_code", identifier: "guest@example.com" }]);
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
  for (const status of [null, "needs_identifier", "needs_first_factor", "needs_second_factor", "needs_new_password", "abandoned", "complete"]) {
    for (const session of [null, undefined, "", "sess_verified"]) {
      for (const current of [false, true]) {
        const calls = [];
        const attempt = passwordSignIn({ create: async () => ({ status, createdSessionId: session }) }, async value => calls.push(value), "qa@example.invalid", "synthetic", () => current);
        const complete = current && status === "complete" && session === "sess_verified";
        const partial = current && ["needs_identifier", "needs_first_factor", "needs_second_factor", "needs_new_password"].includes(status);
        if (!current) assert.equal(await attempt, "cancelled");
        else if (complete) assert.equal(await attempt, "complete");
        else if (partial) assert.equal(await attempt, "continue");
        else await assert.rejects(attempt);
        assert.deepEqual(calls, complete ? [{ session: "sess_verified" }] : []);
      }
    }
  }
});
