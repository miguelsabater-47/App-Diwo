import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const OLD = "user_fixture_previous_admin", TARGET = "user_fixture_production_admin";
const source = async path => readFile(new URL(path, import.meta.url), "utf8");
const draft = await source("../drafts/transfer-production-admin.sql");
function transfer(old = OLD, target = TARGET) {
  return draft.replaceAll("__EXPECTED_ADMIN_SUBJECT__", old).replaceAll("__PRODUCTION_ADMIN_SUBJECT__", target);
}

test("protected admin handover on isolated PostgreSQL only; never hosted", { timeout: 90000 }, async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb
    $$; grant usage on schema auth to anon,authenticated,service_role;`);
  await db.exec(await source("../migrations/20261011225839_diwo_foundation.sql"));
  await db.exec(await source("../migrations/20261012105444_diwo_order_payment_rpcs.sql"));
  await db.query("insert into public.user_roles(clerk_user_id,role) values($1,'admin'),('user_fixture_staff','door_staff')", [OLD]);
  const event = (await db.query(`insert into public.events(slug,title,public_location,sales_open_at,starts_at,ends_at,arrival_from,arrival_until,is_published)
    values('admin-handover-fixture','Synthetic','Generic location','2020-01-01','2099-01-02 23:00Z','2099-01-03 07:00Z','2099-01-02 23:30Z','2099-01-03 01:30Z',true) returning id`)).rows[0].id;
  for (let i = 0; i < 2; i++) {
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: OLD, role: "authenticated" })]);
    await db.exec("set role authenticated");
    const order = (await db.query("select * from public.create_order_request(gen_random_uuid(),$1,'Synthetic Buyer',array['First','Second'])", [event])).rows[0].order_id;
    await db.query("select * from public.approve_order_payment($1)", [order]);
    await db.exec("reset role");
  }
  await db.exec("select set_config('request.jwt.claims','{}',false)");
  const guard = async () => (await db.query("select pg_get_functiondef('diwo_private.protect_role_identity()'::regprocedure) as definition")).rows[0].definition;
  const fingerprint = async () => (await db.query(`select jsonb_build_object(
    'orders',(select md5(jsonb_agg(to_jsonb(o) order by o.id)::text) from public.orders o),
    'tickets',(select md5(jsonb_agg(to_jsonb(t) order by t.id)::text) from public.tickets t),
    'roles',(select md5(jsonb_agg(to_jsonb(r) order by r.clerk_user_id)::text) from public.user_roles r)
  ) as value`)).rows[0].value;
  const fails = async (sql, pattern) => {
    const before = await fingerprint(), originalGuard = await guard();
    await assert.rejects(db.exec(sql), pattern); await db.exec("rollback");
    assert.deepEqual(await fingerprint(), before); assert.equal(await guard(), originalGuard);
  };

  await t.test("placeholders, same subject and stale/wrong old identity fail without changing any data", async () => {
    await fails(draft, /explicit_distinct_subjects/);
    await fails(transfer(OLD, OLD), /explicit_distinct_subjects/);
    await fails(transfer("user_fixture_wrong_admin"), /identity_or_state_mismatch/);
  });
  await t.test("a non-owner cannot run maintenance even with a claimed admin JWT", async () => {
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: OLD, role: "authenticated" })]);
    await db.exec("set role authenticated");
    await assert.rejects(db.exec(transfer()), /requires_table_owner/); await db.exec("rollback; reset role");
  });
  await t.test("failure while installing new admin rolls back demotion AND restores original guard", async () => {
    await db.exec(`create function diwo_private.test_reject_new_admin() returns trigger language plpgsql as $$
      begin if new.clerk_user_id='${TARGET}' then raise exception 'synthetic_failure'; end if; return new; end $$;
      create trigger zz_test_reject before insert on public.user_roles for each row execute function diwo_private.test_reject_new_admin();`);
    await fails(transfer(), /synthetic_failure/);
    await db.exec("drop trigger zz_test_reject on public.user_roles; drop function diwo_private.test_reject_new_admin()");
  });
  await t.test("unexpected changes to another role abort and roll back the whole handover", async () => {
    await db.exec(`create function diwo_private.test_unexpected_side_effect() returns trigger language plpgsql as $$
      begin update public.user_roles set role='user' where clerk_user_id='user_fixture_staff'; return new; end $$;
      create trigger zz_test_side_effect after insert on public.user_roles for each row execute function diwo_private.test_unexpected_side_effect();`);
    await fails(transfer(), /admin_transfer_postcondition_failed/);
    await db.exec("drop trigger zz_test_side_effect on public.user_roles; drop function diwo_private.test_unexpected_side_effect()");
  });
  await t.test("successful transfer preserves every historical order/ticket/token and other roles; repeated execution is a no-op", async () => {
    const before = await fingerprint(), originalGuard = await guard();
    await db.exec(transfer());
    const after = await fingerprint();
    assert.equal(before.orders, after.orders); assert.equal(before.tickets, after.tickets);
    assert.equal(await guard(), originalGuard);
    assert.deepEqual((await db.query("select clerk_user_id,role from public.user_roles order by clerk_user_id")).rows,
      [{ clerk_user_id: OLD, role: "user" }, { clerk_user_id: TARGET, role: "admin" }, { clerk_user_id: "user_fixture_staff", role: "door_staff" }].sort((a,b) => a.clerk_user_id.localeCompare(b.clerk_user_id)));
    assert.equal(Number((await db.query("select count(*) as n from public.orders where confirmed_by=$1", [OLD])).rows[0].n), 2);
    await db.exec(transfer()); assert.deepEqual(await fingerprint(), after);
    await fails(`begin; update public.user_roles set role='user' where clerk_user_id='${TARGET}'; commit;`, /role_identity_is_protected/);
    await fails(`begin; insert into public.user_roles(clerk_user_id,role) values('user_fixture_second_admin','admin'); commit;`, /user_roles_one_admin/);
    await fails(`begin; delete from public.user_roles where clerk_user_id='${TARGET}'; commit;`, /admin_identity_is_protected/);
  });
});
