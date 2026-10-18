import assert from "node:assert/strict";
import { test } from "node:test";
import { configuredAppOrigin, configuredSupabaseUrl, hasConfiguredClerkKeys, isLocalScanRehearsal, isLocalPaymentPreview } from "../lib/local-access.ts";
import { handleOrderMutation } from "../lib/order-mutation-core.ts";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as scanModel from "../lib/door-scan-model.ts";
import * as staffModel from "../lib/door-staff-model.ts";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cache } from "react";

// Synthetic config only. Never import/read local environment files or call hosted services.
const origin = "https://tickets.diwo-party.com";
const live = { DIWO_APP_ENV: "production", NODE_ENV: "production", VERCEL: "1", VERCEL_ENV: "production",
  DIWO_APP_ORIGIN: origin, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_synthetic", CLERK_SECRET_KEY: "sk_live_synthetic",
  DIWO_PRODUCTION_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co" };
const dev = { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_synthetic", CLERK_SECRET_KEY: "sk_test_synthetic" };
function load(path, dependencies) {
  const compiled = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name];
  }, mod, mod.exports);
  return mod.exports;
}
const { handleDoorScan } = load("../lib/door-scan-core.ts", { "./door-scan-model": scanModel });
const { handleDoorStaff } = load("../lib/door-staff-core.ts", { "./door-staff-model": staffModel, "node:crypto": { createHash } });

test("explicit Production uses matched live keys and HTTPS own origin; local Development stays unchanged", () => {
  assert.equal(configuredAppOrigin(dev), "http://localhost:3000");
  assert.equal(hasConfiguredClerkKeys(dev), true);
  assert.equal(hasConfiguredClerkKeys({ ...dev, NODE_ENV: "production" }), true, "Local next start still uses Development config");
  assert.equal(configuredAppOrigin(live), origin); assert.equal(hasConfiguredClerkKeys(live), true);
  assert.equal(hasConfiguredClerkKeys({ ...live, ...dev }), false);
  assert.equal(hasConfiguredClerkKeys({ ...dev, CLERK_SECRET_KEY: "sk_live_synthetic" }), false);
  assert.equal(hasConfiguredClerkKeys({ ...live, CLERK_SECRET_KEY: "sk_live_synthetic\n" }), false);
  assert.equal(hasConfiguredClerkKeys({ ...dev, VERCEL: "1", VERCEL_ENV: "production" }), false);
  assert.equal(hasConfiguredClerkKeys({ ...live, VERCEL_ENV: "preview" }), false);
  assert.equal(hasConfiguredClerkKeys({ ...live, VERCEL_ENV: "development" }), false);
  assert.equal(hasConfiguredClerkKeys({ ...live, DIWO_APP_ENV: undefined }), false);
  assert.equal(hasConfiguredClerkKeys({ ...live, NODE_ENV: "development" }), false);
  for (const bad of [undefined, "", origin + "/", origin + "/path", origin + "?x=1", origin + "#x", " " + origin,
    "http://tickets.diwo-party.com", "https://localhost", "https://127.0.0.1", "https://[::1]", "https://192.168.1.4",
    "https://user:pass@tickets.diwo-party.com", "https://tickets.diwo-party.com:444", "https://diwo.vercel.app", "https://diwo.local",
    "https://diwo.internal", "https://diwo.example", "https://app..com"]) assert.equal(configuredAppOrigin({ ...live, DIWO_APP_ORIGIN: bad }), null);
  assert.equal(isLocalScanRehearsal("/admin/scan-rehearsal", origin, live), false);
  assert.equal(isLocalPaymentPreview({ ...dev, NODE_ENV: "development" }), true);
  assert.equal(isLocalPaymentPreview(live), false);
  assert.equal(isLocalPaymentPreview({ ...dev, NODE_ENV: "development", VERCEL_ENV: "preview" }), false);
});

test("Production database requires an explicit server pin, never an automatic Development fallback or scanner sandbox", () => {
  assert.equal(configuredSupabaseUrl(dev), "https://dujltrbvytsnftlfitbd.supabase.co");
  assert.equal(configuredSupabaseUrl(live), live.DIWO_PRODUCTION_SUPABASE_URL);
  assert.equal(configuredSupabaseUrl({ ...live, DIWO_PRODUCTION_SUPABASE_URL: "https://dujltrbvytsnftlfitbd.supabase.co" }),
    "https://dujltrbvytsnftlfitbd.supabase.co", "Using the original project requires an explicit later operational decision, not an automatic fallback");
  for (const target of [undefined, "https://ofqywrjvzolmoqimkngt.supabase.co",
    "https://abcdefghijklmnopqrst.supabase.co/", "https://attacker.com", "sb_secret_forbidden"]) {
    assert.equal(configuredSupabaseUrl({ ...live, DIWO_PRODUCTION_SUPABASE_URL: target }), null);
  }
});

