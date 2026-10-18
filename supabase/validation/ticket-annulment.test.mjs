import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const install = await readFile(new URL("../testing/scanner-test-install.sql", import.meta.url), "utf8");
const annulment = await readFile(new URL("../drafts/ticket-annulment-rpc.sql", import.meta.url), "utf8");
const event = "00000000-0000-4000-8000-000000000001", order = "00000000-0000-4000-8000-000000000002";
const ticket = n => `00000000-0000-4000-8000-00000000001${n}`;
const token = n => String(n).repeat(64);
const as = subject => `begin; select set_config('request.jwt.claims','{"sub":"${subject}","role":"authenticated"}',true); set local role authenticated;`;
async function denied(db, sql, code) {
  await assert.rejects(db.exec(sql), error => error.code === code); await db.exec("rollback");
}
test("annulment preserves paid order and siblings, replay audit, used protection, old QR rejection and ACLs", { timeout: 90000 }, async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    grant usage on schema auth to anon,authenticated,service_role;`);
  await db.exec(install); await db.exec(annulment);
  await db.exec(`begin;
    insert into public.user_roles(clerk_user_id,role) values('user_admin','admin'),('user_staff','door_staff');
    insert into public.events(id,slug,title,public_location,sales_open_at,starts_at,ends_at,arrival_from,arrival_until,is_published)
    values('${event}','diwo-x-2-2026','Test','Fictional','2020-01-01','2020-01-02 23:30Z','2020-01-03 07:00Z','2020-01-02 23:30Z','2020-01-03 01:30Z',true);
    insert into public.orders(id,event_id,buyer_clerk_id,buyer_name,attendee_names) values('${order}','${event}','user_buyer','Test',array['One','Two']);
    update public.orders set status='confirmed',confirmed_by='user_admin' where id='${order}';
    insert into public.tickets(id,order_id,event_id,ticket_position,attendee_name,qr_token) values
      ('${ticket(1)}','${order}','${event}',1,'One','${token(1)}'),('${ticket(2)}','${order}','${event}',2,'Two','${token(2)}'); commit;`);
  const before = (await db.query(`select to_jsonb(o) as row from public.orders o where id='${order}'`)).rows;
  const sibling = (await db.query(`select to_jsonb(t) as row from public.tickets t where id='${ticket(2)}'`)).rows;
  for (const subject of ["user_staff", "user_buyer"]) await denied(db, as(subject) + `select * from public.revoke_issued_ticket('${ticket(1)}'); commit;`, "42501");
  await db.exec(as("user_admin"));
  const first = (await db.query(`select * from public.revoke_issued_ticket('${ticket(1)}')`)).rows;
  assert.equal(first[0].ticket_status, "revoked");
  assert.deepEqual((await db.query(`select * from public.revoke_issued_ticket('${ticket(1)}')`)).rows, first);
  await db.exec("commit");
  await db.exec(annulment); // Reapplying definitions does not touch history.
  assert.deepEqual((await db.query(`select to_jsonb(o) as row from public.orders o where id='${order}'`)).rows, before);
  assert.deepEqual((await db.query(`select to_jsonb(t) as row from public.tickets t where id='${ticket(2)}'`)).rows, sibling);
  await db.exec(as("user_staff"));
  assert.equal((await db.query(`select * from public.check_in_ticket('${event}','${token(1)}')`)).rows[0].outcome, "revoked");
  assert.equal((await db.query(`select * from public.check_in_ticket('${event}','${token(2)}')`)).rows[0].outcome, "admitted");
  await db.exec("commit");
  await denied(db, as("user_admin") + `select * from public.revoke_issued_ticket('${ticket(2)}'); commit;`, "22023");
  await db.exec(as("user_staff"));
  const counters = (await db.query("select * from public.read_door_event()")).rows[0];
  assert.equal(Number(counters.used_admissions), 1); assert.equal(Number(counters.pending_admissions), 0); assert.equal(Number(counters.issued_non_revoked), 1);
  await db.exec("commit");
  const acl = (await db.query(`select
    has_function_privilege('anon','public.revoke_issued_ticket(uuid)','execute') as anon,
    has_function_privilege('service_role','public.revoke_issued_ticket(uuid)','execute') as service,
    has_table_privilege('authenticated','public.tickets','update') as direct_write,
    has_column_privilege('authenticated','public.tickets','qr_token','select') as qr`)).rows[0];
  assert.deepEqual(acl, { anon: false, service: false, direct_write: false, qr: false });
  await db.exec(await readFile(new URL("../drafts/door-staff-rpcs.sql", import.meta.url), "utf8"));
  const verification = (await db.query(await readFile(new URL("../drafts/verify-staff-annulment.sql", import.meta.url), "utf8"))).rows[0];
  for (const key of ["all_12_functions_present", "execution_modes_and_paths_ok", "authenticated_permissions_ok",
    "public_anon_service_denied", "no_direct_writes", "private_qr_not_selectable"]) assert.equal(verification[key], true, key);
  assert.equal(Number(verification.paid_orders), 1); assert.equal(Number(verification.retained_tickets), 2);
});
