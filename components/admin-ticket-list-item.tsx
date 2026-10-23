import type { MouseEventHandler, ReactNode } from "react";
import type { AdminTicket } from "@/lib/admin-ticket-model";

type ListTicket = Pick<AdminTicket, "id" | "name" | "status" | "position" | "buyerName" | "reference">;
const labels = { valid: "Sin usar", used: "Utilizada", revoked: "Anulada" };

/** Shared presentation only. Callers own data access and what opening a row does. */
export function AdminTicketListItem({ ticket, selected = false, disabled = false, description, action, onOpen }: {
  ticket: ListTicket; selected?: boolean; disabled?: boolean; description?: string;
  onOpen: MouseEventHandler<HTMLButtonElement>; action?: ReactNode;
}) {
  return <article className={`diwo-admin-request-card${selected ? " is-selected" : ""}${action ? " has-secondary-action" : ""}`}>
    <button type="button" className="diwo-admin-ticket-open"
      aria-label={`Ver entrada de ${ticket.name}, número ${ticket.position}, ${ticket.reference}`}
      aria-pressed={selected} disabled={disabled} onClick={onOpen}>
      <span className="diwo-admin-buyer-initial" aria-hidden="true">{ticket.name.trim().charAt(0).toLocaleUpperCase("es")}</span>
      <strong>{ticket.name}</strong><span className={`diwo-admin-ticket-state is-${ticket.status}`}>{labels[ticket.status]}</span>
      <span className="diwo-admin-ticket-buyer">{description ?? `Comprador: ${ticket.buyerName}`}</span>
      <span className="diwo-admin-ticket-reference">{ticket.reference} · #{ticket.position}</span>
    </button>
    {action}
  </article>;
}
