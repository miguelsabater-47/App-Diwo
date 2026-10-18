type Dependencies = {
  bitmap(file: Blob): Promise<ImageBitmap>;
  canvas(): HTMLCanvasElement;
  decoder(): Promise<typeof import("jsqr").default>;
};

/** Rehearsal-only file reader. No uploads, URLs, persistence or camera requests. */
export async function readQrImage(file: Blob, current: () => boolean, deps: Dependencies = {
  bitmap: file => createImageBitmap(file),
  canvas: () => document.createElement("canvas"),
  decoder: async () => (await import("jsqr")).default,
}): Promise<string | null> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("qr_image_type");
  if (file.size === 0 || file.size > 5 * 1024 * 1024) throw new Error("qr_image_size");
  if (!current()) return null;
  const bitmap = await deps.bitmap(file);
  let canvas: HTMLCanvasElement | null = null;
  let pixels: ImageData | null = null;
  try {
    if (!current()) return null;
    if (bitmap.width <= 0 || bitmap.height <= 0 || bitmap.width > 8192 || bitmap.height > 8192 || bitmap.width * bitmap.height > 16_000_000) throw new Error("qr_image_dimensions");
    const decode = await deps.decoder();
    if (!current()) return null;
    canvas = deps.canvas();
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("qr_image_context");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const result = decode(pixels.data, pixels.width, pixels.height, { inversionAttempts: "attemptBoth" });
    return current() ? result?.data ?? null : null;
  } finally {
    pixels?.data.fill(0);
    if (canvas) { canvas.width = 0; canvas.height = 0; }
    bitmap.close();
  }
}

export function qrImageErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  if (code === "qr_image_type") return "Elige una imagen PNG, JPEG o WebP. No se admiten SVG, GIF ni otros archivos.";
  if (code === "qr_image_size") return "La imagen debe ocupar entre 1 byte y 5 MB.";
  if (code === "qr_image_dimensions") return "La imagen es demasiado grande. Recorta el QR ficticio o usa su descarga PNG.";
  return "No se ha podido leer la imagen. Usa el PNG del QR ficticio o una captura nítida. No se ha simulado ningún acceso.";
}
