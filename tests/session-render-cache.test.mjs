import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

test("session construction is shared within a render, not between actors; tokens stay live", async t => {
  const names = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"];
  const previous = names.map(name => process.env[name]);
  t.after(() => names.forEach((name, i) => {
    if (previous[i] === undefined) delete process.env[name]; else process.env[name] = previous[i];
  }));
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.invalid";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_synthetic";
  const render = new AsyncLocalStorage();
  let creations = 0, authentications = 0;
  // Model React's request-owned cache dispatcher, not a process-wide memoizer.
  const cache = fn => {
    const key = {};
    return () => {
      const scope = render.getStore();
      if (!scope) return fn();
      if (!scope.memo.has(key)) scope.memo.set(key, fn());
      return scope.memo.get(key);
    };
  };
  const deps = {
    "server-only": {}, react: { cache },
    "@/lib/local-access": { hasConfiguredClerkKeys: () => true, configuredSupabaseUrl: () => "https://example.invalid" },
    "@clerk/nextjs/server": { auth: async () => {
      authentications++;
      const scope = render.getStore();
      return { userId: scope?.actor, getToken: async () => scope.token };
    } },
    "@supabase/supabase-js": { createClient: (_url, _key, options) => { creations++; return options; } },
  };
  const compiled = ts.transpileModule(readFileSync(new URL("../lib/supabase-session.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    assert.ok(name in deps, name); return deps[name];
  }, mod, mod.exports);
  const read = mod.exports.createSessionSupabaseClient;
  const results = await Promise.all(["user_a", "user_b"].map(actor =>
    render.run({ actor, token: actor, memo: new Map() }, async () => {
      const sessions = await Promise.all([read(), read(), read()]);
      assert.equal(sessions[0], sessions[1]);
      assert.equal(sessions[1], sessions[2]);
      assert.equal(sessions[0].actorId, actor);
      assert.equal(await sessions[0].client.accessToken(), actor);
      render.getStore().token = null;
      await assert.rejects(sessions[0].client.accessToken(), /session_token_unavailable/);
      return sessions[0];
    })));
  assert.notEqual(results[0], results[1]);
  assert.equal(creations, 2);
  assert.equal(authentications, 2);
  assert.equal((await read()).status, "unauthenticated");
  assert.equal((await read()).status, "unauthenticated");
  assert.equal(authentications, 4, "Calls outside a render are not memoized");
});
