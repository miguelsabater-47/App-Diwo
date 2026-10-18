import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";
import { PGlite } from "@electric-sql/pglite";

const source = await readFile(new URL("../../scripts/test-scanner-sandbox.browser.js", import.meta.url), "utf8");
const install = await readFile(new URL("../testing/scanner-test-install.sql", import.meta.url), "utf8");
const actor = "user_sandbox_flow_local";
async function browser(rpc, options = {}) {
  const logs = [], requests = [];
  let sql;
  const window = { Clerk: { user: { id: actor }, session: { id: "local_session", getToken: async () => "private_mock_token" } },
    prompt: () => options.key ?? "sb_publishable_local_mock_key" };
  const context = { window, location: { origin: options.origin ?? "http://localhost:3000" },
    console: { log: (...args) => logs.push(args) }, AbortSignal,
    copy: text => { sql = text; },
    fetch: async (url, init) => {
      // DevTools utilities exist during initial Console evaluation, not in the
      // resumed async global scope. Reproduce Chrome instead of a permanent mock.
      delete context.copy;
      requests.push({ url, init });
      assert.ok(url.startsWith("https://ofqywrjvzolmoqimkngt.supabase.co/rest/v1/rpc/"));
      assert.equal(init.credentials, "omit"); assert.equal(init.redirect, "error");
      assert.equal(init.headers.Authorization, "Bearer private_mock_token");
      return { ok: true, json: async () => rpc(url.split("/").at(-1), JSON.parse(init.body), window) };
    } };
  await vm.runInNewContext(source, context);
  assert.doesNotMatch(JSON.stringify(logs), /private_mock_token|sb_publishable_local_mock_key|user_sandbox_flow_local|local_session/);
  return { sql, logs, requests };
}
async function database(t) {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    grant usage on schema auth to anon,authenticated,service_role;`);
  await db.exec(install);
  // PGlite owner is postgres; matches the manually used Dashboard owner.
  return db;
}
async function fixtureSql() {
  const setup = await browser(() => "user");
  assert.equal(setup.logs[0][0], "DIWO_SCANNER_SETUP_SQL_COPIED");
  assert.equal(setup.requests.length, 1);
  assert.ok(setup.sql.includes(`'${actor}','admin'`));
  return setup.sql;
}

test("generated fixture and signed browser flow use the real installed SQL; retained states and no reset", { timeout: 90000 }, async t => {
  const db = await database(t), sql = await fixtureSql();
  await db.exec(sql);
  assert.deepEqual((await db.query(`select (select count(*)::int from public.events) as events,
    (select count(*)::int from public.orders) as orders,(select count(*)::int from public.tickets) as tickets,
    (select count(*)::int from public.user_roles) as roles`)).rows[0], { events: 1, orders: 1, tickets: 3, roles: 1 });
  await db.exec(`select set_config('request.jwt.claims','{"sub":"${actor}","role":"authenticated"}',false); set role authenticated;`);
  const rpc = async (name, body) => {
    if (name === "get_current_app_role") return (await db.query("select public.get_current_app_role() as role")).rows[0].role;
    if (name === "read_door_event") return (await db.query("select * from public.read_door_event()")).rows.map(row => ({ ...row,
      used_admissions: Number(row.used_admissions), pending_admissions: Number(row.pending_admissions), issued_non_revoked: Number(row.issued_non_revoked) }));
    return (await db.query("select * from public.check_in_ticket($1,$2)", [body.target_event, body.scanned_token])).rows.map(row => ({ ...row,
      used_at: row.used_at instanceof Date ? row.used_at.toISOString() : row.used_at }));
  };
  const run = await browser(rpc);
  assert.equal(run.logs[0][0], "DIWO_SCANNER_SANDBOX_PASS");
  assert.equal(run.requests.filter(item => item.url.endsWith("check_in_ticket")).length, 5);
  const again = await browser(rpc);
  assert.equal(again.logs[0][1].reason, "fixture_not_fresh_do_not_reset");
  assert.equal(again.requests.filter(item => item.url.endsWith("check_in_ticket")).length, 0);
  await db.exec("reset role; select set_config('request.jwt.claims','{}',false)");
  assert.deepEqual((await db.query("select status,count(*)::int as count from public.tickets group by status order by status")).rows,
    [{ status: "revoked", count: 1 }, { status: "used", count: 2 }]);
  await assert.rejects(db.exec(sql), /sandbox_not_empty_do_not_reset_or_repeat/);
  await db.exec("rollback");
});

test("fixture SQL refuses an original-style unmarked target before creating any data", { timeout: 90000 }, async t => {
  const db = await database(t), sql = await fixtureSql();
  await db.exec("comment on schema diwo_private is null");
  await assert.rejects(db.exec(sql), /wrong_target_missing_sandbox_marker/);
  await db.exec("rollback");
  assert.equal((await db.query("select count(*)::int as count from public.user_roles")).rows[0].count, 0);
});

test("browser rejects wrong origin, secret key and account changes without scanner writes", async () => {
  const origin = await browser(() => "user", { origin: "https://example.com" });
  assert.equal(origin.requests.length, 0);
  const key = await browser(() => "user", { key: "sb_secret_forbidden" });
  assert.equal(key.requests.length, 0);
  const changed = await browser((_name, _body, window) => { window.Clerk.session.id = "changed"; return "user"; });
  assert.equal(changed.logs[0][1].reason, "account_or_session_changed");
  assert.equal(changed.sql, undefined);
});
