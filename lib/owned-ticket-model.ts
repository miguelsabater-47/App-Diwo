export type OwnedTicket = {
  id: string; orderId: string; eventId: string; attendeeName: string;
  status: "valid" | "used" | "revoked"; issuedAt: string; usedAt: string | null; revokedAt: string | null;
  qrToken: string | null; eventSlug: string; eventTitle: string; startsAt: string; endsAt: string;
  timezone: string; publicLocation: string; unitPriceCents: number; currency: string; orderReference: string;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hexToken = /^[0-9a-f]{64}$/;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const date = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));

export function ticketId(value: unknown): value is string { return typeof value === "string" && uuid.test(value); }

export function isTechnicalTicketEvent(eventId: unknown, eventSlug: unknown): boolean {
  return eventId === "9d560641-aacf-4d25-8d65-94960bba59b2" && eventSlug === "diwo-technical-test-20261012";
}

/** Validate the RPC projection and remove all unrecognized/private fields. */
export function ownedTicket(value: unknown): OwnedTicket | null {
  if (!record(value)) return null;
  const status = value.status;
  const publicLocation = isTechnicalTicketEvent(value.event_id, value.event_slug)
    ? "Evento ficticio de integración" : "Casa de campo en Ceutí";
  if (!ticketId(value.id) || !ticketId(value.order_id) || !ticketId(value.event_id) ||
    typeof value.attendee_name !== "string" || !value.attendee_name.trim() ||
    !["valid", "used", "revoked"].includes(String(status)) || !date(value.issued_at) ||
    (value.used_at !== null && !date(value.used_at)) || (value.revoked_at !== null && !date(value.revoked_at)) ||
    typeof value.event_slug !== "string" || !value.event_slug || typeof value.event_title !== "string" || !value.event_title ||
    !date(value.starts_at) || !date(value.ends_at) || value.timezone !== "Europe/Madrid" ||
    typeof value.public_location !== "string" || value.public_location !== publicLocation || value.unit_price_cents !== 500 ||
    value.currency !== "EUR" ||
    typeof value.order_reference !== "string" || !value.order_reference.trim()) return null;
  const valid = status === "valid";
  if (valid ? typeof value.qr_token !== "string" || !hexToken.test(value.qr_token) || value.used_at !== null || value.revoked_at !== null
    : value.qr_token !== null || (status === "used" ? value.used_at === null || value.revoked_at !== null : value.revoked_at === null || value.used_at !== null)) return null;
  return {
    id: value.id, orderId: value.order_id, eventId: value.event_id, attendeeName: value.attendee_name,
    status: status as OwnedTicket["status"], issuedAt: value.issued_at, usedAt: value.used_at as string | null,
    revokedAt: value.revoked_at as string | null, qrToken: valid ? value.qr_token as string : null,
    eventSlug: value.event_slug, eventTitle: value.event_title, startsAt: value.starts_at, endsAt: value.ends_at,
    timezone: value.timezone, publicLocation: value.public_location, unitPriceCents: value.unit_price_cents as number,
    currency: value.currency, orderReference: value.order_reference,
  };
}
