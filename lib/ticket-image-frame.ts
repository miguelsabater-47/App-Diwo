/** Local-only raster composition: add breathing room without resizing the ticket/QR. */
export async function frameTicketImage(dataUrl: string, format: "png" | "jpg"): Promise<string> {
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
  return canvas.toDataURL(format === "png" ? "image/png" : "image/jpeg", 0.96);
}
