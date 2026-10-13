// Authorized SECOND synthetic order: creation only, approval must use the UI.
// Fixed UUID/payload across reruns; no tokens, cookies, subjects or QR are printed.
(async () => {
  const orderId = "57c58ec8-9537-4c5c-a573-5e2b8350f9c9";
  const payload = {
    requestId: orderId, eventId: "9d560641-aacf-4d25-8d65-94960bba59b2",
    buyerName: "Comprador PRUEBA UI 2",
    attendeeNames: ["Asistente ficticio UI 2 - Uno", "Asistente ficticio UI 2 - Dos"],
  };
  const assert = (value, code) => { if (!value) throw new Error(code); };
  const call = async (path, body) => {
    const response = await fetch(path, {
      method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store", redirect: "error",
      signal: AbortSignal.timeout(20000),
      ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    const allowed = ["authentication_required", "operation_not_authorized", "sales_not_open", "request_id_conflict",
      "invalid_request_body", "order_operation_failed", "supabase_session_verification_failed", "supabase_configuration_required"];
    if (!response.ok) throw new Error(`HTTP_${response.status}_${allowed.includes(data?.error) ? data.error : "unexpected_response"}`);
    assert(response.headers.get("cache-control")?.includes("no-store"), "missing_no_store");
    return data;
  };
  try {
    assert(location.origin === "http://localhost:3000", "use_localhost_3000");
    const session = await call("/api/supabase-session");
    assert(session.authenticated && session.supabaseConnected && session.appRole === "admin", "signed_admin_required");
    const first = (await call("/api/orders/request", payload)).order;
    assert(first?.id === orderId && first.quantity === 2 && first.totalCents === 1000 &&
      ["pending", "confirmed"].includes(first.status), "request_result_mismatch");
    const repeated = (await call("/api/orders/request", payload)).order;
    assert(repeated?.id === first.id && repeated.reference === first.reference && repeated.quantity === 2 &&
      repeated.totalCents === 1000 && repeated.status === first.status, "request_retry_mismatch");
    console.log(first.status === "pending" ? "DIWO_UI_APPROVAL_TEST_READY" : "DIWO_UI_TEST_ALREADY_CONFIRMED", {
      status: first.status, reference: first.reference, quantity: 2, totalCents: 1000,
      next: first.status === "pending" ? "Open /admin/requests and approve PRUEBA UI 2 using its technical checkbox." : "Do not generate another UUID; report the result.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    console.log("DIWO_UI_APPROVAL_TEST_STOPPED", {
      reason: /^[A-Za-z0-9_]+$/.test(message) && message.length < 120 ? message : "network_or_unexpected_failure",
      next: "Keep this same script/UUID and report the safe code before continuing.",
    });
  }
})();
