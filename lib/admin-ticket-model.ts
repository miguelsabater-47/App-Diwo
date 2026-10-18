import type { OrderView, TicketView } from "./order-view-model";

export type AdminTicket = TicketView & {
  reference: string; buyerName: string; eventTitle: string; technical: boolean;
};
export function adminTickets(orders: OrderView[]): AdminTicket[] {
  return orders.filter(order => order.status === "confirmed").flatMap(order => order.tickets.map(ticket => ({
    ...ticket, reference: order.reference, buyerName: order.buyerName,
    eventTitle: order.eventTitle, technical: order.technical,
  })));
}
const fold = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
export function filterAdminTickets(tickets: AdminTicket[], search: string, status: string): AdminTicket[] {
  const query = fold(search.trim());
  return tickets.filter(ticket => (status === "all" || ticket.status === status) &&
    fold([ticket.name, ticket.buyerName, ticket.reference, ticket.id].join(" ")).includes(query));
}
export function revokedTicketReceipt(value: unknown, id: string): string | null {
  if (!value || typeof value !== "object" || !("ticket" in value)) return null;
  const ticket = value.ticket;
  if (!ticket || typeof ticket !== "object" || !("id" in ticket) || ticket.id !== id ||
      !("status" in ticket) || ticket.status !== "revoked" || !("revokedAt" in ticket) ||
      typeof ticket.revokedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(ticket.revokedAt) ||
      !Number.isFinite(Date.parse(ticket.revokedAt))) return null;
  return ticket.revokedAt;
}
