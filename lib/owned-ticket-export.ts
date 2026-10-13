export function exportTicketImageType(mime: string): "png" | "jpg" | null {
  return mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : null;
}

/** Do not export a different, stale, terminal, or externally rendered QR. */
export function freshTicketQr(value: unknown, expectedId: string): string | null {
  if (!value || typeof value !== "object" || !("ok" in value) || value.ok !== true ||
    !("ticket" in value) || !value.ticket || typeof value.ticket !== "object") return null;
  const ticket = value.ticket;
  if (!("id" in ticket) || ticket.id !== expectedId || !("status" in ticket) || ticket.status !== "valid" ||
    !("qrDataUrl" in ticket) || typeof ticket.qrDataUrl !== "string" ||
    !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(ticket.qrDataUrl)) return null;
  return ticket.qrDataUrl;
}

type SharePlatform = { canShare?: (data?: ShareData) => boolean; share?: (data?: ShareData) => Promise<void> };
export async function shareTicketImage(platform: SharePlatform, data: ShareData): Promise<"shared" | "download"> {
  if (!platform.share || !platform.canShare || !platform.canShare(data)) return "download";
  await platform.share(data);
  return "shared";
}
