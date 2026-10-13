export const canonicalEventSlug = "diwo-x-2-2026";
export type SalesAvailability = {
  state: "unpublished" | "closed" | "open" | "unavailable";
  eventId: string | null;
};
export type RequestDraft = {
  requestId: string; eventId: string; buyerName: string; attendeeNames: string[];
};
export type RequestReceipt = {
  id: string; reference: string; status: "pending" | "confirmed" | "rejected" | "cancelled";
  quantity: number; totalCents: number;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const nonemptyName = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "" && !value.includes("\u0000");

/** Real sales use the explicitly published event's configured opening, never a fixed estimate. */
export function salesAvailability(row: unknown, now: number): SalesAvailability {
  if (row === null) return { state: "unpublished", eventId: null };
  if (!record(row) || typeof row.id !== "string" || !uuid.test(row.id) ||
      row.slug !== canonicalEventSlug || row.is_published !== true ||
      row.unit_price_cents !== 500 || row.currency !== "EUR" || row.timezone !== "Europe/Madrid" ||
      row.title !== "DIWO X 2.0" || row.public_location !== "Casa de campo en Ceutí" ||
      typeof row.sales_open_at !== "string" || !Number.isFinite(Date.parse(row.sales_open_at)) ||
      Date.parse(row.sales_open_at) >= Date.parse("2026-10-31T22:00:00Z") ||
      ![
        [row.starts_at, "2026-10-31T22:00:00Z"],
        [row.ends_at, "2026-11-01T06:00:00Z"], [row.arrival_from, "2026-10-31T22:30:00Z"],
        [row.arrival_until, "2026-11-01T00:30:00Z"],
      ].every(([actual, expected]) => typeof actual === "string" && Date.parse(actual) === Date.parse(expected as string)) ||
      !Number.isFinite(now)) return { state: "unavailable", eventId: null };
  return { state: now >= Date.parse(row.sales_open_at) ? "open" : "closed", eventId: row.id };
}

export function parseRequestDraft(raw: string, eventId: string): RequestDraft | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!record(value) || Object.keys(value).length !== 4 ||
        typeof value.requestId !== "string" || !uuidV4.test(value.requestId) ||
        value.eventId !== eventId || !uuid.test(eventId) || !nonemptyName(value.buyerName) ||
        !Array.isArray(value.attendeeNames) || !value.attendeeNames.length ||
        !value.attendeeNames.every(nonemptyName)) return null;
    return { requestId: value.requestId, eventId, buyerName: value.buyerName, attendeeNames: [...value.attendeeNames] };
  } catch { return null; }
}

export function requestReceipt(value: unknown, draft: RequestDraft): RequestReceipt | null {
  if (!record(value) || !record(value.order)) return null;
  const row = value.order;
  if (row.id !== draft.requestId || typeof row.reference !== "string" || !/^DIWO-[A-F0-9]{12}$/.test(row.reference) ||
      !["pending", "confirmed", "rejected", "cancelled"].includes(String(row.status)) ||
      row.quantity !== draft.attendeeNames.length || row.totalCents !== draft.attendeeNames.length * 500) return null;
  return { id: draft.requestId, reference: row.reference, status: row.status as RequestReceipt["status"],
    quantity: draft.attendeeNames.length, totalCents: draft.attendeeNames.length * 500 };
}
