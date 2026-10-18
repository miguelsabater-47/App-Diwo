import Link from "next/link";
import { RefreshOrders } from "@/components/refresh-orders";
import { TicketsHeading } from "@/components/tickets-heading";

export function EmptyTickets() {
  return <section className="diwo-tickets-empty">
    <TicketsHeading />
    <div className="diwo-tickets-empty-card">
      <h2>Todavía no tienes tus entradas</h2>
      <p>Puedes solicitar tus entradas desde Inicio.</p>
      <Link href="/" className="inline-flex min-h-11 items-center text-primary underline underline-offset-4">Ir a Inicio</Link>
    </div>
    <div className="diwo-tickets-refresh"><RefreshOrders /></div>
  </section>;
}
