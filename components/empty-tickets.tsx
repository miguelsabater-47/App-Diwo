import Link from "next/link";
import { Ticket } from "lucide-react";
import { RefreshOrders } from "@/components/refresh-orders";
import { TicketsHeading } from "@/components/tickets-heading";

export function EmptyTickets() {
  return <section className="diwo-tickets-empty">
    <TicketsHeading />
    <div className="diwo-tickets-empty-card">
      <h2>Todavía no tienes tus entradas</h2>
      <Link href="/request" className="diwo-home-cta"><Ticket aria-hidden="true" /><span>CONSEGUIR ENTRADAS</span></Link>
    </div>
    <div className="diwo-tickets-refresh"><RefreshOrders /></div>
  </section>;
}
