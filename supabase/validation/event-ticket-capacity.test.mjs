import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("131-place capacity on disposable PostgreSQL: pending excluded, exact replays and safe aggregate", { timeout: 90000 }, async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    grant usage on schema auth to anon,authenticated,service_role;`);
  for (const file of ["../migrations/20261011225839_diwo_foundation.sql", "../drafts/order-payment-rpcs.sql",
    "../drafts/short-order-references.sql", "../drafts/ticket-annulment-rpc.sql", "../drafts/event-ticket-capacity.sql"]) {
    await db.exec(await readFile(new URL(file, import.meta.url), "utf8"));
  }
  await db.exec(`insert into public.user_roles(clerk_user_id,role) values('user_fixture_admin','admin');`);
  const event = (await db.query(`insert into public.events(slug,title,public_location,sales_open_at,starts_at,ends_at,arrival_from,arrival_until,is_published)
    values('diwo-x-2-2026','Synthetic','Generic','2020-01-01','2099-01-02 23:00UTC','2099-01-03 07:00UTC','2099-01-02 23:30UTC','2099-01-03 01:30UTC',true) returning id`)).rows[0].id;
  const actor = async (subject, role = "authenticated") => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: subject })]);
    await db.exec(`set role ${role}`);
  };
  const names = n => Array.from({ length: n }, (_, i) => `Synthetic ${i}`);
  const create = async (n, id = randomUUID()) => (await db.query("select * from public.create_order_request($1,$2,'Synthetic',$3::text[])", [id, event, names(n)])).rows[0];
  const approve = async id => (await db.query("select * from public.approve_order_payment($1)", [id])).rows[0];
  const available = async () => (await db.query("select * from public.get_event_ticket_availability($1)", [event])).rows[0];
  const denied = async fn => assert.rejects(fn, error => error.code === "22023" && error.message === "event_capacity_exceeded");
  await actor("user_fixture_buyer");
  const baseline = await create(114);
  const oldPending = await create(18);
  await actor("user_fixture_admin"); await approve(baseline.order_id);
  await actor("user_fixture_buyer");
  assert.deepEqual(await available(), { capacity: 131, remaining_tickets: 17 });
  await denied(() => create(18));
  assert.deepEqual(await create(18, oldPending.order_id), oldPending, "Existing pending requests still replay even when oversized");
  const last = await create(17);
  assert.deepEqual(await available(), { capacity: 131, remaining_tickets: 17 }, "Pending orders do not reserve");
  await actor("user_fixture_admin");
  await denied(() => approve(oldPending.order_id));
  const receipt = await approve(last.order_id);
  assert.deepEqual(await approve(last.order_id), receipt, "Approval replay at full capacity does not emit more tickets");
  await actor("user_fixture_buyer");
  assert.deepEqual(await available(), { capacity: 131, remaining_tickets: 0 });
  await denied(() => create(1));
  assert.equal((await create(17, last.order_id)).order_status, "confirmed");
  await db.exec("reset role");
  const tickets = (await db.query("select id from public.tickets where order_id=$1 order by ticket_position", [last.order_id])).rows;
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: "user_fixture_admin" })]);
  await db.query("update public.tickets set status='used',used_by='user_fixture_admin' where id=$1", [tickets[0].id]);
  await actor("user_fixture_admin");
  assert.equal((await available()).remaining_tickets, 0, "Used tickets still count");
  await db.query("select * from public.revoke_issued_ticket($1)", [tickets[1].id]);
  assert.equal((await available()).remaining_tickets, 1, "Annulled tickets free a place");
  const replacement = await create(1); await approve(replacement.order_id);
  assert.equal((await available()).remaining_tickets, 0);
  await db.exec("reset role");
  assert.equal((await db.query("select status from public.orders where id=$1", [oldPending.order_id])).rows[0].status, "pending");
  for (const role of ["anon", "service_role"]) {
    assert.equal((await db.query("select has_function_privilege($1,'public.get_event_ticket_availability(uuid)','EXECUTE') as allowed", [role])).rows[0].allowed, false);
  }
  assert.equal((await db.query("select has_function_privilege('authenticated','diwo_private.guard_event_ticket_capacity()','EXECUTE') as allowed")).rows[0].allowed, false);
  await actor(null);
  await assert.rejects(available, error => error.code === "42501");
});
