/** No role source is configured yet: deny independently of request metadata. */
export async function assertAdmin() {
  return { ok: false as const, status: 403, reason: "authorization_not_configured" };
}
