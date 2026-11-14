import type { AppAccess } from "./app-authorization-core";

type Dependencies = {
  origin: string | null;
  authenticate(): Promise<{ userId: string | null; reverified: boolean }>;
  access(): Promise<AppAccess>;
  reverificationRequired(): Response;
  deleteUser(userId: string): Promise<unknown>;
};

const reply = (error: string, status: number) => Response.json({ error }, {
  status, headers: { "Cache-Control": "private, no-store" },
});

/** Deletes only the authenticated Clerk identity; paid history is never mutated. */
export async function handleAccountDeletion(request: Request, dependencies: Dependencies): Promise<Response> {
  try {
    if (request.method !== "DELETE") return reply("method_not_allowed", 405);
    const { origin } = dependencies;
    if (!origin || new URL(request.url).origin !== origin || request.headers.get("origin") !== origin ||
      request.headers.get("sec-fetch-site") === "cross-site") return reply("request_origin_not_allowed", 403);
    // No client-selected identity or role, including in the body/query string.
    if (new URL(request.url).search ||
      request.headers.get("x-diwo-confirm-deletion") !== "delete-my-account") return reply("invalid_deletion_request", 400);
    // Next's HTTP adapter can supply a non-null stream even for a bodyless DELETE.
    // Reject actual bytes, not the existence of the stream, without buffering it.
    if (request.body) {
      const reader = request.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value.byteLength > 0) {
            await reader.cancel();
            return reply("invalid_deletion_request", 400);
          }
        }
      } finally { reader.releaseLock(); }
    }
    const session = await dependencies.authenticate();
    if (!session.userId) return reply("authentication_required", 401);
    const access = await dependencies.access();
    if (!access.ok) return reply(access.reason, access.status);
    if (access.role !== "user") return reply("operation_not_authorized", 403);
    if (!session.reverified) return dependencies.reverificationRequired();
    await dependencies.deleteUser(session.userId);
    return Response.json({ deleted: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    // Upstream errors can contain personal data. Never expose them or retry a write.
    return reply("account_deletion_unconfirmed", 502);
  }
}
