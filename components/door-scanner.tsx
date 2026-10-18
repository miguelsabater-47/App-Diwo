"use client";

import { useEffect, useRef, useState, type Ref } from "react";
import { Button } from "@/components/ui/button";
import { Check, CircleAlert, ScanLine, X } from "lucide-react";
import { doorEvent, scanRecord, scanResult, scanToken, type DoorEvent, type ScanResult } from "@/lib/door-scan-model";
import type { DoorScanDevelopmentState } from "@/lib/door-scan-development-model";

import { createQrFrameReader } from "@/lib/qr-frame-reader";
import { createDoorCameraSession } from "@/lib/door-camera-session";
import { scanFeedback, scanFeedbackStyle } from "@/lib/door-scan-feedback";
function failure(data: unknown) {
  const code = scanRecord(data) ? data.error : null;
  if (code === "scanner_configuration_required") return "El escáner aún no está activado en la base de datos.";
  if (code === "operation_not_authorized" || code === "authentication_required") return "No tienes una sesión con permisos de puerta vigentes. Vuelve a iniciar sesión.";
  if (code === "door_event_unavailable") return "El evento ya no está disponible para el control de acceso.";
  return "Resultado sin confirmar. No autorices el acceso. No se repetirá automáticamente; un nuevo escaneo consultará el estado actual.";
}

/** Presentation of authoritative scan results; connection errors are not ticket states. */
export function renderDoorScanResult({ result, message, resultRef }: {
  result: ScanResult | null; message?: string | null; resultRef?: Ref<HTMLDivElement>;
}) {
  const feedback = scanFeedback(result?.outcome ?? "connection_error");
  const Icon = feedback.tone === "success" ? Check : feedback.tone === "rejected" ? X : CircleAlert;
  return <div ref={resultRef} tabIndex={-1} role="status" aria-live="polite" className={`diwo-door-result is-${feedback.tone} ${scanFeedbackStyle(feedback.tone)}`}>
    <p className="diwo-door-result-eyebrow">Control de acceso</p>
    <span className="diwo-door-result-symbol" aria-hidden="true"><Icon /></span>
    <h2>{feedback.title}</h2>
    <p className="diwo-door-result-instruction">{feedback.detail}</p>
    {result?.name && <div className="diwo-door-result-person"><span className="diwo-admin-buyer-initial" aria-hidden="true">{result.name.trim().charAt(0).toLocaleUpperCase("es")}</span><div><p>Asistente</p><strong>{result.name}</strong></div></div>}
    {result?.usedAt && <p className="diwo-door-result-time">{result.outcome === "admitted" ? "Acceso registrado" : "Primer uso"}: {new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeStyle: "medium", timeZone: "Europe/Madrid" }).format(new Date(result.usedAt))}</p>}
    {message && <p className="diwo-door-result-message">{message}</p>}
    {result?.ticketId && <details className="diwo-door-result-id"><summary>Identificador de entrada</summary><p>{result.ticketId}</p></details>}
  </div>;
}

async function requestDoorScan(source: DoorScanDevelopmentState | null, body?: { eventId: string; token: string }, signal?: AbortSignal) {
  if (source) {
    if (body && source.connectionError) throw new Error("local_scan_connection_error");
    return { response: { ok: true }, data: body ? { result: source.result } : { event: source.event } };
  }
  const response = await fetch("/api/door-scan", {
    ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    cache: "no-store", credentials: "same-origin", redirect: "error", signal,
  });
  const data: unknown = await response.json();
  return { response, data };
}

