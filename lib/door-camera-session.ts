import type { DecodedQr, QrFrameReader } from "./qr-frame-reader";

type Dependencies = {
  video: HTMLVideoElement;
  reader: QrFrameReader;
  media: Pick<MediaDevices, "getUserMedia">;
  schedule(callback: () => void): ReturnType<typeof setTimeout>;
  cancel(timer: ReturnType<typeof setTimeout>): void;
  ready(): void;
  codes(codes: DecodedQr[]): void;
  failure(): void;
};

/** One explicit scan session, with exclusive frame reads and no automatic restart. */
export function createDoorCameraSession(deps: Dependencies) {
  let stopped = false;
  let started = false;
  let stream: MediaStream | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  function stop() {
    if (stopped) return;
    stopped = true;
    if (timer !== null) deps.cancel(timer);
    stream?.getTracks().forEach(track => track.stop());
    if (deps.video.srcObject === stream) deps.video.srcObject = null;
    stream = null; deps.reader.dispose();
  }
  function fail() { if (!stopped) { stop(); deps.failure(); } }
  async function detect() {
    timer = null;
    if (stopped) return;
    try {
      if (deps.video.readyState >= 2) {
        const codes = await deps.reader.detect(deps.video);
        if (stopped) return;
        if (codes.length) { stop(); deps.codes(codes); return; }
      }
      if (!stopped) timer = deps.schedule(() => void detect());
    } catch { fail(); }
  }
  return {
    stop,
    async start() {
      if (stopped || started) return;
      started = true;
      try {
        const media = await deps.media.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } } });
        if (stopped) { media.getTracks().forEach(track => track.stop()); return; }
        stream = media; deps.video.srcObject = media;
        await deps.video.play();
        if (stopped) return;
        deps.ready(); void detect();
      } catch { fail(); }
    },
  };
}
