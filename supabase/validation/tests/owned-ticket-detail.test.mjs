import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const ADMIN = "user_fixture_admin";
const STAFF = "user_fixture_staff";
const BUYER = "user_fixture_buyer";
const OTHER = "user_fixture_other";
const foundation = await readFile(new URL("../../drafts/foundation.sql", import.meta.url), "utf8");
const detail = await readFile(new URL("../../drafts/owned-ticket-detail.sql", import.meta.url), "utf8");

test("owned ticket detail is owner-only and read-only on disposable PostgreSQL", { timeout: 90000 }, async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    grant usage on schema auth to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;`);
  await db.exec(foundation);
  await db.query("insert into public.user_roles(clerk_user_id,role) values($1,'admin'),($2,'door_staff')", [ADMIN, STAFF]);
  const events = (await db.query(`insert into public.events(slug,title,public_location,sales_open_at,starts_at,ends_at,arrival_from,arrival_until,is_published)
    values ('owned-fixture','Owned Fixture','Venue','2020-01-01 UTC','2020-02-01 23:00 UTC','2020-02-02 07:00 UTC','2020-02-01 23:30 UTC','2020-02-02 01:30 UTC',true) returning id`)).rows;
  const event = events[0].id;
  const createPaid = async (buyer, name) => {
    await db.exec("begin");
    const order = (await db.query(`insert into public.orders(event_id,buyer_clerk_id,buyer_name,attendee_names)
      values($1,$2,'Fixture Buyer',array[$3]) returning id`, [event,buyer,name])).rows[0];
    await db.query("update public.orders set status='confirmed',confirmed_by=$2 where id=$1", [order.id,ADMIN]);
    const ticket = (await db.query(`insert into public.tickets(order_id,event_id,ticket_position,attendee_name)
      values($1,$2,1,$3) returning id,qr_token`, [order.id,event,name])).rows[0];
    await db.exec("commit");
    return ticket;
  };
  const own = await createPaid(BUYER, "Buyer Guest");
  const staffOwned = await createPaid(STAFF, "Staff Guest");
  const adminOwned = await createPaid(ADMIN, "Admin Guest");
  const foreign = await createPaid(OTHER, "Other Guest");
  await db.query("update public.tickets set status='used',used_by=$2 where id=$1", [own.id,STAFF]);
  await db.query("update public.tickets set status='revoked',revoked_by=$2 where id=$1", [staffOwned.id,ADMIN]);
  const hash = async () => (await db.query(`select md5(string_agg(x,'|' order by x)) as hash from (
    select 'o:'||id||':'||status||':'||buyer_clerk_id as x from public.orders
    union all select 't:'||id||':'||status||':'||qr_token from public.tickets) q`)).rows[0].hash;
  const before = await hash();
  await db.exec(detail);
  await db.exec(detail);
  const afterApply = await hash();
  assert.equal(afterApply, before);

  const owner = async () => { await db.exec("reset role"); await db.query("select set_config('request.jwt.claims','{}',false)"); };
  const client = async (subject, extra = {}, role = "authenticated") => {
    await owner();
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: subject, role: "authenticated", ...extra })]);
    await db.exec(`set role ${role}`);
  };
  const rpc = async (id) => (await db.query("select * from public.read_owned_ticket($1)", [id])).rows;

  await t.test("owner reads complete valid bearer details only through public RPC", async () => {
    await client(OTHER);
    const row = (await rpc(foreign.id))[0];
    assert.equal(row.qr_token, foreign.qr_token);
    assert.match(row.qr_token, /^[0-9a-f]{64}$/);
    assert.equal(row.event_slug, "owned-fixture");
    assert.equal(row.order_reference.startsWith("DIWO-"), true);
  });
  for (const [label, subject, ticket] of [["buyer", BUYER, own], ["staff", STAFF, staffOwned], ["admin", ADMIN, adminOwned]]) {
    await t.test(`${label} owns own detail regardless of role`, async () => {
      await client(subject);
      const rows = await rpc(ticket.id);
      assert.equal(rows.length, 1);
    });
  }
  for (const [label, subject] of [["ordinary buyer", BUYER], ["admin", ADMIN], ["staff", STAFF]]) {
    await t.test(`${label} cannot read another owner's ticket`, async () => {
      await client(subject);
      assert.deepEqual(await rpc(foreign.id), []);
    });
  }
  await t.test("used and revoked ownership returns history without token", async () => {
    await client(BUYER);
    const used = (await rpc(own.id))[0];
    assert.equal(used.status, "used"); assert.ok(used.used_at); assert.equal(used.qr_token, null);
    await client(STAFF);
    const revoked = (await rpc(staffOwned.id))[0];
    assert.equal(revoked.status, "revoked"); assert.ok(revoked.revoked_at); assert.equal(revoked.qr_token, null);
  });
  await t.test("anonymous, malformed, forged role, bad UUID and missing ids fail closed", async () => {
    await client(null, {}, "anon");
    await assert.rejects(() => rpc(own.id), { code: "42501" });
    await client("malformed", {}, "authenticated");
    await assert.rejects(() => rpc(own.id), { code: "42501" });
    await client(OTHER, { app_role: "admin", user_metadata: { role: "admin" } });
    assert.deepEqual(await rpc(own.id), []);
    assert.deepEqual(await rpc("00000000-0000-4000-8000-000000000000"), []);
    await assert.rejects(() => rpc("not-a-uuid"));
  });
  await t.test("token is not exposed by broad table access and grants are narrow", async () => {
    for (const subject of [BUYER, STAFF, ADMIN]) {
      await client(subject);
      await assert.rejects(() => db.query("select qr_token from public.tickets"), { code: "42501" });
    }
    await client(null, {}, "service_role");
    await assert.rejects(() => rpc(own.id), { code: "42501" });
    await owner();
    const grants = await db.query(`select has_function_privilege('anon','public.read_owned_ticket(uuid)','execute') as anon,
      has_function_privilege('authenticated','public.read_owned_ticket(uuid)','execute') as authenticated,
      has_function_privilege('service_role','public.read_owned_ticket(uuid)','execute') as service`);
    assert.deepEqual(grants.rows[0], { anon: false, authenticated: true, service: false });
  });
  assert.equal(await hash(), before);
});
