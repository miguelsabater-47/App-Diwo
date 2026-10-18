import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("door scanner on isolated SQL only, never hosted tickets", { timeout: 90000 }, async t => {
  const db = new PGlite(); t.after(() => db.close());
  const ADMIN = "user_scan_admin", STAFF = "user_scan_staff", BUYER = "user_scan_buyer";
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    grant usage on schema auth to anon,authenticated,service_role;`);
  const source = name => readFile(new URL(name, import.meta.url), "utf8");
  await db.exec(await source("../migrations/20261011225839_diwo_foundation.sql"));
  await db.exec(await source("../drafts/order-payment-rpcs.sql"));
  const draft = await source("../drafts/door-scan-rpcs.sql"); await db.exec(draft);
  await db.query("insert into public.user_roles(clerk_user_id,role) values($1,'admin'),($2,'door_staff')", [ADMIN, STAFF]);
  const event = (await db.query(`insert into public.events(slug,title,public_location,sales_open_at,starts_at,ends_at,arrival_from,arrival_until,is_published)
    values('diwo-x-2-2026','Synthetic only','Generic','2020-01-01','2020-01-02 23:00UTC','2020-01-03 07:00UTC','2020-01-02 23:30UTC','2020-01-03 01:30UTC',true) returning id`)).rows[0].id;
  const owner = async () => { await db.exec("reset role"); await db.query("select set_config('request.jwt.claims','{}',false)"); };
  const client = async (subject, role = "authenticated") => { await owner(); await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: subject, role: "authenticated", public_metadata: { role: "admin" } })]); await db.exec(`set role ${role}`); };
  await client(BUYER);
  const order = randomUUID(); await db.query("select * from public.create_order_request($1,$2,'Synthetic',array['One','Two'])", [order, event]);
  await client(ADMIN); await db.query("select * from public.approve_order_payment($1)", [order]); await owner();
  const tickets = (await db.query("select * from public.tickets where order_id=$1 order by ticket_position", [order])).rows;
  const scan = async (token = tickets[0].qr_token, id = event) => (await db.query("select outcome,ticket_id,attendee_name,used_at::text as used_at from public.check_in_ticket($1,$2)", [id, token])).rows[0];
  const denied = async (code, run) => { await db.exec("savepoint denial"); let actual; try { await run(); } catch(e) { actual = e.code; } await db.exec("rollback to denial; release savepoint denial"); assert.equal(actual, code); };
  const scenario = async (name, run) => t.test(name, async () => { await owner(); await db.exec("begin"); try { await run(); await db.exec("set constraints all immediate"); } finally { await db.exec("rollback"); await owner(); } });
  await scenario("current roles only, no metadata escalation or privileged fallback", async () => {
    for (const [subject, role] of [[BUYER,"authenticated"],[undefined,"authenticated"],[ADMIN,"anon"],[ADMIN,"service_role"]]) {
      await client(subject, role); await denied("42501", scan); await denied("42501", () => db.query("select * from public.read_door_event()"));
    }
    await client(ADMIN); assert.equal((await scan()).outcome,"admitted");
  });
  await scenario("first access uses persisted identity and server timestamp, replay rejects preserving whole history", async () => {
    await client(STAFF); const first = await scan(); assert.equal(first.outcome,"admitted"); assert.equal(first.ticket_id,tickets[0].id); assert.equal(first.attendee_name,"One"); assert.ok(first.used_at);
    await owner(); const stored = (await db.query("select to_jsonb(t) as row from public.tickets t where id=$1", [tickets[0].id])).rows[0].row; assert.equal(stored.used_by,STAFF);
    await client(ADMIN); const second = await scan(); assert.equal(second.outcome,"already_used"); assert.equal(second.used_at,first.used_at);
    await owner(); assert.deepEqual((await db.query("select to_jsonb(t) as row from public.tickets t where id=$1", [tickets[0].id])).rows[0].row,stored);
  });
  await scenario("annulled old images reject, counters exclude revoked and satisfy U+P=V", async () => {
    await client(ADMIN); await db.exec("reset role"); await db.query("update public.tickets set status='revoked' where id=$1", [tickets[1].id]);
    await client(STAFF); assert.equal((await scan(tickets[1].qr_token)).outcome,"revoked"); assert.equal((await scan()).outcome,"admitted");
    const counters = (await db.query("select * from public.read_door_event()")).rows[0]; assert.equal(Number(counters.used_admissions),1); assert.equal(Number(counters.pending_admissions),0); assert.equal(Number(counters.issued_non_revoked),1);
    await owner(); await db.query("update public.user_roles set role='user' where clerk_user_id=$1", [STAFF]); await client(STAFF); await denied("42501",scan);
  });
  await scenario("unknown and wrong event omit personal data; technical event never fallback", async () => {
    await client(STAFF); assert.deepEqual(await scan("f".repeat(64)),{ outcome:"unknown",ticket_id:null,attendee_name:null,used_at:null });
    await owner(); await db.query("update public.events set slug='technical-only' where id=$1",[event]);
    assert.deepEqual((await (async () => { await client(STAFF); return db.query("select * from public.read_door_event()"); })()).rows,[]);
    await denied("22023",scan);
    await owner();
    const other = (await db.query(`insert into public.events(slug,title,public_location,sales_open_at,starts_at,ends_at,arrival_from,arrival_until,is_published)
      values('diwo-x-2-2026','Other synthetic event','Generic','2020-01-01','2020-01-02 23:00UTC','2020-01-03 07:00UTC','2020-01-02 23:30UTC','2020-01-03 01:30UTC',true) returning id`)).rows[0].id;
    await client(STAFF); assert.deepEqual(await scan(tickets[0].qr_token,other),{ outcome:"wrong_event",ticket_id:null,attendee_name:null,used_at:null });
  });
  await scenario("invalid payload denied and direct writes/private QR still inaccessible", async () => {
    await client(STAFF); for (const token of [null,"", "A".repeat(64)]) await denied("22023", () => scan(token));
    await denied("42501", () => db.query("select qr_token from public.tickets"));
    await denied("42501", () => db.query("update public.tickets set status='used'"));
    const functions = (await db.query(`select n.nspname,p.proname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where proname in ('check_in_ticket','read_door_event')`)).rows;
    assert.equal(functions.length,4); assert.ok(functions.every(r => r.prosecdef === (r.nspname === "diwo_private") && r.proconfig.includes('search_path=""')));
  });
  const before = (await db.query("select to_jsonb(t) as row from public.tickets t order by id")).rows;
  await db.exec(draft); await db.exec(draft); assert.deepEqual((await db.query("select to_jsonb(t) as row from public.tickets t order by id")).rows,before);
});
