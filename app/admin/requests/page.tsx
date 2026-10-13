import { readOrderOverview } from "@/lib/order-reads";
import { RefreshOrders } from "@/components/refresh-orders";
import { ApproveOrderPayment } from "@/components/approve-order-payment";

export const dynamic = "force-dynamic";

export default async function AdminRequestsPage() {
  const result = await readOrderOverview("admin");
  if (!result.ok) return <section role="alert" className="mx-auto max-w-xl px-5 py-8 text-zinc-300">No hemos podido cargar las solicitudes autorizadas. Actualiza la página.</section>;
  const orders = [...result.orders].sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending'));
  const labels = { pending: 'Pendiente de pago', confirmed: 'Pago confirmado', rejected: 'Rechazada', cancelled: 'Cancelada' };
  return <section className="mx-auto max-w-3xl px-5 py-7">
    <header className="mb-6 flex flex-wrap items-center justify-between gap-4"><h1 className="text-3xl font-bold text-white">Solicitudes</h1><RefreshOrders /></header>
    {!orders.length && <p className="rounded-2xl border border-zinc-800 bg-card p-6 text-zinc-300">Todavía no hay solicitudes.</p>}
    <div className="space-y-5">{orders.map((o) => <article key={o.id} className="rounded-2xl border border-zinc-800 bg-card p-5 sm:p-6">
      {o.technical && <p className="mb-4 text-sm font-semibold text-primary">PRUEBA TÉCNICA · No válida para DIWO</p>}
      <div className="flex flex-wrap justify-between gap-3"><p className="break-all font-mono text-sm text-zinc-400">{o.reference}</p><p className="text-sm font-semibold text-primary">{labels[o.status]}</p></div>
      <h2 className="mt-4 break-words text-xl font-semibold text-white">{o.buyerName}</h2>
      <p className="mt-2 text-sm text-zinc-300">{o.quantity} {o.quantity === 1 ? 'entrada' : 'entradas'} · <strong>{new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(o.totalCents / 100)}</strong></p>
      <p className="mt-3 text-sm text-zinc-400">{o.status === 'confirmed' ? 'Pago comprobado y confirmado por la organización.' : o.reportedAt ? 'Aviso del comprador: pago comunicado. El aviso no confirma el ingreso.' : 'El comprador no ha comunicado el pago.'}</p>
      <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-zinc-200">{o.names.map((name, index) => <li key={index} className="break-words">{name}</li>)}</ol>
      {o.status === 'pending' && <ApproveOrderPayment orderId={o.id} quantity={o.quantity} technical={o.technical} />}
      {o.status === 'confirmed' && <p className="mt-5 text-sm text-zinc-300">{o.tickets.length} entradas emitidas. El estado de cada entrada se conserva en su historial.</p>}
    </article>)}</div>
  </section>;
}
