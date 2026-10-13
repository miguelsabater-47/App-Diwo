import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

// Synthetic identities only; no environment, remote service or real subject.
const SUBJECT = "user_fixture_owner";
const BROKEN = SUBJECT + "IED_CLERK_ID__";
const foundation = await readFile(new URL("../migrations/20261011225839_diwo_foundation.sql", import.meta.url), "utf8");
const template = await readFile(new URL("../drafts/repair-development-admin.sql.example", import.meta.url), "utf8");
const bootstrap = await readFile(new URL("../drafts/bootstrap-admin.sql.example", import.meta.url), "utf8");
const repair = template.replace("__REPLACE_ENTIRE_VALUE_WITH_DEVELOPMENT_USER_ID__", SUBJECT);

async function fixture(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
    $$;
    grant usage on schema auth to anon, authenticated, service_role;
  `);
  await db.exec(foundation);
  await db.query("insert into public.user_roles(clerk_user_id,role) values($1,'admin')", [BROKEN]);
  return db;
}

async function expectRejected(db, sql, code = "P0001") {
  await assert.rejects(db.exec(sql), (error) => error.code === code);
  await db.exec("rollback; reset role");
  const state = await db.query(`select clerk_user_id,
    (select tgenabled from pg_trigger where tgrelid='public.user_roles'::regclass
      and tgname='user_roles_identity') as guard from public.user_roles where role='admin'`);
  assert.equal(state.rows[0].clerk_user_id, BROKEN);
  assert.equal(state.rows[0].guard, "O");
}

test("owner repair restores exact role mapping and protected identity", async (t) => {
  const db = await fixture(t);
  await db.exec(repair);
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: SUBJECT })]);
  await db.exec("set role authenticated");
  assert.equal((await db.query("select public.get_current_app_role() as role")).rows[0].role, "admin");
  await assert.rejects(db.query("update public.user_roles set role='user'"), (e) => e.code === "42501");
  await db.exec("reset role");
  await assert.rejects(db.query("update public.user_roles set role='user'"), (e) => e.code === "23514");
  await assert.rejects(db.query("delete from public.user_roles"), (e) => e.code === "23514");
});

test("repair placeholder and partial substitution are rejected without changing guard", async (t) => {
  const db = await fixture(t);
  await expectRejected(db, template);
  await expectRejected(db, template.replace("__REPLACE_ENTIRE_VALUE_WITH_DEVELOPMENT_USER_ID__", BROKEN));
});

test("repair rejects a different requested identity and duplicate target", async (t) => {
  const db = await fixture(t);
  await expectRejected(db, repair.replace(SUBJECT, "user_fixture_other"));
  await db.query("insert into public.user_roles(clerk_user_id,role) values($1,'user')", [SUBJECT]);
  await expectRejected(db, repair);
});

test("repair rejects existing role assignments", async (t) => {
  const db = await fixture(t);
  await db.query("insert into public.user_roles(clerk_user_id,role,assigned_by) values('user_fixture_staff','door_staff',$1)", [BROKEN]);
  await expectRejected(db, repair);
});

test("repair failure after trigger disable rolls back identity and trigger DDL", async (t) => {
  const db = await fixture(t);
  await db.exec(`create function public.fixture_fail() returns trigger language plpgsql as $$
    begin raise exception 'Synthetic update failure'; end $$;
    create trigger fixture_fail before update on public.user_roles
      for each row execute function public.fixture_fail();`);
  await expectRejected(db, repair);
});

test("ordinary authenticated caller cannot run owner repair", async (t) => {
  const db = await fixture(t);
  await db.exec("set role authenticated");
  await expectRejected(db, repair, "42501");
});

test("bootstrap rejects leftover marker even with a valid user prefix", async (t) => {
  const db = await fixture(t);
  await expectRejected(db, bootstrap.replace("__REPLACE_PRIVATELY_WITH_VERIFIED_CLERK_ID__", BROKEN));
});
