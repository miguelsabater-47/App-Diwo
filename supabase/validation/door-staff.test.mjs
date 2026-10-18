import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const ADMIN = "user_staff_test_admin", STAFF = "user_staff_test_staff", BUYER = "user_staff_test_buyer";
const ref = subject => createHash("sha256").update(`diwo:staff:${subject}`).digest("hex");
test("door staff RPCs on isolated PostgreSQL only", { timeout: 90000 }, async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb
    $$; grant usage on schema auth to anon,authenticated,service_role;`);
  const source = async name => readFile(new URL(name, import.meta.url), "utf8");
  await db.exec(await source("../migrations/20261011225839_diwo_foundation.sql"));
  await db.exec(await source("../drafts/order-payment-rpcs.sql"));
  const draft = await source("../drafts/door-staff-rpcs.sql"); await db.exec(draft);
  await db.query("insert into public.user_roles(clerk_user_id,role) values($1,'admin'),($2,'door_staff')", [ADMIN, STAFF]);
  const event = (await db.query(`insert into public.events(slug,title,public_location,sales_open_at,starts_at,ends_at,arrival_from,arrival_until,is_published)
    values('staff-fixture','Synthetic','Generic','2020-01-01','2099-01-02 23:00UTC','2099-01-03 07:00UTC','2099-01-02 23:30UTC','2099-01-03 01:30UTC',true) returning id`)).rows[0].id;
  const owner = async () => { await db.exec("reset role"); await db.query("select set_config('request.jwt.claims','{}',false)"); };
  const client = async (subject, role = "authenticated", extra = {}) => {
    await owner(); await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: subject, role: "authenticated", ...extra })]); await db.exec(`set role ${role}`);
  };
  const denied = async (code, operation) => {
    await db.exec("savepoint denied"); let actual = "NO_ERROR";
    try { await operation(); } catch (error) { actual = error.code; }
    await db.exec("rollback to savepoint denied; release savepoint denied"); assert.equal(actual, code);
  };
  const grant = async (subject, version = null) => (await db.query("select staff_id,app_role,version::text as version from public.grant_door_staff($1,$2)", [subject, version])).rows[0];
  const revoke = async (subject, version) => (await db.query("select staff_id,app_role,version::text as version from public.revoke_door_staff($1,$2)", [ref(subject), version])).rows[0];
  const rows = async () => { await owner(); return (await db.query("select to_jsonb(r) as row from public.user_roles r order by clerk_user_id")).rows; };
  const scenario = async (name, run) => t.test(name, async () => {
    await owner(); await db.exec("begin"); try { await run(); await db.exec("set constraints all immediate"); } finally { await db.exec("rollback"); await owner(); }
  });
  await scenario("public invokers, authenticated-only entrypoints and inaccessible internal setters", async () => {
    const found = (await db.query(`select proname,prosecdef,proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and proname in ('list_door_staff','read_staff_target','grant_door_staff','revoke_door_staff')`)).rows;
    assert.equal(found.length, 4); assert.ok(found.every(r => !r.prosecdef && r.proconfig.includes('search_path=""')));
    for (const role of ["anon", "service_role"]) {
      await client(ADMIN, role);
      await denied("42501", () => grant(BUYER));
      await denied("42501", () => db.query("select * from public.list_door_staff()"));
    }
    await owner(); await denied("42501", () => grant(BUYER));
    await client(ADMIN);
    await denied("42501", () => db.query("select * from diwo_private.set_door_role($1,true,null)", [BUYER]));
    for (const privilege of ["INSERT", "UPDATE", "DELETE"]) assert.equal((await db.query("select has_table_privilege('authenticated','public.user_roles',$1) as allowed", [privilege])).rows[0].allowed, false);
  });
  await scenario("buyers, staff, missing subjects and forged metadata cannot manage roles", async () => {
    for (const subject of [BUYER, STAFF, "bad", undefined]) {
      await client(subject, "authenticated", { appRole: "admin", public_metadata: { role: "admin" } });
      for (const run of [() => grant(BUYER), () => revoke(STAFF, null), () => db.query("select * from public.list_door_staff()"), () => db.query("select * from public.read_staff_target($1)", [BUYER])]) await denied("42501", run);
    }
  });
  await scenario("admin identity and uniqueness cannot be changed through either operation", async () => {
    const before = await rows(); await client(ADMIN);
    await denied("22023", () => grant(ADMIN)); await denied("22023", () => revoke(ADMIN, null));
    assert.deepEqual(await rows(), before);
  });
  await scenario("lookup is read-only and first grant derives only door_staff; replay preserves original audit", async () => {
    const before = await rows(); await client(ADMIN);
    assert.deepEqual((await db.query("select * from public.read_staff_target($1)", [BUYER])).rows, [{ staff_id: ref(BUYER), app_role: "user", version: null }]);
    assert.deepEqual(await rows(), before); await client(ADMIN);
    const first = await grant(BUYER);
    assert.equal(first.staff_id, ref(BUYER)); assert.equal(first.app_role, "door_staff"); assert.ok(first.version);
    assert.deepEqual(await grant(BUYER), first);
    const stored = (await rows()).find(r => r.row.clerk_user_id === BUYER).row;
    assert.equal(stored.assigned_by, ADMIN); assert.equal(stored.role, "door_staff");
    await client(ADMIN);
    const listed = (await db.query("select * from public.list_door_staff()")).rows;
    assert.equal(listed.length, 2); assert.ok(listed.every(r => Number(r.total_count) === 2 && r.clerk_subject !== ADMIN));
  });
  await scenario("revocation keeps identity/audit and buyer features, denies next door counter read", async () => {
    await client(ADMIN);
    const granted = await grant(BUYER);
    const removed = await revoke(BUYER, granted.version);
    assert.equal(removed.app_role, "user"); assert.equal(removed.staff_id, ref(BUYER)); assert.ok(removed.version);
    assert.deepEqual(await revoke(BUYER, granted.version), removed);
    assert.equal((await db.query("select * from public.list_door_staff()")).rows.some(r => r.clerk_subject === BUYER), false);
    await client(BUYER, "authenticated", { appRole: "door_staff" });
    assert.equal((await db.query("select public.get_current_app_role() as role")).rows[0].role, "user");
    await denied("42501", () => db.query("select * from public.get_event_counters($1)", [event]));
    const order = (await db.query("select * from public.create_order_request($1,$2,'Synthetic',array['Name'])", [randomUUID(), event])).rows[0];
    assert.equal(order.order_status, "pending");
  });
  await scenario("stale prior grant cannot re-enable a revoked user, and stale removal cannot undo a regrant", async () => {
    await client(ADMIN);
    const first = await grant(BUYER); const removed = await revoke(BUYER, first.version);
    await denied("22023", () => grant(BUYER, null));
    const second = await grant(BUYER, removed.version);
    await denied("22023", () => revoke(BUYER, first.version));
    assert.deepEqual(await grant(BUYER, removed.version), second);
  });
  await scenario("invalid subjects, fabricated IDs and stale versions cannot write roles", async () => {
    const before = await rows(); await client(ADMIN);
    for (const subject of [null, "bad", " user_valid", "user_"]) await denied("22023", () => grant(subject));
    await denied("22023", () => db.query("select * from public.revoke_door_staff($1,null)", ["f".repeat(64)]));
    await denied("22023", () => grant(BUYER, "2020-01-01T00:00:00Z"));
    assert.deepEqual(await rows(), before);
  });
  const before = await rows(); await db.exec(draft); await db.exec(draft);
  assert.deepEqual(await rows(), before);
});
