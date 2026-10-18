"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CalendarDays, Check, Clock, Copy, Euro, Search, Ticket, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { canDecideRequest, requestCounts, requestReceipt, requestRows, requestStatus, type AdminRequest, type RequestDecision, type RequestFilter } from "@/lib/admin-requests-model";

type Decision = { row: AdminRequest; action: RequestDecision };
const euro = (cents: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
const date = (value: string) => new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Madrid" }).format(new Date(value));

export function AdminRequests({ orders, preview = false, allowPreview = false }: {
  orders: AdminRequest[]; preview?: boolean; allowPreview?: boolean;
}) {
  const router = useRouter();
  const { userId, isLoaded } = useAuth();
  const originalActor = useRef(userId), currentActor = useRef(userId);
  currentActor.current = userId;
  const [filter, setFilter] = useState<RequestFilter>("pending");
  const [search, setSearch] = useState("");
  const [history, setHistory] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, { status: "confirmed" | "cancelled"; at: string }>>({});
  const flight = useRef(false), locked = useRef(false), alive = useRef(true), lastRead = useRef(orders), settled = useRef(new Set<string>());
  const dialog = useRef<HTMLDialogElement>(null), cancel = useRef<HTMLButtonElement>(null);
  const feedback = useRef<HTMLParagraphElement>(null), dialogFeedback = useRef<HTMLParagraphElement>(null);
  const detail = useRef<HTMLElement>(null), returnFocus = useRef<HTMLButtonElement | null>(null), heading = useRef<HTMLHeadingElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = list.current;
    if (!container) return;
    let disposed = false;
    const fitNames = () => {
      if (disposed) return;
      for (const name of container.querySelectorAll<HTMLElement>(".diwo-admin-request-name")) {
        name.style.fontSize = "13px";
        if (name.clientWidth > 0 && name.scrollWidth > name.clientWidth) {
          name.style.fontSize = `${13 * name.clientWidth / name.scrollWidth}px`;
        }
      }
    };
    fitNames();
    const observer = new ResizeObserver(fitNames);
    observer.observe(container);
    void document.fonts.ready.then(fitNames);
    return () => { disposed = true; observer.disconnect(); };
  }, [orders, filter, search, history, selected, overrides]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!isLoaded) return;
    if (originalActor.current === undefined && userId) { originalActor.current = userId; return; }
    if (!userId || originalActor.current !== userId) {
      locked.current = true; setUncertain(true); setDecision(null); setChecked(false);
      setMessage("La sesión ha cambiado. Actualiza antes de consultar o gestionar solicitudes.");
    }
  }, [isLoaded, userId]);
  useEffect(() => {
    if (lastRead.current === orders || flight.current) return;
    lastRead.current = orders;
    if (isLoaded && (!userId || originalActor.current !== userId)) return;
    locked.current = false; settled.current.clear(); setUncertain(false); setOverrides({}); setDecision(null); setChecked(false); setMessage(null);
  }, [orders, busy, isLoaded, userId]);
  useEffect(() => {
    if (selected) detail.current?.focus();
  }, [selected]);
  useEffect(() => {
    const node = dialog.current;
    if (!decision || !node) return;
    const fallbackHeading = heading.current;
    returnFocus.current = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null;
    if (!node.open) node.showModal();
    cancel.current?.focus(); // Safe default: Enter must never approve accidentally.
    const prior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prior;
      if (node.open) node.close();
      if (returnFocus.current?.isConnected) returnFocus.current.focus();
      else fallbackHeading?.focus();
    };
  }, [decision]);
  useEffect(() => {
    if (message) (decision ? dialogFeedback.current : feedback.current)?.focus();
  }, [message, decision]);

  const rows = orders.map(row => overrides[row.id] ? { ...row, status: overrides[row.id].status,
    confirmedAt: overrides[row.id].status === "confirmed" ? overrides[row.id].at : null } : row);
  const counts = requestCounts(rows, history);
  const visible = requestRows(rows, history, filter, search);
  const active = rows.find(row => row.id === selected);
  const disabled = busy || uncertain;
  const sameActor = !isLoaded || !!userId && (originalActor.current === undefined || originalActor.current === userId);
  function open(row: AdminRequest, action: RequestDecision) {
    if (flight.current || locked.current || settled.current.has(row.id) || !sameActor || !canDecideRequest(row)) return;
    setChecked(false); setMessage(null); setDecision({ row, action });
  }
  function close() { if (!flight.current) { setDecision(null); setChecked(false); } }
  async function submit() {
    if (!decision || flight.current || locked.current || settled.current.has(decision.row.id) || !sameActor || !canDecideRequest(rows.find(row => row.id === decision.row.id) ?? decision.row) ||
      decision.action === "approve" && !checked) return;
    flight.current = true; setBusy(true); setMessage(null);
    const actor = currentActor.current, target = decision;
    try {
      if (preview) {
        settled.current.add(target.row.id);
        setOverrides(previous => ({ ...previous, [target.row.id]: { status: target.action === "approve" ? "confirmed" : "cancelled", at: new Date().toISOString() } }));
        setDecision(null); setChecked(false);
        setMessage("Simulación realizada. No se han modificado datos ni emitido entradas reales.");
        return;
      }
      const response = await fetch(target.action === "approve" ? "/api/orders/approve-payment" : "/api/orders/cancel", {
        method: "POST", credentials: "same-origin", redirect: "error", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: target.row.id }), signal: AbortSignal.timeout(20000),
      });
      const data: unknown = await response.json();
      if (!alive.current || actor !== currentActor.current) return;
      const receipt = response.ok ? requestReceipt(target.action, data, target.row) : null;
      if (!receipt) {
        locked.current = true; setUncertain(true);
        setMessage("Resultado sin confirmar. Actualiza las solicitudes para comprobar el estado antes de volver a actuar. La operación no se repetirá automáticamente.");
        return;
      }
      settled.current.add(target.row.id);
      setOverrides(previous => ({ ...previous, [target.row.id]: { status: receipt.status, at: receipt.at } }));
      setDecision(null); setChecked(false);
      setMessage(target.action === "approve" ? `Pago confirmado. ${target.row.quantity} ${target.row.quantity === 1 ? "entrada emitida" : "entradas emitidas"}.`
        : "Solicitud cancelada. Su historial se conserva y no se ha realizado ninguna devolución.");
    } catch {
      if (alive.current && actor === currentActor.current) {
        locked.current = true; setUncertain(true);
        setMessage("No hemos podido confirmar el resultado. Actualiza las solicitudes antes de continuar; no se reintentará automáticamente.");
      }
    } finally { flight.current = false; if (alive.current) setBusy(false); }
  }
  async function copy(reference: string) {
    try { await navigator.clipboard.writeText(reference); if (alive.current) setMessage("Concepto copiado."); }
    catch { if (alive.current) setMessage("No hemos podido copiar. Selecciona la referencia para copiarla manualmente."); }
  }
  const actionButtons = (row: AdminRequest, large = false) => canDecideRequest(row) && <div className={`diwo-admin-request-actions${large ? " is-detail" : ""}`}>
    <Button type="button" className="diwo-admin-button diwo-admin-primary" disabled={disabled} onClick={() => open(row, "approve")}>{large ? "Aceptar pago y emitir entradas" : "Confirmar"}</Button>
    <Button type="button" className="diwo-admin-button diwo-admin-outline" disabled={disabled} onClick={() => open(row, "cancel")}>{large ? "Cancelar solicitud" : "Cancelar"}</Button>
  </div>;

  if (!sameActor) return <section role="alert" className="diwo-admin-requests"><p>La sesión ha cambiado. Actualiza para comprobar los permisos de la cuenta actual.</p></section>;
  return <section className={`diwo-admin-requests${selected ? " has-detail" : ""}`}>
    <h1 ref={heading} tabIndex={-1} className="sr-only">Solicitudes</h1>
    <header className="diwo-admin-requests-tools">
      <div className="diwo-admin-requests-intro"><p className="diwo-admin-section-label">Gestión de solicitudes</p><p>{preview ? "Vista de diseño · Las acciones son simuladas" : history ? "Histórico conservado · Separado de la venta actual" : "Revisa el ingreso y confirma cada pedido."}</p></div>
      <div>{allowPreview && <Link href="/admin/requests?preview=1" className="diwo-admin-text-link">Ver diseño</Link>}
        {preview && <Link href="/admin/requests" className="diwo-admin-text-link">Salir del diseño</Link>}
        <Button type="button" variant="ghost" className="diwo-admin-button" disabled={busy} onClick={() => router.refresh()}>Actualizar</Button></div>
    </header>
    <div className="diwo-admin-request-tabs" role="group" aria-label="Estado de solicitudes">
      {([["pending", "Pendientes"], ["confirmed", "Confirmadas"], ["closed", "Cerradas"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value}
        disabled={busy} className={filter === value ? "is-active" : ""} onClick={() => { setFilter(value); setSelected(null); }}>{label}<span>{counts[value]}</span></button>)}
    </div>
    <div className="diwo-admin-request-search">
      <label><span className="sr-only">Buscar solicitudes</span><Search aria-hidden="true" /><input type="search" value={search} placeholder="Buscar por nombre, correo o concepto…"
        disabled={busy} onChange={event => setSearch(event.target.value)} /></label>
    </div>
    {!preview && <label className="diwo-admin-history"><input type="checkbox" checked={history} disabled={busy} onChange={event => { setHistory(event.target.checked); setSelected(null); }} />Ver histórico técnico y otros eventos</label>}
    {message && !decision && <p ref={feedback} tabIndex={-1} role="status" className="diwo-admin-request-feedback">{message}</p>}
    <div className="diwo-admin-request-workspace">
      <div ref={list} className="diwo-admin-request-list">
        {!visible.length && <div className="diwo-admin-request-empty"><span className="diwo-admin-empty-icon" aria-hidden="true"><Search /></span><h2>{search.trim() ? "Sin coincidencias" : filter === "pending" ? "No hay solicitudes pendientes" : filter === "confirmed" ? "Aún no hay solicitudes confirmadas" : "No hay solicitudes cerradas"}</h2><p>{search.trim() ? "Prueba con otro nombre, correo o concepto del Bizum." : history ? "No hay solicitudes de este estado en el histórico conservado." : "Las solicitudes de la venta actual aparecerán aquí. El histórico técnico se consulta por separado."}</p>{search.trim() && <button type="button" className="diwo-admin-text-link" onClick={() => setSearch("")}>Limpiar búsqueda</button>}</div>}
        {visible.map(row => <article key={row.id} className={`diwo-admin-request-card${selected === row.id ? " is-selected" : ""}`}>
          {(row.technical || !row.actualEvent) && <p className="diwo-admin-history-note">Histórico conservado · No corresponde a la venta actual{row.technical ? " · Prueba técnica" : ""}</p>}
          <button type="button" className="diwo-admin-request-open" aria-label={`Ver solicitud ${row.reference}`} onClick={() => { setSelected(row.id); setMessage(null); }}>
            <span className="diwo-admin-buyer-initial" aria-hidden="true">{row.buyerName.trim().charAt(0).toLocaleUpperCase("es")}</span>
            <span className="diwo-admin-request-overview"><strong className="diwo-admin-request-name">{row.buyerName}</strong><span>{date(row.createdAt)}</span><span>{row.quantity} {row.quantity === 1 ? "entrada" : "entradas"}</span></span>
            <span className="diwo-admin-request-amount"><strong>{euro(row.totalCents)}</strong><span className="diwo-admin-reference-chip">{row.reference}</span></span>
          </button>
          {actionButtons(row)}
        </article>)}
      </div>
      <aside ref={detail} tabIndex={-1} className={`diwo-admin-request-detail${active ? " is-open" : ""}`} aria-label="Detalle de solicitud">
        {!active ? <div className="diwo-admin-request-empty diwo-admin-detail-placeholder"><span className="diwo-admin-empty-icon" aria-hidden="true"><Ticket /></span><h2>Todo listo para revisar</h2><p>Selecciona una solicitud para ver el concepto del Bizum, el importe y sus asistentes.</p><span className="diwo-admin-detail-hint">Comprueba siempre el ingreso en tu banco antes de confirmar.</span></div> : <>
          <header className="diwo-admin-detail-heading"><button type="button" aria-label="Volver a solicitudes" onClick={() => { setSelected(null); heading.current?.focus(); }}><ArrowLeft aria-hidden="true" /></button><h2>Detalle de solicitud</h2></header>
          <div className="diwo-admin-detail-buyer"><span className="diwo-admin-buyer-initial" aria-hidden="true">{active.buyerName.trim().charAt(0).toLocaleUpperCase("es")}</span><div><div className="diwo-admin-detail-title"><h3>{active.buyerName}</h3>{active.status === "pending" ? <span className="diwo-admin-pending-icon" role="img" aria-label="Solicitud pendiente" title="Solicitud pendiente"><Clock aria-hidden="true" /></span> : <span className={`diwo-admin-request-state is-${active.status}`}>{requestStatus[active.status]}</span>}</div><p>{active.buyerEmail ?? "Correo no disponible"}</p></div></div>
          {(active.technical || !active.actualEvent) && <p className="diwo-admin-history-note">Histórico conservado · Sin acciones sobre la venta actual{active.technical ? " · Prueba técnica" : ""}</p>}
          <section className="diwo-admin-payment-summary" aria-label="Datos para comprobar el Bizum">
            <div className="diwo-admin-payment-reference"><div><p>Concepto del Bizum</p><strong>{active.reference}</strong></div><button type="button" aria-label="Copiar concepto del Bizum" onClick={() => void copy(active.reference)}><Copy aria-hidden="true" /></button></div>
            <dl><div><dt><CalendarDays aria-hidden="true" />Fecha de solicitud</dt><dd>{date(active.createdAt)}</dd></div><div><dt><Ticket aria-hidden="true" />Entradas solicitadas</dt><dd>{active.quantity}</dd></div><div className="diwo-admin-payment-total"><dt><Euro aria-hidden="true" />Importe total</dt><dd>{euro(active.totalCents)}</dd></div></dl>
          </section>
          <section className="diwo-admin-request-attendees"><header><h3>Asistentes</h3><span>{active.quantity} {active.quantity === 1 ? "persona" : "personas"}</span></header><ol>{active.names.map((name, index) => <li key={index}><span className="diwo-admin-attendee-icon"><UserRound aria-hidden="true" /></span><span>{name}</span></li>)}</ol></section>
          {actionButtons(active, true)}
        </>}
      </aside>
    </div>
    <dialog ref={dialog} className="diwo-admin-requests-dialog" aria-labelledby="admin-request-dialog-title" aria-describedby="admin-request-dialog-description"
      onCancel={event => { event.preventDefault(); close(); }}>
      {decision && <div>
        <h2 id="admin-request-dialog-title">{decision.action === "approve" ? "¿Seguro que quieres confirmar esta solicitud?" : "¿Seguro que quieres cancelar esta solicitud?"}</h2>
        <p id="admin-request-dialog-description">{decision.action === "approve" ? "Confirma solo después de comprobar el ingreso en tu banco. Se emitirán las entradas de esta solicitud." : "No se emitirán entradas. Su historial se conserva y esta acción no devuelve dinero."}</p>
        <div className="diwo-admin-dialog-summary"><strong>{decision.row.buyerName}</strong><span>{decision.row.reference}</span><span>{decision.row.quantity} {decision.row.quantity === 1 ? "entrada" : "entradas"} · {euro(decision.row.totalCents)}</span></div>
        {decision.action === "approve" && <label className="diwo-admin-bank-check"><input type="checkbox" checked={checked} disabled={disabled} onChange={event => setChecked(event.target.checked)} />He comprobado el importe y el concepto en mi banco.</label>}
        {message && <p ref={dialogFeedback} tabIndex={-1} role="status" className="diwo-admin-request-feedback">{message}</p>}
        <div className="diwo-admin-dialog-buttons"><Button ref={cancel} type="button" className="diwo-admin-button diwo-admin-outline" disabled={busy} onClick={close}><X aria-hidden="true" />{uncertain ? "Cerrar" : "Volver sin cambios"}</Button>
          <Button type="button" className={`diwo-admin-button ${decision.action === "approve" ? "diwo-admin-primary" : "diwo-admin-danger"}`} disabled={disabled || decision.action === "approve" && !checked} onClick={submit}>
            {decision.action === "approve" ? <Check aria-hidden="true" /> : <X aria-hidden="true" />}{busy ? "Procesando…" : decision.action === "approve" ? "Confirmar y emitir entradas" : "Confirmar cancelación"}
          </Button></div>
        {uncertain && <Button type="button" className="diwo-admin-button diwo-admin-outline" onClick={() => { close(); router.refresh(); }}>Actualizar solicitudes <ArrowRight aria-hidden="true" /></Button>}
      </div>}
    </dialog>
  </section>;
}
