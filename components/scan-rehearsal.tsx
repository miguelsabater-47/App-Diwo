"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { createQrFrameReader } from "@/lib/qr-frame-reader";
import { createDoorCameraSession } from "@/lib/door-camera-session";
import { readQrImage, qrImageErrorMessage } from "@/lib/qr-image-reader";
import { createScanRehearsal, rehearsalLabels, type RehearsalCase, type RehearsalReceipt } from "@/lib/scan-rehearsal";
import { scanFeedback, scanFeedbackStyle } from "@/lib/door-scan-feedback";
export function ScanRehearsal() {
  const model = useRef<ReturnType<typeof createScanRehearsal> | null>(null);
  const [selected, setSelected] = useState<RehearsalCase>("valid");
  const [qr, setQr] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [offline, setOffline] = useState(false);
  const [phase, setPhase] = useState<"idle" | "starting" | "camera" | "image">("idle");
  const [receipt, setReceipt] = useState<RehearsalReceipt | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [counts, setCounts] = useState({ used: 0, pending: 1, total: 1 });
  const video = useRef<HTMLVideoElement>(null);
  const camera = useRef<ReturnType<typeof createDoorCameraSession> | null>(null);
  const result = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const active = useRef(false);
  const mounted = useRef(false);

  function stop() { generation.current++; active.current = false; camera.current?.stop(); camera.current = null; }
  useEffect(() => {
    mounted.current = true;
    model.current = createScanRehearsal(crypto.randomUUID()); setReady(true);
    const hide = () => { if (document.hidden) { stop(); setPhase("idle"); setReceipt(null); } };
    document.addEventListener("visibilitychange", hide);
    return () => { mounted.current = false; stop(); model.current = null; document.removeEventListener("visibilitychange", hide); };
  }, []);
  useEffect(() => {
    if (!ready || !model.current) return;
    let cancelled = false;
    setQr(null);
    const token = model.current.fixtures.find(f => f.kind === selected)!.token;
    void import("qrcode").then(module => module.toDataURL(token, { width: 360, margin: 4, errorCorrectionLevel: "M" }))
      .then(data => { if (!cancelled) setQr(data); })
      .catch(() => { if (!cancelled) setMessage("No se ha podido generar el QR ficticio. Actualiza el ensayo."); });
    return () => { cancelled = true; };
  }, [ready, selected]);
  useEffect(() => { if (receipt || message) result.current?.focus(); }, [receipt, message]);
  async function start() {
    if (active.current || !model.current || !video.current || document.hidden) return;
    active.current = true; const run = ++generation.current;
    setPhase("starting"); setReceipt(null); setMessage(null);
    const current = () => mounted.current && active.current && generation.current === run && !document.hidden;
    function fail() { if (current()) { stop(); setPhase("idle"); setMessage("No se ha podido abrir o leer la cámara. Revisa el permiso. No se ha registrado ningún acceso real ni simulado."); } }
    try {
      const reader = await createQrFrameReader();
      if (!current() || !video.current) { reader.dispose(); return; }
      camera.current = createDoorCameraSession({
        video: video.current, reader, media: navigator.mediaDevices,
        schedule: callback => setTimeout(callback, 200), cancel: clearTimeout,
        ready: () => { if (current()) setPhase("camera"); }, failure: fail,
        codes: codes => {
          if (!current() || !model.current) return;
          stop(); setPhase("idle");
          if (codes.length !== 1) { setMessage("Muestra un solo QR ficticio cada vez. No se ha simulado ningún acceso."); return; }
          setReceipt(model.current.read(codes[0].rawValue, !offline)); setCounts(model.current.counts());
        },
      });
      await camera.current.start();
    } catch { fail(); }
  }
  async function loadImage(file: File) {
    if (active.current || !model.current || document.hidden) return;
    active.current = true; const run = ++generation.current;
    setPhase("image"); setReceipt(null); setMessage(null);
    const current = () => mounted.current && active.current && generation.current === run && !document.hidden;
    try {
      const token = await readQrImage(file, current);
      if (!current() || !model.current) return;
      stop(); setPhase("idle");
      if (token === null) { setMessage("No se ha encontrado un QR en la imagen. Usa el PNG del QR ficticio o recorta una captura. No se ha simulado ningún acceso."); return; }
      setReceipt(model.current.read(token, !offline)); setCounts(model.current.counts());
    } catch (error) {
      if (current()) { stop(); setPhase("idle"); setMessage(qrImageErrorMessage(error)); }
    }
  }
  const feedback = scanFeedback(receipt?.outcome ?? "connection_error");
  return <div className="mt-6 space-y-6">
    <aside className="rounded-2xl border border-amber-400 p-5 text-amber-100">
      <h2 className="font-bold">ENSAYO LOCAL · Sin validez de acceso</h2>
      <p className="mt-2 text-sm">No consulta ni escribe entradas en Supabase. Los QR y resultados son ficticios y solo existen en esta pestaña. Recargar reinicia este ensayo, nunca una entrada real.</p>
      <p className="mt-2 text-sm">No comprueba el check-in de la base de datos ni la sincronización entre dos móviles. No publiques el evento para probar esta pantalla.</p>
    </aside>
    <section aria-label="QR ficticios" className="rounded-2xl border border-zinc-800 p-5">
      <label htmlFor="rehearsal-case" className="block text-sm font-semibold">QR que quieres mostrar</label>
      <select id="rehearsal-case" value={selected} onChange={event => setSelected(event.target.value as RehearsalCase)} className="mt-3 min-h-12 w-full rounded-lg border border-zinc-600 bg-zinc-950 px-3 text-white focus-visible:outline-2 focus-visible:outline-amber-400">
        {Object.entries(rehearsalLabels).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
      </select>
      <div className="mx-auto mt-5 aspect-square w-full max-w-[360px] rounded-lg bg-white p-2">
        {/* Local synthetic data URL; never a real ticket or an external image. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {qr ? <img src={qr} width={360} height={360} alt={`Solo ensayo local: ${rehearsalLabels[selected]}`} className="h-full w-full" /> : <p className="p-5 text-center text-black" role="status">Preparando QR ficticio…</p>}
      </div>
      {qr && <Button asChild variant="outline" className="mt-4 min-h-12 w-full"><a href={qr} download={`diwo-ensayo-qr-${selected}.png`}>Descargar QR ficticio PNG</a></Button>}
      <p className="mt-3 text-xs text-zinc-400">Sin webcam: descarga este PNG y cárgalo abajo. Con webcam: haz una foto y muéstrala a la cámara. No recargues ni abras otra sesión del ensayo: sus QR serán distintos. No uses entradas reales.</p>
    </section>
    <section aria-label="Lectura de imagen del ensayo" className="space-y-4 rounded-2xl border border-zinc-800 p-5">
      <h2 className="text-xl font-bold">Cargar imagen del QR</h2>
      <p id="rehearsal-image-help" className="text-sm text-zinc-400">PNG, JPEG o WebP de hasta 5 MB. Procesamiento local: el archivo no se sube a ningún servidor ni se guarda en la aplicación. Esta opción no prueba la cámara.</p>
      <label htmlFor="rehearsal-image" className="block text-sm font-semibold">Seleccionar imagen ficticia</label>
      <input id="rehearsal-image" type="file" accept="image/png,image/jpeg,image/webp" disabled={!ready || phase !== "idle"} aria-describedby="rehearsal-image-help" className="block min-h-12 w-full min-w-0 rounded-lg border border-zinc-600 p-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-zinc-800 file:p-2 file:text-white focus-visible:outline-2 focus-visible:outline-amber-400 disabled:opacity-50" onChange={event => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (file) void loadImage(file);
      }} />
      {phase === "image" && <><p role="status" className="text-sm">Leyendo imagen local…</p><Button variant="outline" className="min-h-12 w-full" onClick={() => { stop(); setPhase("idle"); }}>Cancelar lectura de imagen</Button></>}
    </section>
    <section aria-label="Cámara del ensayo" className="space-y-4">
      <h2 className="text-xl font-bold">Leer con la cámara de este dispositivo</h2>
      <video ref={video} muted playsInline aria-label="Vista de cámara del ensayo local" className="aspect-square max-h-[45dvh] w-full rounded-2xl border border-zinc-800 bg-black object-cover" />
      <label className="flex min-h-12 items-center gap-3 text-sm"><input type="checkbox" checked={offline} disabled={phase !== "idle"} onChange={event => setOffline(event.target.checked)} className="size-5 accent-amber-400" />Simular fallo de conexión (solo ensayo)</label>
      {phase === "starting" || phase === "camera" ? <Button className="min-h-12 w-full" variant="outline" onClick={() => { stop(); setPhase("idle"); }}>Detener cámara del ensayo</Button>
        : <Button className="min-h-12 w-full" disabled={!ready || phase !== "idle"} onClick={start}>Abrir cámara del ensayo</Button>}
      <p className="text-sm text-zinc-400">Una lectura por pulsación. Repite el QR A para comprobar el rechazo. Para usar la cámara en un móvil hará falta un origen HTTPS autorizado; la dirección localhost de tu ordenador no sirve desde el teléfono.</p>
    </section>
    <section aria-label="Contadores ficticios" className="rounded-2xl border border-zinc-800 p-5">
      <h2 className="font-bold">Contadores simulados · No son métricas del evento</h2>
      <dl className="mt-4 grid grid-cols-3 gap-3 text-center">{[["Usadas", counts.used], ["Pendientes", counts.pending], ["Válidas", counts.total]].map(([label,value]) => <div key={label}><dt className="text-xs text-zinc-400">{label}</dt><dd className="mt-1 text-2xl font-bold">{value}</dd></div>)}</dl>
    </section>
    {(receipt || message) && <div ref={result} tabIndex={-1} role="status" aria-live="polite" className={`rounded-2xl border p-5 outline-offset-4 ${scanFeedbackStyle(feedback.tone)}`}>
      <p className="text-xs font-bold uppercase">Solo ensayo · No autoriza acceso real</p>
      <h2 className="mt-2 text-2xl font-bold">{feedback.title}</h2>
      <p className="mt-2 text-sm">{receipt?.outcome === "admitted" ? "Admisión simulada. No autoriza acceso real." : feedback.detail}</p>
      {receipt?.usedAt && <p className="mt-3 text-sm">Primer uso ficticio: {new Intl.DateTimeFormat("es-ES", { timeStyle: "medium", timeZone: "Europe/Madrid" }).format(new Date(receipt.usedAt))}</p>}
      {message && <p className="mt-3 text-sm">{message}</p>}
    </div>}
  </div>;
}
