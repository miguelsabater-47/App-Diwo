import type { OrderView } from "./order-view-model";

export type TicketNavigation = { current: number; hrefs: string[] };

/** Input is the verified PERSONAL order projection, never an admin-wide list. */
export function ticketNavigation(orders: OrderView[], ticket: { id: string; orderId: string; eventId: string }): TicketNavigation | null {
  const order = orders.find(candidate => candidate.id === ticket.orderId && candidate.eventId === ticket.eventId && candidate.status === "confirmed");
  if (!order) return null;
  const tickets = [...order.tickets].sort((a, b) => a.position - b.position);
  const current = tickets.findIndex(candidate => candidate.id === ticket.id);
  if (current < 0 || new Set(tickets.map(candidate => candidate.id)).size !== tickets.length) return null;
  return { current, hrefs: tickets.map(candidate => `/ticket/${encodeURIComponent(candidate.id)}`) };
}
