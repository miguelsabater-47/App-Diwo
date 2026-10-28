import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("manual admission delegates to scanner with atomic private audit, terminal states and current admin/staff privileges", { timeout: 90000 }, async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    grant usage on schema auth to anon,authenticated,service_role;`);
  for (const path of ["../migrations/20261011225839_diwo_foundation.sql", "../drafts/order-payment-rpcs.sql", "../drafts/short-order-references.sql", "../drafts/door-scan-rpcs.sql", "../drafts/ticket-annulment-rpc.sql"])
    await db.exec(await readFile(new URL(path, import.meta.url), "utf8"));
  await db.exec("insert into public.user_roles(clerk_user_id,role) values('user_fixture_admin','admin'),('user_fixture_staff','door_staff')");
  const event = (await db.query(`insert into public.events(slug,title,public_location,sales_open_at,starts_at,ends_at,arrival_from,arrival_until,is_published)
    values('diwo-x-2-2026','Synthetic','Casa de campo en Ceutí','2020-01-01','2099-01-02 23:00UTC','2099-01-03 07:00UTC','2099-01-02 23:30UTC','2099-01-03 01:30UTC',true) returning id`)).rows[0].id;
  const actor = async (sub, role = "authenticated") => { await db.exec("reset role"); await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub })]); await db.exec(`set role ${role}`); };
  await actor("user_fixture_buyer");
  const order = (await db.query("select * from public.create_order_request($1,$2,'Synthetic',array['First','Second'])", [randomUUID(), event])).rows[0];
  await actor("user_fixture_admin"); await db.query("select * from public.approve_order_payment($1)", [order.order_id]);
  await db.exec("reset role");
  await db.exec(await readFile(new URL("../migrations/20261023173307_admin_extra_ticket_issuance.sql", import.meta.url), "utf8"));
  const fingerprint = async () => (await db.query("select md5(string_agg(to_jsonb(t)::text,',' order by id)) hash from public.tickets t")).rows[0].hash;
  const before = await fingerprint();
  await db.exec(await readFile(new URL("../drafts/admin-manual-access.sql", import.meta.url), "utf8"));
  assert.equal(await fingerprint(), before, "schema draft does not alter issued tickets");
  // Local transactional stand-in for Supabase's Realtime storage, not a hosted
  // transport test. Include broad legacy policies to test restrictive boundaries.
  await db.exec(`create schema realtime; create table realtime.messages(topic text,extension text,payload jsonb,event text,private boolean);
    alter table realtime.messages enable row level security;
    grant usage on schema realtime to anon,authenticated;
    grant select,insert on realtime.messages to anon,authenticated;
    create policy fixture_broad_receive on realtime.messages for select to anon,authenticated using(true);
    create policy fixture_broad_send on realtime.messages for insert to anon,authenticated with check(true);
    create function realtime.topic() returns text language sql stable as $$ select current_setting('realtime.topic',true) $$;
    create function realtime.send(payload jsonb,event text,topic text,private boolean) returns void language sql security definer set search_path='' as $$
      insert into realtime.messages values(topic,'broadcast',payload,event,private) $$;
    revoke all on function realtime.send(jsonb,text,text,boolean) from public,anon,authenticated;`);
  await db.exec(await readFile(new URL("../drafts/event-control-realtime.sql", import.meta.url), "utf8"));
  const tickets = (await db.query("select id,qr_token from public.tickets where order_id=$1 order by ticket_position", [order.order_id])).rows;
  const manual = async id => (await db.query("select * from public.manual_check_in_ticket($1,$2)", [event, id])).rows[0];
  for (const sub of [null, "user_fixture_buyer"]) {
    await actor(sub); await assert.rejects(() => manual(tickets[0].id), e => e.code === "42501");
  }
  await actor("user_fixture_admin");
  const first = await manual(tickets[0].id); assert.equal(first.outcome, "admitted");
  const second = await manual(tickets[0].id); assert.equal(second.outcome, "already_used"); assert.deepEqual(first.used_at, second.used_at);
  assert.equal((await db.query("select * from public.check_in_ticket($1,$2)", [event, tickets[0].qr_token])).rows[0].outcome, "already_used");
  await db.query("select * from public.revoke_issued_ticket($1)", [tickets[1].id]);
  assert.equal((await manual(tickets[1].id)).outcome, "revoked");
  const extras = (await db.query("select * from public.issue_extra_tickets($1,array['Extra'])", [randomUUID()])).rows;
  assert.equal((await manual(extras[0].ticket_id)).outcome, "admitted");
  assert.equal((await manual(randomUUID())).outcome, "unknown");
  await assert.rejects(() => db.query("select * from diwo_private.manual_admissions"), e => e.code === "42501");
  await db.exec("reset role");
  const audits = (await db.query("select * from diwo_private.manual_admissions")).rows;
  assert.equal(audits.length, 2); assert.ok(audits.every(r => r.method === "manual" && r.admitted_by === "user_fixture_admin" && r.event_id === event));
  assert.deepEqual(audits.find(r => r.ticket_id === tickets[0].id).admitted_at, first.used_at);
  const signals = (await db.query("select * from realtime.messages")).rows;
  assert.ok(signals.length >= 2);
  assert.ok(signals.every(r => r.topic === `diwo:event:${event}` && r.event === "changed" && r.private === true && Object.keys(r.payload).length === 0), "signals contain no names, ticket IDs, QR, counts, payments or actors");
  await actor("user_fixture_admin");
  const staffTicket = (await db.query("select * from public.issue_extra_tickets($1,array['Álex García'])", [randomUUID()])).rows[0];
  await actor("user_fixture_staff");
  const snapshot = (await db.query("select public.read_event_control('First',0) as dto")).rows[0].dto;
  assert.equal(snapshot.used + snapshot.pending, snapshot.total);
  assert.ok(snapshot.results.length > 0); assert.ok(snapshot.latest.length <= 5);
  assert.equal((await db.query("select public.read_event_control('alex garcia',0) as dto")).rows[0].dto.results.length,1,"SQL search folds accents without SQL wildcard interpolation");
  assert.doesNotMatch(JSON.stringify(snapshot), /qr_token|used_by|buyer_clerk_id|admitted_by/);
  assert.equal((await db.query("select count(*) from public.tickets")).rows[0].count, 0, "staff has no raw attendee stream");
  await assert.rejects(() => db.query("select qr_token from public.tickets"), e => e.code === "42501");
  assert.equal((await manual(staffTicket.ticket_id)).outcome, "admitted");
  await assert.rejects(() => db.query("select * from public.revoke_issued_ticket($1)",[staffTicket.ticket_id]), e=>e.code === "42501");
  assert.equal((await db.query("select diwo_private.can_receive_event_signal($1) as allowed",[`diwo:event:${event}`])).rows[0].allowed,true);
  assert.equal((await db.query("select diwo_private.can_receive_event_signal($1) as allowed",[`diwo:event:${randomUUID()}`])).rows[0].allowed,false);
  await assert.rejects(() => db.query("insert into realtime.messages values($1,'broadcast','{}','changed',true)",[`diwo:event:${event}`]), e=>e.code === "42501");
  await db.exec("reset role");
  assert.equal((await db.query("select admitted_by from diwo_private.manual_admissions where ticket_id=$1",[staffTicket.ticket_id])).rows[0].admitted_by,"user_fixture_staff");
  await db.exec("update public.user_roles set role='user' where clerk_user_id='user_fixture_staff'");
  await actor("user_fixture_staff");
  await assert.rejects(() => db.query("select public.read_event_control('',0)"),e=>e.code === "42501");
  await assert.rejects(() => manual(staffTicket.ticket_id),e=>e.code === "42501");
  assert.equal((await db.query("select count(*) from realtime.messages")).rows[0].count,0,"revoked role cannot read signals even with preexisting permissive policy");
  await db.exec("reset role");
  await db.exec(`create function diwo_private.fixture_fail_audit() returns trigger language plpgsql as $$ begin raise exception 'fixture_audit_failure'; end $$;
    create trigger fixture_fail_audit before insert on diwo_private.manual_admissions for each row execute function diwo_private.fixture_fail_audit();`);
  await actor("user_fixture_admin");
  const rollbackExtra = (await db.query("select * from public.issue_extra_tickets($1,array['Rollback'])", [randomUUID()])).rows[0];
  const beforeRollbackSignals=(await db.query("select count(*) from realtime.messages")).rows[0].count;
  await assert.rejects(() => manual(rollbackExtra.ticket_id), /fixture_audit_failure/);
  assert.equal((await db.query("select status from public.tickets where id=$1", [rollbackExtra.ticket_id])).rows[0].status, "valid", "audit failure rolls back check-in too");
  assert.equal((await db.query("select count(*) from realtime.messages")).rows[0].count,beforeRollbackSignals,"rolled-back admission cannot publish a committed change signal");
  await db.exec("reset role");
  await db.exec(`drop trigger fixture_fail_audit on diwo_private.manual_admissions;
    create or replace function realtime.send(payload jsonb,event text,topic text,private boolean) returns void language plpgsql security definer set search_path='' as $$ begin raise exception 'fixture_transport_down'; end $$;`);
  await actor("user_fixture_admin");
  assert.equal((await manual(rollbackExtra.ticket_id)).outcome,"admitted","Realtime failure does not reject a valid atomic admission; polling can recover it");
  for (const role of ["anon", "service_role"]) { await actor("user_fixture_admin", role); await assert.rejects(() => manual(tickets[0].id), e => e.code === "42501"); if(role==="anon")assert.equal((await db.query("select count(*) from realtime.messages")).rows[0].count,0); }
});
