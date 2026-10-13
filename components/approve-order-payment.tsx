"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { paymentApproval } from "@/lib/order-payment-state";

export function ApproveOrderPayment({ orderId, quantity, technical = false }: { orderId: string; quantity: number; technical?: boolean }) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);
  async function approve() {
    if (!checked || inFlight.current) return;
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
      setChecked(false); router.refresh();
    } catch { setMessage("No hemos podido confirmar el resultado. Actualiza el estado antes de reintentar el mismo pedido."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <div className="mt-5 rounded-xl border border-primary/30 bg-primary/5 p-4">
    <label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed text-zinc-200"><input type="checkbox" checked={checked} disabled={busy} onChange={(event) => setChecked(event.target.checked)} className="mt-1 size-5 shrink-0 accent-primary" />{technical ? "Confirmo esta prueba técnica ficticia. No corresponde a un Bizum real." : "He comprobado el ingreso en mi banco y coinciden el importe y la referencia."}</label>
    <Button type="button" onClick={approve} disabled={!checked || busy} className="mt-4 min-h-12 w-full whitespace-normal py-3">{busy ? "Confirmando pago…" : technical ? "Aprobar solicitud técnica y emitir entradas" : "Confirmar pago y emitir entradas"}</Button>
    <p className="mt-3 text-xs leading-relaxed text-zinc-400">El aviso del comprador es informativo. Puedes aprobar sin ese aviso si has comprobado el Bizum.</p>
    {message && <p role="status" className="mt-3 text-sm text-zinc-200">{message}</p>}
  </div>;
}
