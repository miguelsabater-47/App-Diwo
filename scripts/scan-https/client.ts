import { createQrFrameReader } from "../../lib/qr-frame-reader";
import { createDoorCameraSession } from "../../lib/door-camera-session";
import { createScanRehearsal, rehearsalLabels, type RehearsalCase } from "../../lib/scan-rehearsal";
import { scanFeedback } from "../../lib/door-scan-feedback";

async function main() {
  const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const start = element<HTMLButtonElement>("start"), pause = element<HTMLButtonElement>("pause");
  const video = element<HTMLVideoElement>("camera"), status = element<HTMLDivElement>("result");
  const title = element<HTMLHeadingElement>("result-title"), detail = element<HTMLParagraphElement>("result-detail");
  const select = element<HTMLSelectElement>("fixture"), qr = element<HTMLImageElement>("qr");
  const offline = element<HTMLInputElement>("offline");
  let active = false, generation = 0;
  let camera: ReturnType<typeof createDoorCameraSession> | null = null;
  const response = await fetch("/fixtures.json", { credentials: "omit", cache: "no-store", redirect: "error" });
  if (!response.ok) throw new Error("rehearsal_unavailable");
  const data: unknown = await response.json();
  if (!data || typeof data !== "object" || !("session" in data) || typeof data.session !== "string") throw new Error("rehearsal_unavailable");
  const model = createScanRehearsal(data.session);
  for (const fixture of model.fixtures) {
    const option = document.createElement("option"); option.value = fixture.kind; option.textContent = fixture.label; select.append(option);
  }
  const updateQr = () => { qr.src = `/qr-${select.value}.svg`; qr.alt = rehearsalLabels[select.value as RehearsalCase]; };
  select.addEventListener("change", updateQr); updateQr();
  function stop() {
    active = false; generation++; camera?.stop(); camera = null;
    start.disabled = false; pause.disabled = true; offline.disabled = false;
  }
  function message(text: string) {
    status.hidden = false; status.className = "unconfirmed";
    title.textContent = "No se ha podido comprobar"; detail.textContent = text; status.focus();
  }
  start.disabled = !window.isSecureContext || !navigator.mediaDevices?.getUserMedia;
  if (start.disabled) { message("Se necesita HTTPS con certificado confiable y permiso de cámara. No se ha simulado ningún acceso."); return; }
  pause.addEventListener("click", stop);
  const hide = () => { if (document.hidden) { stop(); status.hidden = true; } };
  document.addEventListener("visibilitychange", hide);
  window.addEventListener("pagehide", stop);
  start.addEventListener("click", async () => {
    if (active || document.hidden) return;
    active = true; const run = ++generation;
    start.disabled = true; pause.disabled = false; offline.disabled = true; status.hidden = true;
    const current = () => active && generation === run && !document.hidden;
    const failure = () => { if (current()) { stop(); message("Revisa el permiso de cámara de Safari y la confianza del certificado. No se ha simulado ningún acceso."); } };
    try {
      const reader = await createQrFrameReader();
      if (!current()) { reader.dispose(); return; }
      camera = createDoorCameraSession({ video, reader, media: navigator.mediaDevices,
        schedule: callback => setTimeout(callback, 200), cancel: clearTimeout, ready() {}, failure,
        codes(codes) {
          if (!current()) return;
          stop();
          if (codes.length !== 1) { message("Muestra un solo QR ficticio cada vez."); return; }
          const receipt = model.read(codes[0].rawValue, !offline.checked), feedback = scanFeedback(receipt.outcome);
          status.hidden = false; status.className = feedback.tone; title.textContent = feedback.title;
          detail.textContent = receipt.outcome === "admitted" ? "Admisión simulada. No autoriza acceso real." : feedback.detail;
          const counts = model.counts();
          element("counts").textContent = `Simulado: usadas ${counts.used} · pendientes ${counts.pending} · válidas ${counts.total}`;
          status.focus();
        },
      });
      await camera.start();
    } catch { failure(); }
  });
}
void main().catch(() => {
  const status = document.getElementById("startup-error");
  if (status) { status.hidden = false; status.textContent = "No se ha podido preparar el ensayo. No se ha iniciado la cámara ni ningún acceso real."; }
});
