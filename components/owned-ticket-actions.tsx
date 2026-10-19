"use client";

import { useEffect, useRef, useState } from "react";
import { toJpeg, toPng } from "html-to-image";
import { Button } from "@/components/ui/button";
import { Download, Share2, LoaderCircle } from "lucide-react";
import { exportTicketImageType, shareTicketImage, freshTicketQr } from "@/lib/owned-ticket-export";
import { frameTicketImage } from "@/lib/ticket-image-frame";
import { withRequestDeadline } from "@/lib/request-deadline";

export function OwnedTicketActions({ ticketId, technical, designPreview = false, cardLayout = false }: { ticketId: string; technical: boolean; designPreview?: boolean; cardLayout?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<"png" | "jpg" | "share" | null>(null);
  const inFlight = useRef(false);
  const [prepared, setPrepared] = useState<{ href: string; name: string; scope: string; qrOnly: boolean } | null>(null);
  const imageUrl = useRef<string | null>(null);
  const lifetime = useRef(0);
  const scope = `${ticketId}:${designPreview}`;
  useEffect(() => () => {
    lifetime.current++;
    if (imageUrl.current) URL.revokeObjectURL(imageUrl.current);
    imageUrl.current = null;
  }, [ticketId, designPreview]);
  const disabled = busy;

  function prepareImage(file: File, qrOnly = false) {
    if (imageUrl.current) URL.revokeObjectURL(imageUrl.current);
    const href = URL.createObjectURL(file);
    imageUrl.current = href;
    setPrepared({ href, name: file.name, scope, qrOnly });
    return href;
  }

  function download(file: File) {
    const anchor = document.createElement("a");
    anchor.href = prepareImage(file); anchor.download = file.name;
    anchor.target = "_blank"; anchor.rel = "noopener noreferrer"; anchor.style.display = "none";
    document.body.appendChild(anchor);
    try { anchor.click(); } finally { anchor.remove(); }
    // Keep the URL alive for mobile download/preview and the explicit fallback
    // link. Release it on replacement/unmount, not after an arbitrary second.
  }

  async function shareImage(file: File, isCurrent: () => boolean) {
    let timeout: number | undefined;
    try {
      // Preparation and sharing belong to the same click. Browser activation can
      // expire during a slow export; handle refusal without a staged second click.
      const sharing = shareTicketImage(navigator, { files: [file], title: designPreview ? "Diseño de entrada DIWO" : "Entrada DIWO X 2.0", text: designPreview ? "Vista de diseño sin QR de acceso." : technical ? "Prueba técnica conservada; no válida para el evento real." : "Entrada DIWO X 2.0" });
      const outcome = await Promise.race([
        sharing,
        new Promise<never>((_, reject) => {
          timeout = window.setTimeout(() => reject(new DOMException("Share timed out", "TimeoutError")), 15000);
        }),
      ]);
      if (!isCurrent()) return;
      if (outcome === "download") {
        download(file);
        setMessage("Este dispositivo no admite compartir archivos. Puedes guardar la imagen con el enlace y compartirla manualmente.");
      }
    } catch (error) {
      if (!isCurrent()) return;
      if (error instanceof DOMException && error.name === "TimeoutError") setMessage("El menú de compartir ha tardado demasiado en responder. Puedes descargar la entrada y compartirla manualmente. Si el menú sigue abierto, ciérralo antes de volver a intentarlo.");
      else if (error instanceof DOMException && error.name === "NotAllowedError") {
        download(file);
        setMessage("El navegador no ha permitido abrir el menú de compartir. Puedes guardar la imagen con el enlace y compartirla manualmente.");
      }
      else if (!(error instanceof DOMException && error.name === "AbortError")) setMessage("No hemos podido compartir la imagen. Puedes descargarla y compartirla manualmente.");
    } finally {
      if (timeout !== undefined) window.clearTimeout(timeout);
    }
  }

  async function exportImage(share: boolean, format: "png" | "jpg" = "png") {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setActiveAction(share ? "share" : format); setMessage(null);
    const run = lifetime.current;
    const isCurrent = () => lifetime.current === run;
    setPrepared(null);
    const cardId = designPreview ? "owned-ticket-design" : "owned-ticket-export";
    let latestQr: string | null = null;
    let selectedCard: HTMLElement | null = null;
    try {
      if (!designPreview) {
        const latest: unknown = await withRequestDeadline(async signal => {
          const response = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}`, {
            credentials: "same-origin", redirect: "error", cache: "no-store", signal,
          });
          return response.ok ? await response.json() : null;
        }, 15000);
        if (!isCurrent()) return;
        latestQr = freshTicketQr(latest, ticketId);
        if (!latestQr) {
          setMessage("La entrada ya no está disponible para exportar. Actualiza el detalle para consultar su estado.");
          return;
        }
      }
      const card = document.getElementById(cardId);
      if (!card || card.getAttribute("data-ticket-id") !== ticketId) { setMessage("La entrada mostrada ha cambiado. Abre de nuevo su detalle antes de descargarla."); return; }
      selectedCard = card;
      const qrImage = card.querySelector<HTMLImageElement>("[data-ticket-qr]");
      if (designPreview) {
        // A design export must never borrow a private QR or query a synthetic ID.
        if (qrImage) throw new Error("unexpected_private_qr_in_design");
      } else {
        if (!qrImage || !latestQr) throw new Error("qr_image_missing");
        qrImage.src = latestQr;
        await qrImage.decode();
      }
      if (document.fonts) await document.fonts.ready;
      if (!isCurrent()) return;
      if (document.getElementById(cardId) !== card || card.getAttribute("data-ticket-id") !== ticketId) {
        setMessage("La entrada mostrada ha cambiado. Abre de nuevo su detalle antes de descargarla."); return;
      }
      if (designPreview && card.querySelector("[data-ticket-qr]")) throw new Error("unexpected_private_qr_in_design");
      const dataUrl = format === "png"
        ? await toPng(card, { pixelRatio: 2, backgroundColor: "#000000", cacheBust: false })
        : await toJpeg(card, { pixelRatio: 2, quality: 0.96, backgroundColor: "#000000", cacheBust: false });
      const framed = await frameTicketImage(dataUrl, format);
      if (!isCurrent()) return;
      if (document.getElementById(cardId) !== card || card.getAttribute("data-ticket-id") !== ticketId) {
        setMessage("La entrada mostrada ha cambiado. Abre de nuevo su detalle antes de descargarla."); return;
      }
      const blob = await (await fetch(framed)).blob();
      if (!isCurrent()) return;
      const type = exportTicketImageType(blob.type);
      if (!type) throw new Error("image_export_failed");
      const file = new File([blob], `${designPreview ? "diwo-diseno" : "diwo-entrada"}-${ticketId.slice(0, 8)}.${type}`, { type: blob.type });
      if (share) {
        await shareImage(file, isCurrent);
        return;
      }
      download(file);
    } catch (error) {
      if (!isCurrent()) return;
      if (error instanceof DOMException && error.name === "AbortError") return;
      // Some mobile renderers cannot rasterize this card. Offer the exact fresh
      // server QR as an explicitly labelled alternative, never a new token.
      if (!designPreview && latestQr && selectedCard && document.getElementById(cardId) === selectedCard && selectedCard.getAttribute("data-ticket-id") === ticketId) {
        try {
          const blob = await (await fetch(latestQr)).blob();
          if (!isCurrent()) return;
          if (document.getElementById(cardId) !== selectedCard || selectedCard.getAttribute("data-ticket-id") !== ticketId) return;
          prepareImage(new File([blob], `diwo-qr-${ticketId.slice(0, 8)}.png`, { type: "image/png" }), true);
          setMessage("El navegador no ha podido generar la imagen completa. Puedes guardar solo el QR verificado con el enlace.");
        } catch { if (isCurrent()) setMessage("No hemos podido preparar la entrada. Inténtalo de nuevo."); }
      } else if (error instanceof DOMException && error.name === "TimeoutError") setMessage("La comprobación ha tardado demasiado. Comprueba tu conexión e inténtalo de nuevo.");
      else setMessage("No hemos podido preparar la entrada. Inténtalo de nuevo.");
    } finally { inFlight.current = false; if (isCurrent()) { setBusy(false); setActiveAction(null); } }
  }

  const saveLink = prepared?.scope === scope ? <p className={cardLayout ? "diwo-ticket-action-feedback" : "text-sm leading-relaxed text-zinc-300 sm:col-span-2"}>
    <a href={prepared.href} download={prepared.name} target="_blank" rel="noopener noreferrer" className="text-primary underline">{prepared.qrOnly ? "Guardar solo el QR (PNG)" : "Abrir o guardar imagen"}</a>
    {" · Si el móvil abre la imagen, mantén pulsado sobre ella para guardarla."}
  </p> : null;
  if (cardLayout) return <div className="diwo-ticket-actions">
    <Button type="button" disabled={disabled} aria-label="Compartir entrada" aria-busy={activeAction === "share"}
      className="diwo-ticket-share" onClick={() => void exportImage(true)}>
      <span>{activeAction === "share" ? "PREPARANDO…" : "COMPARTIR"}</span>{activeAction === "share" ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Share2 aria-hidden="true" />}
    </Button>
    <Button type="button" disabled={disabled} aria-label="Descargar entrada PNG" aria-busy={activeAction === "png"}
      className="diwo-ticket-download" onClick={() => void exportImage(false, "png")}>
      <span>{activeAction === "png" ? "PREPARANDO…" : "DESCARGAR"}</span>{activeAction === "png" ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Download aria-hidden="true" />}
    </Button>
    {message && <p role="status" className="diwo-ticket-action-feedback">{message}</p>}
    {saveLink}
  </div>;
  return <div className="mt-6 grid gap-3 sm:grid-cols-2">
    <Button type="button" disabled={disabled} className="min-h-12" onClick={() => void exportImage(false, "png")}>{activeAction === "png" ? "Preparando…" : "Descargar entrada PNG"}</Button>
    <Button type="button" variant="outline" disabled={disabled} className="min-h-12" onClick={() => void exportImage(false, "jpg")}>{activeAction === "jpg" ? "Preparando…" : "Descargar entrada JPG"}</Button>
    <Button type="button" variant="outline" disabled={disabled} aria-label="Compartir entrada" aria-busy={activeAction === "share"} title="Compartir entrada" className="min-h-12 w-12 justify-self-end sm:col-span-2" onClick={() => void exportImage(true)}>
      {activeAction === "share" ? <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 animate-spin fill-none stroke-current" strokeWidth="2"><circle cx="12" cy="12" r="9" opacity="0.25" /><path d="M12 3a9 9 0 0 1 9 9" /></svg> : <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4" /></svg>}
    </Button>
    {message && <p role="status" className="text-sm leading-relaxed text-zinc-300 sm:col-span-2">{message}</p>}
    {saveLink}
  </div>;
}
