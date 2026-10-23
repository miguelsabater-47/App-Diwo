import type { AdminTicket } from "./admin-ticket-model";
import type { ReadyTicket } from "./ticket-carousel-model";
import { ticketId } from "./owned-ticket-model";
import { freshTicketQr } from "./owned-ticket-export";

export type ExtraTicket = AdminTicket & { batchId: string; eventId: string };
export type ExtraDraft = { requestId: string; attendeeNames: string[] };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const time = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
const validName = (value: unknown): value is string => typeof value === "string" && !!value.trim() && value.length <= 120 && !value.includes("\0");

export function extraDraft(value: unknown): ExtraDraft | null {
  if (!record(value) || Object.keys(value).length !== 2 || typeof value.requestId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.requestId) ||
    !Array.isArray(value.attendeeNames) || !value.attendeeNames.length || !value.attendeeNames.every(validName)) return null;
  return { requestId: value.requestId.toLowerCase(), attendeeNames: [...value.attendeeNames] };
}

export function extraTicketRows(value: unknown): ExtraTicket[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>(), positions = new Set<string>(), rows: ExtraTicket[] = [];
  for (const row of value) {
    if (!record(row) || !ticketId(row.ticket_id) || !ticketId(row.batch_id) || !ticketId(row.event_id) ||
      typeof row.batch_reference !== "string" || !/^EX-[A-F0-9]{12}$/.test(row.batch_reference) ||
      !validName(row.attendee_name) || !Number.isSafeInteger(row.ticket_position) || (row.ticket_position as number) < 1 ||
      !["valid", "used", "revoked"].includes(String(row.status)) || !time(row.issued_at) ||
      (row.status === "used" ? !time(row.used_at) : row.used_at !== null) ||
      (row.status === "revoked" ? !time(row.revoked_at) : row.revoked_at !== null) ||
      seen.has(row.ticket_id) || positions.has(`${row.batch_id}:${row.ticket_position}`)) return null;
    seen.add(row.ticket_id); positions.add(`${row.batch_id}:${row.ticket_position}`);
    rows.push({ id: row.ticket_id, batchId: row.batch_id, eventId: row.event_id, reference: row.batch_reference,
      name: row.attendee_name, buyerName: "", eventTitle: "DIWO X 2.0", technical: false,
      position: row.ticket_position as number, status: row.status as ExtraTicket["status"],
      issuedAt: row.issued_at, usedAt: row.used_at as string | null, revokedAt: row.revoked_at as string | null });
  }
  return rows;
}

export function extraIssuanceReceipt(value: unknown, draft: ExtraDraft): ExtraTicket[] | null {
  const rows = extraTicketRows(value);
  if (!rows || rows.length !== draft.attendeeNames.length) return null;
  const ordered = [...rows].sort((a, b) => a.position - b.position);
  if (ordered.some((row, index) => row.batchId !== draft.requestId || row.position !== index + 1 ||
    row.name !== draft.attendeeNames[index] || row.reference !== ordered[0].reference || row.eventId !== ordered[0].eventId)) return null;
  return ordered;
}

/** Validate the safe HTTP DTO, without accepting private fields or trusting a cast. */
export function extraTicketResponse(value: unknown, draft?: ExtraDraft): ExtraTicket[] | null {
  if (!record(value) || !Array.isArray(value.tickets)) return null;
  const rows = value.tickets.map(row => record(row) ? {
    ticket_id: row.id, batch_id: row.batchId, event_id: row.eventId, batch_reference: row.reference,
    attendee_name: row.name, ticket_position: row.position, status: row.status,
    issued_at: row.issuedAt, used_at: row.usedAt, revoked_at: row.revokedAt,
  } : null);
  return draft ? extraIssuanceReceipt(rows, draft) : extraTicketRows(rows);
}

/** Narrow browser projection for this exact admin-only extra; never accepts a paid/other ticket. */
export function extraTicketDetail(value: unknown, expected: ExtraTicket): ReadyTicket | null {
  if (!record(value) || value.ok !== true || value.technical !== false || !record(value.ticket)) return null;
  const row = value.ticket;
  if (row.id !== expected.id || row.orderId !== expected.batchId || row.eventId !== expected.eventId ||
    row.orderReference !== expected.reference || row.attendeeName !== expected.name || row.unitPriceCents !== 0 ||
    row.currency !== "EUR" || row.eventSlug !== "diwo-x-2-2026" || row.timezone !== "Europe/Madrid" ||
    row.publicLocation !== "Casa de campo en Ceutí" || typeof row.eventTitle !== "string" || !row.eventTitle.trim() ||
    !time(row.startsAt) || !time(row.endsAt) || !time(row.issuedAt) ||
    !["valid", "used", "revoked"].includes(String(row.status)) ||
    (row.status === "used" ? !time(row.usedAt) : row.usedAt !== null) ||
    (row.status === "revoked" ? !time(row.revokedAt) : row.revokedAt !== null)) return null;
  const qr = row.status === "valid" ? freshTicketQr(value, expected.id) : null;
  if (row.status === "valid" ? !qr : row.qrDataUrl !== null) return null;
  return { ok: true, technical: false, ticket: {
    id: expected.id, orderId: expected.batchId, eventId: expected.eventId, orderReference: expected.reference,
    attendeeName: expected.name, status: row.status as ExtraTicket["status"], issuedAt: row.issuedAt,
    usedAt: row.usedAt as string | null, revokedAt: row.revokedAt as string | null, qrDataUrl: qr,
    eventSlug: "diwo-x-2-2026", eventTitle: row.eventTitle, startsAt: row.startsAt, endsAt: row.endsAt,
    timezone: "Europe/Madrid", publicLocation: "Casa de campo en Ceutí", unitPriceCents: 0, currency: "EUR",
  } };
}
