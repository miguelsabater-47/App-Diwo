import type { AppRole } from "./app-authorization-core";
import { doorEvent, scanRecord, scanResult, scanToken, scanUuid } from "./door-scan-model";

type Session = { ok: false; status: number; reason: string } | { ok: true; role: AppRole; client: { rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> } };
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
class ScanFailure extends Error {
  constructor(readonly status: number, readonly reason: string) { super(reason); }
}
function fail(status: number, reason: string): never { throw new ScanFailure(status, reason); }
async function input(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) fail(400, "invalid_scan_request");
  const decoder = new TextDecoder("utf-8", { fatal: true }); let text = "", size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > 512) { await reader.cancel(); fail(413, "scan_request_too_large"); }
      text += decoder.decode(part.value, { stream: true });
    }
    const value: unknown = JSON.parse(text + decoder.decode());
    if (!scanRecord(value) || Object.keys(value).length !== 2 || !scanUuid(value.eventId) || !scanToken(value.token)) fail(400, "invalid_scan_request");
    return { eventId: value.eventId.toLowerCase(), token: value.token };
  } catch (error) { if (error instanceof ScanFailure) throw error; return fail(400, "invalid_scan_request"); }
  finally { reader.releaseLock(); }
}
export async function handleDoorScan(request: Request, authorize: () => Promise<Session>, allowedOrigin: string | null = "http://localhost:3000"): Promise<Response> {
  try {
    if (!["GET", "POST"].includes(request.method)) fail(405, "method_not_allowed");
    const url = new URL(request.url);
    if (!allowedOrigin || url.origin !== allowedOrigin || url.search || request.headers.get("sec-fetch-site") === "cross-site" ||
      (request.method === "POST" && request.headers.get("origin") !== allowedOrigin)) fail(403, "request_origin_not_allowed");
    if (request.method === "POST" && (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "") ||
      ![null, "identity"].includes(request.headers.get("content-encoding")))) fail(415, "json_request_required");
    const session = await authorize();
    if (!session.ok) return reply({ error: session.reason }, session.status);
    if (!["admin", "door_staff"].includes(session.role)) fail(403, "operation_not_authorized");
    const body = request.method === "POST" ? await input(request) : null;
    const { data, error } = await session.client.rpc(body ? "check_in_ticket" : "read_door_event", body ? { target_event: body.eventId, scanned_token: body.token } : undefined);
    if (error !== null) {
      if (scanRecord(error)) {
        if (error.code === "42501") fail(403, "operation_not_authorized");
        if (error.code === "PGRST202") fail(503, "scanner_configuration_required");
        if (error.code === "22023" && error.message === "door_event_unavailable") fail(409, "door_event_unavailable");
      }
      fail(502, "scan_operation_unconfirmed");
    }
    if (!Array.isArray(data) || data.length > 1) fail(502, "scan_operation_unconfirmed");
    if (body) {
      const row = data[0];
      const result = scanRecord(row) ? scanResult({ outcome: row.outcome, ticketId: row.ticket_id, name: row.attendee_name, usedAt: row.used_at }) : null;
      if (!result) fail(502, "scan_operation_unconfirmed");
      return reply({ result });
    }
    // Recheck after a read before releasing event information/counters.
    const role = await session.client.rpc("get_current_app_role");
    if (role.error !== null || !["admin", "door_staff"].includes(role.data as string)) fail(403, "operation_not_authorized");
    if (!data.length) return reply({ event: null });
    const row = data[0];
    const event = scanRecord(row) ? doorEvent({ id: row.event_id, title: row.event_title, used: row.used_admissions, pending: row.pending_admissions, total: row.issued_non_revoked }) : null;
    if (!event) fail(502, "scan_operation_unconfirmed");
    return reply({ event });
  } catch (error) {
    // QR bearer values and upstream exceptions must never be logged or returned.
    return error instanceof ScanFailure ? reply({ error: error.reason }, error.status) : reply({ error: "scan_operation_unconfirmed" }, 502);
  }
}
