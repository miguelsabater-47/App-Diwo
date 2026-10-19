import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { hasConfiguredClerkKeys, isLocalPaymentPreview } from "@/lib/local-access";
import { requireAdminAccess } from "@/lib/app-authorization";
import { readOrderOverview } from "@/lib/order-reads";
import { paymentPhone } from "@/lib/order-payment-state";
import { OrderPaymentDetails } from "@/components/order-payment-details";
import { RefreshOrders } from "@/components/refresh-orders";

export const dynamic = "force-dynamic";

export default async function PaymentPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ quantity?: string | string[] }>;
}) {
  if (!hasConfiguredClerkKeys(process.env)) redirect("/setup");
  if (!(await auth()).userId) redirect("/sign-in");
  const { id } = await params;
  if (id === "preview") {
    // Same customer presentation, but this branch cannot load/create an order.
    if (!isLocalPaymentPreview(process.env) || !(await requireAdminAccess()).ok) notFound();
    const raw = (await searchParams).quantity ?? "1";
    const quantity = typeof raw === "string" && /^[1-9]\d*$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isSafeInteger(quantity) || quantity < 1 || !Number.isSafeInteger(quantity * 500)) notFound();
    return <OrderPaymentDetails preview reference="A7K9" quantity={quantity} totalCents={quantity * 500}
      phone={paymentPhone(process.env.DIWO_BIZUM_PHONE)} />;
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  // PERSONAL reader explicitly filters the verified actor, including admin.
  const result = await readOrderOverview("buyer");
  if (!result.ok) return <section role="alert" className="diwo-payment space-y-4 py-6 text-zinc-300">
    <h1 className="text-2xl font-bold text-white">Instrucciones de pago</h1>
    <p>No hemos podido consultar tu solicitud. No realices un pago hasta que podamos mostrar sus datos verificados.</p>
    <RefreshOrders />
  </section>;
  const order = result.orders.find(candidate => candidate.id.toLowerCase() === id.toLowerCase());
  if (!order) notFound();
  // Bookmarks must not invite another payment after approval or cancellation.
  if (order.status !== "pending") redirect("/ticket");
  return <>
    {order.technical && <p className="diwo-payment text-sm text-primary">Prueba técnica conservada · No realices un pago por esta solicitud.</p>}
    <OrderPaymentDetails preview={false} reference={order.reference} quantity={order.quantity} totalCents={order.totalCents}
      phone={order.actualEvent && !order.technical ? paymentPhone(process.env.DIWO_BIZUM_PHONE) : null} requestCreated />
  </>;
}
