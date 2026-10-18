import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const read=async file => (await readFile(new URL(file,import.meta.url),"utf8")).replaceAll("\r\n","\n");
const install=await read("../testing/scanner-test-install.sql"),verify=await read("../testing/scanner-test-verify.sql");
const foundation=await read("../migrations/20261011225839_diwo_foundation.sql"),payment=await read("../drafts/order-payment-rpcs.sql"),scanner=await read("../drafts/door-scan-rpcs.sql");
const marker="DIWO_SCANNER_TEST_ONLY_V1 - isolated empty scanner project";
async function database(t) {
  const db=new PGlite(); t.after(() => db.close());
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    grant usage on schema auth to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;`);
  return db;
}
async function denied(db,sql,code) {
  let actual;
  try { await db.exec(sql); } catch(error) { actual=error.code; }
  await db.exec("rollback"); assert.equal(actual,code);
}
async function noPartialInstall(db) {
  const row=(await db.query(`select to_regnamespace('diwo_private') is null as no_schema,
    to_regclass('public.events') is null as no_table,
    to_regprocedure('public.check_in_ticket(uuid,text)') is null as no_function`)).rows[0];
  assert.deepEqual(row,{ no_schema:true,no_table:true,no_function:true });
}
async function snapshot(db) {
  return (await db.query(`select
    (select md5(string_agg(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''),E'\n' order by p.oid))
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','diwo_private')) as function_hash,
    (select md5(string_agg(c.relname||c.relrowsecurity::text||coalesce(c.relacl::text,''),E'\n' order by c.oid))
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r') as table_hash,
    (select count(*)::int from public.events) as events,
    (select count(*)::int from public.orders) as orders,
    (select count(*)::int from public.tickets) as tickets,
    (select count(*)::int from public.user_roles) as roles,
    obj_description(to_regnamespace('diwo_private'),'pg_namespace') as marker`)).rows[0];
}

test("sandbox installer embeds exact reviewed SQL, one transaction and no extra payment writer surface", () => {
  const foundationBody=install.split("-- BEGIN UNCHANGED FOUNDATION BODY (no fixture or application-role rows).\n")[1].split("-- END UNCHANGED FOUNDATION BODY.")[0].trim();
  assert.equal(foundationBody,foundation.slice(foundation.indexOf("do $$")).trim());
  const helper=source => { const start=source.indexOf("create function diwo_private.lock_order_actor"); return source.slice(start,source.indexOf("\nend $$;",start)+8); };
  assert.equal(helper(install),helper(payment));
  const scannerBody=install.split("-- BEGIN UNCHANGED SCANNER RPC BODY (outer transaction supplied by this file).\n")[1].split("-- END UNCHANGED SCANNER RPC BODY.")[0].trim();
  assert.equal(scannerBody,scanner.slice(scanner.indexOf("create or replace function"),scanner.lastIndexOf("\ncommit;")).trim());
  assert.equal(install.match(/^begin;$/gm).length,1); assert.equal(install.match(/^commit;$/gm).length,1);
  assert.equal(/create function (?:public|diwo_private)\.(?:create_order_request|report_order_payment|approve_order_payment)/i.test(install),false);
});
test("empty sandbox installs all verified controls and ZERO business/role rows despite broad default grants", { timeout:90000 }, async t => {
  const db=await database(t); await db.exec(install);
  const result=(await db.query(verify)).rows[0]; assert.equal(Object.keys(result).length,11);
  assert.ok(Object.values(result).every(value => value===true));
  assert.equal((await db.query("select obj_description(to_regnamespace('diwo_private'),'pg_namespace') as marker")).rows[0].marker,marker);
});
test("repeating installer fails closed and preserves installed definitions, permissions and zero data", { timeout:90000 }, async t => {
  const db=await database(t); await db.exec(install); const before=await snapshot(db);
  await denied(db,install,"55000"); assert.deepEqual(await snapshot(db),before);
});
test("existing original-style foundation and event are preserved, never overwritten or re-marked", { timeout:90000 }, async t => {
  const db=await database(t); await db.exec(foundation);
  await db.exec(`insert into public.events(slug,title,public_location,sales_open_at,starts_at,ends_at,arrival_from,arrival_until)
    values('untouched-synthetic','Existing synthetic row','Generic','2020-01-01','2020-01-02 23:00UTC','2020-01-03 07:00UTC','2020-01-02 23:30UTC','2020-01-03 01:30UTC');`);
  const before=await snapshot(db),row=(await db.query("select to_jsonb(e) as row from public.events e")).rows;
  await denied(db,install,"55000"); assert.deepEqual(await snapshot(db),before); assert.deepEqual((await db.query("select to_jsonb(e) as row from public.events e")).rows,row);
});
test("single conflicting relation or exposed function blocks install before any private schema is created", { timeout:90000 }, async t => {
  const table=await database(t); await table.exec("create table public.tickets(id integer primary key); insert into public.tickets values(7)");
  await denied(table,install,"55000"); assert.equal((await table.query("select to_regnamespace('diwo_private') is null as absent")).rows[0].absent,true);
  assert.deepEqual((await table.query("select id from public.tickets")).rows,[{ id:7 }]);
  const fn=await database(t); await fn.exec("create function public.check_in_ticket() returns integer language sql as $$ select 7 $$;");
  await denied(fn,install,"55000"); assert.equal((await fn.query("select public.check_in_ticket() as value")).rows[0].value,7); await noPartialInstall(fn);
});
test("anon/authenticated/service_role cannot run installer even when target is empty", { timeout:90000 }, async t => {
  const db=await database(t);
  for (const role of ["anon","authenticated","service_role"]) {
    await db.exec(`set role ${role}`); await denied(db,install,"42501"); await db.exec("reset role"); await noPartialInstall(db);
  }
});
test("late SQL failure rolls back the entire fresh installation, not just the final statement", { timeout:90000 }, async t => {
  const db=await database(t);
  await denied(db,install.replace(/\ncommit;\s*$/,"\nselect 1/0;\ncommit;\n"),"22012"); await noPartialInstall(db);
});
test("sandbox scanner keeps actual role/empty-event behavior and no anonymous/helper/private QR access", { timeout:90000 }, async t => {
  const db=await database(t); await db.exec(install);
  await db.exec(`insert into public.user_roles(clerk_user_id,role) values('user_sandbox_local_admin','admin');
    select set_config('request.jwt.claims','{"sub":"user_sandbox_local_admin","role":"authenticated"}',false);
    set role authenticated;`);
  assert.deepEqual((await db.query("select * from public.read_door_event()")).rows,[]);
  assert.equal((await db.query("select public.get_current_app_role() as role")).rows[0].role,"admin");
  // A new project has no privileged app users until separately bootstrapped.
  await db.exec("reset role; select set_config('request.jwt.claims','{}',false); set role anon;");
  await denied(db,"begin; select * from public.read_door_event(); commit;","42501");
});
