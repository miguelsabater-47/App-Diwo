import type { AppRole } from "./app-authorization-core";

export const technicalEventId = "9d560641-aacf-4d25-8d65-94960bba59b2";
export type TicketView = { id: string; position: number; name: string; status: "valid" | "used" | "revoked"; issuedAt: string; usedAt: string | null; revokedAt: string | null };
export type OrderView = {
  id: string; eventId: string; reference: string; buyerName: string; names: string[];
  quantity: number; totalCents: number; status: "pending" | "confirmed" | "rejected" | "cancelled";
  reportedAt: string | null; confirmedAt: string | null; createdAt: string;
  eventTitle: string; actualEvent: boolean; technical: boolean; tickets: TicketView[];
};
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const name = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const time = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v));
const nullableTime = (v: unknown) => v === null || time(v);
const integer = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

/** Even an admin's PERSONAL view must explicitly filter to the signed actor. */
export function orderReadScope(role: AppRole, actorId: string, kind: "buyer" | "admin"):
  { buyerId: string | null } | null {
  if (!/^user_[A-Za-z0-9_-]+$/.test(actorId) || !["user", "door_staff", "admin"].includes(role) ||
      !["buyer", "admin"].includes(kind)) return null;
  if (kind === "admin") return role === "admin" ? { buyerId: null } : null;
  return { buyerId: actorId };
}

/** Exact counts avoid silent truncation even if a server row limit is below our page size. */
export async function readOrderPages(query: (from: number, to: number) =>
  PromiseLike<{ data: unknown; error: unknown; count: number | null }>): Promise<unknown[]> {
  const rows: unknown[] = [];
  const ids = new Set<string>();
  let expected: number | null = null;
  while (true) {
    const { data, error, count } = await query(rows.length, rows.length + 499);
    if (error || !Array.isArray(data) || data.length > 500 || count === null ||
        !Number.isSafeInteger(count) || count < 0 || (expected !== null && expected !== count)) throw new Error("order_read_changed");
    expected = count;
    for (const row of data) {
      if (!record(row) || typeof row.id !== "string" || ids.has(row.id)) throw new Error("order_read_changed");
      ids.add(row.id); rows.push(row);
    }
    if (rows.length === expected) return rows;
    if (!data.length || rows.length > expected) throw new Error("order_read_changed");
  }
}

/** Bounded fan-out; each chunk still uses exact, sequential pagination. */
export async function readOrderChunks(ids: string[], read: (batch: string[]) => Promise<unknown[]>): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let start = 0; start < ids.length; start += 150) {
    const wave: Promise<unknown[]>[] = [];
    for (let offset = start; offset < Math.min(start + 150, ids.length); offset += 50) {
      wave.push(read(ids.slice(offset, offset + 50)));
    }
    for (const batch of await Promise.all(wave)) rows.push(...batch);
  }
  return rows;
}

/** Safe projection and consistency checks; never expose subjects, QR or arbitrary columns. */
export function orderViews(rawOrders: unknown[], rawTickets: unknown[], rawEvents: unknown[]): OrderView[] | null {
  const result: OrderView[] = [];
  const seenOrders = new Set<string>();
  const seenTickets = new Set<string>();
  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const t of rawTickets) {
    if (!record(t) || !uuid(t.id) || !uuid(t.order_id) || seenTickets.has(t.id)) return null;
    seenTickets.add(t.id);
    const group = grouped.get(t.order_id);
    if (group) group.push(t);
    else grouped.set(t.order_id, [t]);
  }
  for (const o of rawOrders) {
    if (!record(o) || !uuid(o.id) || !uuid(o.event_id) || seenOrders.has(o.id) ||
        typeof o.reference !== "string" || !/^DIWO-[A-F0-9]{12}$/.test(o.reference) || !name(o.buyer_name) ||
        !Array.isArray(o.attendee_names) || !o.attendee_names.length || !o.attendee_names.every(name) ||
        !integer(o.quantity) || o.quantity !== o.attendee_names.length || o.unit_price_cents !== 500 ||
        o.currency !== "EUR" || typeof o.status !== "string" || !["pending", "confirmed", "rejected", "cancelled"].includes(o.status) ||
        !nullableTime(o.payment_reported_at) || !nullableTime(o.confirmed_at) || !time(o.created_at)) return null;
    const total = typeof o.total_cents === "string" && /^\d+$/.test(o.total_cents) ? Number(o.total_cents) : o.total_cents;
    if (!integer(total) || total !== o.attendee_names.length * 500 ||
        (o.status === "confirmed") !== (o.confirmed_at !== null)) return null;
    seenOrders.add(o.id);
    const tickets: TicketView[] = [];
    const positions = new Set<number>();
    for (const t of grouped.get(o.id) ?? []) {
      if (t.event_id !== o.event_id || !integer(t.ticket_position) || typeof t.ticket_position !== "number" ||
          positions.has(t.ticket_position) || t.attendee_name !== o.attendee_names[t.ticket_position - 1] ||
          typeof t.status !== "string" || !["valid", "used", "revoked"].includes(t.status) || !time(t.issued_at) ||
          !nullableTime(t.used_at) || !nullableTime(t.revoked_at) ||
          (t.status === "used") !== (t.used_at !== null) || (t.status === "revoked") !== (t.revoked_at !== null)) return null;
      positions.add(t.ticket_position);
      tickets.push({ id: t.id as string, position: t.ticket_position, name: t.attendee_name as string,
        status: t.status as TicketView["status"], issuedAt: t.issued_at, usedAt: t.used_at as string | null, revokedAt: t.revoked_at as string | null });
    }
    if (tickets.length !== (o.status === "confirmed" ? o.attendee_names.length : 0)) return null;
    const event = rawEvents.find((e) => record(e) && e.id === o.event_id);
    const actualEvent = record(event) && event.slug === "diwo-x-2-2026";
    result.push({ id: o.id, eventId: o.event_id, reference: o.reference, buyerName: o.buyer_name,
      names: [...o.attendee_names], quantity: o.attendee_names.length, totalCents: total as number,
      status: o.status as OrderView["status"], reportedAt: o.payment_reported_at as string | null,
      confirmedAt: o.confirmed_at as string | null, createdAt: o.created_at, actualEvent,
      technical: o.event_id === technicalEventId,
      eventTitle: actualEvent ? "DIWO X 2.0" : o.event_id === technicalEventId ? "PRUEBA TÉCNICA · No válida para DIWO" : "Evento de esta solicitud",
      tickets: tickets.sort((a, b) => a.position - b.position) });
  }
  if ([...grouped.keys()].some((id) => !seenOrders.has(id))) return null;
  return result;
}

export function orderSummary(orders: OrderView[]) {
  const actual = orders.filter((o) => o.actualEvent && !o.technical);
  const confirmed = actual.filter((o) => o.status === "confirmed");
  return { pending: actual.filter((o) => o.status === "pending").length,
    paidOrders: confirmed.length, totalCents: confirmed.reduce((n, o) => n + o.totalCents, 0),
    issued: confirmed.reduce((n, o) => n + o.tickets.length, 0),
    used: confirmed.reduce((n, o) => n + o.tickets.filter((t) => t.status === "used").length, 0),
    unused: confirmed.reduce((n, o) => n + o.tickets.filter((t) => t.status === "valid").length, 0) };
}
