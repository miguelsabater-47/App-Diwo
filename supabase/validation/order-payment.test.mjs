import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

// Synthetic JWT settings exercise DB policy only, never real token signatures.
const ADMIN = "user_fixture_admin";
const BUYER = "user_fixture_buyer";
const STAFF = "user_fixture_staff";
const OTHER = "user_fixture_other";
const foundation = await readFile(new URL("../migrations/20261011225839_diwo_foundation.sql", import.meta.url), "utf8");
const writers = await readFile(new URL("../drafts/order-payment-rpcs.sql", import.meta.url), "utf8");

test("order/payment draft on disposable PostgreSQL, no hosted changes", { timeout: 90000 }, async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role anon nologin; create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb
    $$;
    grant usage on schema auth to anon,authenticated,service_role;`);
  await db.exec(foundation);
  await db.exec(writers);
  await db.query("insert into public.user_roles(clerk_user_id,role) values($1,'admin'),($2,'door_staff')", [ADMIN, STAFF]);
  const events = (await db.query(`insert into public.events(slug,title,public_location,
    sales_open_at,starts_at,ends_at,arrival_from,arrival_until,is_published)
    select 'fixture-'||n,'Synthetic Event','Generic location',
      case when n=3 then '2099-01-01'::timestamptz else '2020-01-01'::timestamptz end,
      '2099-01-02 23:00 UTC','2099-01-03 07:00 UTC',
      '2099-01-02 23:30 UTC','2099-01-03 01:30 UTC',n<>2
    from generate_series(1,3) n returning id`)).rows.map((r) => r.id);
  const owner = async () => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claims','{}',false)");
  };
  const client = async (subject, role = "authenticated", extra = {}) => {
    await owner();
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: subject, role: "authenticated", ...extra })]);
    await db.exec(`set role ${role}`);
  };
  const create = async (id = randomUUID(), event = events[0], names = ["Guest One", "Guest Two"], buyer = "Buyer") =>
    (await db.query("select * from public.create_order_request($1,$2,$3,$4::text[])", [id, event, buyer, names])).rows[0];
  const report = async (id) => (await db.query("select * from public.report_order_payment($1)", [id])).rows[0];
  const approve = async (id) => (await db.query("select * from public.approve_order_payment($1)", [id])).rows[0];
  const reject = async (code, run) => {
    await db.exec("savepoint denied");
    let actual = "NO_ERROR";
    try { await run(); } catch (error) { actual = error.code ?? "UNEXPECTED_ERROR"; }
    await db.exec("rollback to savepoint denied; release savepoint denied");
    assert.equal(actual, code);
  };
  const scenario = async (name, run) => t.test(name, async () => {
    await owner();
    await db.exec("begin");
    try { await run(); await db.exec("set constraints all immediate"); }
    finally { await db.exec("rollback"); await owner(); }
  });

  await scenario("exactly four tables; direct writes stay denied and wrappers remain invokers", async () => {
    assert.equal((await db.query("select count(*)::int as n from pg_tables where schemaname='public'")).rows[0].n, 4);
    const policies = (await db.query(`select p.proname,p.prosecdef,p.proconfig from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
      and p.proname in ('create_order_request','report_order_payment','approve_order_payment')`)).rows;
    assert.equal(policies.length, 3);
    assert.equal(policies.every((p) => !p.prosecdef && p.proconfig.includes('search_path=""')), true);
    for (const table of ["orders", "tickets", "user_roles"]) {
      const result = (await db.query("select has_table_privilege('authenticated',$1,'INSERT,UPDATE,DELETE') as allowed", [`public.${table}`])).rows[0];
      assert.equal(result.allowed, false);
    }
  });
  await scenario("anon/service role cannot call writers, and owner has no anonymous fallback", async () => {
    for (const role of ["anon", "service_role"]) {
      await client(BUYER, role);
      await reject("42501", () => create());
      await reject("42501", () => report(randomUUID()));
      await reject("42501", () => approve(randomUUID()));
    }
    await owner();
    await reject("42501", () => create());
  });
  await scenario("caller cannot invoke the role-lock helper or forge admin metadata", async () => {
    await client(BUYER, "authenticated", { appRole: "admin", public_metadata: { role: "admin" } });
    await reject("42501", () => db.query("select diwo_private.lock_order_actor(array['admin'])"));
    await reject("42501", () => approve(randomUUID()));
  });
  await scenario("malformed subjects cannot use definer owner privileges", async () => {
    for (const subject of [undefined, "invalid_subject", "00000000-0000-0000-0000-000000000001"]) {
      await client(subject);
      await reject("42501", () => create());
    }
  });
  await scenario("all roles keep buyer features; price/quantity derive from names", async () => {
    for (const subject of [BUYER, STAFF, ADMIN]) {
      await client(subject);
      const result = await create(undefined, undefined, [" Guest ", "Guest"], " Buyer ");
      assert.equal(result.ticket_quantity, 2);
      assert.equal(result.total_cents, 1000);
      assert.equal(result.order_status, "pending");
      await owner();
      const stored = (await db.query("select buyer_clerk_id,buyer_name,attendee_names from public.orders where id=$1", [result.order_id])).rows[0];
      assert.equal(stored.buyer_clerk_id, subject);
      assert.equal(stored.buyer_name, "Buyer");
      assert.deepEqual(stored.attendee_names, ["Guest", "Guest"]);
    }
  });
  await scenario("same submission UUID retries preserve one order and its reference", async () => {
    await client(BUYER);
    const id = randomUUID();
    assert.deepEqual(await create(id), await create(id));
    await owner();
    assert.equal((await db.query("select count(*)::int as n from public.orders")).rows[0].n, 1);
  });
  await scenario("reusing submission UUID with changed payload or different buyer is denied", async () => {
    await client(BUYER);
    const result = await create();
    await reject("22023", () => create(result.order_id, undefined, ["Changed"]));
    await reject("22023", () => create(result.order_id, undefined, undefined, "Different buyer name"));
    await client(OTHER);
    await reject("22023", () => create(result.order_id));
  });
  await scenario("unpublished/future/missing events and empty names cannot create orders", async () => {
    await client(BUYER);
    for (const event of [events[1], events[2], randomUUID(), null]) await reject("22023", () => create(undefined, event));
    for (const names of [[], [null], [" "], null]) await reject("22023", () => create(undefined, undefined, names));
    await reject("22023", () => create(null));
    await reject("22023", () => create(undefined, undefined, undefined, " "));
  });
  await scenario("payment notice is own-order only, repeatable, and never issues tickets", async () => {
    await client(BUYER);
    const result = await create();
    const first = await report(result.order_id);
    assert.equal(first.order_status, "pending");
    assert.ok(first.payment_reported_at);
    assert.deepEqual(await report(result.order_id), first);
    await client(OTHER);
    await reject("22023", () => report(result.order_id));
    await client(ADMIN);
    await reject("22023", () => report(result.order_id));
    await owner();
    assert.equal((await db.query("select count(*)::int as n from public.tickets")).rows[0].n, 0);
  });
  await scenario("buyer and door staff cannot approve; admin needs no buyer notice", async () => {
    await client(BUYER);
    const result = await create();
    await reject("42501", () => approve(result.order_id));
    await client(STAFF);
    await reject("42501", () => approve(result.order_id));
    await client(ADMIN);
    assert.equal((await approve(result.order_id)).issued_ticket_count, 2);
    await owner();
    const stored = (await db.query("select confirmed_by,payment_reported_at from public.orders where id=$1", [result.order_id])).rows[0];
    assert.equal(stored.confirmed_by, ADMIN);
    assert.equal(stored.payment_reported_at, null);
  });
  await scenario("approval emits exactly N private unique tokens and immutable ticket names", async () => {
    await client(BUYER);
    const result = await create(undefined, undefined, ["First", "Second", "Second"]);
    await client(ADMIN);
    const response = await approve(result.order_id);
    assert.deepEqual(Object.keys(response).sort(), ["confirmed_at", "issued_ticket_count", "order_id", "order_status"]);
    await owner();
    const tickets = (await db.query("select ticket_position,attendee_name,qr_token from public.tickets order by ticket_position")).rows;
    assert.deepEqual(tickets.map((r) => r.attendee_name), ["First", "Second", "Second"]);
    assert.equal(new Set(tickets.map((r) => r.qr_token)).size, 3);
    assert.equal(tickets.every((r) => /^[0-9a-f]{64}$/.test(r.qr_token)), true);
    await client(ADMIN);
    await reject("42501", () => db.query("select qr_token from public.tickets"));
  });
  await scenario("repeated approval preserves timestamps, ticket identities and used/annulled states", async () => {
    await client(BUYER);
    const result = await create();
    await client(ADMIN);
    const first = await approve(result.order_id);
    await owner();
    const before = (await db.query("select id,qr_token from public.tickets order by ticket_position")).rows;
    await db.query("update public.tickets set status='used',used_by=$2 where id=$1", [before[0].id, ADMIN]);
    await db.query("update public.tickets set status='revoked',revoked_by=$2 where id=$1", [before[1].id, ADMIN]);
    await client(ADMIN);
    assert.deepEqual(await approve(result.order_id), first);
    await owner();
    const after = (await db.query("select id,qr_token,status from public.tickets order by ticket_position")).rows;
    assert.deepEqual(after.map(({ id, qr_token }) => ({ id, qr_token })), before);
    assert.deepEqual(after.map((r) => r.status), ["used", "revoked"]);
  });
  await scenario("notice after approval is a no-op and request retries survive sales closing", async () => {
    await client(BUYER);
    const request = await create();
    await client(ADMIN);
    await approve(request.order_id);
    await owner();
    await db.query("update public.events set is_published=false where id=$1", [events[0]]);
    await client(BUYER);
    const notice = await report(request.order_id);
    assert.equal(notice.order_status, "confirmed");
    assert.equal(notice.payment_reported_at, null);
    assert.equal((await create(request.order_id)).order_status, "confirmed");
  });
  await scenario("closed requests never reopen via notice or approval", async () => {
    for (const status of ["cancelled", "rejected"]) {
      await client(BUYER);
      const result = await create();
      await owner();
      await db.query("update public.orders set status=$2,closed_by=$3 where id=$1", [result.order_id, status, ADMIN]);
      await client(BUYER);
      await reject("22023", () => report(result.order_id));
      await client(ADMIN);
      await reject("22023", () => approve(result.order_id));
    }
  });
  await scenario("failure on the second ticket rolls back payment confirmation and all tickets", async () => {
    await client(BUYER);
    const result = await create();
    await owner();
    await db.exec(`create function public.fixture_fail_second() returns trigger language plpgsql as $$
      begin if new.ticket_position=2 then raise exception 'Synthetic ticket failure'; end if; return new; end $$;
      create trigger fixture_fail_second before insert on public.tickets
        for each row execute function public.fixture_fail_second();`);
    await client(ADMIN);
    await reject("P0001", () => approve(result.order_id));
    await owner();
    assert.equal((await db.query("select status from public.orders where id=$1", [result.order_id])).rows[0].status, "pending");
    assert.equal((await db.query("select count(*)::int as n from public.tickets")).rows[0].n, 0);
  });
});
