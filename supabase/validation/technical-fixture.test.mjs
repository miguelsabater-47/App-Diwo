import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const eventId = "9d560641-aacf-4d25-8d65-94960bba59b2";
const fixture = await readFile(new URL("../drafts/technical-test-event.sql", import.meta.url), "utf8");
const foundation = await readFile(new URL("../migrations/20261011225839_diwo_foundation.sql", import.meta.url), "utf8");

test("authorized technical fixture is exact, isolated, idempotent and owner-only", { timeout: 90000 }, async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
      grant usage on schema auth to anon, authenticated, service_role;`);
    await db.exec(foundation);
    await db.exec(`insert into public.events(slug,title,public_location,sales_open_at,starts_at,
      ends_at,arrival_from,arrival_until,is_published) values ('diwo-x-2-2026','DIWO X 2.0',
      'Casa de campo en Ceutí','2026-10-15 20:00 Europe/Madrid','2026-10-31 23:00 Europe/Madrid',
      '2026-11-01 07:00 Europe/Madrid','2026-10-31 23:30 Europe/Madrid','2026-11-01 01:30 Europe/Madrid',false);`);
    const realBefore = (await db.query("select * from public.events where slug='diwo-x-2-2026'")).rows;
    await db.exec(fixture);
    const first = (await db.query("select * from public.events where id=$1", [eventId])).rows;
    assert.equal(first.length, 1);
    assert.equal(first[0].is_published, true);
    assert.equal(first[0].unit_price_cents, 500);
    assert.equal((await db.query("select sales_open_at < now() as open from public.events where id=$1", [eventId])).rows[0].open, true);
    await db.exec(fixture);
    assert.deepEqual((await db.query("select * from public.events where id=$1", [eventId])).rows, first);
    assert.deepEqual((await db.query("select * from public.events where slug='diwo-x-2-2026'")).rows, realBefore);
    assert.equal((await db.query("select count(*)::int as n from public.orders")).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::int as n from public.tickets")).rows[0].n, 0);
    await db.exec("set role authenticated");
    await assert.rejects(db.exec(fixture), /owner_execution_required/);
    await db.exec("rollback; reset role");
    await db.query("update public.events set title='Conflicting fixture' where id=$1", [eventId]);
    await assert.rejects(db.exec(fixture), /technical_fixture_conflict/);
    await db.exec("rollback");
    assert.equal((await db.query("select title from public.events where id=$1", [eventId])).rows[0].title, "Conflicting fixture");
    assert.deepEqual((await db.query("select * from public.events where slug='diwo-x-2-2026'")).rows, realBefore);
  } finally {
    await db.close();
  }
});
