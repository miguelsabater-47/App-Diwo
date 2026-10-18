import { notFound } from "next/navigation";
import { readOrderOverview } from "@/lib/order-reads";
import { requireAdminAccess } from "@/lib/app-authorization";
import { isLocalPaymentPreview } from "@/lib/local-access";
import { requestDesignExamples } from "@/lib/admin-requests-model";
import { AdminRequests } from "@/components/admin-requests";
import { RefreshOrders } from "@/components/refresh-orders";

export const dynamic = "force-dynamic";

export default async function AdminRequestsPage({ searchParams }: { searchParams?: Promise<{ preview?: string | string[] }> } = {}) {
  const preview = (await searchParams)?.preview;
  if (preview !== undefined && preview !== "1") notFound();
  if (preview === "1") {
    if (!isLocalPaymentPreview(process.env) || !(await requireAdminAccess()).ok) notFound();
    return <AdminRequests orders={requestDesignExamples()} preview />;
  }
  const result = await readOrderOverview("admin", { contacts: true }); // Independent current-admin reader, not layout alone.
  if (!result.ok) return <section role="alert" className="mx-auto max-w-xl space-y-4 px-5 py-8 text-zinc-300">
    <p>No hemos podido cargar las solicitudes autorizadas. No se mostrará un listado vacío como si estuviera comprobado.</p><RefreshOrders />
  </section>;
  return <AdminRequests orders={result.orders} allowPreview={isLocalPaymentPreview(process.env)} />;
}
