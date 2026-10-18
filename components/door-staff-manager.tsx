"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { staffCandidate, staffEmail, staffMembers, staffReceipt, staffRecord, type StaffCandidate, type StaffMember } from "@/lib/door-staff-model";

const errors: Record<string, string> = {
  registered_account_required: "No hay una cuenta registrada con ese correo.",
  verified_email_required: "Esa persona debe verificar su correo antes de recibir acceso.",
  account_not_unique: "No podemos identificar una única cuenta con ese correo. No se ha concedido acceso.",
  staff_account_changed: "La cuenta asociada al correo ha cambiado. Búscala de nuevo antes de continuar.",
  staff_state_changed: "Los permisos han cambiado desde la última consulta. Actualiza antes de continuar.",
  admin_identity_is_protected: "La cuenta administradora está protegida y no se puede modificar aquí.",
  staff_configuration_required: "La gestión de personal aún no está activada en la base de datos.",
  staff_account_unavailable: "Esta cuenta está bloqueada o no está disponible para recibir acceso.",
  operation_not_authorized: "No tienes permisos vigentes para gestionar el personal.",
  authentication_required: "Tu sesión ha caducado. Vuelve a iniciar sesión.",
};
const failure = (data: unknown, writing: boolean) => staffRecord(data) && typeof data.error === "string" && errors[data.error]
  ? errors[data.error] : writing
    ? "No hemos podido confirmar el resultado. Actualiza el personal antes de volver a intentarlo; no se repetirá la operación automáticamente."
    : "No hemos podido consultar el personal. Actualiza antes de continuar.";

