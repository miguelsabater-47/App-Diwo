"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { ArrowLeft, ArrowRight, Check, Search, ScanLine, X } from "lucide-react";
import { AdminTabLink } from "@/components/admin-tab-link";
import { parseEventControl, type EventAttendee, type EventControl } from "@/lib/admin-event-model";
import { scanResult } from "@/lib/door-scan-model";
import { subscribeEventControl } from "@/lib/event-control-realtime";

type Connection = "checking" | "connected" | "offline";
const labels = { valid: "Disponible", used: "Utilizada", revoked: "Anulada" };
const clock = (at: string, timezone: string, full = false) => new Intl.DateTimeFormat("es-ES", {
  timeZone: timezone, ...(full ? { dateStyle: "short" as const, timeStyle: "short" as const } : { hour: "2-digit" as const, minute: "2-digit" as const }),
}).format(new Date(at));

export function AdminEventDashboard({ role = "admin" }: { role?: "admin" | "door_staff" }) {
  const { userId, isLoaded, getToken } = useAuth();
  const tokenGetter = useRef(getToken); tokenGetter.current = getToken;
  const actor = useRef(userId), currentActor = useRef(userId); currentActor.current = userId;
  const [data, setData] = useState<EventControl | null>(null);
  const [connection, setConnection] = useState<Connection>("checking");
  const [search, setSearch] = useState(""), [query, setQuery] = useState("");
  const [page, setPage] = useState(0), [history, setHistory] = useState(false);
  const [selected, setSelected] = useState<EventAttendee | null>(null);
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const [confirming, setConfirming] = useState(false), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null), [denied, setDenied] = useState(false);
  const [uncertain, setUncertain] = useState(false), [reading, setReading] = useState(true);
  const alive = useRef(false), writeFlight = useRef(false), readFlight = useRef(false);
  const pendingRefresh = useRef(false), notifyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controller = useRef<AbortController | null>(null), revision = useRef(0), lastSuccess = useRef(0);
  const selectedId = selected?.id;
  const criteria = useRef({ query, page }); criteria.current = { query: selectedId ?? query, page: selectedId ? 0 : page };
  const fetchedQuery = useRef<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null), cancel = useRef<HTMLButtonElement>(null);
  const detail = useRef<HTMLElement>(null), returnFocus = useRef<HTMLButtonElement | null>(null);
  const sameActor = isLoaded && !!userId && (actor.current === undefined || actor.current === userId);

  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); if (notifyTimer.current) clearTimeout(notifyTimer.current); }; }, []);
  useEffect(() => {
    if (!isLoaded) return;
    if (actor.current === undefined && userId) actor.current = userId;
    if (!userId || actor.current !== userId) {
      revision.current++; controller.current?.abort(); setData(null); setSelected(null); setDenied(true); setConnection("offline");
    }
  }, [isLoaded, userId]);
  useEffect(() => {
    const timer = setTimeout(() => { setQuery(search.trim()); setPage(0); }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (confirming && dialog.current && !dialog.current.open) { dialog.current.showModal(); cancel.current?.focus(); }
    else if (!confirming && dialog.current?.open) dialog.current.close();
  }, [confirming]);
  useEffect(() => {
    if (selectedId) detail.current?.focus();
    else if (returnFocus.current?.isConnected) returnFocus.current.focus();
  }, [selectedId]);

  const refresh = useCallback(async () => {
    if (!currentActor.current || actor.current !== currentActor.current || readFlight.current || writeFlight.current) return false;
    readFlight.current = true;
    const requestActor = currentActor.current, sequence = revision.current;
    const params = new URLSearchParams({ q: criteria.current.query, page: String(criteria.current.page) });
    const abort = new AbortController(); controller.current = abort;
    const timer = setTimeout(() => abort.abort(), 10000);
    setReading(true);
    try {
      const response = await fetch(`/api/door/event-control?${params}`, { cache: "no-store", credentials: "same-origin", redirect: "error", signal: abort.signal });
      if (!alive.current || requestActor !== currentActor.current || sequence !== revision.current) return false;
      if ([401, 403].includes(response.status)) {
        setDenied(true); setData(null); setSelected(null); setConfirming(false); throw new Error("denied");
      }
      const next = response.ok ? parseEventControl(await response.json()) : null;
      if (!alive.current || requestActor !== currentActor.current || sequence !== revision.current) return false;
      if (!next) throw new Error("unavailable");
      fetchedQuery.current = params.get("q");
      setData(next); setConnection("connected"); lastSuccess.current = Date.now();
      // A verified current state resolves ambiguity, but NEVER retries a write.
      if (selectedRef.current && next.results.some(row => row.id === selectedRef.current?.id)) setUncertain(false);
      setSelected(previous => {
        if (!previous) return null;
        return [...next.results, ...next.recent].find(row => row.id === previous.id) ?? null;
      });
      return true;
    } catch {
      if (alive.current && sequence === revision.current && requestActor === currentActor.current) setConnection("offline");
      return false;
    } finally {
      clearTimeout(timer); readFlight.current = false;
      if (alive.current) setReading(false);
    }
  }, []);

  useEffect(() => {
    if (!sameActor || denied) return;
    // Cancel a superseded search and ignore all late responses from it.
    revision.current++; controller.current?.abort();
    let disposed = false;
    const run = async () => {
      if (disposed) return;
      if (readFlight.current) { timer = setTimeout(run, 50); return; }
      await refresh();
    };
    let timer: ReturnType<typeof setTimeout> = setTimeout(run, 0);
    return () => { disposed = true; clearTimeout(timer); };
  }, [query, page, selectedId, sameActor, denied, refresh]);
  const onSignal = useCallback(() => {
    if (!alive.current || document.visibilityState !== "visible") return;
    pendingRefresh.current = true;
    if (notifyTimer.current) return;
    const drain = async () => {
      notifyTimer.current = null;
      if (!alive.current || !pendingRefresh.current || document.visibilityState !== "visible") return;
      if (readFlight.current || writeFlight.current) { notifyTimer.current = setTimeout(drain, 60); return; }
      pendingRefresh.current = false;
      await refresh();
      if (pendingRefresh.current && alive.current && !notifyTimer.current) notifyTimer.current = setTimeout(drain, 60);
    };
    // Coalesce bursts without losing a signal received during an in-flight read.
    notifyTimer.current = setTimeout(drain, 40);
  }, [refresh]);
  const eventId = data?.event.id;
  useEffect(() => {
    if (!sameActor || denied || !eventId) return;
    let unsubscribe: (() => void) | undefined;
    const synchronize = () => {
      unsubscribe?.(); unsubscribe = undefined;
      if (document.visibilityState === "visible") { unsubscribe = subscribeEventControl(eventId, () => tokenGetter.current(), onSignal); onSignal(); }
    };
    synchronize(); document.addEventListener("visibilitychange", synchronize);
    return () => { unsubscribe?.(); document.removeEventListener("visibilitychange", synchronize); };
  }, [eventId, sameActor, denied, onSignal]);
  useEffect(() => {
    if (!sameActor || denied) return;
    const poll = () => { if (document.visibilityState === "visible" && Date.now() - lastSuccess.current >= 2500) void refresh(); };
    const online = () => onSignal();
    const offline = () => { controller.current?.abort(); setConnection("offline"); setConfirming(false); };
    const timer = setInterval(poll, 3000);
    window.addEventListener("online", online); window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", poll);
    return () => {
      clearInterval(timer); window.removeEventListener("online", online); window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [sameActor, denied, refresh, onSignal]);

  function open(row: EventAttendee, button: HTMLButtonElement) {
    returnFocus.current = button; setSelected(row); setConfirming(false); setMessage(null);
  }
  async function admit() {
    if (!selected || !data || !confirming || !sameActor || denied || uncertain || connection !== "connected" ||
        selected.status !== "valid" || writeFlight.current || Date.now() - lastSuccess.current > 30000) return;
    writeFlight.current = true; setBusy(true); setMessage(null);
    revision.current++; controller.current?.abort();
    const requestActor = currentActor.current, ticket = selected;
    try {
      const response = await fetch("/api/door/event-control", {
        method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId: data.event.id, ticketId: ticket.id }),
        signal: AbortSignal.timeout(20000),
      });
      const payload = await response.json();
      if (!alive.current || requestActor !== currentActor.current) return;
      if ([401, 403].includes(response.status)) { setDenied(true); setData(null); setSelected(null); setConnection("offline"); return; }
      const result = response.ok ? scanResult(payload.result) : null;
      if (!result || (result.ticketId !== null && result.ticketId !== ticket.id)) {
        setUncertain(true);
        setMessage(payload.error === "manual_access_not_configured"
          ? "La validación manual aún no está habilitada en el servidor. Utiliza el escáner QR."
          : "Acceso sin confirmar. Consulta de nuevo el estado antes de actuar. No se repetirá automáticamente.");
        return;
      }
      if (result.outcome === "admitted" || result.outcome === "already_used") {
        setSelected({ ...ticket, status: "used", usedAt: result.usedAt });
        setMessage(result.outcome === "admitted" ? "Acceso registrado correctamente." : "Esta entrada ya se había utilizado. No se ha registrado otro acceso.");
      } else if (result.outcome === "revoked") {
        setSelected({ ...ticket, status: "revoked", usedAt: null }); setMessage("Esta entrada está anulada y no permite el acceso.");
      } else { setUncertain(true); setMessage("No se ha encontrado una entrada válida para este evento."); }
    } catch {
      if (alive.current && requestActor === currentActor.current) {
        setUncertain(true); setConnection("offline");
        setMessage("Resultado sin confirmar. Recupera la conexión y consulta el estado. No vuelvas a dar acceso sin comprobarlo.");
      }
    } finally {
      writeFlight.current = false;
      if (alive.current) { setBusy(false); setConfirming(false); if (requestActor === currentActor.current) void refresh(); }
    }
  }

  const currentCriteria = data && data.page === page && query === search.trim() && fetchedQuery.current === query;
  const connectionText = connection === "connected" ? "Sistema conectado" : connection === "checking" ? "Comprobando conexión" : "Sin conexión";
  const canValidate = sameActor && !denied && !uncertain && !busy && !reading && connection === "connected" && selected?.status === "valid";
  if (!isLoaded) return <section className="diwo-event-dashboard" role="status">Cargando sesión…</section>;
  if (denied || !sameActor) return <section className="diwo-event-dashboard" role="alert"><h1>Acceso no disponible</h1><p>La sesión o tus permisos han cambiado. Vuelve a iniciar sesión para continuar.</p></section>;
  return <section className="diwo-event-dashboard" aria-label="Control del evento">
    <header className="diwo-event-heading"><h1>Dashboard</h1></header>
    {connection === "offline" && <div className="diwo-event-notice" role="alert">
      <p>No se puede verificar la conexión con el sistema. {data ? "Los datos mostrados pueden estar desactualizados." : "No hemos podido cargar los datos del evento."} No confirmes accesos sin respuesta del servidor.</p>
    </div>}
    {selected ? <section className="diwo-event-detail" ref={detail} tabIndex={-1}>
      <button type="button" className="diwo-event-back" disabled={busy} onClick={() => { setSelected(null); setConfirming(false); setMessage(null); }}><ArrowLeft aria-hidden="true" /> Volver al panel</button>
      <h2>{selected.name}</h2><p className="diwo-event-code">{selected.code}</p>
      <span className={`diwo-event-state is-${selected.status}`}><i aria-hidden="true" />{labels[selected.status]}</span>
      <dl><div><dt>Evento</dt><dd>{data?.event.title}</dd></div><div><dt>Entrada</dt><dd>{selected.kind === "extra" ? "Invitación extra" : "General"}</dd></div>
        <div><dt>Código de entrada</dt><dd>{selected.id}</dd></div>
        {selected.usedAt && data && <div><dt>Acceso registrado</dt><dd>{clock(selected.usedAt, data.event.timezone, true)}</dd></div>}
      </dl>
      {selected.status === "valid" && <button type="button" className="diwo-event-primary" disabled={!canValidate} onClick={() => setConfirming(true)}><Check aria-hidden="true" />{busy ? "Confirmando…" : "Validar entrada"}</button>}
      <p className="diwo-event-footnote">Un único acceso por entrada. Sin reentrada. La validación se confirma online y no se puede deshacer.</p>
      {message && <p className="diwo-event-notice" role="status">{message}</p>}
      {uncertain && <p className="diwo-event-footnote">Comprobando el estado automáticamente. Si ya se utilizó, aparecerá como utilizada.</p>}
    </section> : <>
      {!history && <section aria-labelledby="diwo-aforo-title" className="diwo-event-attendance">
        <header className="diwo-event-section-heading"><h2 id="diwo-aforo-title">Aforo</h2><span className={`diwo-event-connection is-${connection}`} role="status"><i aria-hidden="true" />{connectionText}</span></header>
        <div className="diwo-event-squares">
          <div className="diwo-event-donut-card" aria-busy={!data && reading}>
            {data ? <div className="diwo-event-donut" role="img" aria-label={`${data.percentage} %, ${data.used} accesos de ${data.total} entradas emitidas`}>
              <svg viewBox="0 0 160 160" aria-hidden="true"><circle className="diwo-event-track" cx="80" cy="80" r="66" /><circle className="diwo-event-progress" cx="80" cy="80" r="66" pathLength="100" strokeDasharray={`${data.percentage} 100`} /></svg>
              <div><strong>{data.percentage}<small> %</small></strong><span>{data.used} / {data.total}</span><p>ACCESOS<br />REGISTRADOS</p></div>
            </div> : <p className="diwo-event-loading" role="status">{reading ? "Cargando aforo…" : "Aforo no disponible"}</p>}
          </div>
          <AdminTabLink href={role === "admin" ? "/admin/scan" : "/scan"} className="diwo-event-scan"><ScanLine aria-hidden="true" /><span>Abrir<br />escáner QR</span><ArrowRight aria-hidden="true" /></AdminTabLink>
        </div>
      </section>}
      {history ? <div className="diwo-event-history-heading"><button type="button" className="diwo-event-back" onClick={() => { setHistory(false); setPage(0); }}><ArrowLeft aria-hidden="true" /> Volver al panel</button><h2>Historial de accesos</h2></div>
        : <div className="diwo-event-search"><Search aria-hidden="true" /><input type="search" aria-label="Buscar asistente o código" placeholder="Buscar asistente o código..." value={search} maxLength={120} onChange={e => { setSearch(e.target.value); setSelected(null); }} />{search && <button type="button" aria-label="Borrar búsqueda" onClick={() => setSearch("")}><X aria-hidden="true" /></button>}</div>}
      {!history && search.trim() && <section aria-label="Resultados de búsqueda" aria-busy={reading || !currentCriteria}>
        <header className="diwo-event-section-heading"><h2>Asistentes</h2></header>
        {!currentCriteria || reading ? <p role="status" className="diwo-event-empty">Buscando…</p> : data.results.length ? <>
          <div className="diwo-event-results">{data.results.map(row => <button type="button" key={row.id} onClick={e => open(row, e.currentTarget)}>
            <span><strong>{row.name}</strong><small>{row.code}</small></span><span className={`diwo-event-state is-${row.status}`}><i aria-hidden="true" />{labels[row.status]}</span><ArrowRight aria-hidden="true" />
          </button>)}</div>
          <Pagination page={page} total={data.matches} busy={reading} onChange={setPage} />
        </> : <p className="diwo-event-empty">No se han encontrado asistentes.</p>}
      </section>}
      <section aria-labelledby="diwo-event-history-title" aria-busy={reading}>
        <header className="diwo-event-section-heading"><h2 id="diwo-event-history-title">{history ? "Todos los accesos" : "Últimos accesos"}</h2>
          {!history && <button type="button" onClick={() => { setHistory(true); setPage(0); }}>Ver todos <ArrowRight aria-hidden="true" /></button>}
        </header>
        {data ? <>{(history ? data.recent : data.latest).length ? <div className="diwo-event-accesses">{(history ? data.recent : data.latest).map(row => <button type="button" key={row.id} onClick={e => open(row, e.currentTarget)}>
          <i aria-hidden="true" /><strong>{row.name}</strong><time dateTime={row.usedAt!}>{clock(row.usedAt!, data.event.timezone)}</time>
        </button>)}</div> : <p className="diwo-event-empty">Todavía no se han registrado accesos.</p>}
          {history && <Pagination page={page} total={data.historyTotal} busy={reading} onChange={setPage} />}
        </> : <p className="diwo-event-empty" role="status">{reading ? "Cargando accesos…" : "Historial no disponible."}</p>}
      </section>
    </>}
    <dialog ref={dialog} className="diwo-event-dialog" onCancel={e => { e.preventDefault(); if (!busy) setConfirming(false); }} onClose={() => { if (!busy) setConfirming(false); }} aria-labelledby="diwo-confirm-access">
      <h2 id="diwo-confirm-access">Confirmar acceso</h2><p>¿Confirmar el acceso de {selected?.name}?</p><p className="diwo-event-footnote">Se registrará como validación manual. No se podrá utilizar otra vez.</p>
      <button ref={cancel} type="button" disabled={busy} onClick={() => setConfirming(false)}>Cancelar</button>
      <button type="button" className="diwo-event-primary" disabled={!canValidate} onClick={() => void admit()}>{busy ? "Confirmando…" : "Confirmar acceso"}</button>
    </dialog>
  </section>;
}

function Pagination({ page, total, busy, onChange }: { page: number; total: number; busy: boolean; onChange: (page: number) => void }) {
  if (total <= 20) return null;
  return <nav className="diwo-event-pagination" aria-label="Paginación"><button type="button" disabled={busy || page === 0} onClick={() => onChange(page - 1)}>Anterior</button><span>{page + 1} / {Math.ceil(total / 20)}</span><button type="button" disabled={busy || (page + 1) * 20 >= total} onClick={() => onChange(page + 1)}>Siguiente</button></nav>;
}
