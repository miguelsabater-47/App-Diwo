import type { ReadyTicket } from "./ticket-carousel-model";

export type PrototypeTicket = {
  id: string; name: string; buyer: string; reference: string; kind: "general" | "extra";
  status: "valid" | "used" | "revoked"; issuedAt: string; usedAt: string | null; revokedAt: string | null;
};
const issuedAt = "2026-10-22T18:00:00.000Z";

/** Entirely fictional local data. IDs and QR payloads cannot pass real ticket validators. */
export function initialPrototypeTickets(): PrototypeTicket[] {
  return [
    { id: "local-general-0001", name: "Álex Navarro", buyer: "Álex Navarro", reference: "GN0001", kind: "general", status: "valid", issuedAt, usedAt: null, revokedAt: null },
    { id: "local-general-0002", name: "Sara Molina", buyer: "Álex Navarro", reference: "GN0001", kind: "general", status: "valid", issuedAt, usedAt: null, revokedAt: null },
    { id: "local-general-0003", name: "Dani Ríos", buyer: "Dani Ríos", reference: "GN0002", kind: "general", status: "used", issuedAt, usedAt: "2026-11-01T00:15:00.000Z", revokedAt: null },
    { id: "local-general-0004", name: "Andrea Soler", buyer: "Andrea Soler", reference: "GN0003", kind: "general", status: "revoked", issuedAt, usedAt: null, revokedAt: issuedAt },
    { id: "local-extra-0001", name: "Invitado de cortesía", buyer: "Invitación", reference: "EX0001", kind: "extra", status: "valid", issuedAt, usedAt: null, revokedAt: null },
  ];
}

export function createPrototypeExtras(names: string[], start: number): PrototypeTicket[] {
  if (!names.length || !Number.isSafeInteger(start) || start < 2 ||
    names.some(name => !name.trim() || name.trim().length > 120 || name.includes("\u0000"))) throw new Error("invalid_guests");
  return names.map((name, index) => ({
    id: `local-extra-${String(start + index).padStart(4, "0")}`, name: name.trim(), buyer: "Invitación",
    reference: `EX${String(start + index).padStart(4, "0")}`, kind: "extra", status: "valid",
    issuedAt: new Date().toISOString(), usedAt: null, revokedAt: null,
  }));
}

export function filterPrototypeTickets(tickets: PrototypeTicket[], kind: PrototypeTicket["kind"], status: string, search: string): PrototypeTicket[] {
  const fold = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const query = fold(search.trim());
  return tickets.filter(ticket => ticket.kind === kind && (status === "all" || ticket.status === status) &&
    fold(`${ticket.name} ${ticket.buyer} ${ticket.reference}`).includes(query));
}

export function prototypeQrPayload(ticket: PrototypeTicket): string {
  if (!/^local-(?:extra|general)-\d{4,}$/.test(ticket.id) || ticket.status !== "valid") throw new Error("invalid_local_ticket");
  return `DIWO:LOCAL:NOT-VALID-FOR-ENTRY:${ticket.id}`;
}

export function prototypeTicketCard(ticket: PrototypeTicket, qrDataUrl: string | null): ReadyTicket {
  return { ok: true, technical: false, ticket: {
    id: ticket.id, orderId: `local-order-${ticket.reference}`, eventId: "local-event", attendeeName: ticket.name,
    status: ticket.status, issuedAt: ticket.issuedAt, usedAt: ticket.usedAt, revokedAt: ticket.revokedAt,
    qrDataUrl: ticket.status === "valid" ? qrDataUrl : null, eventSlug: "diwo-x-2-2026", eventTitle: "DIWO X 2.0",
    startsAt: "2026-10-31T22:30:00.000Z", endsAt: "2026-11-01T06:00:00.000Z", timezone: "Europe/Madrid",
    publicLocation: "Casa de campo en Ceutí", unitPriceCents: ticket.kind === "extra" ? 0 : 500,
    currency: "EUR", orderReference: ticket.reference,
  } };
}
