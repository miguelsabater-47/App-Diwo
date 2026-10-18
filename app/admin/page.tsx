import Link from "next/link";
import { readOrderOverview } from "@/lib/order-reads";
import { orderSummary } from "@/lib/order-view-model";
import { RefreshOrders } from "@/components/refresh-orders";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const result = await readOrderOverview("admin");
  if (!result.ok) return <section role="alert" className="mx-auto max-w-xl px-5 py-8 text-zinc-300">No hemos podido cargar el resumen autorizado. Actualiza la página.</section>;
  const stats = orderSummary(result.orders);
  return <section className="mx-auto max-w-4xl px-5 py-7">
    <header className="mb-6 flex flex-wrap items-center justify-between gap-4"><h1 className="text-3xl font-bold text-white">Resumen</h1><RefreshOrders /></header>
    <Link href="/admin/requests" className="mb-6 block rounded-2xl bg-primary p-6 text-black outline-none focus-visible:ring-2 focus-visible:ring-white"><h2 className="text-xl font-bold">Solicitudes pendientes</h2><p className="mt-3 text-4xl font-bold">{stats.pending}</p><p className="mt-2 text-sm">Comprobar Bizum y confirmar entradas →</p></Link>
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">{[
      ['Entradas emitidas', stats.issued], ['Pedidos pagados', stats.paidOrders],
      ['Importe confirmado', new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(stats.totalCents / 100)],
      ['Accesos registrados', stats.used], ['Pendientes de entrar', stats.unused],
    ].map(([label, value]) => <div key={label} className="rounded-xl border border-zinc-800 bg-card p-4"><p className="text-xs text-zinc-400">{label}</p><p className="mt-3 text-2xl font-bold text-white">{value}</p></div>)}</div>
    <p className="mt-5 text-xs leading-relaxed text-zinc-400">Datos actuales de DIWO X 2.0. Los registros técnicos se excluyen de estas estadísticas. Accesos acumulados, no ocupación. Pulsa Actualizar para consultar cambios.</p>
    {result.orders.some((o) => o.technical) && <p className="mt-4 rounded-xl border border-zinc-800 p-4 text-sm text-zinc-300">Hay registros de prueba conservados. Puedes consultarlos, identificados como técnicos, en Solicitudes.</p>}
    <Button asChild variant="secondary" className="mt-6 min-h-12"><Link href="/admin/scan">Abrir escáner</Link></Button>
  </section>;
}
