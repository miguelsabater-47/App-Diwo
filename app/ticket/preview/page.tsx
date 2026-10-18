import { notFound } from "next/navigation";
import { isLocalPaymentPreview } from "@/lib/local-access";
import { requireAdminAccess } from "@/lib/app-authorization";
import { PendingOrderCard } from "@/components/pending-order-card";
import { TicketsHeading } from "@/components/tickets-heading";

export const dynamic = "force-dynamic";

/** Local admin-only mock, never inserted into orders or mixed with the real history. */
export default async function TicketsPreviewPage() {
  if (!isLocalPaymentPreview(process.env) || !(await requireAdminAccess()).ok) notFound();
  return <section className="diwo-tickets-overview">
    <TicketsHeading />
    <PendingOrderCard preview order={{ id: "preview", reference: "DIWO-A7K9", quantity: 2,
      names: ["Asistente de ejemplo 1", "Asistente de ejemplo 2"], totalCents: 1000,
      actualEvent: true, technical: false, eventTitle: "DIWO X 2.0" }} />
  </section>;
}
