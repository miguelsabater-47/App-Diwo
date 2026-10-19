import { notFound } from "next/navigation";
import { isLocalPaymentPreview } from "@/lib/local-access";
import { requireAdminAccess } from "@/lib/app-authorization";
import { OwnedTicketDetail } from "@/components/owned-ticket-detail";
import type { OwnedTicketResult } from "@/lib/owned-ticket-reader";

export const dynamic = "force-dynamic";

/** No database ticket, private QR or approval; exports are QR-free design images. */
export default async function TicketDesignPage({ searchParams }: { searchParams?: Promise<{ entry?: string | string[] }> } = {}) {
  if (!isLocalPaymentPreview(process.env) || !(await requireAdminAccess()).ok) notFound();
  const raw = (await searchParams)?.entry ?? "1";
  const position = typeof raw === "string" && /^[1-2]$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(position)) notFound();
  const example = (entry: number): Extract<OwnedTicketResult, { ok: true }> => ({ ok: true, technical: false, ticket: {
    id: `8f3c2${entry === 1 ? "a" : "b"}00-2ed0-4a8b-9b15-000000000001`, orderId: "a7c924f1-2ed0-4a8b-9b15-000000000002",
    eventId: "a7c924f1-2ed0-4a8b-9b15-000000000003", attendeeName: "Pablo Romero Martínez", status: "valid",
    issuedAt: "2026-10-17T00:00:00Z", usedAt: null, revokedAt: null,
    eventSlug: "diwo-x-2-2026", eventTitle: "DIWO X 2.0", startsAt: "2026-10-31T22:30:00Z",
    endsAt: "2026-11-01T06:00:00Z", timezone: "Europe/Madrid", publicLocation: "Casa de campo en Ceutí",
    unitPriceCents: 500, currency: "EUR", orderReference: "A7K9", qrDataUrl: null,
  } });
  return <OwnedTicketDetail result={example(position)} designPreview navigation={{ current: position - 1,
    hrefs: [1, 2].map(entry => `/ticket/design?entry=${entry}`) }}
    adjacent={{ previous: position > 1 ? example(position - 1) : null, next: position < 2 ? example(position + 1) : null }} />;
}
