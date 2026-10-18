// MANUAL, signed localhost console ONLY. Pinned diwo-scanner-test, never App Diwo.
// First run copies owner SQL for the EMPTY sandbox. Paste it ONLY in that project's
// SQL Editor. Second run consumes two fictional tickets through the real scan RPC.
// No app configuration changes, secret keys, new grants, resets or automatic retries.
// Capture the DevTools utility synchronously: it is not a window global and may
// no longer be in scope after the first await resumes outside Console evaluation.
(async (copySql) => {
  const projectRef = "ofqywrjvzolmoqimkngt";
  const base = "https://ofqywrjvzolmoqimkngt.supabase.co/rest/v1/rpc/";
  const eventId = "a6170000-0000-4000-8000-000000000001";
  const ticketId = position => `a6170000-0000-4000-8000-00000000001${position}`;
  // PUBLICLY KNOWN FICTIONAL TOKENS. Valid only in the isolated test fixture.
  const fixtureToken = position => String(position).repeat(64);
  const assert = (ok, reason) => { if (!ok) throw new Error(reason); };
  const safe = new Set(["use_localhost_3000", "loaded_session_required", "publishable_key_required",
    "account_or_session_changed", "session_token_unavailable", "sandbox_rpc_failed", "sandbox_role_unexpected",
    "console_copy_required", "fixture_not_fresh_do_not_reset", "unexpected_scan_result", "counter_mismatch",
    "concurrent_scan_failed_do_not_retry"]);
  if (window.__diwoScannerSandboxTestRunning) {
    console.log("DIWO_SCANNER_SANDBOX_STOPPED", { reason: "test_already_running" }); return;
  }
  window.__diwoScannerSandboxTestRunning = true;
  let writesAttempted = false;
  try {
    assert(location.origin === "http://localhost:3000", "use_localhost_3000");
    const clerk = window.Clerk, actor = clerk?.user?.id, session = clerk?.session;
    assert(typeof actor === "string" && /^user_[A-Za-z0-9_-]+$/.test(actor) &&
      typeof session?.id === "string" && typeof session?.getToken === "function", "loaded_session_required");
    const sessionId = session.id;
    const unchanged = () => window.Clerk === clerk && clerk.user?.id === actor && clerk.session?.id === sessionId;
    const key = window.prompt("Solo diwo-scanner-test: Publishable key sb_publishable_. Nunca Secret key, service_role ni JWT.");
    assert(typeof key === "string" && /^sb_publishable_[A-Za-z0-9_-]{10,240}$/.test(key), "publishable_key_required");
    async function rpc(name, body = {}, write = false) {
      assert(unchanged(), "account_or_session_changed");
      const token = await session.getToken();
      assert(unchanged(), "account_or_session_changed");
      assert(typeof token === "string" && token.length > 0, "session_token_unavailable");
      if (write) writesAttempted = true;
      const response = await fetch(base + name, {
        method: "POST", credentials: "omit", cache: "no-store", redirect: "error", mode: "cors", referrerPolicy: "no-referrer",
        headers: { apikey: key, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body), signal: AbortSignal.timeout(20000),
      });
      assert(unchanged(), "account_or_session_changed");
      assert(response.ok, "sandbox_rpc_failed");
      const data = await response.json();
      assert(unchanged(), "account_or_session_changed");
      return data;
    }
    const role = await rpc("get_current_app_role");
    if (role === "user") {
      // copy() is a Chrome DevTools Console utility, not clipboard permission or storage.
      assert(typeof copySql === "function", "console_copy_required");
      const sql = `-- ONLY diwo-scanner-test / ofqywrjvzolmoqimkngt. Run COMPLETE as postgres.
-- Fictional retained fixture. No real payment or actual-party publication.
begin;
do $$
begin
  if current_user <> 'postgres' or coalesce(current_setting('role',true),'none') not in ('none','postgres') then
    raise exception 'postgres_owner_required';
  end if;
  if obj_description(to_regnamespace('diwo_private'),'pg_namespace') is distinct from
    'DIWO_SCANNER_TEST_ONLY_V1 - isolated empty scanner project' then
    raise exception 'wrong_target_missing_sandbox_marker';
  end if;
  lock table public.user_roles,public.events,public.orders,public.tickets in access exclusive mode;
  if exists(select 1 from public.user_roles) or exists(select 1 from public.events)
    or exists(select 1 from public.orders) or exists(select 1 from public.tickets) then
    raise exception 'sandbox_not_empty_do_not_reset_or_repeat';
  end if;
end $$;
select set_config('request.jwt.claims','{}',true);
insert into public.user_roles(clerk_user_id,role) values('${actor}','admin');
insert into public.events(id,slug,title,public_location,sales_open_at,starts_at,ends_at,arrival_from,arrival_until,is_published)
values('${eventId}','diwo-x-2-2026','SCANNER TEST ONLY - NOT VALID FOR DIWO','Fictional test location',
  '2020-01-01Z','2020-01-02 23:30Z','2020-01-03 07:00Z','2020-01-02 23:30Z','2020-01-03 01:30Z',true);
insert into public.orders(id,event_id,buyer_clerk_id,buyer_name,attendee_names,reference)
values('a6170000-0000-4000-8000-000000000002','${eventId}','${actor}',
  'SCANNER TEST BUYER',array['TEST VALID','TEST REVOKED','TEST CONCURRENT'],'SCANNER-TEST-20261017');
update public.orders set status='confirmed',confirmed_by='${actor}'
where id='a6170000-0000-4000-8000-000000000002';
insert into public.tickets(id,order_id,event_id,ticket_position,attendee_name,qr_token) values
('${ticketId(1)}','a6170000-0000-4000-8000-000000000002','${eventId}',1,'TEST VALID','${fixtureToken(1)}'),
('${ticketId(2)}','a6170000-0000-4000-8000-000000000002','${eventId}',2,'TEST REVOKED','${fixtureToken(2)}'),
('${ticketId(3)}','a6170000-0000-4000-8000-000000000002','${eventId}',3,'TEST CONCURRENT','${fixtureToken(3)}');
update public.tickets set status='revoked',revoked_by='${actor}',revoked_reason='ISOLATED SCANNER TEST'
where id='${ticketId(2)}';
set constraints all immediate;
commit;
select 'DIWO_SCANNER_FIXTURE_READY' as result;
`;
      assert(unchanged(), "account_or_session_changed");
      copySql(sql);
      console.log("DIWO_SCANNER_SETUP_SQL_COPIED", { projectRef, writesAttempted: false,
        next: "Paste ONLY into diwo-scanner-test SQL Editor as postgres. Run COMPLETE once. Then rerun this browser script." });
      return;
    }
    assert(role === "admin", "sandbox_role_unexpected");
    function counters(data, used, pending) {
      assert(Array.isArray(data) && data.length === 1 && data[0].event_id === eventId &&
        data[0].event_title === "SCANNER TEST ONLY - NOT VALID FOR DIWO" &&
        data[0].used_admissions === used && data[0].pending_admissions === pending &&
        data[0].issued_non_revoked === 2, "counter_mismatch");
    }
    const before = await rpc("read_door_event");
    assert(Array.isArray(before) && before.length === 1 && before[0].event_id === eventId &&
      before[0].used_admissions === 0 && before[0].pending_admissions === 2, "fixture_not_fresh_do_not_reset");
    counters(before, 0, 2);
    const scan = position => rpc("check_in_ticket", { target_event: eventId, scanned_token: fixtureToken(position) }, true);
    function result(data, position, outcome) {
      assert(Array.isArray(data) && data.length === 1 && data[0].outcome === outcome &&
        data[0].ticket_id === ticketId(position) &&
        data[0].attendee_name === ["TEST VALID", "TEST REVOKED", "TEST CONCURRENT"][position - 1] &&
        (outcome === "revoked" ? data[0].used_at === null :
          typeof data[0].used_at === "string" && Number.isFinite(Date.parse(data[0].used_at))), "unexpected_scan_result");
      return data[0];
    }
    const first = result(await scan(1), 1, "admitted");
    const repeated = result(await scan(1), 1, "already_used");
    assert(first.used_at === repeated.used_at, "unexpected_scan_result");
    result(await scan(2), 2, "revoked");
    // Two independent HTTP requests; all settle before releasing the singleflight lock.
    const race = await Promise.allSettled([scan(3), scan(3)]);
    assert(race.every(item => item.status === "fulfilled"), "concurrent_scan_failed_do_not_retry");
    const rows = race.map(item => item.value);
    assert(rows.every(data => Array.isArray(data) && data.length === 1) &&
      rows.map(data => data[0].outcome).sort().join(",") === "admitted,already_used", "unexpected_scan_result");
    const admitted = rows.find(data => data[0].outcome === "admitted");
    const denied = rows.find(data => data[0].outcome === "already_used");
    assert(result(admitted, 3, "admitted").used_at === result(denied, 3, "already_used").used_at, "unexpected_scan_result");
    counters(await rpc("read_door_event"), 2, 0);
    console.log("DIWO_SCANNER_SANDBOX_PASS", { projectRef, checks: ["valid_admitted", "repeat_denied",
      "revoked_denied", "concurrent_single_admission", "final_counters"], used: 2, pending: 0, total: 2 });
  } catch (error) {
    console.log("DIWO_SCANNER_SANDBOX_STOPPED", { projectRef, writesAttempted,
      reason: error instanceof Error && safe.has(error.message) ? error.message : "unconfirmed_do_not_retry" });
  } finally { window.__diwoScannerSandboxTestRunning = false; }
})(typeof copy === "function" ? copy : null);
