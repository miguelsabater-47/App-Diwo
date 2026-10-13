import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

test("whole-row hashes, actor grants and role refresh remain unchanged by reads", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create function auth.jwt() returns jsonb language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb
      $$;
      grant usage on schema auth to anon,authenticated,service_role;
    `);
    await db.exec(await readFile(new URL("../../drafts/foundation.sql", import.meta.url), "utf8"));
    await db.exec("insert into public.user_roles(clerk_user_id,role) values('user_admin','admin'),('user_staff','door_staff')");
    const eventId = (await db.query(`
      insert into public.events(slug,title,public_location,sales_open_at,starts_at,ends_at,arrival_from,arrival_until,is_published)
      values('probe','Probe','Casa de campo en Ceutí','2020-01-01 UTC','2020-02-01 23:00 UTC',
        '2020-02-02 07:00 UTC','2020-02-01 23:30 UTC','2020-02-02 01:30 UTC',true) returning id
    `)).rows[0].id;
    await db.exec("begin");
    const orderId = (await db.query("insert into public.orders(event_id,buyer_clerk_id,buyer_name,attendee_names) values($1,$2,$3,array[$3]) returning id", [eventId, "user_staff", "Guest"])).rows[0].id;
    await db.query("update public.orders set status=$2,confirmed_by=$3 where id=$1", [orderId, "confirmed", "user_admin"]);
    const ticket = (await db.query("insert into public.tickets(order_id,event_id,ticket_position,attendee_name) values($1,$2,1,$3) returning id,qr_token", [orderId, eventId, "Guest"])).rows[0];
    await db.exec("commit");

    async function reset() {
      await db.exec("reset role");
      await db.query("select set_config($1,$2,false)", ["request.jwt.claims", "{}"]);
    }
    async function hash() {
      await reset();
      const result = await db.query(`select
        (select jsonb_agg(to_jsonb(o) order by id) from public.orders o) as orders,
        (select jsonb_agg(to_jsonb(t) order by id) from public.tickets t) as tickets,
        (select jsonb_agg(to_jsonb(e) order by id) from public.events e) as events,
        (select jsonb_agg(to_jsonb(r) order by clerk_user_id) from public.user_roles r) as roles`);
      return createHash("sha256").update(JSON.stringify(result.rows)).digest("hex");
    }
    async function client(claims, role = "authenticated") {
      await reset();
      await db.query("select set_config($1,$2,false)", ["request.jwt.claims", JSON.stringify(claims)]);
      await db.exec("set role " + role);
    }
    const before = await hash();
    const draft = await readFile(new URL("../../drafts/owned-ticket-detail.sql", import.meta.url), "utf8");
    for (let attempt = 0; attempt < 2; attempt++) {
      await db.exec(draft);
      assert.equal(await hash(), before);
    }
    for (const claims of [{}, { sub: "bad" }, { sub: "user_admin", app_role: "admin" }, { sub: "user_other", user_metadata: { role: "admin" } }]) {
      await client(claims);
      if (claims.sub?.startsWith("user_")) {
        assert.deepEqual((await db.query("select * from public.read_owned_ticket($1)", [ticket.id])).rows, []);
      } else {
        await assert.rejects(db.query("select * from public.read_owned_ticket($1)", [ticket.id]), { code: "42501", message: "verified_clerk_identity_required" });
      }
      assert.equal(await hash(), before);
    }
    await client({ sub: "user_staff" });
    for (const id of [ticket.id, ticket.id.toUpperCase()]) {
      assert.equal((await db.query("select * from public.read_owned_ticket($1)", [id])).rows[0].qr_token, ticket.qr_token);
    }
    await assert.rejects(db.query("select qr_token from public.tickets"), { code: "42501" });
    assert.equal(await hash(), before);
    for (const role of ["anon", "service_role"]) {
      await client({ sub: "user_staff" }, role);
      await assert.rejects(db.query("select * from public.read_owned_ticket($1)", [ticket.id]), { code: "42501" });
      assert.equal(await hash(), before);
    }
    await client({ sub: "user_staff" });
    await assert.rejects(db.query("select * from public.read_owned_ticket($1)", ["invalid"]), { code: "22P02" });
    assert.equal(await hash(), before);
    await client({ sub: "user_staff" });
    assert.deepEqual((await db.query("select * from public.read_owned_ticket(null)")).rows, []);
    assert.equal(await hash(), before);
    for (const status of ["used", "revoked"]) {
      await reset();
      await db.exec("begin");
      const actorColumn = status === "used" ? "used_by" : "revoked_by";
      await db.query(`update public.tickets set status=$1,${actorColumn}=$2 where id=$3`, [status, "user_admin", ticket.id]);
      const terminalHash = await hash();
      await client({ sub: "user_staff" });
      const history = (await db.query("select * from public.read_owned_ticket($1)", [ticket.id])).rows[0];
      assert.equal(history.status, status);
      assert.equal(history.qr_token, null);
      assert.ok(history[status === "used" ? "used_at" : "revoked_at"]);
      assert.equal(await hash(), terminalHash);
      await reset();
      await db.exec("rollback");
      assert.equal(await hash(), before);
    }
    await reset();
    await db.query("update public.user_roles set role=$1 where clerk_user_id=$2", ["user", "user_staff"]);
    await client({ sub: "user_staff", app_role: "door_staff" });
    assert.equal((await db.query("select public.get_current_app_role() as role")).rows[0].role, "user");
    assert.equal((await db.query("select * from public.read_owned_ticket($1)", [ticket.id])).rows.length, 1);
  } finally { await db.close(); }
});
