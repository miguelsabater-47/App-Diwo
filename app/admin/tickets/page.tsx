import { readOrderOverview } from "@/lib/order-reads";
import { adminTickets } from "@/lib/admin-ticket-model";
import { AdminTickets } from "@/components/admin-tickets";
import { RefreshOrders } from "@/components/refresh-orders";

export const dynamic = "force-dynamic";
export default async function AdminTicketsPage() {
  // Reader independently requires current admin, in addition to the layout gate.
  const result = await readOrderOverview("admin");
  if (!result.ok) return <section role="alert" className="mx-auto max-w-xl space-y-4 px-5 py-8 text-zinc-300">
    <p>No hemos podido cargar las entradas autorizadas. No se mostrará un listado vacío como si estuviera comprobado.</p><RefreshOrders />
  </section>;
  return <AdminTickets tickets={adminTickets(result.orders)} />;
}
