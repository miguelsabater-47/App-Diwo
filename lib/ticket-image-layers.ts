export type TicketImageRect = { x: number; y: number; width: number; height: number };
export type TicketImageLayer = TicketImageRect & { image: HTMLImageElement; kind: "artwork" | "qr"; radius: number };
export type TicketImageLayers = {
  width: number; height: number; images: TicketImageLayer[]; reference: TicketImageRect;
};

/** Keep private QR data local and independent of the SVG/foreignObject renderer. */
export async function ticketImageLayers(card: HTMLElement, qr: string | null): Promise<TicketImageLayers> {
  const bounds = card.getBoundingClientRect();
  if (!Number.isFinite(bounds.width) || !Number.isFinite(bounds.height) || bounds.width <= 0 || bounds.height <= 0) {
    throw new Error("invalid_ticket_layout");
  }
  const rect = (node: Element | null): TicketImageRect => {
    if (!node) throw new Error("ticket_image_element_missing");
    const box = node.getBoundingClientRect();
    const result = { x: box.left - bounds.left, y: box.top - bounds.top, width: box.width, height: box.height };
    if (!Object.values(result).every(Number.isFinite) || result.width <= 0 || result.height <= 0 ||
      result.x < 0 || result.y < 0 || result.x + result.width > bounds.width + 1 || result.y + result.height > bounds.height + 1) {
      throw new Error("invalid_ticket_image_layout");
    }
    return result;
  };
  const load = async (src: string) => {
    const image = new Image();
    image.src = src;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        image.decode(),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("ticket_image_decode_timeout")), 15000); }),
      ]);
    } finally { if (timeout !== undefined) clearTimeout(timeout); }
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("ticket_image_decode_failed");
    return image;
  };

  const artwork = card.querySelector<HTMLImageElement>(".diwo-ticket-art");
  const frame = card.querySelector(".diwo-ticket-artwork");
  if (!artwork || !frame) throw new Error("ticket_artwork_missing");
  const source = new URL(artwork.currentSrc || artwork.src, window.location.href);
  if (source.origin !== window.location.origin || source.pathname !== "/imagen%20entrada.jpg") {
    throw new Error("unexpected_ticket_artwork_source");
  }
  const reference = rect(card.querySelector(".diwo-ticket-order"));
  const radius = Number.parseFloat(getComputedStyle(frame).borderTopLeftRadius) || 0;
  const images: TicketImageLayer[] = [{ ...rect(artwork), kind: "artwork", radius, image: await load(source.href) }];
  const qrElement = card.querySelector<HTMLImageElement>("[data-ticket-qr]");
  if (qr === null) {
    if (qrElement) throw new Error("unexpected_private_qr_in_design");
  } else {
    if (!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(qr) || !qrElement || qrElement.src !== qr) {
      throw new Error("ticket_qr_image_mismatch");
    }
    const image = await load(qr);
    if (image.naturalWidth !== image.naturalHeight) throw new Error("invalid_ticket_qr_dimensions");
    images.push({ ...rect(qrElement), kind: "qr", radius: 0, image });
  }
  return { width: bounds.width, height: bounds.height, images, reference };
}
