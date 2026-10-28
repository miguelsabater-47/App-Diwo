import { scanRecord, scanResult, scanUuid } from "./door-scan-model";
import type { AppRole } from "./app-authorization-core";

type Session = { ok: false; status: number } | { ok: true; role: AppRole; client: {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
} };
const reply = (data: unknown, status: number) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });

/** No token lookup in JavaScript. The DB wrapper delegates to the existing scanner. */
export async function handleManualAccess(request: Request, authorize: () => Promise<Session>, origin: string | null) {
  try {
    const url = new URL(request.url);
    if (request.method !== "POST") return reply({ error: "method_not_allowed" }, 405);
    if (!origin || url.origin !== origin || url.search || request.headers.get("origin") !== origin ||
        request.headers.get("sec-fetch-site") === "cross-site") return reply({ error: "operation_not_authorized" }, 403);
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "") ||
        ![null, "identity"].includes(request.headers.get("content-encoding"))) return reply({ error: "invalid_request" }, 415);
    const session = await authorize();
    if (!session.ok) return reply({ error: "operation_not_authorized" }, session.status);
    if (!["admin", "door_staff"].includes(session.role)) return reply({ error: "operation_not_authorized" }, 403);
    const reader = request.body?.getReader();
    if (!reader) return reply({ error: "invalid_request" }, 400);
    let bytes = 0, text = "";
    const decoder = new TextDecoder("utf-8", { fatal: true });
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 512) { await reader.cancel(); return reply({ error: "invalid_request" }, 413); }
        text += decoder.decode(part.value, { stream: true });
      }
      text += decoder.decode();
    } finally { reader.releaseLock(); }
    let body: unknown;
    try { body = JSON.parse(text); } catch { return reply({ error: "invalid_request" }, 400); }
    if (!scanRecord(body) || Object.keys(body).length !== 2 || !scanUuid(body.eventId) || !scanUuid(body.ticketId)) return reply({ error: "invalid_request" }, 400);
    const { data, error } = await session.client.rpc("manual_check_in_ticket", {
      target_event: body.eventId.toLowerCase(), target_ticket: body.ticketId.toLowerCase(),
    });
    if (error) {
      const code = scanRecord(error) ? error.code : null;
      return reply({ error: code === "PGRST202" ? "manual_access_not_configured" : code === "42501" ? "operation_not_authorized" : "access_unconfirmed" }, code === "PGRST202" ? 503 : code === "42501" ? 403 : 502);
    }
    const row = Array.isArray(data) && data.length === 1 ? data[0] : null;
    const result = scanRecord(row) ? scanResult({ outcome: row.outcome, ticketId: row.ticket_id, name: row.attendee_name, usedAt: row.used_at }) : null;
    if (!result || (result.ticketId !== null && result.ticketId !== body.ticketId.toLowerCase())) return reply({ error: "access_unconfirmed" }, 502);
    return reply({ result }, 200);
  } catch { return reply({ error: "access_unconfirmed" }, 502); }
}
