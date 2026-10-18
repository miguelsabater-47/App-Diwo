"use client";

import { useEffect, useRef, useState } from "react";
import { BuyerFlowLink as Link } from "@/components/buyer-flow-link";
import { ArrowRight, CircleCheck, Copy, Smartphone, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OrderSummary } from "@/components/order-summary";

type Props = {
  preview: boolean; reference: string; quantity: number; totalCents: number;
  phone: string | null; requestCreated?: boolean;
};

export function OrderPaymentDetails({ preview, reference, quantity, totalCents, phone, requestCreated = false }: Props) {
  const [message, setMessage] = useState<string | null>(null);
  const success = useRef<HTMLDivElement>(null);
  useEffect(() => { if (requestCreated && !preview) success.current?.focus(); }, [requestCreated, preview]);
  // Never truncate or fabricate an existing real order's reference.
  const concept = preview ? "DIWO-A7K9" : reference;
  const displayPhone = phone ? phone.replace(/^(\+34)?(\d{3})(\d{3})(\d{3})$/, "$1 $2 $3 $4").trim() : "Por configurar";

  async function copy(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); setMessage(`${label} copiado.`); }
    catch { setMessage("No hemos podido copiar. Mantén pulsado o selecciona el texto para copiarlo manualmente."); }
  }

  return <section className="diwo-payment">
    {(requestCreated || preview) && <div ref={success} role={preview ? undefined : "status"} tabIndex={-1} className="diwo-payment-success">
      <CircleCheck aria-hidden="true" fill="none" />
      <p className="diwo-payment-success-message">Solicitud registrada</p>
      <p className="diwo-payment-success-reference">#{concept}</p>
    </div>}
    <header className="diwo-payment-header">
      <h1 className="diwo-payment-title">Realiza el pago <span>por Bizum</span></h1>
    </header>

    <OrderSummary quantity={quantity} totalCents={totalCents} />

    <ol className="diwo-payment-steps" aria-label="Instrucciones para pagar por Bizum" role="list">
      <li>
        <span className="diwo-payment-step-number" aria-hidden="true">1</span>
        <div className="diwo-payment-step-content">
          <h2>Envía el pago por Bizum</h2>
          <p>Realiza un único Bizum por el importe total a este número.</p>
          <div className="diwo-payment-copy-field">
            <Smartphone aria-hidden="true" className="diwo-payment-copy-icon" />
            <div><p>Número de Bizum</p><strong>{displayPhone}</strong></div>
            {phone && <button type="button" className="diwo-payment-copy" aria-label="Copiar número de Bizum" onClick={() => void copy(phone, "Número de Bizum")}><Copy aria-hidden="true" /></button>}
          </div>
          {!phone && <p role="status">El número de Bizum aún no está configurado. No realices el pago hasta que esté disponible.</p>}
        </div>
      </li>
      <li>
        <span className="diwo-payment-step-number" aria-hidden="true">2</span>
        <div className="diwo-payment-step-content">
          <h2>Concepto del Bizum</h2>
          <p>En el concepto del Bizum pega este código.</p>
          <div className="diwo-payment-copy-field">
            <ClipboardList aria-hidden="true" className="diwo-payment-copy-icon" />
            <div><p>Concepto del Bizum</p><strong className="diwo-payment-concept">{concept}</strong></div>
            <button type="button" className="diwo-payment-copy" aria-label="Copiar concepto del Bizum" onClick={() => void copy(concept, "Concepto del Bizum")}><Copy aria-hidden="true" /></button>
          </div>
        </div>
      </li>
      <li>
        <span className="diwo-payment-step-number" aria-hidden="true">3</span>
        <div className="diwo-payment-step-content">
          <h2>Espera la aprobación</h2>
          <p>La administración comprobará el pago antes de aprobar tu solicitud. Tus entradas aparecerán en <span className="text-[var(--diwo-yellow)]">Mis Entradas</span> cuando esté aprobada.</p>
        </div>
      </li>
    </ol>
    {message && <p role="status" className="diwo-payment-feedback">{message}</p>}
    <Button asChild className="diwo-request-submit"><Link href="/ticket">IR A MIS ENTRADAS <ArrowRight aria-hidden="true" /></Link></Button>
  </section>;
}
