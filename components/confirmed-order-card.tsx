import Link from "next/link";
import { ArrowRight, CircleCheck, Clock3, CircleX, UserRound } from "lucide-react";
import type { OrderView } from "@/lib/order-view-model";

type ConfirmedOrder = Pick<OrderView, "reference" | "quantity" | "totalCents" | "tickets" | "actualEvent" | "technical" | "eventTitle">;
const euro = (cents: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);

/** Uses only the personal safe projection. Each link selects the exact ticket ID. */
export function ConfirmedOrderCard({ order }: { order: ConfirmedOrder }) {
  const tickets = [...order.tickets].sort((a, b) => a.position - b.position);
  const available = tickets.some(ticket => ticket.status === "valid");
  const allUsed = tickets.length > 0 && tickets.every(ticket => ticket.status === "used");
  const allRevoked = tickets.length > 0 && tickets.every(ticket => ticket.status === "revoked");
  const state = order.technical || !order.actualEvent ? "history" : available ? "available" : allRevoked ? "revoked" : "history";
  const label = order.technical ? "Prueba técnica" : !order.actualEvent ? "Historial de entradas"
    : available ? "Entradas disponibles" : allRevoked ? "Entradas anuladas" : allUsed ? "Entradas utilizadas" : "Historial de entradas";
  const StatusIcon = state === "available" ? CircleCheck : state === "revoked" ? CircleX : Clock3;
  return <article className="diwo-issued-card" aria-label={`Pedido confirmado ${order.reference}`}>
    {order.technical && <p className="diwo-pending-technical">Prueba técnica conservada · Estas entradas no son válidas para DIWO X 2.0.</p>}
    <div className="diwo-issued-top">
      <p className={`diwo-issued-status is-${state}`}><StatusIcon aria-hidden="true" /><span>{label}</span></p>
      <p className="diwo-issued-reference">#{order.reference}</p>
    </div>
    {!order.actualEvent && <p className="diwo-issued-event">{order.eventTitle}</p>}
    <dl className="diwo-issued-summary">
      <div><dt>Entradas</dt><dd>{order.quantity} {order.quantity === 1 ? "entrada" : "entradas"}</dd></div>
      <div><dt>Importe total</dt><dd>{euro(order.totalCents)}</dd></div>
    </dl>
    <ul className="diwo-issued-list" aria-label={`Entradas de la solicitud ${order.reference}`}>
      {tickets.map(ticket => <li key={ticket.id}>
        <Link href={`/ticket/${encodeURIComponent(ticket.id)}`} className="diwo-issued-entry"
          aria-label={`Ver entrada de ${ticket.name}, ${ticket.position} de ${order.quantity}${ticket.status === "used" ? ", utilizada" : ticket.status === "revoked" ? ", anulada" : ""}`}>
          <span className="diwo-issued-person" aria-hidden="true"><UserRound /></span>
          <span className="diwo-issued-attendee"><strong>{ticket.name}</strong><span>Entrada {ticket.id.slice(0, 8).toUpperCase()}</span>
            {ticket.status !== "valid" && <span className={`diwo-issued-entry-state is-${ticket.status}`}>{ticket.status === "used" ? "Utilizada · Sin reentrada" : "Anulada · No permite el acceso"}</span>}
          </span>
          <span className="diwo-issued-open">Ver entrada <ArrowRight aria-hidden="true" /></span>
        </Link>
      </li>)}
    </ul>
  </article>;
}
