"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { ArrowLeft, Download, Share2 } from "lucide-react";
import { OwnedTicketCard } from "@/components/owned-ticket-card";
import { prototypeQrPayload, prototypeTicketCard, type PrototypeTicket } from "@/lib/extra-ticket-prototype";
import { ticketImageLayers } from "@/lib/ticket-image-layers";
import { frameTicketImage } from "@/lib/ticket-image-frame";
import { shareTicketImage } from "@/lib/owned-ticket-export";

export type PrototypeQuickShareOutcome = { message: string | null; download: File | null };

/** No private ticket reader/actions: this component cannot query a synthetic ID. */
export function ExtraTicketPrototypeDetail({ ticket, onBack, onAnnul, quickShare = false, onQuickShareDone }: {
  ticket: PrototypeTicket; onBack(): void; onAnnul(): void;
  quickShare?: boolean; onQuickShareDone?(outcome: PrototypeQuickShareOutcome): void;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [prepared, setPrepared] = useState<{ href: string; name: string } | null>(null);
  const alive = useRef(false), flight = useRef(false), imageUrl = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null), cancel = useRef<HTMLButtonElement>(null);
  const quickDone = useRef(onQuickShareDone), quickStart = useRef<(() => Promise<void>) | null>(null);
  const quickStarted = useRef(false), quickDownload = useRef<File | null>(null), feedback = useRef<string | null>(null);
  quickDone.current = onQuickShareDone;
  function report(value: string) { feedback.current = value; setMessage(value); }
  useEffect(() => {
    let cancelled = false;
    alive.current = true;
    if (!quickShare) heading.current?.focus();
    if (ticket.status === "valid") {
      void QRCode.toDataURL(prototypeQrPayload(ticket), { width: 420, margin: 4, errorCorrectionLevel: "M" })
        .then(value => { if (!cancelled && alive.current) setQr(value); })
        .catch(() => {
          if (cancelled || !alive.current) return;
          const error = "No hemos podido preparar la entrada. Inténtalo de nuevo.";
          report(error); if (quickShare) quickDone.current?.({ message: error, download: null });
        });
    }
    return () => { cancelled = true; alive.current = false; if (imageUrl.current) URL.revokeObjectURL(imageUrl.current); };
    // The parent keys the detail by ID + status, isolating every async lifetime.
  }, [ticket, quickShare]);
  useEffect(() => { if (confirming) cancel.current?.focus(); }, [confirming]);
  useEffect(() => {
    if (quickShare && qr && !quickStarted.current) {
      quickStarted.current = true; void quickStart.current?.();
    }
  }, [quickShare, qr]);

  function save(file: File) {
    if (quickShare) { quickDownload.current = file; return; }
    if (imageUrl.current) URL.revokeObjectURL(imageUrl.current);
    const href = URL.createObjectURL(file); imageUrl.current = href; setPrepared({ href, name: file.name });
    const anchor = document.createElement("a");
    anchor.href = href; anchor.download = file.name; anchor.rel = "noopener noreferrer"; anchor.target = "_blank";
    document.body.appendChild(anchor); try { anchor.click(); } finally { anchor.remove(); }
  }

  async function exportImage(share: boolean, format: "png" | "jpg" = "png") {
    if (flight.current || !qr || ticket.status !== "valid") return;
    flight.current = true; setBusy(true); setMessage(null); feedback.current = null;
    try {
      const card = document.getElementById("owned-ticket-export");
      const current = () => alive.current && document.getElementById("owned-ticket-export") === card && card?.getAttribute("data-ticket-id") === ticket.id;
      if (!card || !current()) return;
      await document.fonts.ready;
      const layers = await ticketImageLayers(card, qr);
      if (!current()) return;
      const { toPng, toJpeg } = await import("html-to-image");
      const options = { pixelRatio: 2, backgroundColor: "#000000", cacheBust: false };
      const raster = format === "png" ? await toPng(card, options) : await toJpeg(card, { ...options, quality: .96 });
      const image = await frameTicketImage(raster, format, layers);
      if (!current()) return;
      const bytes = Uint8Array.from(atob(image.split(",")[1]), value => value.charCodeAt(0));
      const file = new File([bytes], `diwo-local-${ticket.reference}.${format}`, { type: format === "png" ? "image/png" : "image/jpeg" });
      if (share) {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          const outcome = await Promise.race([
            shareTicketImage(navigator, { files: [file], title: "Entrada DIWO X 2.0" }),
            new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("share_timeout")), 15000); }),
          ]);
          if (current() && outcome === "download") { save(file); report("Puedes guardar la imagen y compartirla desde tu dispositivo."); }
        } catch (error) {
          if (current() && !(error instanceof DOMException && error.name === "AbortError")) {
            save(file); report("No se ha podido abrir el menú de compartir. Puedes guardar la imagen y compartirla desde tu dispositivo.");
          }
        } finally { if (timeout !== undefined) clearTimeout(timeout); }
      } else save(file);
    } catch (error) {
      if (alive.current && !(error instanceof DOMException && error.name === "AbortError")) report("No hemos podido preparar la imagen. Inténtalo de nuevo o utiliza la descarga.");
    } finally {
      flight.current = false;
      if (alive.current) {
        setBusy(false);
        if (quickShare) quickDone.current?.({ message: feedback.current, download: quickDownload.current });
      }
    }
  }
  quickStart.current = () => exportImage(true);

  // Rasterize the same card offscreen, without a detail screen or focus changes.
  if (quickShare) return <div className="diwo-prototype-detail diwo-prototype-share-render" aria-hidden="true" inert>
    {qr && <OwnedTicketCard result={prototypeTicketCard(ticket, qr)} displayNumber={ticket.reference} />}
  </div>;

  return <section className="diwo-prototype-detail">
    <header className="diwo-admin-detail-heading"><button type="button" aria-label="Volver a entradas" disabled={busy} onClick={onBack}><ArrowLeft aria-hidden="true" /></button>
      <div><h1 ref={heading} tabIndex={-1}>Entrada {ticket.kind === "extra" ? "extra" : "general"}</h1><p>{ticket.reference} · {ticket.kind === "extra" ? "Invitación · Sin pago" : "Compra general"}</p></div>
    </header>
    {ticket.status !== "valid" || qr ? <OwnedTicketCard result={prototypeTicketCard(ticket, qr)} displayNumber={ticket.reference} /> : <p role="status">Cargando entrada…</p>}
    {ticket.status === "valid" && <>
      <div className="diwo-ticket-actions">
        <button className="diwo-ticket-share" type="button" disabled={busy || !qr} onClick={() => void exportImage(true)}><span>{busy ? "PREPARANDO…" : "COMPARTIR"}</span><Share2 aria-hidden="true" /></button>
        <button className="diwo-ticket-download" type="button" disabled={busy || !qr} onClick={() => void exportImage(false)}><span>DESCARGAR</span><Download aria-hidden="true" /></button>
      </div>
      <button className="diwo-admin-text-link" type="button" disabled={busy || !qr} onClick={() => void exportImage(false, "jpg")}>Descargar en JPG</button>
      {!confirming ? <button className="diwo-admin-button diwo-admin-danger diwo-prototype-annul" type="button" disabled={busy} onClick={() => setConfirming(true)}>Anular entrada</button>
        : <div className="diwo-admin-ticket-confirm" role="group" aria-labelledby="annul-heading"><h2 id="annul-heading">¿Anular la entrada de {ticket.name}?</h2><p>La entrada dejará de permitir el acceso. Esta acción no se puede deshacer.</p>
          <div className="diwo-admin-extra-actions"><button ref={cancel} className="diwo-admin-button diwo-admin-outline" type="button" onClick={() => setConfirming(false)}>Conservar entrada</button><button className="diwo-admin-button diwo-admin-danger" type="button" onClick={onAnnul}>Confirmar anulación</button></div>
        </div>}
    </>}
    {message && <p role="status" className="diwo-ticket-action-feedback">{message}</p>}
    {prepared && <p className="diwo-ticket-action-feedback"><a href={prepared.href} download={prepared.name} target="_blank" rel="noopener noreferrer">Abrir o guardar imagen</a></p>}
  </section>;
}
