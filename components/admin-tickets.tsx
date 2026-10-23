"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { ArrowLeft, Search, Ticket } from "lucide-react";
import { filterAdminTickets, revokedTicketReceipt, type AdminTicket } from "@/lib/admin-ticket-model";
import { AdminTicketListItem } from "@/components/admin-ticket-list-item";

const labels = { valid: "Sin usar", used: "Utilizada", revoked: "Anulada" };
const date = (value: string) => new Intl.DateTimeFormat("es-ES", {
  dateStyle: "short", timeStyle: "short", timeZone: "Europe/Madrid",
}).format(new Date(value));

export function AdminTickets({ tickets, hideHeader = false }: { tickets: AdminTicket[]; hideHeader?: boolean }) {
  const { userId, isLoaded } = useAuth();
  const originalActor = useRef(userId), currentActor = useRef(userId);
  currentActor.current = userId;
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mustRefresh, setMustRefresh] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [revoked, setRevoked] = useState<Record<string, string>>({});
  const flight = useRef(false), locked = useRef(false), mounted = useRef(false), settled = useRef(new Set<string>());
  const feedback = useRef<HTMLDivElement>(null), detail = useRef<HTMLElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const lastCard = useRef<HTMLButtonElement | null>(null);
  const cancelConfirmation = useRef<HTMLButtonElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (message) feedback.current?.focus(); }, [message]);
  useEffect(() => {
    if (selected) detail.current?.focus();
    else if (lastCard.current?.isConnected) lastCard.current.focus();
  }, [selected]);
  useEffect(() => { if (confirming) cancelConfirmation.current?.focus(); }, [confirming]);
  useEffect(() => {
    if (!isLoaded) return;
    if (originalActor.current === undefined && userId) { originalActor.current = userId; return; }
    if (!userId || originalActor.current !== userId) {
      locked.current = true; setMustRefresh(true); setSelected(null); setConfirming(false);
    }
  }, [isLoaded, userId]);
  const sameActor = !isLoaded || !!userId && (originalActor.current === undefined || originalActor.current === userId);
  const current = tickets.map(ticket => revoked[ticket.id] ? { ...ticket, status: "revoked" as const, revokedAt: revoked[ticket.id] } : ticket);
  const scoped = current.filter(ticket => !ticket.technical);
  const visible = filterAdminTickets(scoped, search, status);
  const active = scoped.find(ticket => ticket.id === selected);
  const canAnnul = (ticket: AdminTicket) => ticket.status === "valid" && !ticket.technical;
  function back() {
    if (flight.current) return;
    setSelected(null); setConfirming(false); setMessage(null);
    if (!lastCard.current?.isConnected) heading.current?.focus();
  }

  async function annul(id: string) {
    if (flight.current || locked.current || settled.current.has(id) || mustRefresh || !sameActor || !confirming || selected !== id || !current.some(t => t.id === id && canAnnul(t))) return;
    flight.current = true; setBusy(true); setMessage(null);
    const actor = currentActor.current;
    try {
      const response = await fetch("/api/tickets/revoke", {
        method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticketId: id }), signal: AbortSignal.timeout(20000),
      });
      const data: unknown = await response.json();
      if (!mounted.current || actor !== currentActor.current) return;
      const revokedAt = response.ok ? revokedTicketReceipt(data, id) : null;
      if (!revokedAt) {
        locked.current = true; setMustRefresh(true);
        setMessage("No hemos podido confirmar la anulación. Actualiza las entradas para consultar su estado antes de volver a actuar. Puede haberse utilizado en puerta.");
        return;
      }
      settled.current.add(id);
      setRevoked(previous => ({ ...previous, [id]: revokedAt }));
      setMessage("Entrada anulada. Su QR anterior ya no permite el acceso. El pedido pagado y las demás entradas se conservan.");
    } catch {
      if (mounted.current && actor === currentActor.current) {
        locked.current = true; setMustRefresh(true);
        setMessage("Resultado sin confirmar. Actualiza las entradas antes de continuar; la operación no se repetirá automáticamente.");
      }
    } finally {
      flight.current = false;
      if (mounted.current) { setBusy(false); setConfirming(false); }
    }
  }
  if (!sameActor) return <section className="diwo-admin-requests" role="alert"><p>La sesión ha cambiado. Actualiza para comprobar los permisos de la cuenta actual.</p></section>;
  return <section className={`diwo-admin-requests diwo-admin-tickets${active ? " has-ticket-detail" : ""}`}>
    <h1 ref={heading} tabIndex={-1} className="sr-only">Entradas</h1>
    {!hideHeader && <header className="diwo-admin-requests-tools">
      <div className="diwo-admin-requests-intro"><p className="diwo-admin-section-label">Gestión de entradas</p><p>Una entrada por asistente. Consulta su estado y acceso.</p></div>
    </header>}
    <div className="diwo-admin-ticket-controls">
      <div className="diwo-admin-request-tabs diwo-admin-ticket-tabs" role="group" aria-label="Estado de entradas">
        {([['all', 'Todas'], ['valid', 'Sin usar'], ['used', 'Utilizadas'], ['revoked', 'Anuladas']] as const).map(([value, label]) => <button key={value} type="button" disabled={busy} aria-pressed={status === value} className={status === value ? "is-active" : ""} onClick={() => { setStatus(value); setSelected(null); setConfirming(false); }}>{label}<span>{value === "all" ? scoped.length : scoped.filter(ticket => ticket.status === value).length}</span></button>)}
      </div>
      <div className="diwo-admin-request-search"><label><Search aria-hidden="true" /><span className="sr-only">Buscar entrada</span><input type="search" value={search} placeholder="Asistente, comprador o referencia…" disabled={busy} onChange={event => { setSearch(event.target.value); setSelected(null); setConfirming(false); }} /></label></div>
    </div>
    {message && <div ref={feedback} tabIndex={-1} role="status" className="diwo-admin-request-feedback">{message}</div>}
    {mustRefresh && <p className="diwo-admin-ticket-warning">Actualiza antes de volver a gestionar entradas. No se reintentará ninguna anulación automáticamente.</p>}
    <div className="diwo-admin-ticket-workspace">
      <div className="diwo-admin-ticket-list">
        {!visible.length && <div className="diwo-admin-request-empty"><span className="diwo-admin-empty-icon" aria-hidden="true"><Ticket /></span><h2>{search.trim() ? "Sin coincidencias" : "No hay entradas en esta vista"}</h2><p>Las entradas emitidas aparecerán aquí tras confirmar los pagos.</p>{search.trim() && <button type="button" className="diwo-admin-text-link" onClick={() => setSearch("")}>Limpiar búsqueda</button>}</div>}
        {visible.map(ticket => <AdminTicketListItem key={ticket.id} ticket={ticket} selected={selected === ticket.id} disabled={busy}
          onOpen={event => { lastCard.current = event.currentTarget; setSelected(ticket.id); setConfirming(false); setMessage(null); }} />)}
      </div>
      <aside ref={detail} tabIndex={-1} className={`diwo-admin-ticket-detail${active ? " is-open" : ""}`} aria-label="Detalle de entrada">
        {!active ? <div className="diwo-admin-request-empty"><span className="diwo-admin-empty-icon" aria-hidden="true"><Ticket /></span><h2>Una entrada, un acceso</h2><p>Selecciona un asistente para consultar su entrada. Las utilizadas no se pueden anular.</p></div> : <>
          <header className="diwo-admin-detail-heading"><button type="button" aria-label="Volver a entradas" disabled={busy} onClick={back}><ArrowLeft aria-hidden="true" /></button><h2>Detalle de entrada</h2></header>
          <div className="diwo-admin-detail-buyer"><span className="diwo-admin-buyer-initial" aria-hidden="true">{active.name.trim().charAt(0).toLocaleUpperCase("es")}</span><div><div className="diwo-admin-detail-title"><h3>{active.name}</h3><span className={`diwo-admin-ticket-state is-${active.status}`}>{labels[active.status]}</span></div><p>Entrada #{active.position}</p></div></div>
          {active.technical && <p className="diwo-admin-history-note">PRUEBA TÉCNICA · No válida para DIWO · Solo consulta</p>}
          <dl className="diwo-admin-ticket-data"><div><dt>Comprador</dt><dd>{active.buyerName}</dd></div><div><dt>Referencia del pedido</dt><dd>{active.reference}</dd></div><div><dt>Evento</dt><dd>{active.eventTitle}</dd></div><div><dt>Emitida</dt><dd>{date(active.issuedAt)}</dd></div>{active.usedAt && <div><dt>Utilizada</dt><dd>{date(active.usedAt)}</dd></div>}{active.revokedAt && <div><dt>Anulada</dt><dd>{date(active.revokedAt)}</dd></div>}<div><dt>Identificador de entrada</dt><dd className="diwo-admin-ticket-id">{active.id}</dd></div></dl>
          {active.status === "revoked" && <p className="diwo-admin-ticket-warning">Esta entrada y su QR anterior ya no permiten el acceso.</p>}
          {canAnnul(active) && (confirming ? <div className="diwo-admin-ticket-confirm" role="group" aria-label={`Confirmar anulación de ${active.name}`}>
            <p>¿Anular la entrada de <strong>{active.name}</strong>? Es irreversible desde la app, invalida su QR y no implica devolución. El pedido pagado y las demás entradas se conservan.</p>
            <div className="diwo-admin-request-actions is-detail"><button ref={cancelConfirmation} type="button" className="diwo-admin-button diwo-admin-outline" disabled={busy} onClick={() => setConfirming(false)}>Volver sin cambios</button><button type="button" className="diwo-admin-button diwo-admin-danger" disabled={busy || mustRefresh} onClick={() => annul(active.id)}>{busy ? "Anulando…" : "Confirmar anulación"}</button></div>
          </div> : <div className="diwo-admin-request-actions is-detail"><p className="diwo-admin-ticket-warning">Anular esta entrada no cancela el pedido ni devuelve dinero.</p><button type="button" className="diwo-admin-button diwo-admin-danger" disabled={busy || mustRefresh} onClick={() => { setConfirming(true); setMessage(null); }}>Anular entrada</button></div>)}
        </>}
      </aside>
    </div>
  </section>;
}
