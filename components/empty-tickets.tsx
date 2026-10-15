import Link from "next/link";
import { Ticket } from "lucide-react";
import { RefreshOrders } from "@/components/refresh-orders";

export function EmptyTickets() {
  return <section className="diwo-tickets-empty">
    <h1 className="sr-only">Mis entradas</h1>
    <p className="diwo-tickets-caption">Consulta el estado de tus solicitudes y entradas.</p>
    <div className="diwo-tickets-empty-card">
      <h2>Todavía no tienes tus entradas</h2>
      <Link href="/request" className="diwo-home-cta"><Ticket aria-hidden="true" /><span>CONSEGUIR ENTRADAS</span></Link>
    </div>
    <div className="diwo-tickets-refresh"><RefreshOrders /></div>
  </section>;
}
