"use client";

import { toast } from "sonner";
import { BuyerFlowLink as Link } from "@/components/buyer-flow-link";
import { ArrowRight, CircleCheck, Copy, Smartphone, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OrderSummary } from "@/components/order-summary";

type Props = {
  preview: boolean; reference: string; quantity: number; totalCents: number;
  phone: string | null; requestCreated?: boolean;
};

export function OrderPaymentDetails({ preview, reference, quantity, totalCents, phone, requestCreated = false }: Props) {
  // Never truncate or fabricate an existing real order's reference.
  const concept = preview ? "A7K9" : reference;
  const displayPhone = phone ? phone.replace(/^(\+34)?(\d{3})(\d{3})(\d{3})$/, "$1 $2 $3 $4").trim() : "Por configurar";

  async function copy(value: string, label: string) {
    const options = { id: "diwo-payment-copy", position: "top-center" as const };
    try { await navigator.clipboard.writeText(value); toast.success(label, { ...options, duration: 2200 }); }
    catch { toast.error("No hemos podido copiar. Mantén pulsado o selecciona el texto para copiarlo manualmente.", { ...options, duration: 5000 }); }
  }

  return <section className="diwo-payment">
    {(requestCreated || preview) && <div role={preview ? undefined : "status"} className="diwo-payment-success">
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
            {phone && <button type="button" className="diwo-payment-copy" aria-label="Copiar número de Bizum" onClick={() => void copy(phone, "Número copiado")}><Copy aria-hidden="true" /></button>}
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
            <button type="button" className="diwo-payment-copy" aria-label="Copiar concepto del Bizum" onClick={() => void copy(concept, "Concepto copiado")}><Copy aria-hidden="true" /></button>
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
    <Button asChild className="diwo-request-submit"><Link href="/ticket">IR A MIS ENTRADAS <ArrowRight aria-hidden="true" /></Link></Button>
  </section>;
}
