// MANUAL preparation for two explicitly fictional requests in the EXISTING test event.
// Creates/replays only these fixed requests. Never approve/report/close, change sales,
// read credentials or print subjects/QR. No automatic write retry on any failure.
(async () => {
  const eventId = "9d560641-aacf-4d25-8d65-94960bba59b2";
  const fixtures = [
    { decision: "cancel", status: "cancelled", payload: {
      requestId: "cb67be71-6b85-4c80-b234-70a920ba41e8", eventId,
      buyerName: "PRUEBA CIERRE - CANCELAR", attendeeNames: ["Asistente ficticio cierre - Cancelar"],
    } },
    { decision: "reject", status: "rejected", payload: {
      requestId: "5856888b-18ee-4fb6-8e4f-ba6222e993ab", eventId,
      buyerName: "PRUEBA CIERRE - RECHAZAR", attendeeNames: ["Asistente ficticio cierre - Rechazar"],
    } },
  ];
  const assert = (value, code) => { if (!value) throw new Error(code); };
  const actor = () => window.Clerk?.user?.id;
  const allowed = ["authentication_required", "operation_not_authorized", "sales_not_open", "request_id_conflict",
    "invalid_request_body", "order_operation_failed", "supabase_session_verification_failed", "supabase_configuration_required"];
  const call = async (path, body) => {
    const response = await fetch(path, {
      method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store", redirect: "error",
      signal: AbortSignal.timeout(20000),
      ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`HTTP_${response.status}_${allowed.includes(data?.error) ? data.error : "unexpected_response"}`);
    assert(response.headers.get("cache-control")?.includes("no-store"), "missing_no_store");
    return data;
  };
  if (window.__diwoClosureTestRunning) {
    console.log("DIWO_CLOSURE_TEST_STOPPED", { reason: "test_already_running" }); return;
  }
  window.__diwoClosureTestRunning = true;
  const summary = [];
  try {
    assert(location.origin === "http://localhost:3000", "use_localhost_3000");
    const actorId = actor();
    assert(typeof actorId === "string" && /^user_[A-Za-z0-9_-]+$/.test(actorId), "loaded_clerk_account_required");
    const session = await call("/api/supabase-session");
    assert(session.authenticated && session.supabaseConnected && session.appRole === "admin", "signed_admin_required");
    assert(actor() === actorId, "account_changed");
    // sessionStorage is scoped to this tab; bind the exact pair to account/event too.
    const key = `diwo:closure-test:v1:${actorId}:${eventId}`;
    const serialized = JSON.stringify({ version: 1, fixtures });
    const previous = sessionStorage.getItem(key);
    assert(previous === null || previous === serialized, "saved_test_payload_mismatch");
    sessionStorage.setItem(key, serialized);
    assert(sessionStorage.getItem(key) === serialized, "test_storage_unavailable");
    for (const fixture of fixtures) {
      assert(actor() === actorId, "account_changed");
      assert(sessionStorage.getItem(key) === serialized, "saved_test_payload_mismatch");
      const row = (await call("/api/orders/request", fixture.payload)).order;
      assert(row?.id === fixture.payload.requestId && row.quantity === 1 && row.totalCents === 500 &&
        /^DIWO-[A-F0-9]{12}$/.test(row.reference) && ["pending", fixture.status].includes(row.status), "request_result_mismatch");
      summary.push({ label: fixture.payload.buyerName, id: row.id, status: row.status, reference: row.reference, quantity: 1, totalCents: 500 });
    }
    console.log(summary.every(row => row.status !== "pending") ? "DIWO_CLOSURE_TEST_ALREADY_CLOSED" : "DIWO_CLOSURE_TEST_READY", {
      requests: summary,
      next: "Stop here. Verify both exact requests and zero tickets read-only before using /admin/requests. No Bizum or approval.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    console.log("DIWO_CLOSURE_TEST_STOPPED", {
      reason: /^[A-Za-z0-9_]+$/.test(message) && message.length < 120 ? message : "network_or_storage_or_unexpected_failure",
      verifiedRequestCount: summary.length,
      next: "Keep the same script, tab, account, UUIDs and saved payload. Report this code and read current state; do not auto-retry or create replacements.",
    });
  } finally { window.__diwoClosureTestRunning = false; }
})();
