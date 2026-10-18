import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { EmptyTickets } from "@/components/empty-tickets";
import { hasConfiguredClerkKeys } from "@/lib/local-access";
import { readOrderOverview } from "@/lib/order-reads";
import { PendingOrderCard } from "@/components/pending-order-card";
import { TicketsHeading } from "@/components/tickets-heading";
import { RefreshOrders } from "@/components/refresh-orders";
import { NewOrderLink } from "@/components/new-order-link";

export const dynamic = "force-dynamic";

export default async function TicketPage() {
  if (!hasConfiguredClerkKeys(process.env)) redirect("/setup");
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const result = await readOrderOverview("buyer");
  if (result.ok && result.orders.length === 0) return <EmptyTickets />;
  return (
    <section className="diwo-tickets-overview">
      <TicketsHeading />
      {!result.ok ? <div role="alert" className="rounded-2xl border border-zinc-800 bg-card p-6 text-zinc-300">No hemos podido cargar tus entradas. Pulsa Actualizar para intentarlo de nuevo.</div> :
        <div className="space-y-6">{result.orders.map((order) => order.status === "pending" ? <PendingOrderCard key={order.id} order={order} /> : <article key={order.id} className="rounded-2xl border border-zinc-800 bg-card p-5 sm:p-6">
          {order.technical && <p className="mb-4 rounded-lg border border-primary/30 p-3 text-sm text-primary">Prueba técnica conservada · Estas entradas no son válidas para DIWO X 2.0.</p>}
          <p className="mb-2 break-all font-mono text-xs text-zinc-400">{order.reference}</p><h2 className="text-xl font-semibold text-white">{order.eventTitle}</h2>
          <p className="mt-2 text-sm text-zinc-300">{order.quantity} {order.quantity === 1 ? "entrada" : "entradas"} · {new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(order.totalCents / 100)}</p>
          {order.status === "confirmed" ? <>
              <p className="mt-5 font-semibold text-primary">{order.tickets.some((t) => t.status === "valid") ? "¡Tus entradas están listas!" : "Pago confirmado · Historial de entradas"}</p>
              {order.actualEvent && <p className="mt-3 text-sm leading-relaxed text-zinc-400">31 oct 2026 · 23:30 · Casa de campo en Ceutí. Te esperamos entre las 23:30 y la 01:30. La dirección exacta se compartirá por WhatsApp el último día.</p>}
              <ul className="mt-5 space-y-3">{order.tickets.map((ticket) => <li key={ticket.id} className="rounded-xl border border-zinc-700 bg-zinc-950 p-4">
                 <p className="break-words font-semibold text-white">{ticket.name}</p><p className="mt-1 font-mono text-xs text-zinc-500">Entrada {ticket.id.slice(0, 8).toUpperCase()}</p>
                 <Link className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" href={`/ticket/${encodeURIComponent(ticket.id)}`}>Ver detalle de la entrada</Link>
                <p className={`mt-3 text-sm font-semibold ${ticket.status === "revoked" ? "text-red-300" : ticket.status === "used" ? "text-zinc-300" : "text-primary"}`}>{ticket.status === "valid" ? "Válida · Sin utilizar" : ticket.status === "used" ? "Entrada utilizada" : "Anulada · Esta entrada no permite el acceso"}</p>
                {ticket.usedAt && <p className="mt-1 text-xs text-zinc-400">{new Date(ticket.usedAt).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}</p>}
              </li>)}</ul>
            </> : <p className="mt-5 text-zinc-300">{order.status === "cancelled" ? "Esta solicitud ha sido cancelada." : "No hemos podido confirmar tu solicitud. Contacta con la organización."}</p>}
        </article>)}</div>}
      {result.ok && result.orders.length > 0 && <NewOrderLink eventId={result.orders.find((o) => o.actualEvent)?.eventId ?? null} knownOrderIds={result.orders.map((o) => o.id)} />}
      <div className="diwo-tickets-refresh"><RefreshOrders /></div>
    </section>
  );
}
