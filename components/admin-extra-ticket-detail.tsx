"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { ArrowLeft, Download, Share2 } from "lucide-react";
import { OwnedTicketCard } from "@/components/owned-ticket-card";
import { extraTicketDetail, type ExtraTicket } from "@/lib/extra-ticket-model";
import { revokedTicketReceipt } from "@/lib/admin-ticket-model";
import type { ReadyTicket } from "@/lib/ticket-carousel-model";
import { withRequestDeadline } from "@/lib/request-deadline";
import { ticketImageLayers } from "@/lib/ticket-image-layers";
import { frameTicketImage } from "@/lib/ticket-image-frame";
import { shareTicketImage } from "@/lib/owned-ticket-export";

export type ExtraShareOutcome = { message: string | null; download: File | null };

/** Only real, fresh admin RPC projections can reach this card/export pipeline. */
export function AdminExtraTicketDetail({ ticket, onBack, onChanged, quickShare = false, onQuickShareDone }: {
  ticket: ExtraTicket; onBack(): void; onChanged(ticket: ExtraTicket): void;
  quickShare?: boolean; onQuickShareDone?(outcome: ExtraShareOutcome): void;
}) {
  const { userId, isLoaded } = useAuth();
  const actor = useRef(userId), currentActor = useRef(userId); currentActor.current = userId;
  const alive = useRef(false), flight = useRef(false), started = useRef(false);
  const writeLock = useRef(false);
  const [result, setResult] = useState<ReadyTicket | null>(null);
  const [message, setMessage] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false), [locked, setLocked] = useState(false);
  const [prepared, setPrepared] = useState<{ href: string; name: string } | null>(null);
  const imageUrl = useRef<string | null>(null), heading = useRef<HTMLHeadingElement>(null), cancel = useRef<HTMLButtonElement>(null);
  const complete = useRef(onQuickShareDone); complete.current = onQuickShareDone;
  const current = () => alive.current && !!actor.current && actor.current === currentActor.current;

  async function read(signal: AbortSignal) {
    const response = await fetch(`/api/admin/extra-tickets/${encodeURIComponent(ticket.id)}`, {
      credentials: "same-origin", redirect: "error", cache: "no-store", signal,
    });
    const value = response.ok ? extraTicketDetail(await response.json(), ticket) : null;
    if (!value) throw new Error("extra_ticket_unavailable");
    return value;
  }
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    if (!quickShare) heading.current?.focus({ preventScroll: true });
    void withRequestDeadline(signal => read(signal), 15000, controller.signal).then(value => {
      if (current()) setResult(value);
    }).catch(() => {
      if (!current()) return;
      const error = "No se ha podido comprobar esta entrada. Vuelve al listado e inténtalo de nuevo.";
      setMessage(error); if (quickShare) complete.current?.({ message: error, download: null });
    });
    return () => { alive.current = false; controller.abort(); if (imageUrl.current) URL.revokeObjectURL(imageUrl.current); };
    // Immutable ticket identity is keyed by the workspace; latest status is read from DB.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket.id, quickShare]);
  useEffect(() => { if (confirming) cancel.current?.focus(); }, [confirming]);

  function save(file: File) {
    if (imageUrl.current) URL.revokeObjectURL(imageUrl.current);
    const href = URL.createObjectURL(file); imageUrl.current = href; setPrepared({ href, name: file.name });
    const anchor = document.createElement("a"); anchor.href = href; anchor.download = file.name;
    anchor.target = "_blank"; anchor.rel = "noopener noreferrer"; document.body.appendChild(anchor);
    try { anchor.click(); } finally { anchor.remove(); }
  }
  async function exportImage(share: boolean, format: "png" | "jpg" = "png") {
    if (!current() || flight.current || !result || result.ticket.status !== "valid" || locked || writeLock.current) return;
    flight.current = true; setBusy(true); setMessage(null); setPrepared(null);
    let feedback: string | null = null, fallback: File | null = null;
    try {
      const latest = await withRequestDeadline(signal => read(signal), 15000);
      if (!current()) return;
      setResult(latest);
      if (latest.ticket.status !== "valid" || !latest.ticket.qrDataUrl) throw new Error("extra_ticket_terminal");
      const card = document.getElementById("owned-ticket-export");
      const validCard = () => current() && document.getElementById("owned-ticket-export") === card && card?.getAttribute("data-ticket-id") === ticket.id;
      if (!card || !validCard()) throw new Error("card_changed");
      const qr = card.querySelector<HTMLImageElement>("[data-ticket-qr]");
      if (!qr) throw new Error("qr_missing");
      qr.src = latest.ticket.qrDataUrl; await qr.decode();
      await document.fonts.ready;
      const layers = await ticketImageLayers(card, latest.ticket.qrDataUrl);
      if (!validCard()) return;
      const { toPng, toJpeg } = await import("html-to-image");
      const options = { pixelRatio: 2, backgroundColor: "#000000", cacheBust: false };
      const raster = format === "png" ? await toPng(card, options) : await toJpeg(card, { ...options, quality: .96 });
      const image = await frameTicketImage(raster, format, layers);
      if (!validCard()) return;
      const bytes = Uint8Array.from(atob(image.split(",")[1]), value => value.charCodeAt(0));
      const file = new File([bytes], `diwo-extra-${ticket.id.slice(0, 8)}.${format}`, { type: format === "png" ? "image/png" : "image/jpeg" });
      if (share) {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          const outcome = await Promise.race([shareTicketImage(navigator, { files: [file], title: "Entrada DIWO X 2.0" }),
            new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("share_timeout")), 15000); })]);
          if (outcome === "download") { fallback = file; feedback = "Puedes guardar la imagen y compartirla desde tu dispositivo."; }
        } catch (error) {
          if (!(error instanceof DOMException && error.name === "AbortError")) {
            fallback = file; feedback = "No se ha podido abrir el menú de compartir. Puedes guardar la imagen y compartirla manualmente.";
          }
        } finally { if (timeout !== undefined) clearTimeout(timeout); }
      } else fallback = file;
      if (current() && fallback && !quickShare) save(fallback);
    } catch {
      feedback = "No se ha podido preparar la entrada. Comprueba su estado antes de volver a intentarlo.";
    } finally {
      flight.current = false;
      if (current()) {
        setBusy(false); setMessage(feedback);
        if (quickShare) complete.current?.({ message: feedback, download: fallback });
      }
    }
  }
  useEffect(() => {
    if (!quickShare || !result || started.current) return;
    started.current = true;
    if (result.ticket.status !== "valid") complete.current?.({ message: "La entrada ya no está disponible para compartir.", download: null });
    else void exportImage(true);
    // The first checked result starts a single export, not every state update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickShare, result]);

  async function annul() {
    if (!current() || flight.current || writeLock.current || locked || !confirming || result?.ticket.status !== "valid") return;
    writeLock.current = true; flight.current = true; setBusy(true); setMessage(null); setPrepared(null);
    try {
      const receipt = await withRequestDeadline(async signal => {
        const response = await fetch("/api/tickets/revoke", { method: "POST", credentials: "same-origin", redirect: "error", cache: "no-store",
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticketId: ticket.id }), signal });
        return response.ok ? revokedTicketReceipt(await response.json(), ticket.id) : null;
      }, 15000);
      if (!current()) return;
      if (!receipt) throw new Error("revocation_unresolved");
      setResult({ ...result, ticket: { ...result.ticket, status: "revoked", revokedAt: receipt, qrDataUrl: null } });
      onChanged({ ...ticket, status: "revoked", revokedAt: receipt }); setConfirming(false);
      if (imageUrl.current) URL.revokeObjectURL(imageUrl.current);
      setMessage("Entrada anulada. Su QR ya no permite el acceso.");
    } catch { if (current()) { setLocked(true); setMessage("No se ha podido confirmar la anulación. Vuelve a abrir el detalle para comprobar su estado; no se reintentará automáticamente."); } }
    finally { flight.current = false; if (current()) setBusy(false); }
  }
  if (!isLoaded || !userId || userId !== actor.current) return null;
  if (quickShare) return <div className="diwo-extra-share-render" inert aria-hidden="true">{result && <OwnedTicketCard result={result} />}</div>;
  return <section className="diwo-admin-requests diwo-extra-detail">
    <header className="diwo-admin-detail-heading"><button type="button" aria-label="Volver a entradas" disabled={busy} onClick={onBack}><ArrowLeft aria-hidden="true" /></button>
      <div><h1 ref={heading} tabIndex={-1}>Entrada extra</h1><p>{ticket.reference} · Invitación de cortesía</p></div></header>
    {result ? <OwnedTicketCard result={result} /> : !message && <p role="status">Comprobando entrada…</p>}
    {result?.ticket.status === "valid" && <>
      <div className="diwo-ticket-actions"><button type="button" className="diwo-ticket-share" disabled={busy || locked} onClick={() => void exportImage(true)}>COMPARTIR <Share2 aria-hidden="true" /></button>
        <button type="button" className="diwo-ticket-download" disabled={busy || locked} onClick={() => void exportImage(false)}>DESCARGAR <Download aria-hidden="true" /></button></div>
      <button type="button" className="diwo-admin-text-link" disabled={busy || locked} onClick={() => void exportImage(false, "jpg")}>Descargar en JPG</button>
      {!confirming ? <button type="button" className="diwo-admin-button diwo-admin-danger diwo-extra-annul" disabled={busy || locked} onClick={() => setConfirming(true)}>Anular entrada</button>
        : <div className="diwo-admin-ticket-confirm" role="group" aria-label="Confirmar anulación"><h2>¿Anular la entrada de {ticket.name}?</h2><p>Su QR dejará de permitir el acceso. Esta acción no se puede deshacer.</p>
          <div className="diwo-admin-extra-actions"><button ref={cancel} type="button" className="diwo-admin-button diwo-admin-outline" disabled={busy || locked} onClick={() => setConfirming(false)}>Conservar entrada</button>
            <button type="button" className="diwo-admin-button diwo-admin-danger" disabled={busy || locked} onClick={() => void annul()}>Confirmar anulación</button></div></div>}
    </>}
    {message && <p role="status" className="diwo-ticket-action-feedback">{message}</p>}
    {prepared && <p className="diwo-ticket-action-feedback"><a href={prepared.href} download={prepared.name} target="_blank" rel="noopener noreferrer">Abrir o guardar imagen</a></p>}
  </section>;
}
