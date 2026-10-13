// Run manually in the signed-in localhost3000 browser console, after event setup.
// Fixed synthetic UUIDs preserve the ONE authorized logical order across reruns.
// This script neither reads nor prints tokens, cookies, subjects or QR credentials.
(async () => {
  const eventId = "9d560641-aacf-4d25-8d65-94960bba59b2";
  const requestId = "0efaab8d-b894-4df3-a00a-4255a302d9ba";
  const completed = [];
  const assert = (condition, code) => { if (!condition) throw new Error(code); };
  const send = async (path, body, expectedStatus = 200) => {
    const response = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin", cache: "no-store", redirect: "error",
      ...(body === undefined ? {} : {
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      }),
    });
    const data = await response.json();
    const allowedErrors = ["authentication_required", "operation_not_authorized", "sales_not_open",
      "request_id_conflict", "order_not_found", "order_not_pending", "order_operation_failed",
      "supabase_session_verification_failed", "local_configuration_required",
      "supabase_configuration_required", "request_origin_not_allowed", "invalid_request_body"];
    if (response.status !== expectedStatus) {
      const reason = allowedErrors.includes(data?.error) ? data.error : "unexpected_response";
      throw new Error(`HTTP_${response.status}_${reason}`);
    }
    assert(response.headers.get("cache-control")?.includes("no-store"), "response_cache_not_private");
    return data;
  };
  try {
    assert(location.origin === "http://localhost:3000", "use_localhost_3000");
    const session = await send("/api/supabase-session");
    assert(session.authenticated && session.supabaseConnected && session.appRole === "admin", "signed_admin_required");
    completed.push("signed_admin_session");

    // Preserve this fixture's already-stored buyer spelling from its PS5 ANSI copy.
    // ASCII escapes make replay encoding-independent; the immutable order is retained.
    const payload = { requestId, eventId, buyerName: "Comprador PRUEBA T\u00c3\u2030CNICA",
      attendeeNames: ["Asistente ficticio PRUEBA 1", "Asistente ficticio PRUEBA 2"] };
    const first = (await send("/api/orders/request", payload)).order;
    assert(first?.id === requestId && first.quantity === 2 && first.totalCents === 1000 &&
      ["pending", "confirmed"].includes(first.status), "request_result_mismatch");
    const repeat = (await send("/api/orders/request", payload)).order;
    assert(repeat?.id === first.id && repeat.reference === first.reference &&
      repeat.quantity === first.quantity && repeat.totalCents === first.totalCents, "request_retry_mismatch");
    completed.push("request_and_same_payload_retry");

    const conflict = await send("/api/orders/request", {
      ...payload, attendeeNames: ["Asistente ficticio PRUEBA 1", "Contenido distinto PRUEBA"],
    }, 409);
    assert(conflict.error === "request_id_conflict", "changed_payload_not_rejected");
    completed.push("changed_payload_rejected");

    const notice = (await send("/api/orders/report-payment", { orderId: requestId })).order;
    const noticeRepeat = (await send("/api/orders/report-payment", { orderId: requestId })).order;
    assert(notice?.id === requestId && typeof notice.paymentReportedAt === "string" &&
      ["pending", "confirmed"].includes(notice.status), "payment_notice_mismatch");
    assert(noticeRepeat?.id === requestId && noticeRepeat.paymentReportedAt === notice.paymentReportedAt &&
      noticeRepeat.status === notice.status, "payment_notice_retry_mismatch");
    if (first.status === "pending") assert(notice.status === "pending", "notice_must_not_approve");
    completed.push("payment_notice_and_stable_retry");

    const approved = (await send("/api/orders/approve-payment", { orderId: requestId })).order;
    const approvedRepeat = (await send("/api/orders/approve-payment", { orderId: requestId })).order;
    assert(approved?.id === requestId && approved.status === "confirmed" &&
      approved.issuedTicketCount === 2 && typeof approved.confirmedAt === "string", "approval_mismatch");
    assert(approvedRepeat?.id === requestId && approvedRepeat.status === "confirmed" &&
      approvedRepeat.issuedTicketCount === 2 && approvedRepeat.confirmedAt === approved.confirmedAt, "approval_retry_mismatch");
    completed.push("approval_and_stable_retry");

    const after = (await send("/api/orders/request", payload)).order;
    assert(after?.id === requestId && after.reference === first.reference &&
      after.status === "confirmed" && after.quantity === 2 && after.totalCents === 1000, "final_request_retry_mismatch");
    completed.push("confirmed_request_retry");
    console.log("DIWO_TECHNICAL_TEST_PASS", {
      checks: completed, orderStatus: "confirmed", ticketQuantity: 2, totalCents: 1000,
      issuedTicketCount: 2, startedPending: first.status === "pending",
    });
  } catch (error) {
    // Emit only our bounded safe codes. Network errors can contain private URLs.
    const message = error instanceof Error ? error.message : "";
    const safe = /^[A-Za-z0-9_]+$/.test(message) && message.length < 120 ? message : "network_or_unexpected_failure";
    console.log("DIWO_TECHNICAL_TEST_STOPPED", { completed, reason: safe,
      next: "Keep the same script/UUID; report this safe code before continuing." });
  }
})();
