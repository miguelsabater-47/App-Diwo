import type { AppAccess, AppRole } from "./app-authorization-core";

export type OrderOperation = "request" | "report-payment" | "approve-payment";
type RpcClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};
export type OrderSession = Exclude<AppAccess, { ok: true }> |
  { ok: true; role: AppRole; client: RpcClient };

const headers = { "Cache-Control": "private, no-store" };
const localOrigin = "http://localhost:3000";
const bodyLimit = 64 * 1024; // Transport limit, not a ticket quantity/capacity rule.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const states = ["pending", "confirmed", "rejected", "cancelled"];
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
const failure = (error: string, status: number) => reply({ error }, status);
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const identifier = (value: unknown): value is string => typeof value === "string" && uuid.test(value);
const name = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "" && !value.includes("\u0000");
// Match SQL btrim(text), preserving logical retry payloads rather than rewriting names.
const cleanName = (value: string) => value.replace(/^ +| +$/g, "");

function argumentsFor(operation: OrderOperation, body: unknown): Record<string, unknown> | null {
  if (!record(body)) return null;
  const expected = operation === "request"
    ? ["requestId", "eventId", "buyerName", "attendeeNames"] : ["orderId"];
  if (Object.keys(body).length !== expected.length || expected.some((key) => !(key in body))) return null;
  if (operation !== "request") {
    return identifier(body.orderId) ? { target_order: body.orderId.toLowerCase() } : null;
  }
  if (typeof body.requestId !== "string" || !uuidV4.test(body.requestId) || !identifier(body.eventId) ||
      !name(body.buyerName) || !Array.isArray(body.attendeeNames) ||
      body.attendeeNames.length === 0 || !body.attendeeNames.every(name)) return null;
  return {
    request_id: body.requestId.toLowerCase(), target_event: body.eventId.toLowerCase(),
    request_buyer_name: cleanName(body.buyerName), request_attendee_names: body.attendeeNames.map(cleanName),
  };
}

async function readBody(request: Request): Promise<{ body: unknown } | { error: string; status: number }> {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > bodyLimit)) {
    return { error: "request_body_too_large", status: 413 };
  }
  if (!request.body) return { error: "invalid_request_body", status: 400 };
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > bodyLimit) {
        await reader.cancel();
        return { error: "request_body_too_large", status: 413 };
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return { body: JSON.parse(text) };
  } catch {
    return { error: "invalid_request_body", status: 400 };
  } finally {
    reader.releaseLock();
  }
}

function upstreamFailure(error: unknown): Response {
  if (record(error)) {
    if (error.code === "42501") return failure("operation_not_authorized", 403);
    if (error.code === "22023") {
      const known: Record<string, number> = {
        invalid_order_request: 400, sales_not_open: 409, request_id_conflict: 409,
        order_not_found: 404, order_not_pending: 409,
      };
      if (typeof error.message === "string" && Object.hasOwn(known, error.message)) {
        return failure(error.message, known[error.message]);
      }
    }
  }
  // Unknown failures may follow a committed write. Do not retry/generate a new ID here.
  return failure("order_operation_failed", 502);
}

function safeInteger(value: unknown): number | null {
  if (typeof value !== "number" && !(typeof value === "string" && /^\d+$/.test(value))) return null;
  const result = Number(value);
  return Number.isSafeInteger(result) && result > 0 ? result : null;
}
const timestamp = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));

function projectResult(operation: OrderOperation, data: unknown, args: Record<string, unknown>): unknown | null {
  if (!Array.isArray(data) || data.length !== 1 || !record(data[0])) return null;
  const row = data[0];
  const requestedId = operation === "request" ? args.request_id : args.target_order;
  if (!identifier(row.order_id) || row.order_id.toLowerCase() !== requestedId ||
      typeof row.order_status !== "string" || !states.includes(row.order_status)) return null;
  const base = { id: row.order_id, status: row.order_status };
  if (operation === "request") {
    const quantity = safeInteger(row.ticket_quantity);
    const totalCents = safeInteger(row.total_cents);
    if (typeof row.order_reference !== "string" || !/^DIWO-[A-F0-9]{12}$/.test(row.order_reference) ||
        quantity === null || quantity !== (args.request_attendee_names as string[]).length ||
        totalCents !== quantity * 500) return null;
    return { order: { ...base, reference: row.order_reference, quantity, totalCents } };
  }
  if (!["pending", "confirmed"].includes(row.order_status)) return null;
  if (operation === "report-payment") {
    if (row.payment_reported_at !== null && !timestamp(row.payment_reported_at)) return null;
    if (row.order_status === "pending" && row.payment_reported_at === null) return null;
    return { order: { ...base, paymentReportedAt: row.payment_reported_at } };
  }
  const issuedTicketCount = safeInteger(row.issued_ticket_count);
  if (row.order_status !== "confirmed" || !timestamp(row.confirmed_at) || issuedTicketCount === null) return null;
  return { order: { ...base, confirmedAt: row.confirmed_at, issuedTicketCount } };
}

/** Shared HTTP boundary; only the server-only adapter can supply a real session. */
export async function handleOrderMutation(
  request: Request, operation: OrderOperation, authorize: () => Promise<OrderSession>,
): Promise<Response> {
  if (request.method !== "POST") return failure("method_not_allowed", 405);
  // Explicit origin protects custom cookie-authenticated POSTs, including missing Origin.
  if (request.headers.get("origin") !== localOrigin || new URL(request.url).origin !== localOrigin ||
      request.headers.get("sec-fetch-site") === "cross-site") return failure("request_origin_not_allowed", 403);
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "") ||
      ![null, "identity"].includes(request.headers.get("content-encoding"))) {
    return failure("json_request_required", 415);
  }
  try {
    const session = await authorize();
    if (!session.ok) return failure(session.reason, session.status);
    if (operation === "approve-payment" && session.role !== "admin") {
      return failure("operation_not_authorized", 403);
    }
    const parsed = await readBody(request);
    if ("error" in parsed) return failure(parsed.error, parsed.status);
    const args = argumentsFor(operation, parsed.body);
    if (!args) return failure("invalid_request_body", 400);
    const rpc = operation === "request" ? "create_order_request"
      : operation === "report-payment" ? "report_order_payment" : "approve_order_payment";
    // POST RPC only; DB rechecks actor/current role/ownership/state inside its transaction.
    const { data, error } = await session.client.rpc(rpc, args);
    if (error !== null) return upstreamFailure(error);
    const result = projectResult(operation, data, args);
    return result === null ? failure("order_operation_failed", 502) : reply(result);
  } catch {
    return failure("order_operation_failed", 502);
  }
}
