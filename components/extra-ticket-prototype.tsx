"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import { ArrowLeft, ClipboardList, CircleUserRound, LayoutGrid, Minus, Plus, ScanLine, Search, Share2, Ticket, UserRound, Users } from "lucide-react";
import { AnimatedAttendeeRow } from "@/components/animated-attendee-row";
import { AdminTicketListItem } from "@/components/admin-ticket-list-item";
import { createPrototypeExtras, filterPrototypeTickets, initialPrototypeTickets, type PrototypeTicket } from "@/lib/extra-ticket-prototype";
import { ExtraTicketPrototypeDetail, type PrototypeQuickShareOutcome } from "@/components/extra-ticket-prototype-detail";

const states = [["all", "Todas"], ["valid", "Sin usar"], ["used", "Utilizadas"], ["revoked", "Anuladas"]] as const;

/** Full local interaction, no API/database/storage dependency or genuine ticket IDs. */
export function ExtraTicketPrototype() {
  const mounted = useRef(true);
  const [tickets, setTickets] = useState(initialPrototypeTickets);
  const currentTickets = useRef(tickets); currentTickets.current = tickets;
  const [kind, setKind] = useState<PrototypeTicket["kind"]>("general");
  const [status, setStatus] = useState("all"), [search, setSearch] = useState("");
  const [listHeight, setListHeight] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"list" | "edit" | "review">("list");
  const [guests, setGuests] = useState([{ id: 1, name: "" }]);
  const [exiting, setExiting] = useState<{ id: number; index: number; name: string }[]>([]);
  const [confirmation, setConfirmation] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null), [message, setMessage] = useState<string | null>(null);
  const [quickShare, setQuickShare] = useState<PrototypeTicket | null>(null);
  const [download, setDownload] = useState<{ href: string; name: string } | null>(null);
  const sharing = useRef(false), downloadUrl = useRef<string | null>(null);
  const draftSequence = useRef(1), ticketSequence = useRef(2), pending = useRef<string[] | null>(null);
  const heading = useRef<HTMLHeadingElement>(null), firstInput = useRef<HTMLInputElement>(null);
  const createButton = useRef<HTMLButtonElement>(null), confirmButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current); };
  }, []);
  useEffect(() => {
    if (mode === "edit") heading.current?.focus({ preventScroll: true });
    else if (mode === "review") confirmButton.current?.focus();
    else heading.current?.focus();
  }, [mode, selected]);
  const canAct = () => mounted.current;
  const active = tickets.find(ticket => ticket.id === selected);
  const scoped = tickets.filter(ticket => ticket.kind === kind);
  const visible = filterPrototypeTickets(tickets, kind, status, search);

  function changeKind(value: PrototypeTicket["kind"]) {
    if (!canAct()) return;
    // A shorter category must not collapse the document and clamp its scroll.
    const height = list.current?.getBoundingClientRect().height ?? 0;
    setListHeight(previous => Math.max(previous, height));
    setKind(value); setStatus("all"); setSearch(""); setMessage(null);
  }
  function openForm() {
    if (!canAct() || sharing.current) return;
    pending.current = null; setConfirmation(null); setSelected(null); setMessage(null);
    setGuests([{ id: ++draftSequence.current, name: "" }]); setExiting([]); setMode("edit");
  }
  function cancelForm() {
    pending.current = null; setConfirmation(null); setMessage(null); setMode("list");
    createButton.current?.focus();
  }
  function addGuest() {
    if (!canAct() || mode !== "edit" || pending.current) return;
    const id = ++draftSequence.current;
    setExiting(rows => rows.filter(row => row.index !== guests.length));
    setGuests(previous => [...previous, { id, name: "" }]);
  }
  function removeGuest() {
    if (!canAct() || mode !== "edit" || pending.current || guests.length <= 1) return;
    const last = guests[guests.length - 1];
    setExiting(previous => [...previous, { id: ++draftSequence.current, index: guests.length - 1, name: last.name }]);
    setGuests(previous => previous.length > 1 ? previous.slice(0, -1) : previous);
  }
  function review(event: FormEvent) {
    event.preventDefault();
    if (!canAct() || mode !== "edit" || pending.current) return;
    const names = guests.map(guest => guest.name.trim());
    if (names.some(name => !name || name.length > 120 || name.includes("\u0000"))) {
      setMessage("Introduce el nombre y apellidos de cada invitado (máximo 120 caracteres)."); firstInput.current?.focus(); return;
    }
    pending.current = names; setConfirmation(names); setMessage(null); setMode("review");
  }
  function issue() {
    if (!canAct() || mode !== "review" || !confirmation || pending.current !== confirmation) return;
    pending.current = null;
    const created = createPrototypeExtras(confirmation, ticketSequence.current);
    ticketSequence.current += created.length;
    setTickets(previous => [...previous, ...created]);
    setKind("extra"); setStatus("all"); setSearch(""); setMode("list"); setConfirmation(null);
    setSelected(created[0].id); setMessage(null);
  }
  function annul() {
    if (!canAct() || !active || active.status !== "valid") return;
    setTickets(previous => previous.map(ticket => ticket.id === active.id && ticket.status === "valid" ? { ...ticket, status: "revoked", revokedAt: new Date().toISOString() } : ticket));
  }
  function shareFromList(ticket: PrototypeTicket) {
    const latest = currentTickets.current.find(row => row.id === ticket.id);
    if (!canAct() || sharing.current || latest?.kind !== "extra" || latest.status !== "valid") return;
    sharing.current = true; setQuickShare(latest); setMessage(null); setDownload(null);
  }
  function finishQuickShare(outcome: PrototypeQuickShareOutcome) {
    if (!canAct()) return;
    let resultMessage = outcome.message;
    try {
      if (outcome.download) {
        if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
        const href = URL.createObjectURL(outcome.download); downloadUrl.current = href;
        setDownload({ href, name: outcome.download.name });
        const anchor = document.createElement("a");
        anchor.href = href; anchor.download = outcome.download.name; anchor.target = "_blank"; anchor.rel = "noopener noreferrer";
        document.body.appendChild(anchor); try { anchor.click(); } finally { anchor.remove(); }
      }
    } catch { resultMessage = "No hemos podido abrir la descarga. Inténtalo de nuevo."; }
    finally { sharing.current = false; setQuickShare(null); setMessage(resultMessage); }
  }

  return <div className="diwo-app-interface diwo-prototype">
    <header className="diwo-prototype-brand"><Image src="/brand/diwo-club.svg" alt="DIWO CLUB" width={80} height={44} priority /><span>Entradas</span><CircleUserRound aria-label="Mi cuenta" /></header>
    <section className="diwo-admin-requests diwo-prototype-content">
      {active ? <ExtraTicketPrototypeDetail key={`${active.id}:${active.status}`} ticket={active} onBack={() => setSelected(null)} onAnnul={annul} /> : mode !== "list" ? <section className="diwo-prototype-create">
        <header className="diwo-admin-detail-heading"><button type="button" aria-label="Volver a entradas" onClick={cancelForm}><ArrowLeft aria-hidden="true" /></button><div><h1 ref={heading} tabIndex={-1}>{mode === "review" ? "Revisar entradas extra" : "Crear entradas extra"}</h1></div></header>
        {mode === "edit" ? <form onSubmit={review} className="diwo-request-form diwo-prototype-extra-form">
          <section className="diwo-request-quantity" aria-labelledby="extra-quantity-heading">
            <h2 id="extra-quantity-heading">¿Cuántas entradas?</h2>
            <div className="diwo-request-stepper">
              <button type="button" className="diwo-request-step inline-flex items-center justify-center" aria-label="Quitar una entrada" disabled={guests.length <= 1} onClick={removeGuest}><Minus aria-hidden="true" /></button>
              <output aria-live="polite" aria-label="Cantidad de entradas">{guests.length}</output>
              <button type="button" className="diwo-request-step inline-flex items-center justify-center" aria-label="Añadir una entrada" onClick={addGuest}><Plus aria-hidden="true" /></button>
            </div>
          </section>
          <section className="diwo-request-attendees" aria-labelledby="extra-attendees-heading">
            <h2 id="extra-attendees-heading">Asistentes</h2>
            <p id="extra-attendees-help" className="diwo-request-attendees-intro">Introduce el nombre y apellidos de cada asistente (Obligatorio)</p>
            <div className="diwo-request-names">
              {guests.map((guest, index) => <AnimatedAttendeeRow key={guest.id} animate={index > 0}>
                <label htmlFor={`guest-${guest.id}`} className="diwo-request-attendee-label"><span><UserRound aria-hidden="true" /></span>Asistente {index + 1}</label>
                <input ref={index === 0 ? firstInput : undefined} id={`guest-${guest.id}`} name={`extra-attendee-${index}`} required maxLength={120} autoComplete="off" aria-describedby="extra-attendees-help" value={guest.name} className="diwo-request-input" placeholder="Nombre y apellidos" onChange={event => { if (canAct() && !pending.current) setGuests(previous => previous.map(row => row.id === guest.id ? { ...row, name: event.target.value } : row)); }} />
              </AnimatedAttendeeRow>)}
              {[...exiting].sort((a, b) => a.index - b.index).map(row => <AnimatedAttendeeRow key={`exit-${row.id}`} exiting onExited={() => setExiting(previous => previous.filter(item => item.id !== row.id))}>
                <div className="diwo-request-attendee-label"><span><UserRound aria-hidden="true" /></span>Asistente {row.index + 1}</div><div className="diwo-request-input">{row.name || "Nombre y apellidos"}</div>
              </AnimatedAttendeeRow>)}
            </div>
          </section>
          <div><button type="submit" className="diwo-request-submit">REVISAR ENTRADAS</button><button type="button" className="diwo-admin-text-link diwo-prototype-form-cancel" onClick={cancelForm}>Cancelar</button></div>
        </form> : <section className="diwo-admin-extra-form">
          <h2>{confirmation?.length} {confirmation?.length === 1 ? "entrada extra" : "entradas extra"}</h2><ol className="diwo-prototype-guests">{confirmation?.map((name, index) => <li key={index}><span className="diwo-admin-buyer-initial" aria-hidden="true">{name.charAt(0)}</span><strong>{name}</strong></li>)}</ol>
          <p>Cada invitado tendrá su propia entrada y código QR.</p>
          <div className="diwo-admin-extra-actions"><button type="button" className="diwo-admin-button diwo-admin-outline" onClick={() => { pending.current = null; setConfirmation(null); setMode("edit"); }}>Volver a editar</button><button ref={confirmButton} type="button" className="diwo-admin-button diwo-admin-primary" onClick={issue}>Crear {confirmation?.length} {confirmation?.length === 1 ? "entrada" : "entradas"}</button></div>
        </section>}
      </section> : <>
        <header className="diwo-admin-requests-tools diwo-prototype-tools"><div className="diwo-admin-requests-intro"><h1 ref={heading} tabIndex={-1} className="diwo-admin-section-label">Gestión de entradas</h1><p>Una entrada por asistente. Consulta su estado y acceso.</p></div><button ref={createButton} type="button" className="diwo-admin-button diwo-admin-primary diwo-prototype-create-button" disabled={!!quickShare} onClick={openForm}><Plus aria-hidden="true" /><span>Crear entrada extra</span></button></header>
        <div className="diwo-prototype-types" role="group" aria-label="Tipo de entrada">{([["general", "Generales"], ["extra", "Extras"]] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={kind === value} onClick={() => changeKind(value)}>{label}<span>{tickets.filter(ticket => ticket.kind === value).length}</span></button>)}</div>
        <div className="diwo-admin-request-tabs diwo-admin-ticket-tabs" role="group" aria-label="Estado de entradas">{states.map(([value, label]) => <button type="button" key={value} aria-pressed={status === value} className={status === value ? "is-active" : ""} onClick={() => { setStatus(value); setMessage(null); }}>{label}<span>{value === "all" ? scoped.length : scoped.filter(ticket => ticket.status === value).length}</span></button>)}</div>
        <div className="diwo-admin-request-search"><label><Search aria-hidden="true" /><span className="sr-only">Buscar entrada</span><input type="search" value={search} placeholder="Asistente, comprador o referencia…" onChange={event => setSearch(event.target.value)} /></label></div>
        <div ref={list} style={{ minHeight: listHeight || undefined }} className="diwo-admin-ticket-list diwo-prototype-list">{visible.length ? visible.map(ticket => <AdminTicketListItem key={ticket.id}
          ticket={{ id: ticket.id, name: ticket.name, status: ticket.status, position: 1, buyerName: ticket.buyer, reference: ticket.reference }}
          description={ticket.kind === "extra" ? "Invitación de cortesía · Sin pago" : undefined}
          disabled={!!quickShare}
          action={ticket.kind === "extra" ? <button type="button" className="diwo-prototype-quick-share" aria-label={`Compartir entrada de ${ticket.name}`} aria-busy={quickShare?.id === ticket.id} disabled={!!quickShare || ticket.status !== "valid"} onClick={() => shareFromList(ticket)}><Share2 aria-hidden="true" /></button> : undefined}
          onOpen={() => { if (!sharing.current) { setSelected(ticket.id); setMessage(null); } }} />) : <div className="diwo-admin-request-empty"><Ticket aria-hidden="true" /><h2>{search.trim() ? "Sin coincidencias" : "No hay entradas en esta vista"}</h2><p>{kind === "extra" ? "Las invitaciones creadas aparecerán aquí." : "Cambia los filtros para consultar otras entradas."}</p></div>}</div>
      </>}
      {message && <p role="alert" className="diwo-admin-request-feedback">{message}</p>}
      {download && <p className="diwo-ticket-action-feedback"><a href={download.href} download={download.name} target="_blank" rel="noopener noreferrer">Abrir o guardar imagen</a></p>}
    </section>
    {quickShare && <ExtraTicketPrototypeDetail key={`quick-${quickShare.id}`} ticket={quickShare} quickShare onBack={() => {}} onAnnul={() => {}} onQuickShareDone={finishQuickShare} />}
    <nav className="diwo-prototype-nav" aria-label="Administración">{([[LayoutGrid, "Resumen"], [ClipboardList, "Solicitudes"], [ScanLine, "Escáner"], [Ticket, "Entradas"], [Users, "Personal"]] as const).map(([Icon, label]) => <button key={label} type="button" aria-current={label === "Entradas" ? "page" : undefined} disabled={label !== "Entradas"} onClick={() => { setSelected(null); cancelForm(); }}><Icon aria-hidden="true" /><span>{label}</span></button>)}</nav>
  </div>;
}
