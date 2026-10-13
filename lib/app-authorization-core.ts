export type AppRole = "user" | "door_staff" | "admin";

type AccessFailure = {
  ok: false;
  status: 401 | 403 | 502 | 503;
  reason: "authentication_required" | "local_configuration_required" |
    "supabase_configuration_required" | "supabase_session_verification_failed" |
    "operation_not_authorized";
};

export type AppAccess = { ok: true; role: AppRole } | AccessFailure;

type SessionForRoleLookup =
  | { status: "unauthenticated" | "configuration_required" }
  | {
    status: "ready";
    client: {
      rpc(name: "get_current_app_role"): PromiseLike<{ data: unknown; error: unknown }>;
    };
  };

/** Testable policy only. The server-only wrapper supplies the trusted session. */
export async function readCurrentAppAccess(
  createSession: () => Promise<SessionForRoleLookup>,
): Promise<AppAccess> {
  try {
    const session = await createSession();
    if (session.status === "unauthenticated") {
      return { ok: false, status: 401, reason: "authentication_required" };
    }
    if (session.status === "configuration_required") {
      return { ok: false, status: 503, reason: "supabase_configuration_required" };
    }
    if (session.status !== "ready") {
      return { ok: false, status: 502, reason: "supabase_session_verification_failed" };
    }

    const { data, error } = await session.client.rpc("get_current_app_role");
    if (error !== null || (data !== "user" && data !== "door_staff" && data !== "admin")) {
      return { ok: false, status: 502, reason: "supabase_session_verification_failed" };
    }
    return { ok: true, role: data };
  } catch {
    // Never return/log upstream errors, tokens, subjects or private configuration.
    return { ok: false, status: 502, reason: "supabase_session_verification_failed" };
  }
}

export function checkAllowedAppRole(access: AppAccess, allowedRoles: readonly AppRole[]): AppAccess {
  if (!access.ok) return access;
  if (!allowedRoles.includes(access.role)) {
    return { ok: false, status: 403, reason: "operation_not_authorized" };
  }
  return access;
}
