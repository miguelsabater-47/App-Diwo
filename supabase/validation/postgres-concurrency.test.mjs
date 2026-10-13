import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

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
  await observer.exec(`insert into public.user_roles(clerk_user_id,role)
    values(${quote(ADMIN)},'admin'),(${quote(STAFF)},'door_staff');`);
  const event = randomUUID();
  await observer.exec(`insert into public.events(id,slug,title,public_location,sales_open_at,
    starts_at,ends_at,arrival_from,arrival_until,is_published) values(${quote(event)},
    'synthetic-race','Synthetic Event','Generic location','2020-01-01',
    '2099-01-02 23:00 UTC','2099-01-03 07:00 UTC',
    '2099-01-02 23:30 UTC','2099-01-03 01:30 UTC',true);`);
  const peers = async (ct) => {
    const a = await Peer.open();
    const b = await Peer.open();
    ct.after(async () => { await a.end(); await b.end(); });
    assert.notEqual(a.pid, b.pid);
    return [a, b];
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
  const createCommitted = async () => {
    const id = randomUUID();
    await observer.exec(begin(BUYER) + createSQL(id, event) + "commit;");
    return id;
  };
  const state = async (id) => parse(await observer.exec(jsonQuery(`select o.status,
    o.payment_reported_at is not null as noticed,o.confirmed_at is not null as confirmed,
    (select count(*)::int from public.tickets t where t.order_id=o.id) as tickets,
    (select count(distinct qr_token)::int from public.tickets t where t.order_id=o.id) as unique_tokens
    from public.orders o where o.id=${quote(id)}::uuid`)));

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
  // Cancellation writers are not implemented. The owner fixture invokes the
  // foundation guard directly to test the future writer's parent-lock contract.
  await t.test("approval wins against owner cancellation fixture; paid order cannot close", async (ct) => {
    const [a, b] = await peers(ct);
    const id = await createCommitted();
    await a.exec(begin(ADMIN) + approveSQL(id));
    const pending = launch(b, begin(ADMIN, true) + `update public.orders set status='cancelled',
      closed_by=${quote(ADMIN)} where id=${quote(id)}; commit;`);
    await blockedBy(b, a);
    await a.exec("commit;");
    assert.deepEqual(await pending, { ok: false, sqlState: "23514" });
    assert.equal((await state(id)).tickets, 2);
  });
  await t.test("owner cancellation fixture wins; waiting approval cannot reopen or issue", async (ct) => {
    const [a, b] = await peers(ct);
    const id = await createCommitted();
    await a.exec(begin(ADMIN, true) + `update public.orders set status='cancelled',
      closed_by=${quote(ADMIN)} where id=${quote(id)};`);
    const pending = launch(b, begin(ADMIN) + approveSQL(id) + "commit;");
    await blockedBy(b, a);
    await a.exec("commit;");
    assert.deepEqual(await pending, { ok: false, sqlState: "22023" });
    assert.deepEqual(await state(id), { status: "cancelled", noticed: false, confirmed: false, tickets: 0, unique_tokens: 0 });
  });
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
});
