"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { paymentApproval } from "@/lib/order-payment-state";
import { orderClosure } from "@/lib/order-closure-state";

export function ApproveOrderPayment({ orderId, quantity, technical = false }: { orderId: string; quantity: number; technical?: boolean }) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [completed, setCompleted] = useState(false);
  const inFlight = useRef(false);
  const settled = useRef(false);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const resultMessage = useRef<HTMLParagraphElement>(null);
  const previouslyCancelling = useRef(false);
  useEffect(() => {
    if (completed) resultMessage.current?.focus();
    else if (cancelling) confirmButton.current?.focus();
    else if (previouslyCancelling.current) cancelButton.current?.focus();
    previouslyCancelling.current = cancelling;
  }, [cancelling, completed]);
  async function approve() {
    if (!checked || cancelling || settled.current || inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage(null);
    try {
      const response = await fetch("/api/orders/approve-payment", {
        method: "POST", credentials: "same-origin", redirect: "error", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId }), signal: AbortSignal.timeout(20000),
      });
      const data: unknown = await response.json();
      if (!response.ok || !paymentApproval(data, orderId, quantity)) {
        setMessage("No hemos podido verificar la aprobación. Actualiza el estado o reintenta este mismo pedido.");
        return;
      }
      setMessage(`Pago confirmado. ${quantity} ${quantity === 1 ? "entrada emitida" : "entradas emitidas"}.`);
      settled.current = true;
      setChecked(false); setCompleted(true); router.refresh();
    } catch { setMessage("No hemos podido confirmar el resultado. Actualiza el estado antes de reintentar el mismo pedido."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  function chooseCancellation(value: boolean) {
    if (inFlight.current || settled.current) return;
    setCancelling(value); setMessage(null);
  }
  async function closeOrder() {
    if (!cancelling || settled.current || inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage(null);
    try {
      const response = await fetch("/api/orders/cancel", {
        method: "POST", credentials: "same-origin", redirect: "error", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId }), signal: AbortSignal.timeout(20000),
      });
      const data: unknown = await response.json();
      if (!response.ok || !orderClosure(data, orderId)) {
        setMessage(response.status === 409
          ? "La solicitud ya no admite esta acción. Actualiza el estado antes de continuar."
          : "No hemos podido verificar el resultado. Actualiza el estado antes de reintentar esta misma solicitud.");
        return;
      }
      settled.current = true;
      setCompleted(true); setChecked(false); setCancelling(false);
      setMessage("Solicitud cancelada. Su historial se conserva; no se han emitido entradas.");
      router.refresh();
    } catch { setMessage("No hemos podido confirmar el resultado. Actualiza el estado antes de reintentar esta misma solicitud."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <div className="mt-5 rounded-xl border border-primary/30 bg-primary/5 p-4">
    <label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed text-zinc-200"><input type="checkbox" checked={checked} disabled={busy || completed || cancelling} onChange={(event) => setChecked(event.target.checked)} className="mt-1 size-5 shrink-0 accent-primary" />{technical ? "Confirmo esta prueba técnica ficticia. No corresponde a un Bizum real." : "He comprobado el ingreso en mi banco y coinciden el importe y la referencia."}</label>
    <Button type="button" onClick={approve} disabled={!checked || busy || completed || cancelling} className="mt-4 min-h-12 w-full whitespace-normal py-3">{busy && !cancelling ? "Confirmando pago…" : technical ? "Aceptar solicitud técnica y emitir entradas" : "Aceptar y emitir entradas"}</Button>
    <p className="mt-3 text-xs leading-relaxed text-zinc-400">El aviso del comprador es informativo. Puedes aprobar sin ese aviso si has comprobado el Bizum.</p>
    {!completed && <div className="mt-5 border-t border-zinc-700 pt-4">
      {cancelling ? <div role="group" aria-label="Confirmar cancelación de solicitud">
        <p className="text-sm leading-relaxed text-zinc-200">¿Cancelar esta solicitud pendiente? No se emitirán entradas ni podrá aprobarse después. El historial se conserva. Esta acción no devuelve dinero.</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <Button ref={confirmButton} type="button" variant="destructive" disabled={busy} onClick={closeOrder} className="min-h-12 whitespace-normal">{busy ? "Cancelando solicitud…" : "Confirmar cancelación"}</Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => chooseCancellation(false)} className="min-h-12">Volver sin cambios</Button>
        </div>
      </div> : <div className="flex flex-wrap gap-3">
        <Button ref={cancelButton} type="button" variant="outline" disabled={busy} onClick={() => chooseCancellation(true)} className="min-h-12">Cancelar solicitud</Button>
      </div>}
    </div>}
    {message && <p ref={resultMessage} tabIndex={-1} role="status" className="mt-3 text-sm text-zinc-200">{message}</p>}
  </div>;
}
