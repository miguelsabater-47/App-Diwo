import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { EmptyTickets } from "@/components/empty-tickets";
import { hasConfiguredClerkKeys } from "@/lib/local-access";
import { readOrderOverview } from "@/lib/order-reads";
import { PendingOrderCard } from "@/components/pending-order-card";
import { TicketsHeading } from "@/components/tickets-heading";
import { ConfirmedOrderCard } from "@/components/confirmed-order-card";
import { CancelledOrderCard } from "@/components/cancelled-order-card";

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
      {!result.ok ? <div role="alert" className="rounded-2xl border border-zinc-800 bg-card p-6 text-zinc-300">No hemos podido cargar tus entradas. Volveremos a intentarlo automáticamente.</div> :
        <div className="space-y-6">{result.orders.map((order) => order.status === "pending" ? <PendingOrderCard key={order.id} order={order} />
          : order.status === "confirmed" ? <ConfirmedOrderCard key={order.id} order={order} /> : <CancelledOrderCard key={order.id} order={order} />)}</div>}
    </section>
  );
}
