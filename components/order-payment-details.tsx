"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Copy, Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { paymentNotice } from "@/lib/order-payment-state";

type Props = {
  preview: boolean; orderId: string | null; reference: string; buyerName: string;
  names: string[]; totalCents: number; phone: string | null; onBack?: () => void;
  initiallyReported?: boolean;
  embedded?: boolean;
};
const euro = (cents: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);

export function OrderPaymentDetails({ preview, orderId, reference, buyerName, names, totalCents, phone, onBack, initiallyReported = false, embedded = false }: Props) {
  const router = useRouter();
  const Heading = embedded ? "h3" : "h1";
  const PaymentHeading = embedded ? "h4" : "h2";
  const [reported, setReported] = useState(initiallyReported);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);
  const concept = preview ? `${buyerName} · REFERENCIA DE EJEMPLO` : `${buyerName} · ${reference}`;

  async function copy(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); setMessage(`${label} copiado.`); }
    catch { setMessage("No hemos podido copiar. Puedes seleccionar el texto y copiarlo manualmente."); }
  }

  async function report() {
    if (inFlight.current || reported || confirmed) return;
    if (preview) {
      setReported(true);
      setMessage("Vista previa: aviso simulado en esta pantalla. No se ha enviado ni guardado ningún aviso de pago.");
      return;
    }
    if (!orderId) return;
    inFlight.current = true; setBusy(true); setMessage(null);
    try {
      const response = await fetch("/api/orders/report-payment", {
        method: "POST", credentials: "same-origin", redirect: "error", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId }),
        signal: AbortSignal.timeout(20000),
      });
      const result = response.ok ? paymentNotice(await response.json(), orderId) : null;
      if (!result) { setMessage("No hemos podido confirmar el aviso. Puedes reintentarlo sobre esta misma solicitud."); return; }
      setConfirmed(result.status === "confirmed");
      setReported(result.reportedAt !== null);
      if (embedded) router.refresh();
    } catch { setMessage("No hemos podido confirmar el aviso. Reintenta la misma solicitud cuando vuelva la conexión."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return (
    <section className={embedded ? "mt-5" : "mx-auto w-full max-w-xl px-5 py-7 sm:py-12"}>
      {onBack && <Button type="button" variant="ghost" onClick={onBack} className="mb-5 min-h-11 px-0 text-zinc-300"><ArrowLeft aria-hidden="true" /> Volver a los nombres</Button>}
      {preview && <div role="status" className="mb-5 rounded-xl border border-primary/40 bg-primary/10 p-4 text-sm leading-relaxed text-zinc-200">
        <strong className="block text-primary">Vista previa local · No se ha creado ningún pedido</strong>
        Esta pantalla muestra el siguiente paso con tus datos de prueba. La referencia es de ejemplo; no corresponde a un pago real.
      </div>}
      <div className="rounded-2xl border border-zinc-800 bg-card p-5 sm:p-7">
        {confirmed ? <Check aria-hidden="true" className="mb-4 size-8 text-primary" /> : <Clock3 aria-hidden="true" className="mb-4 size-8 text-primary" />}
        <p className="mb-2 text-xs font-bold uppercase tracking-widest text-primary">{preview ? "Ejemplo de solicitud pendiente" : reference}</p>
        <Heading className={`${embedded ? "text-2xl" : "text-3xl"} font-bold tracking-tight text-white`}>{confirmed ? "¡Tus entradas están listas!" : reported ? "Estamos verificando tu pago" : preview ? "Así será el pago" : "Solicitud recibida"}</Heading>
        <p className="mt-3 text-sm leading-relaxed text-zinc-300">{confirmed ? "La organización ha confirmado el pago. Consulta tus entradas en Mis entradas." : reported ? preview ? "Así se mostrará tu solicitud después de comunicar el Bizum. Las entradas aparecerán cuando la organización confirme el pago." : "Has comunicado el pago. Tus entradas aparecerán cuando la organización lo compruebe y confirme." : "Pendiente de confirmación del pago. Un único Bizum por el total de la solicitud."}</p>
        <dl className="my-6 space-y-3 border-y border-zinc-800 py-5">
          <div className="flex justify-between gap-3 text-sm"><dt className="text-zinc-400">Entradas solicitadas</dt><dd className="text-white">{names.length}</dd></div>
          <div className="flex justify-between gap-3 text-sm"><dt className="text-zinc-400">Precio por entrada</dt><dd className="text-white">5,00 €</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="font-semibold text-white">Total</dt><dd className="text-3xl font-bold text-primary">{euro(totalCents)}</dd></div>
        </dl>
        {!confirmed && <>
          <PaymentHeading className="text-xl font-semibold text-white">Realiza tu Bizum</PaymentHeading>
          <p className="mb-5 mt-2 text-sm leading-relaxed text-zinc-400">Incluye el nombre del comprador y la referencia en el concepto para que podamos identificarlo.</p>
          <div className="space-y-3">
            {[{ label: "Teléfono Bizum", value: phone ?? "Por configurar", copy: phone },
              { label: "Concepto", value: concept, copy: preview ? null : concept },
              { label: "Importe", value: euro(totalCents), copy: preview ? null : euro(totalCents) }].map((field) =>
              <div key={field.label} className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                <div className="min-w-0"><p className="mb-1 text-xs uppercase tracking-wider text-zinc-400">{field.label}</p><p className="break-words font-semibold text-white">{field.value}</p></div>
                {field.copy && !preview && <Button type="button" size="icon" variant="secondary" className="size-11 shrink-0" aria-label={`Copiar ${field.label.toLowerCase()}`} onClick={() => copy(field.copy!, field.label)}><Copy aria-hidden="true" /></Button>}
              </div>)}
          </div>
          {!phone && <p className="mt-3 text-sm leading-relaxed text-zinc-400">El número de Bizum estará disponible cuando la organización complete la configuración.</p>}
          {!reported && <Button type="button" onClick={report} disabled={busy || (!preview && !phone)} className="mt-6 min-h-12 w-full whitespace-normal rounded-xl py-3 font-semibold">{busy ? "Enviando aviso…" : "Ya he realizado el Bizum"}</Button>}
          <p className="mt-4 text-sm leading-relaxed text-zinc-400">El aviso no confirma el pago ni emite entradas. La organización comprobará el ingreso antes de aprobarlo.</p>
        </>}
        <details className="mt-6 border-t border-zinc-800 pt-4 text-sm text-zinc-300"><summary className="cursor-pointer rounded-md py-2 outline-none focus-visible:ring-2 focus-visible:ring-primary">Ver los {names.length} asistentes</summary><ol className="mt-3 list-decimal space-y-2 pl-5">{names.map((name, index) => <li key={index} className="break-words">{name}</li>)}</ol></details>
        {message && <p role="status" className="mt-4 rounded-lg border border-zinc-700 p-3 text-sm text-zinc-200">{message}</p>}
        {!preview && <Button asChild variant="secondary" className="mt-5 min-h-12 w-full"><Link href="/ticket">Mis entradas <ArrowRight aria-hidden="true" /></Link></Button>}
      </div>
    </section>
  );
}
