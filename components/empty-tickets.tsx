import { Ticket } from "lucide-react";
import { TicketsHeading } from "@/components/tickets-heading";

export function EmptyTickets() {
  return <section className="diwo-tickets-empty">
    <TicketsHeading />
    <div className="diwo-tickets-empty-card">
      <h2>Todavía no tienes entradas</h2>
      <p>Puedes solicitar tus entradas desde Inicio.</p>
      <Ticket aria-hidden="true" className="diwo-tickets-empty-icon" />
    </div>
  </section>;
}
