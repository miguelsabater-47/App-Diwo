import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as scanModel from "../../lib/door-scan-model.ts";

// Local PostgreSQL ONLY. No .env.local, SDK, URL or external database input.
const root = fileURLToPath(new URL("../../../", import.meta.url));
const runtime = path.join(root, ".diwo-tools", "postgres", "postgresql-17.11", "bin");
const port = 55417;
const ADMIN = "user_fixture_admin";
const BUYER = "user_fixture_buyer";
const STAFF = "user_fixture_staff";
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const jsonQuery = (query) => `select row_to_json(r) from (${query}) r;`;
const parse = (output) => JSON.parse(output.trim());
const connections = new Set();
// Prevent inherited libpq service/connection settings or credentials leaking in.
const localEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG/i.test(key)));
localEnv.PGCLIENTENCODING = "UTF8";
localEnv.PGPASSWORD = randomBytes(32).toString("base64url");

function command(executable, args, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(runtime, executable), args, { env: localEnv, windowsHide: true, shell: false });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Local PostgreSQL ${executable} command timed out`)); }, timeout);
    child.stdin.end();
    child.stdout.setEncoding("utf8").on("data", (data) => { stdout += data; });
    child.stderr.setEncoding("utf8").on("data", (data) => { stderr += data; });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    // On Windows pg_ctl's server descendant can inherit stdio handles. The
    // supervisor's exit, not closure of all descendant pipes, signals completion.
    const completion = executable === "pg_ctl.exe" && args.includes("start") ? "exit" : "close";
    child.on(completion, (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

/** Separate persistent psql processes = separate real database connections. */
class Peer {
  constructor() {
    this.pending = null;
    this.buffer = "";
    this.stderr = "";
    this.closed = false;
    this.sequence = 0;
    this.name = `diwo_race_${randomUUID().replaceAll("-", "")}`;
    this.child = spawn(path.join(runtime, "psql.exe"), [
      "-X", "-q", "-A", "-t", "-w", "-h", "127.0.0.1", "-p", String(port),
      "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=sqlstate",
    ], { env: localEnv, windowsHide: true, shell: false });
    this.child.stdout.setEncoding("utf8").on("data", (data) => {
      this.buffer += data;
      let newline;
      while ((newline = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, newline).replace(/\r$/, "");
        this.buffer = this.buffer.slice(newline + 1);
        if (!this.pending) continue;
        if (line === this.pending.marker) {
          const pending = this.pending;
          this.pending = null;
          clearTimeout(pending.timer);
          pending.resolve(pending.output.join("\n"));
        } else if (line) this.pending.output.push(line);
      }
    });
    this.child.stderr.setEncoding("utf8").on("data", (data) => { this.stderr += data; });
    this.child.on("error", () => this.fail("Local psql could not start"));
    this.closePromise = new Promise((resolve) => this.child.on("close", (code) => {
      this.closed = true;
      connections.delete(this);
      this.fail(`Local psql exited (${code})`);
      resolve();
    }));
    connections.add(this);
  }

  fail(message) {
    if (!this.pending) return;
    const pending = this.pending;
    this.pending = null;
    clearTimeout(pending.timer);
    const error = new Error(message);
    error.sqlState = this.stderr.match(/(?:ERROR|FATAL):\s+([A-Z0-9]{5})/)?.[1];
    pending.reject(error);
  }

  exec(sql) {
    if (this.pending || this.closed) throw new Error("Local psql peer is busy or closed");
    return new Promise((resolve, reject) => {
      const marker = `__DIWO_QUERY_DONE_${++this.sequence}__`;
      const timer = setTimeout(() => {
        this.fail("Local psql query timed out");
        this.child.kill();
      }, 15000);
      this.pending = { marker, timer, output: [], resolve, reject };
      this.child.stdin.write(`${sql}\n\\echo ${marker}\n`);
    });
  }

  async end() {
    if (this.closed) return;
    // Only this test's own client process; disconnect rolls back its transaction.
    const timer = setTimeout(() => this.child.kill(), 2000);
    this.child.stdin.end("\\q\n");
    await this.closePromise;
    clearTimeout(timer);
  }

  static async open() {
    const peer = new Peer();
    await peer.exec(`set application_name=${quote(peer.name)};
      set statement_timeout='8s'; set lock_timeout='6s';`);
    peer.pid = Number(await peer.exec("select pg_backend_pid();"));
    return peer;
  }
}

const begin = (subject, owner = false) => `begin;
  set local request.jwt.claims=${quote(JSON.stringify({ sub: subject, role: "authenticated" }))};
  ${owner ? "" : "set local role authenticated;"}`;
const createSQL = (id, event, names = ["First", "Second"]) => jsonQuery(
  `select * from public.create_order_request(${quote(id)}::uuid,${quote(event)}::uuid,
    'Synthetic Buyer',array[${names.map(quote).join(",")}])`);
const approveSQL = (id) => jsonQuery(`select * from public.approve_order_payment(${quote(id)}::uuid)`);
const reportSQL = (id) => jsonQuery(`select * from public.report_order_payment(${quote(id)}::uuid)`);
const closeSQL = (id, decision) => jsonQuery(`select * from public.${decision}_order_request(${quote(id)}::uuid)`);

test("real PostgreSQL 17.11 multi-connection order/payment races", { timeout: 150000 }, async (t) => {
  assert.equal(process.platform, "win32", "This isolated runtime is Windows-only");
  const version = await command("postgres.exe", ["--version"]);
  assert.equal(version.code, 0);
  assert.match(version.stdout, /PostgreSQL\) 17\.11\b/);
  // Refuse an occupied port; never stop or connect to an existing database.
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen({ host: "127.0.0.1", port, exclusive: true }, resolve);
  });
  await new Promise((resolve) => probe.close(resolve));
  const runs = path.join(root, ".diwo-tools", "postgres", "runs");
  const run = path.join(runs, `run-${randomUUID()}`);
  const data = path.join(run, "data");
  const passwordFile = path.join(run, "init-password.txt");
  let startAttempted = false;
  await mkdir(run, { recursive: true });
  t.after(async () => {
    await Promise.all([...connections].map((peer) => peer.end()));
    if (startAttempted) {
      const status = await command("pg_ctl.exe", ["-D", data, "status"]);
      if (status.code === 0) {
        const stopped = await command("pg_ctl.exe", ["-D", data, "-m", "fast", "-w", "-t", "20", "stop"]);
        assert.equal(stopped.code, 0, "Could not stop this test's PostgreSQL cluster");
      }
      assert.equal((await command("pg_ctl.exe", ["-D", data, "status"])).code, 3,
        "Test cluster must be stopped before disposal");
    }
    assert.equal(path.dirname(run), runs);
    await rm(run, { recursive: true, force: true });
    t.diagnostic("Own test cluster stopped and disposed; no Windows service or app lifecycle changes.");
  });
  await writeFile(passwordFile, localEnv.PGPASSWORD + "\n", { mode: 0o600 });
  try {
    const initialized = await command("initdb.exe", ["-D", data, "--username=postgres",
      "--auth=scram-sha-256", `--pwfile=${passwordFile}`, "--encoding=UTF8", "--locale=C", "--no-instructions"], 60000);
    assert.equal(initialized.code, 0, "Local PostgreSQL cluster initialization failed");
  } finally { await unlink(passwordFile); }
  startAttempted = true;
  const started = await command("pg_ctl.exe", ["-D", data, "-l", path.join(run, "server.log"),
    "-o", `-c listen_addresses=127.0.0.1 -c port=${port} -c max_connections=16 -c timezone=UTC -c ssl=off`,
    "-w", "-t", "20", "start"]);
  assert.equal(started.code, 0, "Local PostgreSQL cluster start failed");
  const observer = await Peer.open();
  t.diagnostic(`Actual engine ${await observer.exec("show server_version;")}; separate psql backends, SCRAM, loopback-only.`);
  await observer.exec(`create role anon nologin; create role authenticated nologin;
    create role service_role nologin bypassrls; create schema auth;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb
    $$; grant usage on schema auth to anon,authenticated,service_role;`);
  await observer.exec(await readFile(new URL("../migrations/20261011225839_diwo_foundation.sql", import.meta.url), "utf8"));
  await observer.exec(await readFile(new URL("../drafts/order-payment-rpcs.sql", import.meta.url), "utf8"));
  await observer.exec(await readFile(new URL("../drafts/order-closure-rpcs.sql", import.meta.url), "utf8"));
  await observer.exec(await readFile(new URL("../drafts/door-staff-rpcs.sql", import.meta.url), "utf8"));
  await observer.exec(await readFile(new URL("../drafts/door-scan-rpcs.sql", import.meta.url), "utf8"));
  await observer.exec(await readFile(new URL("../drafts/ticket-annulment-rpc.sql", import.meta.url), "utf8"));
  await observer.exec(`insert into public.user_roles(clerk_user_id,role)
    values(${quote(ADMIN)},'admin'),(${quote(STAFF)},'door_staff');`);
  const event = randomUUID();
  await observer.exec(`insert into public.events(id,slug,title,public_location,sales_open_at,
    starts_at,ends_at,arrival_from,arrival_until,is_published) values(${quote(event)},
    'synthetic-race','Synthetic Event','Generic location','2020-01-01',
    '2099-01-02 23:00 UTC','2099-01-03 07:00 UTC',
    '2099-01-02 23:30 UTC','2099-01-03 01:30 UTC',true);`);
  const peers = async (ct, count = 2) => {
    const connections = [];
    ct.after(async () => { for (const peer of connections) await peer.end(); });
    for (let n = 0; n < count; n++) connections.push(await Peer.open());
    assert.equal(new Set(connections.map(peer => peer.pid)).size, count);
    return connections;
  };
  const blockedBy = async (waiting, holder) => {
    for (let attempt = 0; attempt < 60; attempt++) {
      const state = await observer.exec(`select coalesce(bool_or(${holder.pid}=any(pg_blocking_pids(pid))),false)
        from pg_stat_activity where pid=${waiting.pid};`);
      if (state.trim() === "t") return;
      await delay(25);
    }
    assert.fail("Second real connection did not demonstrably wait on the first");
  };
  const launch = (peer, sql) => peer.exec(sql).then(
    (output) => ({ ok: true, output }), (error) => ({ ok: false, sqlState: error.sqlState }));
  const createCommitted = async (targetEvent = event) => {
    const id = randomUUID();
    await observer.exec(begin(BUYER) + createSQL(id, targetEvent) + "commit;");
    return id;
  };
  const state = async (id) => parse(await observer.exec(jsonQuery(`select o.status,
    o.payment_reported_at is not null as noticed,o.confirmed_at is not null as confirmed,
    (select count(*)::int from public.tickets t where t.order_id=o.id) as tickets,
    (select count(distinct qr_token)::int from public.tickets t where t.order_id=o.id) as unique_tokens
     from public.orders o where o.id=${quote(id)}::uuid`)));

  const scanEvent = randomUUID();
  await observer.exec(`insert into public.events(id,slug,title,public_location,sales_open_at,starts_at,ends_at,arrival_from,arrival_until,is_published)
    values(${quote(scanEvent)},'diwo-x-2-2026','Synthetic scan event','Generic','2020-01-01','2020-01-02 23:00UTC','2020-01-03 07:00UTC','2020-01-02 23:30UTC','2020-01-03 01:30UTC',true);`);
  // Lookup synthetic bearer values only inside the local owner connection, never
  // in test output. The signed peer still has no private QR column grants.
  const scanCommand = async id => {
    const token = (await observer.exec(`select qr_token from public.tickets where order_id=${quote(id)} order by ticket_position limit 1;`)).trim();
    return jsonQuery(`select outcome,ticket_id,used_at from public.check_in_ticket(${quote(scanEvent)},${quote(token)})`);
  };
  await t.test("two scanner devices serialize: exactly one admission and one already-used rejection", async ct => {
    const id = await createCommitted(scanEvent); await observer.exec(begin(ADMIN) + approveSQL(id) + "commit;");
    const sql = await scanCommand(id), [a,b] = await peers(ct);
    const first = parse(await a.exec(begin(STAFF) + sql)); assert.equal(first.outcome,"admitted");
    const pending = launch(b,begin(ADMIN) + sql + "commit;"); await blockedBy(b,a); await a.exec("commit;");
    const second = await pending; assert.equal(second.ok,true); const receipt = parse(second.output);
    assert.equal(receipt.outcome,"already_used"); assert.equal(receipt.ticket_id,first.ticket_id); assert.equal(receipt.used_at,first.used_at);
  });
  await t.test("rolled-back first scan does not consume entry; waiting device becomes sole admission", async ct => {
    const id = await createCommitted(scanEvent); await observer.exec(begin(ADMIN) + approveSQL(id) + "commit;");
    const sql = await scanCommand(id), [a,b] = await peers(ct);
    await a.exec(begin(STAFF) + sql); const pending = launch(b,begin(ADMIN) + sql + "commit;");
    await blockedBy(b,a); await a.exec("rollback;"); const second = await pending; assert.equal(second.ok,true); assert.equal(parse(second.output).outcome,"admitted");
  });
  for (const firstOperation of ["scan", "annul"]) await t.test(`${firstOperation} wins against competing ticket operation, terminal audit cannot be overwritten`, async ct => {
    const id = await createCommitted(scanEvent); await observer.exec(begin(ADMIN) + approveSQL(id) + "commit;");
    const sql = await scanCommand(id), [a,b] = await peers(ct);
    const target = (await observer.exec(`select id from public.tickets where order_id=${quote(id)} and ticket_position=1;`)).trim();
    const annul = jsonQuery(`select * from public.revoke_issued_ticket(${quote(target)})`);
    await a.exec(begin(ADMIN) + (firstOperation === "scan" ? sql : annul));
    const pending = launch(b,begin(ADMIN) + (firstOperation === "scan" ? annul : sql) + "commit;");
    await blockedBy(b,a); await a.exec("commit;"); const second = await pending;
    if (firstOperation === "scan") assert.deepEqual(second,{ ok:false,sqlState:"22023" });
    else { assert.equal(second.ok,true); assert.equal(parse(second.output).outcome,"revoked"); }
  });

  // Integrate the CURRENT production handler with real SQL/roles/locks. Only the
  // RPC transport and authenticated subject are local test adapters, not Clerk,
  // Supabase/PostgREST or actual HTTP/mobile integration. No hosted input exists.
  const compiledHandler=ts.transpileModule(await readFile(new URL("../../lib/door-scan-core.ts",import.meta.url),"utf8"),{ compilerOptions:{ module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022 } }).outputText;
  const handlerModule={ exports:{} };
  new Function("require","module","exports",compiledHandler)(name => { assert.equal(name,"./door-scan-model"); return scanModel; },handlerModule,handlerModule.exports);
  const { handleDoorScan }=handlerModule.exports;
  const scanRequest=(token, eventId=scanEvent) => new Request("http://localhost:3000/api/door-scan",token === null ? {} : {
    method:"POST",headers:{ origin:"http://localhost:3000","Content-Type":"application/json" },body:JSON.stringify({ eventId,token }),
  });
  function scanAdapter(peer,subject=STAFF,hooks={}) {
    const calls=[];
    return { calls,authorize:async () => ({ ok:true,role:subject===ADMIN ? "admin" : "door_staff",client:{ async rpc(name,args) {
      calls.push(name);
      try {
        let query;
        if (name === "check_in_ticket") query=`select coalesce(json_agg(r),'[]'::json) as value from public.check_in_ticket(${quote(args.target_event)}::uuid,${quote(args.scanned_token)}) r`;
        else if (name === "read_door_event") query="select coalesce(json_agg(r),'[]'::json) as value from public.read_door_event() r";
        else if (name === "get_current_app_role") query="select public.get_current_app_role() as value";
        else assert.fail("Unexpected RPC in local scanner adapter");
        const result=parse(await peer.exec(begin(subject)+jsonQuery(query))).value;
        await hooks.beforeCommit?.(name);
        await peer.exec("commit;"); // Never deliver admission before its commit.
        await hooks.afterCommit?.(name);
        return { data:result,error:null };
      } catch(error) {
        // No SQL text, token, upstream message or automatic retry in this adapter.
        return { data:null,error:{ code:error.sqlState ?? "LOCAL_TRANSPORT_UNCONFIRMED" } };
      }
    } } }) };
  }
  const apiFixture=async (targetEvent=scanEvent) => {
    const order=await createCommitted(targetEvent); await observer.exec(begin(ADMIN)+approveSQL(order)+"commit;");
    const ticket=parse(await observer.exec(jsonQuery(`select id,qr_token from public.tickets where order_id=${quote(order)} and ticket_position=1`)));
    return { order,ticket };
  };
  const ticketHash=async id => (await observer.exec(`select md5(row_to_json(t)::text) from public.tickets t where id=${quote(id)};`)).trim();
  const orderHash=async id => (await observer.exec(`select md5(row_to_json(o)::text) from public.orders o where id=${quote(id)};`)).trim();
  const safeScanDto=(data,token) => {
    const json=JSON.stringify(data);
    for (const forbidden of [token,ADMIN,STAFF,BUYER,"qr_token","used_by","clerk_user_id"]) assert.equal(json.includes(forbidden),false,"Scanner DTO must not expose bearer or subjects");
  };
  await t.test("scanner handler + SQL: two pending requests commit one admission, preserve paid history and synchronize U/P/V reads", async ct => {
    const fixture=await apiFixture(),[a,b]=await peers(ct),entered=Promise.withResolvers(),release=Promise.withResolvers();
    ct.after(() => release.resolve());
    const beforeOrder=await orderHash(fixture.order);
    const first=scanAdapter(a,STAFF,{ async beforeCommit(name) { if (name === "check_in_ticket") { entered.resolve(); await release.promise; } } });
    const second=scanAdapter(b,ADMIN);
    const beforeResponse=await handleDoorScan(scanRequest(null),second.authorize); assert.equal(beforeResponse.status,200);
    const before=(await beforeResponse.json()).event;
    let firstReturned=false,secondReturned=false;
    const pendingFirst=handleDoorScan(scanRequest(fixture.ticket.qr_token),first.authorize).then(response => { firstReturned=true; return response; });
    await entered.promise;
    const pendingSecond=handleDoorScan(scanRequest(fixture.ticket.qr_token),second.authorize).then(response => { secondReturned=true; return response; });
    await blockedBy(b,a); assert.equal(firstReturned,false); assert.equal(secondReturned,false);
    release.resolve();
    const [admission,rejection]=await Promise.all([pendingFirst,pendingSecond]);
    assert.equal(admission.status,200); assert.equal(rejection.status,200);
    assert.match(admission.headers.get("cache-control"),/no-store/);
    const admitted=await admission.json(),used=await rejection.json();
    assert.equal(admitted.result.outcome,"admitted"); assert.equal(used.result.outcome,"already_used");
    assert.equal(admitted.result.ticketId,fixture.ticket.id); assert.equal(used.result.usedAt,admitted.result.usedAt);
    safeScanDto(admitted,fixture.ticket.qr_token); safeScanDto(used,fixture.ticket.qr_token);
    assert.equal(await orderHash(fixture.order),beforeOrder);
    const read=await handleDoorScan(scanRequest(null),second.authorize); assert.equal(read.status,200);
    const after=(await read.json()).event;
    assert.equal(after.used,before.used+1); assert.equal(after.pending,before.pending-1); assert.equal(after.total,before.total); assert.equal(after.used+after.pending,after.total);
    assert.equal(first.calls.filter(name => name === "check_in_ticket").length,1);
    assert.equal(second.calls.filter(name => name === "check_in_ticket").length,1);
  });
  await t.test("scanner handler + SQL: lost response after commit remains unconfirmed, explicit rescan rejects without overwriting audit", async ct => {
    const fixture=await apiFixture(),[a,b]=await peers(ct),paid=await orderHash(fixture.order);
    const first=scanAdapter(a,STAFF,{ afterCommit(name) { if (name === "check_in_ticket") throw Error("Synthetic lost response after commit"); } });
    const response=await handleDoorScan(scanRequest(fixture.ticket.qr_token),first.authorize);
    assert.equal(response.status,502); assert.deepEqual(await response.json(),{ error:"scan_operation_unconfirmed" });
    assert.deepEqual(first.calls,["check_in_ticket"]);
    const audit=await ticketHash(fixture.ticket.id),second=scanAdapter(b,ADMIN);
    const retry=await handleDoorScan(scanRequest(fixture.ticket.qr_token),second.authorize); assert.equal(retry.status,200);
    const receipt=await retry.json(); assert.equal(receipt.result.outcome,"already_used"); assert.ok(receipt.result.usedAt);
    assert.equal(await ticketHash(fixture.ticket.id),audit); assert.equal(await orderHash(fixture.order),paid); safeScanDto(receipt,fixture.ticket.qr_token);
  });
  await t.test("scanner handler + SQL: revoked, other-event and unknown reject without changing unused ticket or paid parent", async ct => {
    const revoked=await apiFixture(),other=await apiFixture(event),[peer]=await peers(ct,1);
    await observer.exec(begin(ADMIN,true)+`select 1 from public.orders where id=${quote(revoked.order)} for update; update public.tickets set status='revoked' where id=${quote(revoked.ticket.id)}; commit;`);
    const before=[await ticketHash(revoked.ticket.id),await ticketHash(other.ticket.id),await orderHash(revoked.order),await orderHash(other.order)];
    const adapter=scanAdapter(peer);
    for (const [token,outcome] of [[revoked.ticket.qr_token,"revoked"],[other.ticket.qr_token,"wrong_event"],[randomBytes(32).toString("hex"),"unknown"]]) {
      const response=await handleDoorScan(scanRequest(token),adapter.authorize); assert.equal(response.status,200);
      const receipt=await response.json(); assert.equal(receipt.result.outcome,outcome); safeScanDto(receipt,token);
      if (outcome !== "revoked") assert.deepEqual(receipt.result,{ outcome,ticketId:null,name:null,usedAt:null });
    }
    assert.deepEqual([await ticketHash(revoked.ticket.id),await ticketHash(other.ticket.id),await orderHash(revoked.order),await orderHash(other.order)],before);
  });
  await t.test("scanner handler + SQL: stale application role cannot scan after actual DB revocation", async ct => {
    const fixture=await apiFixture(),[peer]=await peers(ct,1),before=await ticketHash(fixture.ticket.id),adapter=scanAdapter(peer);
    try {
      await observer.exec(`update public.user_roles set role='user' where clerk_user_id=${quote(STAFF)};`);
      const response=await handleDoorScan(scanRequest(fixture.ticket.qr_token),adapter.authorize);
      assert.equal(response.status,403); assert.deepEqual(await response.json(),{ error:"operation_not_authorized" });
      assert.equal(await ticketHash(fixture.ticket.id),before); assert.deepEqual(adapter.calls,["check_in_ticket"]);
    } finally { await observer.exec(`update public.user_roles set role='door_staff' where clerk_user_id=${quote(STAFF)};`); }
  });
  await t.test("scanner handler + SQL: role recheck suppresses counters revoked between RPCs and unpublished event never falls back", async ct => {
    const [peer,emptyPeer]=await peers(ct),adapter=scanAdapter(peer,STAFF,{ async afterCommit(name) {
      if (name === "read_door_event") await observer.exec(`update public.user_roles set role='user' where clerk_user_id=${quote(STAFF)};`);
    } });
    try {
      const response=await handleDoorScan(scanRequest(null),adapter.authorize);
      assert.equal(response.status,403); assert.deepEqual(await response.json(),{ error:"operation_not_authorized" });
      assert.deepEqual(adapter.calls,["read_door_event","get_current_app_role"]);
    } finally { await observer.exec(`update public.user_roles set role='door_staff' where clerk_user_id=${quote(STAFF)};`); }
    try {
      await observer.exec(`update public.events set is_published=false where id=${quote(scanEvent)};`);
      const empty=scanAdapter(emptyPeer),response=await handleDoorScan(scanRequest(null),empty.authorize);
      assert.equal(response.status,200); assert.deepEqual(await response.json(),{ event:null });
      assert.deepEqual(empty.calls,["read_door_event","get_current_app_role"]);
    } finally { await observer.exec(`update public.events set is_published=true where id=${quote(scanEvent)};`); }
  });

  await t.test("simultaneous identical submissions wait and commit one order/reference", async (ct) => {
    const [a, b] = await peers(ct);
    const id = randomUUID();
    const first = parse(await a.exec(begin(BUYER) + createSQL(id, event)));
    const pending = launch(b, begin(BUYER) + createSQL(id, event) + "commit;");
    await blockedBy(b, a);
    await a.exec("commit;");
    const second = await pending;
    assert.equal(second.ok, true);
    assert.deepEqual(parse(second.output), first);
    assert.equal((await state(id)).tickets, 0);
  });
  await t.test("competing changed submission payload waits then rejects without mutation", async (ct) => {
    const [a, b] = await peers(ct);
    const id = randomUUID();
    await a.exec(begin(BUYER) + createSQL(id, event));
    const pending = launch(b, begin(BUYER) + createSQL(id, event, ["Changed"]) + "commit;");
    await blockedBy(b, a);
    await a.exec("commit;");
    assert.deepEqual(await pending, { ok: false, sqlState: "22023" });
    assert.equal((await observer.exec(`select quantity from public.orders where id=${quote(id)};`)).trim(), "2");
  });
  await t.test("first creation rollback releases the gap lock and second submission commits", async (ct) => {
    const [a, b] = await peers(ct);
    const id = randomUUID();
    await a.exec(begin(BUYER) + createSQL(id, event));
    const pending = launch(b, begin(BUYER) + createSQL(id, event) + "commit;");
    await blockedBy(b, a);
    await a.exec("rollback;");
    assert.equal((await pending).ok, true);
    assert.equal((await state(id)).status, "pending");
  });
  await t.test("two approvals block on parent and return identical result with exactly N tickets", async (ct) => {
    const [a, b] = await peers(ct);
    const id = await createCommitted();
    const first = parse(await a.exec(begin(ADMIN) + approveSQL(id)));
    const pending = launch(b, begin(ADMIN) + approveSQL(id) + "commit;");
    await blockedBy(b, a);
    await a.exec("commit;");
    const second = await pending;
    assert.equal(second.ok, true);
    assert.deepEqual(parse(second.output), first);
    assert.deepEqual(await state(id), { status: "confirmed", noticed: false, confirmed: true, tickets: 2, unique_tokens: 2 });
  });
  await t.test("rolled-back first approval leaves second free to issue exactly N tickets", async (ct) => {
    const [a, b] = await peers(ct);
    const id = await createCommitted();
    await a.exec(begin(ADMIN) + approveSQL(id));
    const pending = launch(b, begin(ADMIN) + approveSQL(id) + "commit;");
    await blockedBy(b, a);
    await a.exec("rollback;");
    assert.equal((await pending).ok, true);
    assert.deepEqual(await state(id), { status: "confirmed", noticed: false, confirmed: true, tickets: 2, unique_tokens: 2 });
  });
  await t.test("own payment notice and approval serialize without losing notice or issuing twice", async (ct) => {
    const [a, b] = await peers(ct);
    const id = await createCommitted();
    await a.exec(begin(BUYER) + reportSQL(id));
    const pending = launch(b, begin(ADMIN) + approveSQL(id) + "commit;");
    await blockedBy(b, a);
    await a.exec("commit;");
    assert.equal((await pending).ok, true);
    assert.deepEqual(await state(id), { status: "confirmed", noticed: true, confirmed: true, tickets: 2, unique_tokens: 2 });
  });
  for (const [decision, status] of [["cancel", "cancelled"], ["reject", "rejected"]]) {
  await t.test(`approval wins against ${decision} RPC; paid order cannot close`, async (ct) => {
    const [a, b] = await peers(ct);
    const id = await createCommitted();
    await a.exec(begin(ADMIN) + approveSQL(id));
    const pending = launch(b, begin(ADMIN) + closeSQL(id, decision) + "commit;");
    await blockedBy(b, a);
    await a.exec("commit;");
    assert.deepEqual(await pending, { ok: false, sqlState: "22023" });
    assert.equal((await state(id)).tickets, 2);
  });
  await t.test(`${decision} RPC wins; waiting approval cannot reopen or issue`, async (ct) => {
    const [a, b] = await peers(ct);
    const id = await createCommitted();
    await a.exec(begin(ADMIN) + closeSQL(id, decision));
    const pending = launch(b, begin(ADMIN) + approveSQL(id) + "commit;");
    await blockedBy(b, a);
    await a.exec("commit;");
    assert.deepEqual(await pending, { ok: false, sqlState: "22023" });
    assert.deepEqual(await state(id), { status, noticed: false, confirmed: false, tickets: 0, unique_tokens: 0 });
  });
  await t.test(`concurrent ${decision} retries preserve the first receipt and audit fields`, async ct => {
    const [a, b] = await peers(ct);
    const id = await createCommitted();
    const first = parse(await a.exec(begin(ADMIN) + closeSQL(id, decision)));
    const pending = launch(b, begin(ADMIN) + closeSQL(id, decision) + "commit;");
    await blockedBy(b, a); await a.exec("commit;");
    const second = await pending;
    assert.equal(second.ok, true); assert.deepEqual(parse(second.output), first);
    assert.deepEqual(await state(id), { status, noticed: false, confirmed: false, tickets: 0, unique_tokens: 0 });
  });
  await t.test(`${decision} rollback releases approval without losing or partially closing the order`, async ct => {
    const [a, b] = await peers(ct);
    const id = await createCommitted();
    await a.exec(begin(ADMIN) + closeSQL(id, decision));
    const pending = launch(b, begin(ADMIN) + approveSQL(id) + "commit;");
    await blockedBy(b, a); await a.exec("rollback;");
    assert.equal((await pending).ok, true);
    assert.deepEqual(await state(id), { status: "confirmed", noticed: false, confirmed: true, tickets: 2, unique_tokens: 2 });
  });
  await t.test(`${decision} cannot be overwritten by the competing opposite decision`, async ct => {
    const [a, b] = await peers(ct);
    const id = await createCommitted();
    await a.exec(begin(ADMIN) + closeSQL(id, decision));
    const pending = launch(b, begin(ADMIN) + closeSQL(id, decision === "cancel" ? "reject" : "cancel") + "commit;");
    await blockedBy(b, a); await a.exec("commit;");
    assert.deepEqual(await pending, { ok: false, sqlState: "22023" });
    assert.equal((await state(id)).status, status);
  });
  }
  await t.test("staff role maintenance waits for actor lock; next lookup is user with buyer features", async (ct) => {
    const [a, b] = await peers(ct);
    await a.exec(begin(STAFF) + createSQL(randomUUID(), event));
    const pending = launch(b, `begin; update public.user_roles set role='user'
      where clerk_user_id=${quote(STAFF)}; commit;`);
    await blockedBy(b, a);
    await a.exec("commit;");
    assert.equal((await pending).ok, true);
    const next = await a.exec(begin(STAFF) + "select public.get_current_app_role();" + createSQL(randomUUID(), event) + "commit;");
    assert.equal(next.split("\n")[0], "user");
  });
  await t.test("PG17 retry preserves used/annulled ticket identities and tokens", async (ct) => {
    const [a] = await peers(ct);
    const id = await createCommitted();
    const first = parse(await a.exec(begin(ADMIN) + approveSQL(id) + "commit;"));
    await observer.exec(`update public.tickets set status='used',used_by=${quote(ADMIN)}
      where order_id=${quote(id)} and ticket_position=1;
      update public.tickets set status='revoked',revoked_by=${quote(ADMIN)}
      where order_id=${quote(id)} and ticket_position=2;`);
    const snapshot = `select json_agg(json_build_object('id',id,'token',qr_token,'status',status)
      order by ticket_position) from public.tickets where order_id=${quote(id)};`;
    const before = await observer.exec(snapshot);
    assert.deepEqual(parse(await a.exec(begin(ADMIN) + approveSQL(id) + "commit;")), first);
    assert.equal(await observer.exec(snapshot), before);
  });
  await t.test("actual PG17 failure on ticket2 rolls back all confirmation/issuance writes", async (ct) => {
    const [a] = await peers(ct);
    const id = await createCommitted();
    await observer.exec(`create function public.fixture_fail_second() returns trigger language plpgsql as $$
      begin if new.ticket_position=2 then raise exception 'Synthetic failure'; end if; return new; end $$;
      create trigger fixture_fail_second before insert on public.tickets
        for each row execute function public.fixture_fail_second();`);
    assert.deepEqual(await launch(a, begin(ADMIN) + approveSQL(id) + "commit;"), { ok: false, sqlState: "P0001" });
    assert.deepEqual(await state(id), { status: "pending", noticed: false, confirmed: false, tickets: 0, unique_tokens: 0 });
    await observer.exec("drop trigger fixture_fail_second on public.tickets; drop function public.fixture_fail_second();");
  });
  await t.test("concurrent grants share one target row and preserve the first role receipt", async ct => {
    const [a, b] = await peers(ct), subject = "user_race_staff_grant";
    const first = parse(await a.exec(begin(ADMIN) + jsonQuery(`select * from public.grant_door_staff(${quote(subject)},null)`)));
    const pending = launch(b, begin(ADMIN) + jsonQuery(`select * from public.grant_door_staff(${quote(subject)},null)`) + "commit;");
    await blockedBy(b, a); await a.exec("commit;");
    const second = await pending; assert.equal(second.ok, true); assert.deepEqual(parse(second.output), first);
    assert.equal(await observer.exec(`select count(*) from public.user_roles where clerk_user_id=${quote(subject)} and role='door_staff';`), "1");
  });
  await t.test("staff revocation waits for the target actor lock; next door read fails, own purchase survives", async ct => {
    const [a, b, c] = await peers(ct, 3), subject = "user_race_staff_revoke";
    const granted = parse(await b.exec(begin(ADMIN) + jsonQuery(`select * from public.grant_door_staff(${quote(subject)},null)`) + "commit;"));
    await a.exec(begin(subject) + createSQL(randomUUID(), event));
    const pending = launch(b, begin(ADMIN) + jsonQuery(`select * from public.revoke_door_staff(${quote(granted.staff_id)},${quote(granted.version)}::timestamptz)`) + "commit;");
    await blockedBy(b, a); await a.exec("commit;");
    const removed = await pending; assert.equal(removed.ok, true); assert.equal(parse(removed.output).app_role, "user");
    assert.deepEqual(await launch(a, begin(subject) + `select * from public.get_event_counters(${quote(event)});commit;`), { ok: false, sqlState: "42501" });
    const buyer = parse(await c.exec(begin(subject) + createSQL(randomUUID(), event) + "commit;"));
    assert.equal(buyer.order_status, "pending");
  });
  await t.test("stale role versions cannot replay an old grant after removal or an old removal after regrant", async ct => {
    const [a, b, c] = await peers(ct, 3), subject = "user_race_staff_stale";
    const first = parse(await a.exec(begin(ADMIN) + jsonQuery(`select * from public.grant_door_staff(${quote(subject)},null)`) + "commit;"));
    const removed = parse(await b.exec(begin(ADMIN) + jsonQuery(`select * from public.revoke_door_staff(${quote(first.staff_id)},${quote(first.version)}::timestamptz)`) + "commit;"));
    assert.deepEqual(await launch(a, begin(ADMIN) + `select * from public.grant_door_staff(${quote(subject)},null);commit;`), { ok: false, sqlState: "22023" });
    await c.exec(begin(ADMIN) + jsonQuery(`select * from public.grant_door_staff(${quote(subject)},${quote(removed.version)}::timestamptz)`) + "commit;");
    assert.deepEqual(await launch(b, begin(ADMIN) + `select * from public.revoke_door_staff(${quote(first.staff_id)},${quote(first.version)}::timestamptz);commit;`), { ok: false, sqlState: "22023" });
    assert.equal(await observer.exec(`select role from public.user_roles where clerk_user_id=${quote(subject)};`), "door_staff");
  });
  await t.test("capacity serializes competing approvals and requests at the final place", async ct => {
    await observer.exec(await readFile(new URL("../drafts/event-ticket-capacity.sql", import.meta.url), "utf8"));
    const count = Number(await observer.exec(`select count(*) from public.tickets where event_id=${quote(scanEvent)} and status in ('valid','used');`));
    assert.ok(count < 130);
    const first = randomUUID(), second = randomUUID(), seed = randomUUID();
    await observer.exec(begin(BUYER) + createSQL(first, scanEvent, ["Last one"]) + createSQL(second, scanEvent, ["Competing one"]) +
      createSQL(seed, scanEvent, Array.from({ length: 130 - count }, (_, i) => `Synthetic ${i}`)) + "commit;");
    await observer.exec(begin(ADMIN) + approveSQL(seed) + "commit;");
    const [a,b,c] = await peers(ct, 3);
    await a.exec(begin(ADMIN) + approveSQL(first));
    const approval = launch(b, begin(ADMIN) + approveSQL(second) + "commit;");
    const request = launch(c, begin(BUYER) + createSQL(randomUUID(), scanEvent, ["Too late"]) + "commit;");
    await blockedBy(b,a); await blockedBy(c,a); await a.exec("commit;");
    assert.deepEqual(await approval, { ok: false, sqlState: "22023" });
    assert.deepEqual(await request, { ok: false, sqlState: "22023" });
    assert.equal((await state(second)).status, "pending");
    assert.equal(await observer.exec(`select count(*) from public.tickets where event_id=${quote(scanEvent)} and status in ('valid','used');`), "131");
  });
  await t.test("manual vs QR and manual vs manual share scanner locks, with one admission and one audit", async ct => {
    await observer.exec(await readFile(new URL("../migrations/20261023173307_admin_extra_ticket_issuance.sql", import.meta.url), "utf8"));
    await observer.exec(await readFile(new URL("../drafts/admin-manual-access.sql", import.meta.url), "utf8"));
    const [a,b] = await peers(ct);
    for (const competitor of ["qr", "manual"]) {
      const issued = parse(await observer.exec(begin(ADMIN) + jsonQuery(`select * from public.issue_extra_tickets(${quote(randomUUID())},array['Synthetic Race'])`) + "commit;"));
      const id = issued.ticket_id;
      const token = await observer.exec(`select qr_token from public.tickets where id=${quote(id)};`);
      const manual = jsonQuery(`select * from public.manual_check_in_ticket(${quote(scanEvent)},${quote(id)})`);
      const first = parse(await a.exec(begin(ADMIN) + manual));
      assert.equal(first.outcome, "admitted");
      const secondCall = competitor === "qr" ? jsonQuery(`select * from public.check_in_ticket(${quote(scanEvent)},${quote(token)})`) : manual;
      const pending = launch(b, begin(ADMIN) + secondCall + "commit;");
      await blockedBy(b,a); await a.exec("commit;");
      const second = await pending; assert.equal(second.ok, true); assert.equal(parse(second.output).outcome, "already_used");
      assert.equal(await observer.exec(`select count(*) from diwo_private.manual_admissions where ticket_id=${quote(id)};`), "1");
    }
  });
});
