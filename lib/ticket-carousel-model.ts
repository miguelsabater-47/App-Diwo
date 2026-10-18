import type { OwnedTicketResult } from "./owned-ticket-reader";
import { freshTicketQr } from "./owned-ticket-export";
import { ticketId } from "./owned-ticket-model";

export type ReadyTicket = Extract<OwnedTicketResult, { ok: true }>;
export type AdjacentTickets = { previous?: ReadyTicket | null; next?: ReadyTicket | null };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const date = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));

export function ticketIdFromHref(href: string): string | null {
  if (!href.startsWith("/ticket/")) return null;
  try {
    const id = decodeURIComponent(href.split("?")[0].slice("/ticket/".length)).toLowerCase();
    return ticketId(id) ? id : null;
  } catch { return null; }
}

/** Validate a signed personal API response against this exact order, not just any owned ticket. */
export function carouselTicket(value: unknown, target: string, anchor: ReadyTicket): ReadyTicket | null {
  if (!record(value) || value.ok !== true || value.technical !== anchor.technical || !record(value.ticket)) return null;
  const row = value.ticket, base = anchor.ticket;
  if (!ticketId(target) || row.id !== target || typeof row.attendeeName !== "string" || !row.attendeeName.trim() || row.attendeeName.includes("\0") || !date(row.issuedAt)) return null;
  for (const field of ["orderId", "eventId", "eventSlug", "eventTitle", "startsAt", "endsAt", "timezone", "publicLocation", "unitPriceCents", "currency", "orderReference"] as const) {
    if (row[field] !== base[field]) return null;
  }
  let qrDataUrl: string | null = null;
  if (row.status === "valid") {
    qrDataUrl = freshTicketQr(value, target);
    if (!qrDataUrl || row.usedAt !== null || row.revokedAt !== null) return null;
  } else if (row.status === "used") {
    if (!date(row.usedAt) || row.revokedAt !== null || row.qrDataUrl !== null) return null;
  } else if (row.status === "revoked") {
    if (!date(row.revokedAt) || row.usedAt !== null || row.qrDataUrl !== null) return null;
  } else return null;
  return { ok: true, technical: anchor.technical, ticket: {
    id: target, orderId: base.orderId, eventId: base.eventId, attendeeName: row.attendeeName,
    status: row.status, issuedAt: row.issuedAt, usedAt: row.usedAt as string | null, revokedAt: row.revokedAt as string | null,
    eventSlug: base.eventSlug, eventTitle: base.eventTitle, startsAt: base.startsAt, endsAt: base.endsAt,
    timezone: base.timezone, publicLocation: base.publicLocation, unitPriceCents: base.unitPriceCents,
    currency: base.currency, orderReference: base.orderReference, qrDataUrl,
  } };
}
