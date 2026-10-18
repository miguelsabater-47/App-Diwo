import "server-only";
import { hasConfiguredClerkKeys, configuredAppOrigin } from "@/lib/local-access";
import { createSessionSupabaseClient } from "@/lib/supabase-session";
import { readCurrentAppAccess } from "@/lib/app-authorization-core";
import { handleOrderMutation, type OrderOperation, type OrderSession } from "@/lib/order-mutation-core";

async function authorizeOrderSession(): Promise<OrderSession> {
  if (!hasConfiguredClerkKeys(process.env)) {
    return { ok: false, status: 503, reason: "local_configuration_required" };
  }
  // One request-scoped signed client for BOTH current-role lookup and mutation.
  const session = await createSessionSupabaseClient();
  const access = await readCurrentAppAccess(async () => session);
  if (!access.ok) return access;
  if (session.status !== "ready") {
    return { ok: false, status: 502, reason: "supabase_session_verification_failed" };
  }
  return { ok: true, role: access.role, client: session.client };
}

export function runOrderMutation(request: Request, operation: OrderOperation): Promise<Response> {
  return handleOrderMutation(request, operation, authorizeOrderSession, configuredAppOrigin(process.env));
}
