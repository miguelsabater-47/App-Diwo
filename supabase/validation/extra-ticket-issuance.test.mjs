import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("real extra SQL: independent unlimited admin issuance, identity-preserving retries, private QR and atomic terminal states", { timeout: 90000 }, async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    grant usage on schema auth to anon,authenticated,service_role;`);
  for (const path of ["../migrations/20261011225839_diwo_foundation.sql", "../drafts/order-payment-rpcs.sql",
    "../drafts/short-order-references.sql", "../drafts/ticket-annulment-rpc.sql", "../drafts/owned-ticket-detail.sql",
    "../drafts/door-scan-rpcs.sql"]) {
    await db.exec(await readFile(new URL(path, import.meta.url), "utf8"));
  }
  await db.exec("insert into public.user_roles(clerk_user_id,role) values('user_fixture_admin','admin'),('user_fixture_staff','door_staff')");
  const event = (await db.query(`insert into public.events(slug,title,public_location,sales_open_at,starts_at,ends_at,arrival_from,arrival_until,is_published)
    values('diwo-x-2-2026','Synthetic','Casa de campo en Ceutí','2020-01-01','2099-01-02 23:00UTC','2099-01-03 07:00UTC','2099-01-02 23:30UTC','2099-01-03 01:30UTC',true) returning id`)).rows[0].id;
  const actor = async (sub, role = "authenticated") => {
    await db.exec("reset role"); await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub })]); await db.exec(`set role ${role}`);
  };
  const names = n => Array.from({ length: n }, (_, i) => `Synthetic Guest ${i}`);
  const request = async n => (await db.query("select * from public.create_order_request($1,$2,'Synthetic',$3::text[])", [randomUUID(), event, names(n)])).rows[0];
  const issue = async (id, attendees) => (await db.query("select * from public.issue_extra_tickets($1,$2::text[])", [id, attendees])).rows;
  const approve = async id => db.query("select * from public.approve_order_payment($1)", [id]);
  await actor("user_fixture_buyer"); const base = await request(132), last = await request(1), overflow = await request(1);
  await actor("user_fixture_admin"); await approve(base.order_id);
  await db.exec("reset role");
  const snapshot = async () => (await db.query(`select
    (select md5(string_agg(to_jsonb(o)::text,',' order by o.id)) from public.orders o) orders_hash,
    (select md5(string_agg((to_jsonb(t)-'extra_batch_id')::text,',' order by t.id)) from public.tickets t) tickets_hash,
    (select md5(string_agg(to_jsonb(e)::text,',' order by e.id)) from public.events e) events_hash,
    (select md5(string_agg(to_jsonb(r)::text,',' order by r.clerk_user_id)) from public.user_roles r) roles_hash`)).rows[0];
  const before = await snapshot();
  for (const path of ["../drafts/event-ticket-capacity.sql", "../drafts/close-sales-capacity-133.sql", "../migrations/20261023173307_admin_extra_ticket_issuance.sql"]) await db.exec(await readFile(new URL(path, import.meta.url), "utf8"));
  assert.deepEqual(await snapshot(), before, "Applying extras preserves every pre-existing order, ticket, event and role");
  for (const sub of [null, "user_fixture_buyer", "user_fixture_staff"]) {
    await actor(sub);
    for (const call of [() => issue(randomUUID(), ["Unauthorized"]), () => db.query("select * from public.list_extra_tickets()"), () => db.query("select * from public.read_extra_ticket($1)", [randomUUID()])]) {
      await assert.rejects(call, error => error.code === "42501");
    }
  }
  await actor("user_fixture_admin");
  for (const attendees of [[], [" "], ["x".repeat(121)]]) await assert.rejects(() => issue(randomUUID(), attendees), error => error.message === "invalid_extra_request");
  const batch = randomUUID(), attendees = names(200), issued = await issue(batch, attendees);
  assert.equal(issued.length, 200, "No extra quota or general-capacity restriction");
  assert.deepEqual(await issue(batch, attendees), issued);
  await assert.rejects(() => issue(batch, ["Changed payload"]), error => error.message === "request_id_conflict");
  await approve(last.order_id);
  await assert.rejects(() => approve(overflow.order_id), error => error.message === "event_capacity_exceeded");
  await actor("user_fixture_buyer"); await assert.rejects(() => request(1), error => error.message === "sales_closed");
  await actor("user_fixture_admin");
  assert.equal((await db.query("select * from public.list_extra_tickets()")).rows.length, 200);
  const read = (await db.query("select * from public.read_extra_ticket($1)", [issued[0].ticket_id])).rows[0];
  assert.match(read.qr_token, /^[0-9a-f]{64}$/); assert.equal(read.unit_price_cents, 0);
  assert.equal((await db.query("select * from public.read_owned_ticket($1)", [issued[0].ticket_id])).rows.length, 0);
  await db.exec("reset role");
  const tokens = (await db.query("select id,qr_token from public.tickets where extra_batch_id=$1 order by ticket_position", [batch])).rows;
  assert.equal(new Set(tokens.map(row => row.qr_token)).size, 200);
  assert.equal((await db.query("select count(*)::int as n from public.orders")).rows[0].n, 3, "No payment/order for extras");
  await actor("user_fixture_staff");
  const scan = async token => (await db.query("select * from public.check_in_ticket($1,$2)", [event, token])).rows[0];
  const admitted = await scan(tokens[0].qr_token); assert.equal(admitted.outcome, "admitted");
  const replay = await scan(tokens[0].qr_token); assert.equal(replay.outcome, "already_used"); assert.equal(replay.used_at.getTime(), admitted.used_at.getTime());
  const general = (await db.query("select * from public.read_door_event()")).rows[0];
  assert.equal(general.issued_non_revoked, 133); assert.equal(general.used_admissions, 0);
  let counters = (await db.query("select * from public.get_extra_event_counters($1)", [event])).rows[0];
  assert.equal(counters.issued_non_revoked, 200); assert.equal(counters.used_admissions, 1); assert.equal(counters.pending_admissions, 199);
  await actor("user_fixture_admin");
  await assert.rejects(() => db.query("select * from public.revoke_issued_ticket($1)", [tokens[0].id]), error => error.message === "ticket_already_used");
  const revoke = await db.query("select * from public.revoke_issued_ticket($1)", [tokens[1].id]);
  assert.deepEqual((await db.query("select * from public.revoke_issued_ticket($1)", [tokens[1].id])).rows, revoke.rows);
  assert.equal((await scan(tokens[1].qr_token)).outcome, "revoked");
  assert.equal((await db.query("select * from public.read_extra_ticket($1)", [tokens[0].id])).rows[0].qr_token, null);
  assert.equal((await db.query("select * from public.read_extra_ticket($1)", [tokens[1].id])).rows[0].qr_token, null);
  assert.deepEqual((await issue(batch, attendees)).map(row => row.ticket_id), issued.map(row => row.ticket_id));
  counters = (await db.query("select * from public.get_extra_event_counters($1)", [event])).rows[0];
  assert.equal(counters.issued_non_revoked, 199); assert.equal(counters.pending_admissions, 198);
  for (const sub of ["user_fixture_admin", "user_fixture_staff", "user_fixture_buyer"]) {
    await actor(sub);
    await assert.rejects(() => db.query("select qr_token from public.tickets"), error => error.code === "42501");
    await assert.rejects(() => db.query("select * from diwo_private.extra_ticket_batches"), error => error.code === "42501");
    await assert.rejects(() => db.query("insert into public.tickets(extra_batch_id,event_id,ticket_position,attendee_name) values($1,$2,201,'Injected')", [batch, event]), error => error.code === "42501");
  }
  for (const role of ["anon", "service_role"]) {
    await actor("user_fixture_admin", role);
    await assert.rejects(() => issue(randomUUID(), ["Unauthorized"]), error => error.code === "42501");
  }
  await db.exec("reset role");
  assert.equal((await db.query("select count(*)::int as n from public.tickets where extra_batch_id=$1", [batch])).rows[0].n, 200);
  await assert.rejects(() => db.query("update public.tickets set extra_batch_id=null where id=$1", [tokens[1].id]), error => error.message === "ticket_identity_is_immutable");
  await assert.rejects(() => db.query("delete from diwo_private.extra_ticket_batches where id=$1", [batch]), error => error.message === "extra_history_must_be_retained");
});
