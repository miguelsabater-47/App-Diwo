import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { hasDevelopmentClerkKeys, isPrivilegedPath, isLegacyRedemptionPath, isConfiguredOrderAdminPage, isConfiguredDoorPage } from "../lib/local-access.ts";

const require = createRequire(import.meta.url);
const { NextRequest } = require("next/server");
const { getRelativeURL } = require("next/dist/shared/lib/router/utils/relativize-url");

test("canonical localhost remains an internal rewrite; mixed loopback origins become a proxy", () => {
  const canonical = "http://localhost:3000/";
  const numeric = "http://127.0.0.1:3000/";
  assert.equal(new NextRequest(canonical).url, canonical);
  assert.equal(getRelativeURL(new NextRequest(canonical).url, canonical), "/");
  assert.equal(new NextRequest(numeric).url, canonical);
  assert.equal(getRelativeURL(new NextRequest(numeric).url, numeric), canonical);
});

test("missing, placeholder, production and mixed environments cannot start local auth", () => {
  for (const env of [
    {},
    { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "", CLERK_SECRET_KEY: "" },
    { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_example" },
    { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_example", CLERK_SECRET_KEY: "sk_live_example" },
    { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_example", CLERK_SECRET_KEY: "sk_live_example" },
    { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_", CLERK_SECRET_KEY: "sk_test_" },
    { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: " pk_test_example", CLERK_SECRET_KEY: "sk_test_example" },
  ]) assert.equal(hasDevelopmentClerkKeys(env), false);
});

test("development format accepts an owned-key shape but does not claim identity or role verification", () => {
  assert.equal(hasDevelopmentClerkKeys({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_testvalue", CLERK_SECRET_KEY: "sk_test_testvalue" }), true);
});

test("all privileged namespaces and descendants are blocked, without matching unrelated prefixes", () => {
  for (const path of ["/admin", "/admin/", "/admin/requests", "/api/admin", "/api/admin/issue", "/api/admin/next-code", "/scan", "/scan/session"]) {
    assert.equal(isPrivilegedPath(path), true, path);
  }
  for (const path of ["/", "/account", "/ticket", "/sign-in", "/administrator", "/api/administrator", "/scanner"]) {
    assert.equal(isPrivilegedPath(path), false, path);
  }
});

test("only independently guarded new administration pages pass the namespace stop gate", () => {
  for (const path of ["/admin", "/admin/", "/admin/requests", "/admin/requests/", "/admin/scan", "/admin/scan/", "/admin/staff", "/admin/staff/", "/admin/tickets", "/admin/tickets/"]) assert.equal(isConfiguredOrderAdminPage(path), true);
  for (const path of ["/admin/tickets/other", "/admin/scan/other", "/admin/staff/other", "/admin/requests/other", "/api/admin/issue", "/scan"]) assert.equal(isConfiguredOrderAdminPage(path), false);
});

test("retired redemption includes descendants but leaves the new session endpoint separate", () => {
  for (const path of ["/api/redeem", "/api/redeem/", "/api/redeem/anything"]) assert.equal(isLegacyRedemptionPath(path), true);
  for (const path of ["/api/session", "/api/redeemer", "/account"]) assert.equal(isLegacyRedemptionPath(path), false);
});

test("scanner exception is exact and never unlocks children or legacy APIs", () => {
  for (const path of ["/scan", "/scan/"]) assert.equal(isConfiguredDoorPage(path), true);
  for (const path of ["/scan/session", "/scanner", "/api/redeem", "/api/admin/issue"]) assert.equal(isConfiguredDoorPage(path), false);
});