export function DoorStaffManager() {
  const { userId, isLoaded } = useAuth();
  const originalActor = useRef(userId), currentActor = useRef(userId);
  currentActor.current = userId;
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [email, setEmail] = useState("");
  const [candidate, setCandidate] = useState<StaffCandidate | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [mustReload, setMustReload] = useState(false);
  const flight = useRef(false), generation = useRef(0);
  const needsRefresh = useRef(false);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const removeButtons = useRef(new Map<string, HTMLButtonElement>());
  const previousRemoval = useRef<string | null>(null);
  const resultMessage = useRef<HTMLParagraphElement>(null);
  const sameActor = () => !isLoaded || !!currentActor.current && (originalActor.current === undefined || originalActor.current === currentActor.current);
  useEffect(() => {
    if (removing) confirmButton.current?.focus();
    else if (previousRemoval.current) removeButtons.current.get(previousRemoval.current)?.focus();
    previousRemoval.current = removing;
  }, [removing]);
  useEffect(() => { if (message) resultMessage.current?.focus(); }, [message]);

  async function request(body?: Record<string, unknown>, signal?: AbortSignal) {
    const response = await fetch("/api/door-staff", {
      method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store", redirect: "error",
      signal: signal ?? AbortSignal.timeout(20000),
      ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
    const data: unknown = await response.json();
    return { response, data };
  }
  async function reload() {
    if (flight.current || !sameActor()) return;
    flight.current = true; setBusy(true); setMessage(null); setCandidate(null); setRemoving(null);
    const current = generation.current;
    try {
      const { response, data } = await request();
      if (current !== generation.current) return;
      const rows = response.ok && staffRecord(data) ? staffMembers(data.staff) : null;
      if (!rows) { setStaff(null); setMessage(failure(data, false)); return; }
      setStaff(rows); setMustReload(false); needsRefresh.current = false;
    } catch { if (current === generation.current) { setStaff(null); setMessage("No hemos podido consultar el personal. Actualiza antes de continuar."); } }
    finally { if (current === generation.current) { flight.current = false; setBusy(false); } }
  }
  useEffect(() => {
    const current = ++generation.current;
    const controller = new AbortController();
    let active = true;
    // Read-only initial load. Writes are never initiated by an effect.
    flight.current = true; setBusy(true);
    void request(undefined, AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]))
      .then(({ response, data }) => {
        if (!active || generation.current !== current) return;
        const rows = response.ok && staffRecord(data) ? staffMembers(data.staff) : null;
        if (!rows) { setMessage(failure(data, false)); return; }
        setStaff(rows);
      }).catch(() => { if (active) setMessage("No hemos podido consultar el personal. Actualiza antes de continuar."); })
      .finally(() => { if (active) { flight.current = false; setBusy(false); } });
    return () => { active = false; generation.current = current + 1; flight.current = false; controller.abort(); };
  }, []);
  useEffect(() => {
    if (!isLoaded) return;
    if (originalActor.current === undefined && userId) { originalActor.current = userId; return; }
    if (!userId || originalActor.current !== userId) {
      generation.current++; needsRefresh.current = true;
      setStaff(null); setCandidate(null); setRemoving(null); setMustReload(true); setBusy(false);
    }
  }, [isLoaded, userId]);

  async function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (flight.current || !staff || needsRefresh.current || !sameActor()) return;
    const normalized = staffEmail(email);
    if (!normalized) { setMessage("Introduce un correo válido."); return; }
    flight.current = true; setBusy(true); setMessage(null); setCandidate(null); setRemoving(null);
    const current = generation.current;
    try {
      const { response, data } = await request({ action: "lookup", email: normalized });
      if (current !== generation.current) return;
      const found = response.ok && staffRecord(data) ? staffCandidate(data.candidate, normalized) : null;
      if (!found) { setMessage(failure(data, false)); return; }
      setCandidate(found);
    } catch { if (current === generation.current) setMessage("No hemos podido buscar esa cuenta. Inténtalo de nuevo."); }
    finally { if (current === generation.current) { flight.current = false; setBusy(false); } }
  }
  async function change(action: "grant" | "revoke", target: StaffCandidate | StaffMember) {
    if (flight.current || !staff || needsRefresh.current || !sameActor() || (action === "grant" && (!candidate || candidate.staffId !== target.staffId || candidate.role !== "user")) ||
      (action === "revoke" && removing !== target.staffId)) return;
    flight.current = true; needsRefresh.current = true; setBusy(true); setMessage(null);
    const current = generation.current;
    try {
      const body = action === "grant" ? { action, email: target.email, staffId: target.staffId, version: target.version } : { action, staffId: target.staffId, version: target.version };
      const { response, data } = await request(body);
      if (current !== generation.current) return;
      if (!response.ok || !staffRecord(data) || !staffReceipt(data.member, target.staffId, action === "grant" ? "door_staff" : "user")) {
        setMustReload(true); setCandidate(null); setRemoving(null); setMessage(failure(data, true)); return;
      }
      // Stop further writes until a fresh authorized list is explicitly loaded.
      setMustReload(true); setCandidate(null); setRemoving(null);
      setMessage(action === "grant" ? "Acceso de puerta concedido. Actualiza para consultar el personal." : "Acceso de puerta retirado. La cuenta conserva sus compras y entradas. Actualiza para consultar el personal.");
    } catch {
      if (current === generation.current) { setMustReload(true); setCandidate(null); setRemoving(null); setMessage(failure(null, true)); }
    } finally { if (current === generation.current) { flight.current = false; setBusy(false); } }
  }
  const disabled = busy || !staff || mustReload;
  if (!sameActor()) return <div role="alert"><p>La sesión ha cambiado. Recarga la página para comprobar los permisos de la cuenta actual.</p></div>;
  return <div className="diwo-admin-staff">
    <header className="diwo-admin-requests-tools">
      <div className="diwo-admin-requests-intro"><p className="diwo-admin-section-label">Personal de puerta</p><p>Gestiona quién puede validar entradas, sin acceso a pagos ni administración.</p></div>
      <div><Button type="button" variant="outline" onClick={reload} disabled={busy} className="diwo-admin-button diwo-admin-outline">Actualizar personal</Button></div>
    </header>
    {message && <p ref={resultMessage} tabIndex={-1} role="status" className="diwo-admin-request-feedback">{message}</p>}
    {mustReload && <p className="diwo-admin-staff-note">Actualiza el personal antes de realizar otra operación.</p>}
    <div className="diwo-admin-staff-workspace">
    <form onSubmit={lookup} className="diwo-admin-staff-panel" aria-labelledby="staff-search-title">
      <h2 id="staff-search-title">Añadir correo</h2>
      <p className="diwo-admin-staff-note">La persona debe tener una cuenta registrada y el correo verificado.</p>
      <label htmlFor="staff-email" className="diwo-admin-staff-label">Correo de la persona</label>
      <div className="diwo-admin-staff-search"><input id="staff-email" type="email" name="email" autoComplete="off" autoCapitalize="none" spellCheck={false} value={email} disabled={disabled}
        onChange={event => { setEmail(event.target.value); setCandidate(null); setMessage(null); }}
        placeholder="persona@ejemplo.com" />
      <Button type="submit" disabled={disabled || !email.trim()} className="diwo-admin-button diwo-admin-primary">Añadir correo</Button></div>
      {candidate && <div className="diwo-admin-staff-candidate" aria-live="polite">
        <div className="diwo-admin-staff-person"><span className="diwo-admin-buyer-initial" aria-hidden="true">{candidate.name.trim().charAt(0).toLocaleUpperCase("es")}</span><div><h3>{candidate.name}</h3><p>{candidate.email}</p></div></div>
        {candidate.role === "admin" ? <p className="diwo-admin-staff-note">Es la cuenta administradora. No se puede modificar aquí.</p>
          : candidate.role === "door_staff" ? <p className="diwo-admin-staff-note">Esta persona ya tiene acceso de puerta.</p>
          : <><p className="diwo-admin-staff-note">Confirma el acceso de esta persona al escáner de puerta.</p><Button type="button" onClick={() => change("grant", candidate)} disabled={disabled} className="diwo-admin-button diwo-admin-primary diwo-admin-staff-grant">Confirmar acceso</Button></>}
      </div>}
    </form>
    <section aria-labelledby="staff-list-title" className="diwo-admin-staff-panel" aria-busy={busy}>
      <div className="diwo-admin-staff-list-title"><h2 id="staff-list-title">Correos autorizados</h2>{staff !== null && <span aria-label={`${staff.length} personas autorizadas`}>{staff.length}</span>}</div>
      {staff === null ? <p className="diwo-admin-staff-note">{busy ? "Consultando permisos…" : "No hay una lista verificada disponible."}</p>
        : staff.length === 0 ? <div className="diwo-admin-staff-empty"><p>No hay personal de puerta asignado.</p><p>Añade un correo en el formulario de arriba.</p></div>
          : <ul className="diwo-admin-staff-list">{staff.map(member => <li key={member.staffId}>
            <div className="diwo-admin-staff-person"><span className="diwo-admin-buyer-initial" aria-hidden="true">{member.name.trim().charAt(0).toLocaleUpperCase("es")}</span><div><h3>{member.email ?? "Correo no disponible"}</h3><p>{member.name}</p></div></div>
            {removing === member.staffId ? <div className="diwo-admin-staff-confirm"><p>¿Retirar el acceso de puerta? Conservará su cuenta y sus propias entradas.</p>
              <div className="diwo-admin-staff-actions"><Button ref={confirmButton} type="button" variant="outline" disabled={disabled} onClick={() => setRemoving(null)} className="diwo-admin-button diwo-admin-outline">Volver</Button><Button type="button" variant="destructive" disabled={disabled} onClick={() => change("revoke", member)} className="diwo-admin-button diwo-admin-danger">Confirmar retirada</Button></div>
            </div> : <Button ref={node => { if (node) removeButtons.current.set(member.staffId, node); else removeButtons.current.delete(member.staffId); }} type="button" variant="outline" disabled={disabled} onClick={() => { setRemoving(member.staffId); setCandidate(null); setMessage(null); }} className="diwo-admin-button diwo-admin-outline diwo-admin-staff-remove">Retirar acceso</Button>}
          </li>)}</ul>}
    </section>
    </div>
    <p className="diwo-admin-staff-note diwo-admin-staff-footer">El permiso de puerta no concede administración. La cuenta administradora permanece protegida.</p>
  </div>;
}
