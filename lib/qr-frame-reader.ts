export type DecodedQr = { rawValue: string };
export type QrFrameReader = { detect(video: HTMLVideoElement): Promise<DecodedQr[]>; dispose(): void };
type NativeReader = { detect(video: HTMLVideoElement): Promise<DecodedQr[]> };
type NativeConstructor = { new(options: { formats: string[] }): NativeReader; getSupportedFormats(): Promise<string[]> };
type SoftwareDecoder = typeof import("jsqr").default;
type Dependencies = {
  native?: NativeConstructor;
  canvas(): HTMLCanvasElement;
  loadSoftware(): Promise<SoftwareDecoder>;
};

/** Local-only decoder: no images or QR content leave the browser here. */
export async function createQrFrameReader(deps: Dependencies = {
  native: (window as unknown as { BarcodeDetector?: NativeConstructor }).BarcodeDetector,
  canvas: () => document.createElement("canvas"),
  loadSoftware: async () => (await import("jsqr")).default,
}): Promise<QrFrameReader> {
  let native: NativeReader | null = null;
  let decoder: SoftwareDecoder | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let disposed = false;
  try {
    if (deps.native && (await deps.native.getSupportedFormats()).includes("qr_code")) native = new deps.native({ formats: ["qr_code"] });
  } catch { /* A broken/partial native API must not disable the software reader. */ }
  async function software(video: HTMLVideoElement): Promise<DecodedQr[]> {
    decoder ??= await deps.loadSoftware();
    if (disposed) { decoder = null; return []; }
    if (!video.videoWidth || !video.videoHeight) return [];
    canvas ??= deps.canvas();
    // Bound CPU/memory on mobile, while keeping enough pixels for a 64-hex QR.
    const scale = Math.min(1, 960 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("camera_canvas_unavailable");
    let pixels: ImageData | null = null;
    try {
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const found = decoder(pixels.data, pixels.width, pixels.height, { inversionAttempts: "attemptBoth" });
      return found ? [{ rawValue: found.data }] : [];
    } finally {
      pixels?.data.fill(0);
      context.clearRect(0, 0, canvas.width, canvas.height);
    }
  }
  return {
    async detect(video) {
      if (disposed) return [];
      if (native) {
        try { const codes = await native.detect(video); return disposed ? [] : codes; }
        catch { native = null; }
      }
      return software(video);
    },
    dispose() {
      disposed = true; native = null; decoder = null;
      if (canvas) { canvas.width = 0; canvas.height = 0; canvas = null; }
    },
  };
}
