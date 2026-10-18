import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { EmptyTickets } from "@/components/empty-tickets";
import { hasConfiguredClerkKeys } from "@/lib/local-access";
import { readOrderOverview } from "@/lib/order-reads";
import { PendingOrderCard } from "@/components/pending-order-card";
import { TicketsHeading } from "@/components/tickets-heading";
import { RefreshOrders } from "@/components/refresh-orders";
import { ConfirmedOrderCard } from "@/components/confirmed-order-card";

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
        <div className="space-y-6">{result.orders.map((order) => order.status === "pending" ? <PendingOrderCard key={order.id} order={order} />
          : order.status === "confirmed" ? <ConfirmedOrderCard key={order.id} order={order} /> : <article key={order.id} className="rounded-2xl border border-zinc-800 bg-card p-5 sm:p-6">
          {order.technical && <p className="mb-4 rounded-lg border border-primary/30 p-3 text-sm text-primary">Prueba técnica conservada · Estas entradas no son válidas para DIWO X 2.0.</p>}
          <p className="mb-2 break-all font-mono text-xs text-zinc-400">{order.reference}</p><h2 className="text-xl font-semibold text-white">{order.eventTitle}</h2>
          <p className="mt-2 text-sm text-zinc-300">{order.quantity} {order.quantity === 1 ? "entrada" : "entradas"} · {new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(order.totalCents / 100)}</p>
          <p className="mt-5 text-zinc-300">{order.status === "cancelled" ? "Esta solicitud ha sido cancelada." : "No hemos podido confirmar tu solicitud. Contacta con la organización."}</p>
        </article>)}</div>}
      <div className="diwo-tickets-refresh"><RefreshOrders /></div>
    </section>
  );
}
