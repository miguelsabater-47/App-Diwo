import type { TicketImageLayers } from "./ticket-image-layers";

/** Local-only raster composition, bypassing foreignObject for artwork/private QR. */
export async function frameTicketImage(dataUrl: string, format: "png" | "jpg", layers?: TicketImageLayers): Promise<string> {
  if (!/^data:image\/(?:png|jpeg);base64,/.test(dataUrl)) throw new Error("invalid_ticket_raster");
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const width = image.naturalWidth, height = image.naturalHeight;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) throw new Error("invalid_ticket_dimensions");
  const margin = Math.max(1, Math.round(width * 0.08));
  const canvas = document.createElement("canvas");
  canvas.width = width + margin * 2;
  canvas.height = height + margin * 2;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("ticket_canvas_unavailable");
  context.fillStyle = "#000000";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, margin, margin);
  if (layers) {
    const scale = width / layers.width;
    if (!Number.isFinite(scale) || scale <= 0 || Math.abs(height - layers.height * scale) > 2) {
      throw new Error("ticket_raster_layout_changed");
    }
    for (const layer of layers.images) {
      const x = margin + Math.round(layer.x * scale), y = margin + Math.round(layer.y * scale);
      const w = Math.round(layer.width * scale), h = Math.round(layer.height * scale);
      if (w <= 0 || h <= 0) throw new Error("invalid_ticket_image_dimensions");
      context.save();
      try {
        if (layer.kind === "artwork") {
          // Clip the artwork's top corners without relying on newer roundRect APIs.
          const r = Math.min(layer.radius * scale, w / 2, h / 2);
          context.beginPath();
          context.moveTo(x + r, y);
          context.lineTo(x + w - r, y);
          context.quadraticCurveTo(x + w, y, x + w, y + r);
          context.lineTo(x + w, y + h);
          context.lineTo(x, y + h);
          context.lineTo(x, y + r);
          context.quadraticCurveTo(x, y, x + r, y);
          context.closePath(); context.clip();
          // Same centered object-fit: cover as the on-screen poster.
          const fit = Math.max(w / layer.image.naturalWidth, h / layer.image.naturalHeight);
          const sw = w / fit, sh = h / fit;
          context.drawImage(layer.image, (layer.image.naturalWidth - sw) / 2, (layer.image.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
        } else {
          context.imageSmoothingEnabled = false;
          context.fillStyle = "#fff"; context.fillRect(x, y, w, h);
          context.drawImage(layer.image, x, y, w, h);
          // Fail closed if the supposedly rendered QR is still blank.
          const pixels = context.getImageData(x, y, w, h).data;
          let dark = false, light = false;
          for (let p = 0; p < pixels.length && !(dark && light); p += 4) {
            dark ||= pixels[p] < 80 && pixels[p + 1] < 80 && pixels[p + 2] < 80 && pixels[p + 3] > 200;
            light ||= pixels[p] > 175 && pixels[p + 1] > 175 && pixels[p + 2] > 175 && pixels[p + 3] > 200;
          }
          if (!dark || !light) throw new Error("ticket_qr_raster_blank");
        }
      } finally { context.restore(); }
    }
    // The reference sits above the artwork. Restore its black-backed label from
    // the text raster so direct image composition cannot paint over it.
    const label = layers.reference;
    context.drawImage(image, label.x * scale, label.y * scale, label.width * scale, label.height * scale,
      margin + label.x * scale, margin + label.y * scale, label.width * scale, label.height * scale);
  }
  return canvas.toDataURL(format === "png" ? "image/png" : "image/jpeg", 0.96);
}
