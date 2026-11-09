"use client";

import { useRef, useState } from "react";
import { useClerk, useReverification } from "@clerk/nextjs";
import { isReverificationCancelledError } from "@clerk/nextjs/errors";
import { Button } from "@/components/ui/button";

export function DeleteAccount() {
  const { signOut } = useClerk();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const deleteAccount = useReverification(async () => {
    const response = await fetch("/api/account", {
      method: "DELETE", credentials: "same-origin", redirect: "error", cache: "no-store",
      headers: { "X-Diwo-Confirm-Deletion": "delete-my-account" },
    });
    const data: unknown = await response.json();
    // Return parsed data, keeping Clerk's top-level reverification hint and the
    // HTTP outcome. useReverification unwraps raw Responses, losing their status.
    return {
      ...(data && typeof data === "object" ? data : {}),
      ok: response.ok, status: response.status,
    };
  });

  async function submit() {
    if (inFlight.current || !confirming) return;
    inFlight.current = true; setBusy(true); setMessage(null);
    // Leave the native top layer before Clerk may open its reverification modal.
    dialog.current?.close(); setConfirming(false);
    try {
      const response = await deleteAccount();
      if (!response.ok || !("deleted" in response) || response.deleted !== true) {
        setMessage(response.status === 403
          ? "No se permite eliminar esta cuenta. Actualiza la página para comprobar tus permisos."
          : "No hemos podido confirmar la eliminación. Comprueba si puedes iniciar sesión antes de volver a intentarlo.");
        return;
      }
      // Deletion revokes Clerk sessions. Clear local state too; never report a
      // successful deletion as failed just because local sign-out failed.
      try { await signOut(); } catch { /* Full navigation clears the old view. */ }
      window.location.replace("/sign-in");
    } catch (error) {
      setMessage(isReverificationCancelledError(error)
        ? "Verificación cancelada. No se ha enviado la eliminación."
        : "No hemos podido confirmar la eliminación. Comprueba si puedes iniciar sesión antes de volver a intentarlo.");
    } finally { inFlight.current = false; setBusy(false); }
  }

  return <div className="diwo-account-deletion">
    <Button ref={trigger} variant="outline" className="diwo-account-delete" disabled={busy} onClick={() => {
      setMessage(null); setConfirming(true);
      dialog.current?.showModal(); cancel.current?.focus();
    }}>{busy ? "Eliminando…" : "Eliminar cuenta"}</Button>
    <dialog ref={dialog} className="diwo-account-delete-dialog" aria-labelledby="delete-account-heading" aria-describedby="delete-account-warning"
      onCancel={event => { event.preventDefault(); dialog.current?.close(); }}
      onClose={() => { setConfirming(false); trigger.current?.focus(); }}>
      <div className="diwo-account-delete-dialog-content">
        <h2 id="delete-account-heading">¿Quieres eliminar tu cuenta?</h2>
        <p id="delete-account-warning">Esta acción es irreversible. Perderás el acceso a tu cuenta y a tus entradas desde ella. No cancela pedidos ni entradas, no genera reembolsos y no borra el historial de compras.</p>
        <div className="diwo-account-deletion-buttons">
          <Button ref={cancel} type="button" variant="outline" onClick={() => dialog.current?.close()}>Cancelar</Button>
          <Button type="button" className="diwo-account-delete" disabled={busy} onClick={submit}>Eliminar cuenta</Button>
        </div>
      </div>
    </dialog>
    {message && <p role="alert">{message}</p>}
  </div>;
}
