"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@clerk/nextjs";
import { ArrowLeft, Minus, Plus, Search, Share2, UserRound } from "lucide-react";
import { AdminTickets } from "@/components/admin-tickets";
import { AdminTicketListItem } from "@/components/admin-ticket-list-item";
import { AnimatedAttendeeRow } from "@/components/animated-attendee-row";
import { AdminExtraTicketDetail, type ExtraShareOutcome } from "@/components/admin-extra-ticket-detail";
import { filterAdminTickets, type AdminTicket } from "@/lib/admin-ticket-model";
import { extraDraft, extraTicketResponse, type ExtraDraft, type ExtraTicket } from "@/lib/extra-ticket-model";
import { withRequestDeadline } from "@/lib/request-deadline";

const states = [["all", "Todas"], ["valid", "Sin usar"], ["used", "Utilizadas"], ["revoked", "Anuladas"]] as const;

/** Real admin workspace. Every write/read independently rechecks the current DB role. */
export function AdminTicketWorkspace({ tickets, extras }: { tickets: AdminTicket[]; extras: ExtraTicket[] }) {
  const { userId, isLoaded } = useAuth();
  const actor = useRef(userId), currentActor = useRef(userId); currentActor.current = userId;
  const mounted = useRef(false), flight = useRef(false), sequence = useRef(1);
  const [rows, setRows] = useState(extras);
  const [kind, setKind] = useState<"general" | "extra">("general");
  const [status, setStatus] = useState("all"), [search, setSearch] = useState("");
  const [mode, setMode] = useState<"list" | "edit" | "review">("list");
  const [guests, setGuests] = useState([{ id: 1, name: "" }]);
  const [draft, setDraft] = useState<ExtraDraft | null>(null);
  const activeDraft = useRef<ExtraDraft | null>(null);
  const pending = useRef<ExtraDraft | null>(null);
  const [restored, setRestored] = useState(false), [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false), [message, setMessage] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null), [quickShare, setQuickShare] = useState<ExtraTicket | null>(null);
  const [download, setDownload] = useState<{ href: string; name: string } | null>(null);
  const downloadUrl = useRef<string | null>(null), sharing = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null), list = useRef<HTMLDivElement>(null);
  const [listHeight, setListHeight] = useState(0);
  const storageKey = userId ? `diwo:extra-draft:${userId}:diwo-x-2-2026` : null;
  const sameActor = isLoaded && !!userId && actor.current === userId;
  const current = () => mounted.current && !!actor.current && currentActor.current === actor.current;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current); };
  }, []);
  useEffect(() => {
    if (!isLoaded || !userId) return;
    if (!actor.current) actor.current = userId;
    if (actor.current !== userId || !storageKey) return;
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const value = extraDraft(JSON.parse(saved));
        if (!value) throw new Error("invalid_saved_draft");
        pending.current = value; activeDraft.current = value; setDraft(value); setKind("extra"); setMode("review");
        setMessage("Hay una emisión sin resolver. Comprueba el resultado repitiendo únicamente esta misma solicitud.");
      }
    } catch { setBlocked(true); setMessage("No se puede recuperar el borrador de esta pestaña. No se emitirán nuevas entradas para evitar duplicados."); }
    setRestored(true);
  }, [isLoaded, userId, storageKey]);
  useEffect(() => { if (mode !== "list") heading.current?.focus({ preventScroll: true }); }, [mode]);

  function openForm() {
    if (!current() || flight.current || sharing.current || pending.current || blocked || !restored) return;
    setGuests([{ id: ++sequence.current, name: "" }]); setMessage(null); setMode("edit");
  }
  function review(event: FormEvent) {
    event.preventDefault();
    if (!current() || pending.current || mode !== "edit") return;
    const names = guests.map(guest => guest.name.trim());
    if (names.some(name => !name || name.length > 120 || name.includes("\0"))) {
      setMessage("Introduce el nombre y apellidos de cada asistente (máximo 120 caracteres)."); return;
    }
    // No storage or mutation until explicit final confirmation.
    const value = { requestId: crypto.randomUUID(), attendeeNames: names };
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 64 * 1024) {
      setMessage("Este envío supera el tamaño técnico permitido. Divide los asistentes en varias emisiones; no hay límite total de extras."); return;
    }
    activeDraft.current = value; setDraft(value); setMode("review"); setMessage(null);
  }
  async function issue() {
    if (!current() || flight.current || !draft || activeDraft.current !== draft || !storageKey || blocked || mode !== "review") return;
    if (pending.current && pending.current !== draft) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(draft));
      if (sessionStorage.getItem(storageKey) !== JSON.stringify(draft)) throw new Error("draft_not_saved");
    } catch { setMessage("No se ha podido guardar la solicitud antes del envío. No se han emitido entradas."); return; }
    pending.current = draft; flight.current = true; setBusy(true); setMessage(null);
    try {
      const value = await withRequestDeadline(async signal => {
        const response = await fetch("/api/admin/extra-tickets", { method: "POST", credentials: "same-origin", redirect: "error", cache: "no-store",
          headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft), signal });
        if (!response.ok) throw new Error("issuance_unresolved");
        return response.json();
      }, 15000);
      if (!current()) return;
      const issued = extraTicketResponse(value, draft);
      if (!issued) throw new Error("invalid_issuance_receipt");
      // Remove only after validating the exact ID + names + number of tickets.
      sessionStorage.removeItem(storageKey);
      pending.current = null; activeDraft.current = null; setDraft(null);
      setRows(previous => [...issued, ...previous.filter(row => !issued.some(ticket => ticket.id === row.id))]);
      setKind("extra"); setStatus("all"); setSearch(""); setMode("list");
      setSelected(issued[0].id); setMessage(null);
    } catch { if (current()) setMessage("No se ha podido confirmar el resultado. No cambies los nombres ni crees otra solicitud: pulsa Reintentar para comprobar esta misma emisión sin duplicarla."); }
    finally { flight.current = false; if (current()) setBusy(false); }
  }
  function finishShare(outcome: ExtraShareOutcome) {
    if (!current()) return;
    try {
      if (outcome.download) {
        if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
        const href = URL.createObjectURL(outcome.download); downloadUrl.current = href;
        setDownload({ href, name: outcome.download.name });
        const anchor = document.createElement("a"); anchor.href = href; anchor.download = outcome.download.name;
        anchor.rel = "noopener noreferrer"; anchor.target = "_blank"; document.body.appendChild(anchor);
        try { anchor.click(); } finally { anchor.remove(); }
      }
      setMessage(outcome.message);
    } catch { setMessage("No se ha podido abrir la descarga. Abre el detalle para intentarlo de nuevo."); }
    finally { sharing.current = false; setQuickShare(null); }
  }
  const active = rows.find(row => row.id === selected);
  const general = tickets.filter(ticket => !ticket.technical);
  const visible = filterAdminTickets(rows, search, status);
  if (!sameActor) return <section role="alert" className="diwo-admin-requests">La sesión ha cambiado o se está comprobando. Actualiza para verificar los permisos de tu cuenta.</section>;
  if (active) return <AdminExtraTicketDetail key={active.id} ticket={active} onBack={() => setSelected(null)}
    onChanged={row => setRows(previous => previous.map(ticket => ticket.id === row.id ? row : ticket))} />;

  return <div className="diwo-extra-workspace">
    {mode !== "list" ? <section className="diwo-admin-requests diwo-extra-create">
      <header className="diwo-admin-detail-heading"><button type="button" aria-label="Volver a entradas" disabled={busy || !!pending.current} onClick={() => { if (pending.current || flight.current) return; activeDraft.current = null; setMode("list"); setDraft(null); }}><ArrowLeft aria-hidden="true" /></button>
        <div><h1 ref={heading} tabIndex={-1}>{mode === "edit" ? "Crear entradas extra" : "Revisar entradas extra"}</h1></div></header>
      {mode === "edit" ? <form onSubmit={review} className="diwo-request-form">
        <section className="diwo-request-quantity"><h2>¿Cuántas entradas?</h2><div className="diwo-request-stepper">
          <button type="button" className="diwo-request-step" aria-label="Quitar una entrada" disabled={guests.length <= 1} onClick={() => setGuests(previous => previous.slice(0, -1))}><Minus aria-hidden="true" /></button>
          <output aria-live="polite" aria-label="Cantidad de entradas">{guests.length}</output>
          <button type="button" className="diwo-request-step" aria-label="Añadir una entrada" onClick={() => setGuests(previous => [...previous, { id: ++sequence.current, name: "" }])}><Plus aria-hidden="true" /></button>
        </div></section>
        <section className="diwo-request-attendees"><h2>Asistentes</h2><p className="diwo-request-attendees-intro">Introduce el nombre y apellidos de cada asistente (Obligatorio)</p>
          <div className="diwo-request-names">{guests.map((guest, index) => <AnimatedAttendeeRow key={guest.id} animate={index > 0}>
            <label htmlFor={`extra-guest-${guest.id}`} className="diwo-request-attendee-label"><span><UserRound aria-hidden="true" /></span>Asistente {index + 1}</label>
            <input id={`extra-guest-${guest.id}`} className="diwo-request-input" required maxLength={120} autoComplete="off" placeholder="Nombre y apellidos" value={guest.name}
              onChange={event => setGuests(previous => previous.map(row => row.id === guest.id ? { ...row, name: event.target.value } : row))} />
          </AnimatedAttendeeRow>)}</div></section>
        <button type="submit" className="diwo-request-submit">REVISAR ENTRADAS</button>
        <button type="button" className="diwo-admin-text-link" onClick={() => setMode("list")}>Cancelar</button>
      </form> : <section className="diwo-admin-extra-form">
        <h2>{draft?.attendeeNames.length} {draft?.attendeeNames.length === 1 ? "entrada extra" : "entradas extra"}</h2>
        <ol>{draft?.attendeeNames.map((name, index) => <li key={index}>{name}</li>)}</ol>
        <p>Cada asistente tendrá una entrada real y su propio QR. Sin pago y sin consumir el cupo general.</p>
        <div className="diwo-admin-extra-actions"><button type="button" className="diwo-admin-button diwo-admin-outline" disabled={busy || !!pending.current} onClick={() => { if (pending.current || flight.current) return; activeDraft.current = null; setDraft(null); setMode("edit"); }}>Volver a editar</button>
          <button type="button" className="diwo-admin-button diwo-admin-primary" disabled={busy || blocked} onClick={() => void issue()}>{busy ? "Creando…" : pending.current ? "Reintentar misma emisión" : "Crear entradas"}</button></div>
      </section>}
    </section> : <>
      <section className="diwo-admin-requests diwo-extra-overview">
        <header className="diwo-admin-requests-tools"><div className="diwo-admin-requests-intro"><p className="diwo-admin-section-label">Gestión de entradas</p><p>Una entrada por asistente. Consulta su estado y acceso.</p></div>
          <button type="button" className="diwo-admin-button diwo-admin-primary" disabled={!restored || blocked || !!quickShare} onClick={openForm}>Crear entrada extra</button></header>
        <div className="diwo-extra-types" role="group" aria-label="Tipo de entrada">{([["general", "Generales", general.length], ["extra", "Extras", rows.length]] as const).map(([value, label, count]) => <button key={value} type="button" aria-pressed={kind === value}
          onClick={() => { setListHeight(previous => Math.max(previous, list.current?.getBoundingClientRect().height ?? 0)); setKind(value); setSearch(""); setStatus("all"); }}><span>{label}</span><span>{count}</span></button>)}</div>
      </section>
      <div ref={list} style={{ minHeight: listHeight || undefined }}>{kind === "general" ? <AdminTickets tickets={tickets} hideHeader /> : <section className="diwo-admin-requests">
        <div className="diwo-admin-request-tabs diwo-admin-ticket-tabs" role="group" aria-label="Estado de entradas">{states.map(([value, label]) => <button key={value} type="button" aria-pressed={status === value} className={status === value ? "is-active" : ""} onClick={() => setStatus(value)}>{label}<span>{value === "all" ? rows.length : rows.filter(row => row.status === value).length}</span></button>)}</div>
        <div className="diwo-admin-request-search"><label><Search aria-hidden="true" /><span className="sr-only">Buscar entrada extra</span><input type="search" value={search} placeholder="Asistente o referencia…" onChange={event => setSearch(event.target.value)} /></label></div>
        <div className="diwo-admin-ticket-list diwo-extra-list">{visible.map(ticket => <AdminTicketListItem key={ticket.id} ticket={ticket} description="Invitación de cortesía · Sin pago" disabled={!!quickShare}
          onOpen={() => { if (!sharing.current) setSelected(ticket.id); }} action={<button type="button" className="diwo-extra-quick-share" aria-label={`Compartir entrada de ${ticket.name}`} disabled={!!quickShare || ticket.status !== "valid"}
            onClick={() => { if (current() && !sharing.current && ticket.status === "valid") { sharing.current = true; setQuickShare(ticket as ExtraTicket); setDownload(null); setMessage(null); } }}><Share2 aria-hidden="true" /></button>} />)}
          {!visible.length && <div className="diwo-admin-request-empty"><h2>{search.trim() ? "Sin coincidencias" : "No hay entradas extra en esta vista"}</h2><p>Las invitaciones creadas aparecerán aquí.</p></div>}
        </div>
      </section>}</div>
    </>}
    {message && <p role="alert" className="diwo-admin-requests diwo-admin-request-feedback">{message}</p>}
    {download && <p className="diwo-admin-requests diwo-ticket-action-feedback"><a href={download.href} download={download.name} target="_blank" rel="noopener noreferrer">Abrir o guardar imagen</a></p>}
    {quickShare && <AdminExtraTicketDetail key={`share-${quickShare.id}`} ticket={quickShare} quickShare onBack={() => {}} onChanged={() => {}} onQuickShareDone={finishShare} />}
  </div>;
}
