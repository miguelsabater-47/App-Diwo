import Link from "next/link";
import { TicketGallery } from "@/components/ticket-gallery";
import type { OwnedTicketResult } from "@/lib/owned-ticket-reader";
import type { TicketNavigation } from "@/lib/ticket-gallery";
import type { AdjacentTickets } from "@/lib/ticket-carousel-model";

export type { AdjacentTickets } from "@/lib/ticket-carousel-model";

export function OwnedTicketDetail({ result, designPreview = false, navigation, adjacent }: {
  result: OwnedTicketResult; designPreview?: boolean; navigation?: TicketNavigation | null; adjacent?: AdjacentTickets;
}) {
  if (!result.ok) return <section className="diwo-ticket-screen"><p role="alert" className="diwo-ticket-unavailable">No hemos podido cargar el detalle de tu entrada. Inténtalo de nuevo más tarde.</p><Link href="/ticket" className="text-[var(--diwo-yellow)] underline">Volver a Mis entradas</Link></section>;
  return <TicketGallery key={`${result.ticket.id}:${result.ticket.status}`} initial={result} navigation={navigation} adjacent={adjacent} designPreview={designPreview} />;
}
