import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const ADMIN = "user_fixture_admin", BUYER = "user_fixture_buyer", STAFF = "user_fixture_staff";
const source = async path => readFile(new URL(path, import.meta.url), "utf8");
test("order closure draft on disposable PostgreSQL, never hosted", { timeout: 90000 }, async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role anon nologin; create role authenticated nologin;
    create role service_role nologin bypassrls; create schema auth;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb
    $$; grant usage on schema auth to anon,authenticated,service_role;`);
  await db.exec(await source("../migrations/20261011225839_diwo_foundation.sql"));
  await db.exec(await source("../drafts/order-payment-rpcs.sql"));
  const closure = await source("../drafts/order-closure-rpcs.sql");
  await db.exec(closure);
  await db.query("insert into public.user_roles(clerk_user_id,role) values($1,'admin'),($2,'door_staff')", [ADMIN, STAFF]);
  const event = (await db.query(`insert into public.events(slug,title,public_location,sales_open_at,
    starts_at,ends_at,arrival_from,arrival_until,is_published) values('closure-fixture','Synthetic',
    'Generic location','2020-01-01','2099-01-02 23:00 UTC','2099-01-03 07:00 UTC',
    '2099-01-02 23:30 UTC','2099-01-03 01:30 UTC',true) returning id`)).rows[0].id;
  const owner = async () => { await db.exec("reset role"); await db.query("select set_config('request.jwt.claims','{}',false)"); };
  const client = async (subject, role = "authenticated", extra = {}) => {
    await owner(); await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: subject, role: "authenticated", ...extra })]);
    await db.exec(`set role ${role}`);
  };
  const create = async () => {
    await client(BUYER);
    return (await db.query("select * from public.create_order_request($1,$2,'Synthetic Buyer',array['First','Second'])", [randomUUID(), event])).rows[0].order_id;
  };
  const close = async (id, decision) => (await db.query(`select * from public.${decision}_order_request($1)`, [id])).rows[0];
  const denied = async (code, run) => {
    await db.exec("savepoint denied");
    let actual = "NO_ERROR";
    try { await run(); } catch (error) { actual = error.code; }
    await db.exec("rollback to savepoint denied; release savepoint denied");
    assert.equal(actual, code);
  };
  const snapshot = async () => {
    await owner();
    const result = {};
    for (const table of ["events", "user_roles", "orders", "tickets"]) {
      result[table] = (await db.query(`select to_jsonb(t) as row from public.${table} t order by to_jsonb(t)::text`)).rows;
    }
    return result;
  };
  const scenario = async (name, run) => t.test(name, async () => {
    await owner(); await db.exec("begin");
    try { await run(); await db.exec("set constraints all immediate"); }
    finally { await db.exec("rollback"); await owner(); }
  });
  await scenario("public invokers, fixed search_path, no direct writes or owner/anon/service fallback", async () => {
    const functions = (await db.query(`select p.proname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in ('cancel_order_request','reject_order_request')`)).rows;
    assert.equal(functions.length, 2);
    assert.ok(functions.every(p => !p.prosecdef && p.proconfig.includes('search_path=""')));
    assert.equal((await db.query("select has_table_privilege('authenticated','public.orders','UPDATE') as allowed")).rows[0].allowed, false);
    for (const role of ["anon", "service_role"]) {
      await client(ADMIN, role);
      for (const decision of ["cancel", "reject"]) await denied("42501", () => close(randomUUID(), decision));
    }
    await owner();
    for (const decision of ["cancel", "reject"]) await denied("42501", () => close(randomUUID(), decision));
  });
  await scenario("buyer/staff/forged metadata/malformed subject cannot close", async () => {
    const id = await create();
    for (const subject of [BUYER, STAFF, "invalid", undefined]) {
      await client(subject, "authenticated", { appRole: "admin", public_metadata: { role: "admin" } });
      for (const decision of ["cancel", "reject"]) await denied("42501", () => close(id, decision));
    }
  });
  for (const [decision, status] of [["cancel", "cancelled"], ["reject", "rejected"]]) {
    await scenario(`${decision} preserves snapshot/notice, records server actor/time, emits no tickets and retries do not update`, async () => {
      const id = await create();
      await db.query("select * from public.report_order_payment($1)", [id]);
      const before = await snapshot();
      await client(ADMIN);
      const first = await close(id, decision);
      assert.equal(first.order_id, id); assert.equal(first.order_status, status); assert.ok(first.closed_at);
      assert.deepEqual(Object.keys(first).sort(), ["closed_at", "order_id", "order_status"]);
      assert.deepEqual(await close(id, decision), first);
      await denied("22023", () => close(id, decision === "cancel" ? "reject" : "cancel"));
      await denied("22023", () => db.query("select * from public.approve_order_payment($1)", [id]));
      await client(BUYER);
      await denied("22023", () => db.query("select * from public.report_order_payment($1)", [id]));
      const after = await snapshot();
      const stored = after.orders[0].row, original = before.orders[0].row;
      assert.equal(stored.closed_by, ADMIN); assert.equal(stored.status, status);
      for (const key of Object.keys(original).filter(k => !["status", "closed_at", "closed_by", "updated_at"].includes(k))) assert.deepEqual(stored[key], original[key], key);
      assert.deepEqual(after.events, before.events); assert.deepEqual(after.user_roles, before.user_roles);
      assert.deepEqual(after.tickets, []);
      await client(ADMIN); await close(id, decision);
      assert.deepEqual(await snapshot(), after);
    });
  }
  await scenario("confirmed/used/revoked history cannot close; missing IDs and invalid decisions fail", async () => {
    const id = await create();
    await client(ADMIN); await db.query("select * from public.approve_order_payment($1)", [id]);
    await owner();
    const tickets = (await db.query("select id from public.tickets order by ticket_position")).rows;
    await db.query("update public.tickets set status='used',used_by=$2 where id=$1", [tickets[0].id, ADMIN]);
    await db.query("update public.tickets set status='revoked',revoked_by=$2 where id=$1", [tickets[1].id, ADMIN]);
    const before = await snapshot();
    await client(ADMIN);
    for (const decision of ["cancel", "reject"]) {
      await denied("22023", () => close(id, decision));
      await denied("22023", () => close(randomUUID(), decision));
      await denied("22023", () => close(null, decision));
    }
    for (const status of [null, "confirmed", "pending", "admin"]) await denied("22023", () => db.query("select * from diwo_private.close_order_request($1,$2)", [id, status]));
    assert.deepEqual(await snapshot(), before);
  });
  await scenario("current database role revocation defeats stale admin metadata", async () => {
    const id = await create();
    await client(STAFF, "authenticated", { appRole: "admin" });
    await denied("42501", () => close(id, "cancel"));
    await owner(); await db.query("delete from public.user_roles where clerk_user_id=$1", [STAFF]);
    await client(STAFF, "authenticated", { appRole: "admin" });
    await denied("42501", () => close(id, "reject"));
  });
  await scenario("manual readonly protocol detects missing/pending/closed fixtures and preserves retained fingerprints", async () => {
    const preflight = await source("order-closure-preflight.readonly.sql");
    const results = await source("order-closure-results.readonly.sql");
    const beforeMissing = await snapshot();
    assert.equal((await db.query(preflight)).rows.length, 0);
    assert.ok((await db.query(results)).rows.every(r => r.exists === false));
    assert.deepEqual(await snapshot(), beforeMissing);
    const technical = "9d560641-aacf-4d25-8d65-94960bba59b2";
    await db.query(`insert into public.events(id,slug,title,public_location,sales_open_at,starts_at,ends_at,arrival_from,arrival_until,is_published)
      select $1,'technical-manual-test',title,public_location,sales_open_at,starts_at,ends_at,arrival_from,arrival_until,is_published from public.events where id=$2`, [technical, event]);
    for (let n = 0; n < 2; n++) {
      await client(BUYER);
      const id = randomUUID();
      await db.query("select * from public.create_order_request($1,$2,'Retained synthetic',array['First','Second'])", [id, technical]);
      await client(ADMIN); await db.query("select * from public.approve_order_payment($1)", [id]);
    }
    await owner();
    const baseline = (await db.query(preflight)).rows[0];
    assert.equal(Number(baseline.retained_paid_order_count), 2); assert.equal(Number(baseline.retained_ticket_count), 4);
    assert.equal(baseline.not_real_event, true); assert.equal(baseline.is_published, true); assert.equal(baseline.sales_time_reached, true);
    const fixtures = [
      ["cb67be71-6b85-4c80-b234-70a920ba41e8", "PRUEBA CIERRE - CANCELAR", "Asistente ficticio cierre - Cancelar", "cancel"],
      ["5856888b-18ee-4fb6-8e4f-ba6222e993ab", "PRUEBA CIERRE - RECHAZAR", "Asistente ficticio cierre - Rechazar", "cancel"],
    ];
    for (const [id, buyer, attendee] of fixtures) {
      await client(ADMIN);
      await db.query("select * from public.create_order_request($1,$2,$3,$4::text[])", [id, technical, buyer, [attendee]]);
    }
    await owner();
    const pendingSnapshot = await snapshot();
    const pending = (await db.query(results)).rows;
    assert.ok(pending.every(r => r.exists && r.status === "pending" && r.technical_event_matches && r.exact_payload_matches && r.no_payment_notice && r.never_approved && Number(r.ticket_count) === 0 && r.closed_at === null));
    assert.deepEqual(await snapshot(), pendingSnapshot);
    for (const [id, , , decision] of fixtures) { await client(ADMIN); await close(id, decision); }
    await owner();
    const terminalSnapshot = await snapshot();
    const terminal = (await db.query(results)).rows;
    assert.ok(terminal.every(r => r.final_status_matches && r.technical_event_matches && r.exact_payload_matches && r.closed_at && r.closed_by_protected_admin && r.no_payment_notice && r.never_approved && Number(r.ticket_count) === 0));
    const after = (await db.query(preflight)).rows[0];
    assert.equal(Number(after.closure_fixture_count), 2);
    for (const key of ["retained_paid_order_count", "retained_paid_fingerprint", "retained_ticket_count", "retained_ticket_fingerprint"]) assert.equal(after[key], baseline[key], key);
    assert.deepEqual(await snapshot(), terminalSnapshot);
  });
  // Apply/reapply must not mutate existing orders, paid ticket tokens or roles.
  const id = await create(); await client(ADMIN); await db.query("select * from public.approve_order_payment($1)", [id]);
  const before = await snapshot();
  await db.exec(closure); await db.exec(closure);
  assert.deepEqual(await snapshot(), before);
});
