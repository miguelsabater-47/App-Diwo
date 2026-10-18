import "server-only";
import { createSessionSupabaseClient } from "@/lib/supabase-session";
import { readCurrentAppAccess } from "@/lib/app-authorization-core";
import { hasConfiguredClerkKeys } from "@/lib/local-access";
import { ownedTicket, ticketId, isTechnicalTicketEvent, type OwnedTicket } from "@/lib/owned-ticket-model";
import { renderOwnedTicketQr } from "@/lib/owned-ticket-qr";

export type OwnedTicketResult = { ok: true; ticket: Omit<OwnedTicket, "qrToken"> & { qrDataUrl: string | null }; technical: boolean } |
  { ok: false; status: 401 | 403 | 502 | 503 | 404; reason: "not_found" | "unavailable" | "access" };

export async function readOwnedTicket(target: unknown): Promise<OwnedTicketResult> {
  if (!ticketId(target)) return { ok: false, status: 404, reason: "not_found" };
  const canonicalTarget = target.toLowerCase();
  if (!hasConfiguredClerkKeys(process.env)) return { ok: false, status: 503, reason: "unavailable" };
  try {
    const session = await createSessionSupabaseClient();
    const access = await readCurrentAppAccess(async () => session);
    if (!access.ok) return { ok: false, status: access.status, reason: "access" };
    if (session.status !== "ready") return { ok: false, status: 502, reason: "unavailable" };
    const { data, error } = await session.client.rpc("read_owned_ticket", { target_ticket: canonicalTarget });
    if (error) return { ok: false, status: 502, reason: "unavailable" };
    const rows = Array.isArray(data) ? data : data === null ? [] : [data];
    if (rows.length === 0) return { ok: false, status: 404, reason: "not_found" };
    if (rows.length !== 1) return { ok: false, status: 502, reason: "unavailable" };
    const ticket = ownedTicket(rows[0]);
    if (!ticket || ticket.id !== canonicalTarget) return { ok: false, status: 502, reason: "unavailable" };
    const finalAccess = await readCurrentAppAccess(async () => session);
    if (!finalAccess.ok) return { ok: false, status: finalAccess.status, reason: "access" };
    const qrDataUrl = ticket.qrToken ? await renderOwnedTicketQr(ticket.qrToken) : null;
    const safe = {
      id: ticket.id, orderId: ticket.orderId, eventId: ticket.eventId, attendeeName: ticket.attendeeName,
      status: ticket.status, issuedAt: ticket.issuedAt, usedAt: ticket.usedAt, revokedAt: ticket.revokedAt,
      eventSlug: ticket.eventSlug, eventTitle: ticket.eventTitle, startsAt: ticket.startsAt, endsAt: ticket.endsAt,
      timezone: ticket.timezone, publicLocation: ticket.publicLocation, unitPriceCents: ticket.unitPriceCents,
      currency: ticket.currency, orderReference: ticket.orderReference,
    };
    return { ok: true, ticket: { ...safe, qrDataUrl }, technical: isTechnicalTicketEvent(ticket.eventId, ticket.eventSlug) };
  } catch { return { ok: false, status: 502, reason: "unavailable" }; }
}
