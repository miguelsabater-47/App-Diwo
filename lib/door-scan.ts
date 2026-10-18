import "server-only";
import { hasConfiguredClerkKeys, configuredAppOrigin } from "@/lib/local-access";
import { createSessionSupabaseClient } from "@/lib/supabase-session";
import { readCurrentAppAccess } from "@/lib/app-authorization-core";
import { handleDoorScan } from "@/lib/door-scan-core";

export function runDoorScan(request: Request) {
  return handleDoorScan(request, async () => {
    if (!hasConfiguredClerkKeys(process.env)) return { ok: false, status: 503, reason: "local_configuration_required" };
    const session = await createSessionSupabaseClient();
    const access = await readCurrentAppAccess(async () => session);
    if (!access.ok) return access;
    if (session.status !== "ready") return { ok: false, status: 502, reason: "supabase_session_verification_failed" };
    return { ok: true, role: access.role, client: session.client };
  }, configuredAppOrigin(process.env));
}
