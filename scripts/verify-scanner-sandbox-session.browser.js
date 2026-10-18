// MANUAL read-only check in the signed-in http://localhost:3000 browser console.
// Pinned NEW sandbox only. Never edit app env or paste keys/tokens into chat.
// Uses native Clerk getToken(), no template, cookie access or owner fallback.
(async () => {
  const projectRef = "ofqywrjvzolmoqimkngt";
  const projectUrl = "https://ofqywrjvzolmoqimkngt.supabase.co";
  const safeReasons = new Set([
    "use_localhost_3000", "sandbox_target_mismatch", "test_already_running",
    "loaded_clerk_session_required", "publishable_key_cancelled", "publishable_key_required",
    "account_or_session_changed", "session_token_unavailable", "HTTP_401_authentication_failed",
    "HTTP_403_access_denied", "HTTP_404_rpc_unavailable", "unexpected_http_status",
    "sandbox_role_not_user", "network_or_unexpected_failure",
  ]);
  const report = reason => console.log("DIWO_SCANNER_SANDBOX_AUTH_STOPPED", { projectRef, reason, writes: false });
  const assert = (condition, reason) => { if (!condition) throw new Error(reason); };
  if (window.__diwoScannerSandboxVerifyRunning) { report("test_already_running"); return; }
  window.__diwoScannerSandboxVerifyRunning = true;
  try {
    assert(location.origin === "http://localhost:3000", "use_localhost_3000");
    assert(projectRef !== "dujltrbvytsnftlfitbd" && projectUrl === `https://${projectRef}.supabase.co`, "sandbox_target_mismatch");
    const clerk = window.Clerk, actor = clerk?.user?.id, session = clerk?.session;
    assert(typeof actor === "string" && /^user_[A-Za-z0-9_-]+$/.test(actor) &&
      typeof session?.id === "string" && session.id.length > 0 && typeof session.getToken === "function", "loaded_clerk_session_required");
    const sessionId = session.id;
    const unchanged = () => window.Clerk === clerk && clerk.user?.id === actor && clerk.session?.id === sessionId;
    // Public key stays in this invocation's memory only, never logs or storage.
    // Reject secret keys/legacy JWTs before requesting or sending a session token.
    const key = window.prompt(`Solo ensayo ${projectRef}: pega la Publishable key (sb_publishable_) del proyecto diwo-scanner-test. No pegues Secret key, service_role ni JWT.`);
    assert(key !== null, "publishable_key_cancelled");
    assert(typeof key === "string" && /^sb_publishable_[A-Za-z0-9_-]{10,240}$/.test(key), "publishable_key_required");
    assert(unchanged(), "account_or_session_changed");
    const token = await session.getToken();
    assert(typeof token === "string" && token.length > 0, "session_token_unavailable");
    assert(unchanged(), "account_or_session_changed");
    const response = await fetch(`${projectUrl}/rest/v1/rpc/get_current_app_role`, {
      method: "POST", credentials: "omit", cache: "no-store", redirect: "error", mode: "cors", referrerPolicy: "no-referrer",
      headers: { apikey: key, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}", signal: AbortSignal.timeout(15000),
    });
    assert(unchanged(), "account_or_session_changed");
    if (!response.ok) {
      const reasons = { 401: "HTTP_401_authentication_failed", 403: "HTTP_403_access_denied", 404: "HTTP_404_rpc_unavailable" };
      throw new Error(reasons[response.status] ?? "unexpected_http_status");
    }
    const role = await response.json();
    assert(unchanged(), "account_or_session_changed");
    assert(role === "user", "sandbox_role_not_user");
    console.log("DIWO_SCANNER_SANDBOX_AUTH_PASS", {
      projectRef, sandboxRole: "user", writes: false,
      checks: ["native_clerk_session", "sandbox_rpc_authenticated", "default_role_without_bootstrap"],
    });
  } catch (error) {
    // Never print upstream exceptions, bodies, keys, JWTs, subjects or session IDs.
    const reason = error instanceof Error && safeReasons.has(error.message) ? error.message : "network_or_unexpected_failure";
    report(reason);
  } finally { window.__diwoScannerSandboxVerifyRunning = false; }
})();
