import { notFound } from "next/navigation";
import { isLocalPaymentPreview } from "@/lib/local-access";
import { ExtraTicketPrototype } from "@/components/extra-ticket-prototype";
import "@/components/extra-ticket-prototype.css";

export const dynamic = "force-dynamic";

/** Standalone local prototype: no login, real orders or admin access. */
export default async function ExtraTicketsPreviewPage() {
  if (!isLocalPaymentPreview(process.env)) notFound();
  return <ExtraTicketPrototype />;
}
