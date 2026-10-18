import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { hasConfiguredClerkKeys, isLocalPaymentPreview } from "@/lib/local-access";
import { requireAdminAccess } from "@/lib/app-authorization";
import { readOwnedTicket } from "@/lib/owned-ticket-reader";
import { OwnedTicketDetail, type AdjacentTickets } from "@/components/owned-ticket-detail";
import { readOrderOverview } from "@/lib/order-reads";
import { ticketNavigation } from "@/lib/ticket-gallery";

export const dynamic = "force-dynamic";

export default async function TicketDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams?: Promise<{ original?: string | string[] }>;
}) {
  if (!hasConfiguredClerkKeys(process.env)) redirect("/setup");
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const { id } = await params;
  const result = await readOwnedTicket(id);
  if (!result.ok && result.status === 404) notFound();
  const overview = result.ok ? await readOrderOverview("buyer") : null;
  const navigation = result.ok && overview?.ok ? ticketNavigation(overview.orders, result.ticket) : null;
  // During local visual work, the retained fixtures must not be presented as
  // real-event tickets. Open the separate clean mock instead; never rewrite data.
  // Explicit original inspection remains available with ?original=1.
  if (result.ok && result.technical && isLocalPaymentPreview(process.env) &&
      (await searchParams)?.original !== "1" && (await requireAdminAccess()).ok) {
    redirect(`/ticket/design?entry=${Math.min((navigation?.current ?? 0) + 1, 2)}`);
  }
  async function readNeighbor(offset: number): Promise<NonNullable<AdjacentTickets["next"]> | null> {
    if (!result.ok || !navigation) return null;
    const href = navigation.hrefs[navigation.current + offset];
    if (!href) return null;
    try {
      const target = decodeURIComponent(href.slice("/ticket/".length)).toLowerCase();
      const neighbor = await readOwnedTicket(target);
      if (!neighbor.ok || neighbor.ticket.id !== target || neighbor.ticket.orderId !== result.ticket.orderId ||
          neighbor.ticket.eventId !== result.ticket.eventId) return null;
      return neighbor;
    } catch { return null; } // Neighbor failures must not hide the current owned ticket.
  }
  // Only the two adjacent tickets of this same PERSONAL order, each independently
  // authorized by the existing reader. No raw QR token or admin-wide preload.
  const [previous, next] = await Promise.all([readNeighbor(-1), readNeighbor(1)]);
  return <OwnedTicketDetail result={result} navigation={navigation} adjacent={{ previous, next }} />;
}