export function DoorScanner({ development = null }: { development?: DoorScanDevelopmentState | null } = {}) {
  // Freeze the server-authorized source for this mount. A config change remounts
  // the scanner, so a simulated event can never leak into a real POST.
  const source = useRef(process.env.NODE_ENV === "development" ? development : null).current;
  const [event, setEvent] = useState<DoorEvent | null>(source?.event ?? null);
  const [loading, setLoading] = useState(!source);
  const [fresh, setFresh] = useState(!!source);
  const [phase, setPhase] = useState<"idle" | "starting" | "camera" | "checking">("idle");
  const [message, setMessage] = useState<string | null>(source?.connectionError ? failure(null) : null);
  const [result, setResult] = useState<ScanResult | null>(source?.result ?? null);
  const video = useRef<HTMLVideoElement>(null);
  const camera = useRef<ReturnType<typeof createDoorCameraSession> | null>(null);
  const generation = useRef(0);
  const mounted = useRef(false);
  const active = useRef(false);
  const writeFlight = useRef(false);
  const currentEvent = useRef<DoorEvent | null>(source?.event ?? null);
  const resultPanel = useRef<HTMLDivElement>(null);

  function stopCamera() {
    active.current = false; generation.current++;
    camera.current?.stop(); camera.current = null;
  }
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const { response, data } = await requestDoorScan(source, undefined, AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]));
        if (cancelled) return;
        const next = response.ok && scanRecord(data) ? doorEvent(data.event) : null;
        if (!response.ok || !scanRecord(data) || (data.event !== null && !next)) {
          setFresh(false); currentEvent.current = null; stopCamera(); setPhase(previous => previous === "checking" ? previous : "idle"); setResult(null); setMessage(failure(data));
        } else {
          if (currentEvent.current?.id !== next?.id) { stopCamera(); setPhase(previous => previous === "checking" ? previous : "idle"); setResult(null); }
          currentEvent.current = next; setEvent(next); setFresh(true);
        }
      } catch {
        if (!cancelled) { setFresh(false); currentEvent.current = null; stopCamera(); setPhase(previous => previous === "checking" ? previous : "idle"); setResult(null); }
      } finally {
        if (!cancelled) { setLoading(false); timer = setTimeout(refresh, 5000); }
      }
    }
    void refresh();
    const hide = () => { if (document.hidden) { stopCamera(); setPhase(p => p === "checking" ? p : "idle"); setResult(null); } };
    document.addEventListener("visibilitychange", hide);
    return () => { cancelled = true; mounted.current = false; clearTimeout(timer); controller.abort(); stopCamera(); document.removeEventListener("visibilitychange", hide); };
  }, [source]);
  useEffect(() => { if (message || result) resultPanel.current?.focus(); }, [message, result]);

  async function check(token: string, eventId: string) {
    // Invoked once per explicitly started camera session, never by polling/retry.
    if (writeFlight.current) return;
    writeFlight.current = true;
    stopCamera(); setPhase("checking"); setResult(null); setMessage(null);
    const run = generation.current;
    try {
      const { response, data } = await requestDoorScan(source, { eventId, token }, AbortSignal.timeout(20000));
      if (!mounted.current) return;
      if (generation.current !== run) { setMessage(previous => previous ?? failure(null)); return; }
      const receipt = response.ok && scanRecord(data) ? scanResult(data.result) : null;
      if (!receipt) setMessage(failure(data)); else setResult(receipt);
    } catch { if (mounted.current && generation.current === run) setMessage(failure(null)); }
    finally { writeFlight.current = false; if (mounted.current) setPhase("idle"); }
  }
  async function start() {
    if (active.current || writeFlight.current || phase !== "idle" || !fresh || !currentEvent.current || document.hidden) return;
    active.current = true;
    const run = ++generation.current, eventId = currentEvent.current.id;
    setPhase("starting"); setMessage(null); setResult(null);
    const isCurrent = () => mounted.current && active.current && generation.current === run && !document.hidden;
    try {
      const reader = await createQrFrameReader();
      if (!isCurrent() || !video.current) { reader.dispose(); return; }
      camera.current = createDoorCameraSession({
        video: video.current, reader, media: navigator.mediaDevices,
        schedule: callback => setTimeout(callback, 200), cancel: clearTimeout,
        ready: () => { if (isCurrent()) setPhase("camera"); },
        codes: codes => {
          if (!isCurrent()) return;
          if (codes.length > 1) { stopCamera(); setPhase("idle"); setMessage("Muestra una sola entrada cada vez. No se ha registrado ningún acceso."); return; }
          if (!scanToken(codes[0].rawValue)) { stopCamera(); setPhase("idle"); setMessage(null); setResult({ outcome: "unknown", ticketId: null, name: null, usedAt: null }); return; }
          void check(codes[0].rawValue, eventId);
        },
        failure: () => { if (isCurrent()) { stopCamera(); setPhase("idle"); setMessage("No se ha podido abrir o leer la cámara. Revisa el permiso y usa localhost o una conexión HTTPS autorizada. No se ha registrado acceso."); } },
      });
      await camera.current.start();
    } catch {
      if (isCurrent()) {
        stopCamera(); setPhase("idle");
        setMessage("No se ha podido preparar el lector. No se ha registrado acceso. Actualiza la página antes de volver a intentarlo.");
      }
    }
  }
  const cameraRunning = phase === "camera" || phase === "starting";
  return <div className="diwo-door-scanner">
    <section aria-label="Contadores de acceso" className={`diwo-door-counters${!fresh ? " is-stale" : ""}`}>
      <header><h2>{event?.title ?? "Evento DIWO"}</h2><span className={`diwo-door-connection${fresh && event ? " is-ready" : ""}`}>{loading ? "Comprobando" : !fresh ? "Sin actualizar" : !event ? "Sin evento" : "Online"}</span></header>
      {event ? <><dl>
        {[["Han entrado", event.used], ["Pendientes", event.pending], ["Válidas", event.total]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl><p className="diwo-door-note">Válidas = utilizadas + pendientes. Excluye anuladas; no indica ocupación ni permite reentrada.</p></> : null}
      <p role="status" className="diwo-door-note">{loading ? "Verificando evento y permisos…" : !fresh ? "Contadores sin actualizar. Escaneo detenido hasta recuperar la conexión y los permisos." : !event ? "No hay un evento disponible para escanear." : "Contadores actualizados cada 5 segundos."}</p>
    </section>
    {(result || message) && renderDoorScanResult({ result, message, resultRef: resultPanel })}
    <div hidden={!!(result || message)} className={`diwo-door-camera${cameraRunning ? " is-running" : ""}`}>
      <video ref={video} muted playsInline aria-label="Vista de la cámara para leer una entrada" />
      {!cameraRunning && <div className="diwo-door-camera-placeholder"><ScanLine aria-hidden="true" /><p>{phase === "checking" ? "Comprobando entrada…" : "Cámara detenida"}</p><span>{loading ? "Verificando permisos" : !fresh || !event ? "El escáner estará disponible cuando haya un evento y permisos vigentes." : "Pulsa Abrir escáner para leer una entrada."}</span></div>}
      {cameraRunning && <span className="diwo-door-camera-guide" aria-hidden="true" />}
    </div>
    {cameraRunning ? <Button onClick={() => { stopCamera(); setPhase("idle"); }} variant="outline" className="diwo-admin-button diwo-admin-outline diwo-door-scan-button">Detener cámara</Button>
      : <Button onClick={start} disabled={loading || !fresh || !event || phase !== "idle"} className="diwo-admin-button diwo-admin-primary diwo-door-scan-button">{phase === "checking" ? "Comprobando acceso…" : "Abrir escáner"}</Button>}
    <p className="diwo-door-note">Muestra una sola entrada. Al leer un QR válido se registra el acceso online y la cámara se detiene. Para la siguiente entrada, pulsa de nuevo.</p>
  </div>;
}