const id = "00000000-0000-4000-8000-000000000001";
const post = (url = origin, sender = origin, headers = {}) => new Request(url + "/api/test", {
  method: "POST", headers: { origin: sender, "content-type": "application/json", ...headers }, body: JSON.stringify({ ticketId: id }),
});
test("all three HTTP boundaries admit only the explicitly configured origin, never host headers or arbitrary previews", async () => {
  let calls = 0;
  const authorize = async () => { calls++; return { ok: false, status: 401, reason: "authentication_required" }; };
  const boundaries = [
    (request, allowed) => handleOrderMutation(request, "revoke-ticket", authorize, allowed),
    (request, allowed) => handleDoorScan(request, authorize, allowed),
    (request, allowed) => handleDoorStaff(request, { authorize, directory: {}, origin: allowed }),
  ];
  for (const handle of boundaries) {
    assert.equal((await handle(post(), origin)).status, 401); // Origin accepted, identity still REQUIRED.
    for (const request of [post("http://localhost:3000", "http://localhost:3000"), post(origin, "https://evil.com"),
      post("https://random.vercel.app", origin), post("https://evil.com", origin, { "x-forwarded-host": "tickets.diwo-party.com", "x-forwarded-proto": "https" }),
      post(origin, origin, { "sec-fetch-site": "cross-site" })]) assert.equal((await handle(request, origin)).status, 403);
    assert.equal((await handle(post(), null)).status, 403);
  }
  assert.equal(calls, 3, "Invalid origin must fail before authentication/any RPC");
});

test("Production session client pins URL, keeps native token, and never falls back to anonymous or service role", async t => {
  const names = [...Object.keys(live), "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"];
  const previous = Object.fromEntries(names.map(key => [key, process.env[key]]));
  t.after(() => { for (const [key,value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  Object.assign(process.env, live, { NEXT_PUBLIC_SUPABASE_URL: live.DIWO_PRODUCTION_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic" });
  let created = 0, token = "native_synthetic_token";
  const { createSessionSupabaseClient } = load("../lib/supabase-session.ts", {
    react: { cache },
    "server-only": {}, "@/lib/local-access": { configuredSupabaseUrl, hasConfiguredClerkKeys },
    "@clerk/nextjs/server": { auth: async () => ({ userId: "user_synthetic_live", getToken: async () => token }) },
    "@supabase/supabase-js": { createClient: (url, key, options) => {
      created++; assert.equal(url, live.DIWO_PRODUCTION_SUPABASE_URL); assert.equal(key, "sb_publishable_synthetic");
      assert.deepEqual(options.auth, { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false });
      return { options };
    } },
  });
  const session = await createSessionSupabaseClient(); assert.equal(session.status, "ready");
  assert.equal(await session.client.options.accessToken(), token);
  token = null; await assert.rejects(session.client.options.accessToken(), /session_token_unavailable/);
  assert.equal((await createSessionSupabaseClient()).status, "unauthenticated");
  token = "native_synthetic_token";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://dujltrbvytsnftlfitbd.supabase.co";
  assert.equal((await createSessionSupabaseClient()).status, "configuration_required");
  process.env.NEXT_PUBLIC_SUPABASE_URL = live.DIWO_PRODUCTION_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_secret_forbidden";
  assert.equal((await createSessionSupabaseClient()).status, "configuration_required");
  assert.equal(created, 1);
  let middlewareCalls = 0;
  const middleware = load("../middleware.ts", {
    "@clerk/nextjs/server": { clerkMiddleware: options => {
      assert.deepEqual(options.authorizedParties, [origin]);
      return () => { middlewareCalls++; return new Response(null, { status: 200 }); };
    } },
    "next/server": { NextResponse: { json: Response.json, next: () => new Response(null), redirect: Response.redirect } },
    "@/lib/local-access": { ...await import("../lib/local-access.ts") },
  }).default;
  assert.equal(middleware({ nextUrl: new URL(origin + "/admin/tickets") }, {}).status, 200);
  assert.equal(middleware({ nextUrl: new URL("https://evil.com/admin/tickets") }, {}).status, 403);
  assert.equal(middleware({ nextUrl: new URL(origin + "/api/admin/issue") }, {}).status, 403);
  assert.equal(middlewareCalls, 1);
});

test("deployment config command checks only synthetic values and prints no credentials", () => {
  const script = fileURLToPath(new URL("../scripts/check-production-config.mjs", import.meta.url));
  const env = { ...live, NEXT_PUBLIC_SUPABASE_URL: live.DIWO_PRODUCTION_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic" };
  for (const [change, expected] of [[{}, 0], [{ DIWO_APP_ORIGIN: "http://localhost:3000" }, 1]]) {
    const run = spawnSync(process.execPath, [script], { env: { ...env, ...change }, encoding: "utf8" });
    assert.equal(run.status, expected);
    assert.match(run.stdout, /DIWO_PRODUCTION_CONFIG/);
    assert.doesNotMatch(run.stdout + run.stderr, /pk_live_synthetic|sk_live_synthetic|sb_publishable_synthetic/);
  }
});
