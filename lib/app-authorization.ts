import "server-only";
import { hasConfiguredClerkKeys } from "@/lib/local-access";
import { createSessionSupabaseClient } from "@/lib/supabase-session";
import { checkAllowedAppRole, readCurrentAppAccess, type AppAccess, type AppRole } from "@/lib/app-authorization-core";

/** Read the current DB role per call; never cache privileges across requests. */
export async function getCurrentAppAccess(): Promise<AppAccess> {
  if (!hasConfiguredClerkKeys(process.env)) {
    return { ok: false, status: 503, reason: "local_configuration_required" };
  }
  return readCurrentAppAccess(createSessionSupabaseClient);
}

/** Recheck before each sensitive operation; the DB must also enforce its actor. */
export async function requireAppRole(allowedRoles: readonly AppRole[]): Promise<AppAccess> {
  return checkAllowedAppRole(await getCurrentAppAccess(), allowedRoles);
}

export async function requireAdminAccess(): Promise<AppAccess> {
  return requireAppRole(["admin"]);
}

export async function requireDoorAccess(): Promise<AppAccess> {
  return requireAppRole(["admin", "door_staff"]);
}
