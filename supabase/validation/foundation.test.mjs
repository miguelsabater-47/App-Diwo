import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

// Synthetic identities ONLY. This mock tests SQL/RLS, not JWT signatures or
// hosted Clerk/Supabase connectivity. No URL, credentials or real user is read.
const ADMIN = "user_fixture_admin";
const STAFF = "user_fixture_staff";
const BUYER = "user_fixture_buyer";
const OTHER = "user_fixture_other";
const sql = await readFile(new URL("../drafts/foundation.sql", import.meta.url), "utf8");

test("foundation draft on disposable PostgreSQL", { timeout: 90000 }, async (t) => {
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
    -- Simulate legacy broad default grants to prove the draft revokes them.
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  `);
  await db.exec(sql);
  const version = await db.query("select current_setting('server_version') as version");
  t.diagnostic(`Local engine PostgreSQL ${version.rows[0].version}; mock auth, no hosted changes.`);

  const owner = async () => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claims', '{}', false)");
  };
  const client = async (subject, extra = {}, role = "authenticated") => {
    await owner();
    await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: subject, role: "authenticated", ...extra })]);
    await db.exec(`set role ${role}`);
  };
  const expectCode = async (code, run) => {
    let actual = "NO_ERROR";
    try { await run(); } catch (error) { actual = error.code ?? "UNEXPECTED_ERROR"; }
    // Only codes are compared: never dump credentials, row contents or SQL details.
    assert.equal(actual, code);
  };
  const scenario = async (name, run) => t.test(name, async () => {
    await owner();
    await db.exec("begin; savepoint scenario");
    try { await run(); }
    finally { await db.exec("rollback"); await owner(); }
  });
  const createOrder = async (buyer, names, event) => (await db.query(`
    insert into public.orders(event_id, buyer_clerk_id, buyer_name, attendee_names)
    values ($1,$2,'Synthetic Buyer',$3::text[]) returning id,quantity,total_cents`, [event, buyer, names])).rows[0];
  const issue = async (order, names, event) => {
    await db.query("update public.orders set status='confirmed',confirmed_by=$2 where id=$1", [order.id, ADMIN]);
    const ids = [];
    for (const [i, name] of names.entries()) {
      const r = await db.query(`insert into public.tickets(order_id,event_id,ticket_position,attendee_name)
        values($1,$2,$3,$4) returning id`, [order.id, event, i + 1, name]);
      ids.push(r.rows[0].id);
    }
    return ids;
  };

  await db.query("insert into public.user_roles(clerk_user_id,role) values($1,'admin'),($2,'door_staff')", [ADMIN, STAFF]);
  const events = (await db.query(`insert into public.events(slug,title,public_location,sales_open_at,starts_at,ends_at,arrival_from,arrival_until,is_published)
    select 'fixture-'||n,'Synthetic Event','Generic venue','2020-01-01 UTC','2020-02-01 23:00 UTC',
      '2020-02-02 07:00 UTC','2020-02-01 23:30 UTC','2020-02-02 01:30 UTC',n<3
    from generate_series(1,4) as n returning id`)).rows.map((r) => r.id);
  await db.exec("begin");
  const paid = await createOrder(BUYER, ["Guest One", "Guest Two", "Guest Three"], events[0]);
  const tickets = await issue(paid, ["Guest One", "Guest Two", "Guest Three"], events[0]);
  const ownStaff = await createOrder(STAFF, ["Staff Buyer"], events[0]);
  await issue(ownStaff, ["Staff Buyer"], events[0]);
  const otherPaid = await createOrder(OTHER, ["Other Guest"], events[1]);
  await issue(otherPaid, ["Other Guest"], events[1]);
  await db.query("update public.tickets set status='used',used_by=$2 where id=$1", [tickets[0], STAFF]);
  await db.query("update public.tickets set status='revoked',revoked_by=$2 where id=$1", [tickets[2], ADMIN]);
  await db.exec("commit");

  // Deliberately unsafe TEST-ONLY definers prove domain guards remain effective
  // behind a future privileged RPC. These are not part of the deployment draft.
  await db.exec(`create schema test_only;
    grant usage on schema test_only to authenticated;
    create function test_only.mark_used(target uuid) returns void language sql security definer set search_path='' as $$
      update public.tickets set status='used' where id=target
    $$;
    create function test_only.confirm_order(target uuid) returns void language sql security definer set search_path='' as $$
      update public.orders set status='confirmed' where id=target
    $$;
    create function test_only.create_order(event uuid,buyer text) returns void language sql security definer set search_path='' as $$
      insert into public.orders(event_id,buyer_clerk_id,buyer_name,attendee_names) values(event,buyer,'Synthetic',array['Guest'])
    $$;
    grant execute on all functions in schema test_only to authenticated;`);

  await scenario("exactly four RLS-protected application tables", async () => {
    const r = await db.query("select relname,relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by relname");
    assert.deepEqual(r.rows.map((x) => x.relname), ["events", "orders", "tickets", "user_roles"]);
    assert.equal(r.rows.every((x) => x.relrowsecurity), true);
  });
  await scenario("public wrappers are invokers and private definers fix search_path", async () => {
    const r = await db.query("select n.nspname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','diwo_private')");
    assert.equal(r.rows.filter((x) => x.nspname === "public").every((x) => !x.prosecdef), true);
    assert.equal(r.rows.filter((x) => x.prosecdef).every((x) => x.proconfig?.some((s) => s.startsWith("search_path="))), true);
  });
  await scenario("anon sees published metadata only", async () => {
    await client(null, {}, "anon");
    assert.equal((await db.query("select id from public.events")).rows.length, 2);
    await expectCode("42501", () => db.query("select id from public.orders"));
  });
  await scenario("anonymous cannot call role or counter RPC", async () => {
    await client(null, {}, "anon");
    await expectCode("42501", () => db.query("select public.get_current_app_role()"));
  });
  await scenario("Clerk subject is text, non-Clerk UUID has no app role", async () => {
    await client("00000000-0000-4000-8000-000000000000");
    assert.equal((await db.query("select public.get_current_app_role() as role")).rows[0].role, null);
  });
  await scenario("signed subject defaults to user; editable role claims are ignored", async () => {
    await client(BUYER, { app_role: "admin", public_metadata: { role: "admin" }, private_metadata: { role: "admin" } });
    assert.equal((await db.query("select public.get_current_app_role() as role")).rows[0].role, "user");
    assert.equal((await db.query("select id from public.orders")).rows.length, 1);
  });
  await scenario("buyer only reads owned tickets", async () => {
    await client(BUYER);
    assert.equal((await db.query("select id,status from public.tickets")).rows.length, 3);
  });
  await scenario("door staff keeps own buyer finances but cannot read other orders", async () => {
    await client(STAFF);
    const r = await db.query("select id,total_cents from public.orders");
    assert.equal(r.rows.length, 1);
    assert.equal(Number(r.rows[0].total_cents), 500);
    assert.equal((await db.query("select id from public.tickets")).rows.length, 1);
  });
  await scenario("admin reads all orders including other buyers", async () => {
    await client(ADMIN);
    assert.equal((await db.query("select id from public.orders")).rows.length, 3);
    assert.equal((await db.query("select id from public.events")).rows.length, 4);
  });
  for (const [label, subject] of [["buyer", BUYER], ["door staff", STAFF], ["admin", ADMIN]]) {
    await scenario(`${label} cannot directly select raw QR token`, async () => {
      await client(subject);
      await expectCode("42501", () => db.query("select qr_token from public.tickets"));
    });
  }
  await scenario("user cannot create or elevate any role", async () => {
    await client(BUYER);
    await expectCode("42501", () => db.query("insert into public.user_roles(clerk_user_id,role) values($1,'admin')", [BUYER]));
  });
  await scenario("admin cannot bypass verified staff assignment via direct role write", async () => {
    await client(ADMIN);
    await expectCode("42501", () => db.query("update public.user_roles set role='admin' where clerk_user_id=$1", [STAFF]));
  });
  await scenario("exactly one admin and ordinary identity replacement forbidden", async () => {
    await expectCode("23505", () => db.query("insert into public.user_roles(clerk_user_id,role) values('user_fixture_secondadmin','admin')"));
  });
  for (const operation of ["delete", "demote", "replace"]) {
    await scenario(`protected admin cannot ${operation}`, async () => {
      const query = operation === "delete" ? "delete from public.user_roles where role='admin'"
        : operation === "demote" ? "update public.user_roles set role='user' where role='admin'"
          : "update public.user_roles set clerk_user_id='user_fixture_replacement' where role='admin'";
      await expectCode("23514", () => db.query(query));
    });
  }
  await scenario("operational counters exclude annulled, include used, isolate events", async () => {
    await client(STAFF);
    const r = (await db.query("select * from public.get_event_counters($1)", [events[0]])).rows[0];
    assert.deepEqual([r.used_admissions, r.pending_admissions, r.issued_non_revoked].map(Number), [1, 2, 3]);
    assert.ok(Math.abs(Number(r.progress_ratio) - 1 / 3) < 1e-10);
    const other = (await db.query("select * from public.get_event_counters($1)", [events[1]])).rows[0];
    assert.deepEqual([other.used_admissions, other.pending_admissions, other.issued_non_revoked].map(Number), [0, 1, 1]);
  });
  await scenario("empty counter denominator returns null rather than division error", async () => {
    await client(STAFF);
    const r = (await db.query("select * from public.get_event_counters($1)", [events[2]])).rows[0];
    assert.equal(Number(r.issued_non_revoked), 0);
    assert.equal(r.progress_ratio, null);
  });
  await scenario("normal user cannot read operational counters", async () => {
    await client(BUYER);
    await expectCode("42501", () => db.query("select * from public.get_event_counters($1)", [events[0]]));
  });
  await scenario("revocation blocks next counter read without refreshing JWT", async () => {
    await db.query("update public.user_roles set role='user' where clerk_user_id=$1", [STAFF]);
    await client(STAFF, { app_role: "door_staff" });
    await expectCode("42501", () => db.query("select * from public.get_event_counters($1)", [events[0]]));
  });
  await scenario("normal user cannot invoke an unsafe definer to check in", async () => {
    await client(BUYER);
    await expectCode("42501", () => db.query("select test_only.mark_used($1)", [tickets[1]]));
  });
  await scenario("malformed subject cannot exploit a definer owner fallback", async () => {
    await client(null);
    await expectCode("42501", () => db.query("select test_only.mark_used($1)", [tickets[1]]));
  });
  await scenario("staff check-in derives current actor/server time, no arrival gate", async () => {
    await client(STAFF);
    await db.query("select test_only.mark_used($1)", [tickets[1]]);
    await owner();
    const r = (await db.query("select status,used_by,used_at>=issued_at as valid_time from public.tickets where id=$1", [tickets[1]])).rows[0];
    assert.equal(r.status, "used");
    assert.equal(r.used_by, STAFF);
    assert.equal(r.valid_time, true);
  });
  await scenario("revoked staff cannot check in even with stale app-role claim", async () => {
    await db.query("update public.user_roles set role='user' where clerk_user_id=$1", [STAFF]);
    await client(STAFF, { app_role: "door_staff" });
    await expectCode("42501", () => db.query("select test_only.mark_used($1)", [tickets[1]]));
  });
  for (const target of [tickets[0], tickets[2]]) {
    await scenario("used or revoked tickets cannot reactivate or accept another use", async () => {
      await expectCode("23514", () => db.query("update public.tickets set status='valid',used_at=null,used_by=null,revoked_at=null,revoked_by=null where id=$1", [target]));
    });
  }
  await scenario("used ticket cannot be annulled", async () => {
    await expectCode("23514", () => db.query("update public.tickets set status='revoked',revoked_by=$2,used_at=null,used_by=null where id=$1", [tickets[0], ADMIN]));
  });
  await scenario("names/QR identity cannot be transferred after issuance", async () => {
    await expectCode("23514", () => db.query("update public.tickets set attendee_name='Changed' where id=$1", [tickets[1]]));
  });
  await scenario("paid order cannot cancel or rewrite financial snapshot", async () => {
    await expectCode("23514", () => db.query("update public.orders set status='cancelled',confirmed_at=null,confirmed_by=null,closed_by=$2 where id=$1", [paid.id, ADMIN]));
  });
  for (const table of ["orders", "tickets"]) {
    await scenario(`${table} cannot physically delete history`, async () => {
      await expectCode("23514", () => db.query(`delete from public.${table}`));
    });
  }
  for (const names of [[], [""], ["   "], [null]]) {
    await scenario("missing attendee names are rejected", async () => {
      await expectCode("23514", () => createOrder(BUYER, names, events[0]));
    });
  }
  await scenario("duplicate names allowed, amount derived, forecast is not a cap", async () => {
    const r = await createOrder(BUYER, Array(200).fill("Same Guest"), events[0]);
    assert.equal(r.quantity, 200);
    assert.equal(Number(r.total_cents), 100000);
  });
  await scenario("order cannot change names/owner after submission", async () => {
    const r = await createOrder(BUYER, ["Guest"], events[0]);
    await expectCode("23514", () => db.query("update public.orders set buyer_clerk_id=$2 where id=$1", [r.id, OTHER]));
  });
  await scenario("direct forged-price insert rejected", async () => {
    await expectCode("23514", () => db.query("insert into public.orders(event_id,buyer_clerk_id,buyer_name,attendee_names,unit_price_cents) values($1,$2,'Synthetic',array['Guest'],1)", [events[0], BUYER]));
  });
  await scenario("unsafe definer cannot assign an order to another buyer", async () => {
    await client(BUYER);
    await expectCode("42501", () => db.query("select test_only.create_order($1,$2)", [events[0], OTHER]));
  });
  await scenario("payment report leaves pending, never generates tickets", async () => {
    const r = await createOrder(BUYER, ["Guest"], events[0]);
    await db.query("update public.orders set payment_reported_at=clock_timestamp() where id=$1", [r.id]);
    const result = (await db.query("select status,(select count(*) from public.tickets where order_id=$1) as issued from public.orders where id=$1", [r.id])).rows[0];
    assert.equal(result.status, "pending");
    assert.equal(Number(result.issued), 0);
  });
  await scenario("ticket cannot belong to another event or mismatched name", async () => {
    await expectCode("23503", () => db.query("insert into public.tickets(order_id,event_id,ticket_position,attendee_name) values($1,$2,1,'Guest One')", [paid.id, events[1]]));
  });
  await scenario("pending order cannot issue a ticket", async () => {
    const r = await createOrder(BUYER, ["Guest"], events[0]);
    await expectCode("23514", () => db.query("insert into public.tickets(order_id,event_id,ticket_position,attendee_name) values($1,$2,1,'Guest')", [r.id, events[0]]));
  });
  await scenario("ticket QR unique, opaque and private to table-owner future renderer", async () => {
    const r = await db.query("select count(distinct qr_token)=count(*) as unique_tokens,bool_and(qr_token ~ '^[0-9a-f]{64}$') as opaque from public.tickets");
    assert.equal(r.rows[0].unique_tokens, true);
    assert.equal(r.rows[0].opaque, true);
  });
  await t.test("partial approval rolls back rather than leave confirmed with missing tickets", async () => {
    await owner();
    await db.exec("begin");
    const r = await createOrder(BUYER, ["Guest A", "Guest B"], events[0]);
    await db.query("update public.orders set status='confirmed',confirmed_by=$2 where id=$1", [r.id, ADMIN]);
    await db.query("insert into public.tickets(order_id,event_id,ticket_position,attendee_name) values($1,$2,1,'Guest A')", [r.id, events[0]]);
    await expectCode("23514", () => db.exec("commit"));
    await db.exec("rollback");
    assert.equal((await db.query("select id from public.orders where id=$1", [r.id])).rows.length, 0);
  });
  await scenario("event template prepares an unpublished release with current opening and correct Madrid party times", async () => {
    const before = Date.now();
    await db.exec(await readFile(new URL("../drafts/event.sql.example", import.meta.url), "utf8"));
    const r = (await db.query("select sales_open_at,starts_at,ends_at,is_published from public.events where slug='diwo-x-2-2026'")).rows[0];
    const opening = new Date(r.sales_open_at).getTime();
    assert.equal(opening >= before - 1000 && opening <= Date.now() + 1000, true);
    assert.equal(new Date(r.starts_at).toISOString(), "2026-10-31T22:00:00.000Z");
    assert.equal(new Date(r.ends_at).toISOString(), "2026-11-01T06:00:00.000Z");
    assert.equal(r.is_published, false);
  });
  await scenario("bootstrap placeholder cannot create an administrator", async () => {
    const template = await readFile(new URL("../drafts/bootstrap-admin.sql.example", import.meta.url), "utf8");
    // Outer transaction is rolled back by scenario even though template has BEGIN.
    await expectCode("P0001", () => db.exec(template));
  });
});
