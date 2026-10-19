import type { DecodedQr, QrFrameReader } from "./qr-frame-reader";

type Dependencies = {
  video: HTMLVideoElement;
  reader: QrFrameReader | Promise<QrFrameReader>;
  media: Pick<MediaDevices, "getUserMedia"> | undefined;
  schedule(callback: () => void): ReturnType<typeof setTimeout>;
  cancel(timer: ReturnType<typeof setTimeout>): void;
  ready(): void;
  codes(codes: DecodedQr[]): void;
  failure(error: unknown): void;
};

/** One explicit scan session, with exclusive frame reads and no automatic restart. */
export function createDoorCameraSession(deps: Dependencies) {
  let stopped = false;
  let started = false;
  let stream: MediaStream | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let reader: QrFrameReader | null = null;
  // Attach a rejection handler immediately, even while permission is pending.
  const readerReady = Promise.resolve(deps.reader).then(value => {
    if (stopped) value.dispose(); else reader = value;
  }, error => fail(error));
  function stop() {
    if (stopped) return;
    stopped = true;
    if (timer !== null) deps.cancel(timer);
    stream?.getTracks().forEach(track => track.stop());
    if (deps.video.srcObject === stream) deps.video.srcObject = null;
    stream = null; reader?.dispose(); reader = null;
  }
  function fail(error: unknown) { if (!stopped) { stop(); deps.failure(error); } }
  async function detect() {
    timer = null;
    if (stopped) return;
    try {
      if (reader && deps.video.readyState >= 2) {
        const codes = await reader.detect(deps.video);
        if (stopped) return;
        if (codes.length) { stop(); deps.codes(codes); return; }
      }
      if (!stopped) timer = deps.schedule(() => void detect());
    } catch (error) { fail(error); }
  }
  return {
    stop,
    async start() {
      if (stopped || started) return;
      started = true;
      try {
        if (!deps.media?.getUserMedia) throw { name: "NotSupportedError" };
        // Called synchronously by start(), before awaiting decoder preparation:
        // do not lose the mobile browser's explicit user gesture.
        const media = await deps.media.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } } });
        if (stopped) { media.getTracks().forEach(track => track.stop()); return; }
        stream = media; deps.video.srcObject = media;
        deps.video.muted = true; deps.video.defaultMuted = true; deps.video.playsInline = true;
        await deps.video.play();
        if (stopped) return;
        deps.ready();
        await readerReady;
        if (!stopped) void detect();
      } catch (error) { fail(error); }
    },
  };
}
