"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CalendarDays, Check, Minus, Plus, Ticket, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OrderPaymentDetails } from "@/components/order-payment-details";
import { parseRequestDraft, requestReceipt, type RequestDraft, type RequestReceipt, type SalesAvailability } from "@/lib/order-request-state";

const euro = (cents: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
const fieldClass = "min-h-12 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-base text-white outline-none placeholder:text-zinc-500 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-70";
const errorMessages: Record<string, string> = {
  authentication_required: "Tu sesión ha caducado. Vuelve a iniciar sesión y reintenta esta misma solicitud.",
  operation_not_authorized: "No se ha autorizado la operación. Revisa tu sesión antes de continuar.",
  sales_not_open: "La venta todavía no está abierta. Conservamos tu solicitud para reintentarlo cuando se active.",
  request_id_conflict: "Esta solicitud ya existe con otro contenido. Revisa Mis entradas antes de continuar.",
  invalid_request_body: "Revisa los nombres del comprador y de todos los asistentes.",
  request_body_too_large: "La solicitud supera el tamaño técnico permitido. Revisa el contenido antes de continuar.",
};

type Props = { availability: SalesAvailability; previewAllowed: boolean; phone: string | null };

export function OrderRequestForm({ availability, previewAllowed, phone }: Props) {
  const { userId, isLoaded } = useAuth();
  return <OrderRequestFields key={`${userId ?? "anonymous"}:${availability.eventId ?? "none"}:${previewAllowed ? "preview" : "live"}`}
    availability={availability} previewAllowed={previewAllowed} phone={phone} userId={userId} isLoaded={isLoaded} />;
}

function OrderRequestFields({ availability, previewAllowed, phone, userId, isLoaded }: Props & {
  availability: SalesAvailability; userId: string | null | undefined; isLoaded: boolean;
}) {
  const [buyerName, setBuyerName] = useState("");
  const [names, setNames] = useState([""]);
  const [draft, setDraft] = useState<RequestDraft | null>(null);
  const [receipt, setReceipt] = useState<RequestReceipt | null>(null);
  const [preview, setPreview] = useState<{ buyerName: string; names: string[] } | null>(null);
  const [restored, setRestored] = useState(false);
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);
  const eventId = availability.eventId;
  // Drafts are private to this signed account/event/tab, never shared across logins.
  const storageKey = userId && eventId ? `diwo.order-submission.v1.${userId}.${eventId}` : null;
  const salesOpen = availability.state === "open" && !!eventId;
  const canPreview = previewAllowed && availability.state === "unpublished";

  useEffect(() => {
    if (!isLoaded) return;
    setDraft(null); setReceipt(null); setMessage(null); setStorageBlocked(false);
    setBuyerName(""); setNames([""]);
    try {
      const saved = storageKey ? sessionStorage.getItem(storageKey) : null;
      if (saved && eventId) {
        const previous = parseRequestDraft(saved, eventId);
        if (!previous) throw new Error("invalid_saved_submission");
        setDraft(previous); setBuyerName(previous.buyerName); setNames(previous.attendeeNames);
        setMessage("Hemos recuperado tu última solicitud. Reintentaremos el mismo contenido sin crear otra.");
      }
    } catch {
      setStorageBlocked(true);
      setMessage("No podemos recuperar o conservar tu solicitud en esta pestaña. Revisa Mis entradas antes de continuar.");
    }
    setRestored(true);
  }, [storageKey, eventId, isLoaded]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || (!salesOpen && !canPreview) || !userId || !restored || storageBlocked) return;
    const invalid = buyerName.trim() === "" ? "buyer-name" : names.findIndex((name) => name.trim() === "");
    if (invalid === "buyer-name" || (typeof invalid === "number" && invalid >= 0)) {
      setMessage("Escribe el nombre del comprador y un nombre por cada entrada.");
      document.getElementById(invalid === "buyer-name" ? invalid : `attendee-${invalid}`)?.focus();
      return;
    }
    if (canPreview) {
      if (buyerName.includes("\u0000") || names.some((name) => name.includes("\u0000"))) {
        setMessage("Revisa los nombres antes de continuar."); return;
      }
      setMessage(null);
      setPreview({ buyerName: buyerName.trim(), names: names.map((name) => name.trim()) });
      return;
    }
    if (!eventId || !storageKey) return;
    inFlight.current = true; setBusy(true); setMessage(null);
    try {
      const submission = draft ?? {
        requestId: crypto.randomUUID(), eventId, buyerName: buyerName.trim(), attendeeNames: names.map((name) => name.trim()),
      };
      // Save UUID AND immutable payload BEFORE sending. Never silently retry after an error.
      const serialized = JSON.stringify(submission);
      if (!parseRequestDraft(serialized, eventId)) {
        setMessage("Revisa los nombres: deben contener texto válido para cada persona.");
        return;
      }
      if (new TextEncoder().encode(serialized).byteLength > 64 * 1024) {
        setMessage("El contenido supera el tamaño técnico de una solicitud. Revisa los nombres antes de enviarla.");
        return;
      }
      try { sessionStorage.setItem(storageKey, serialized); }
      catch {
        setStorageBlocked(true);
        setMessage("No podemos conservar el identificador en esta pestaña. No se ha enviado la solicitud.");
        return;
      }
      setDraft(submission);
      const response = await fetch("/api/orders/request", {
        method: "POST", credentials: "same-origin", redirect: "error", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: serialized, signal: AbortSignal.timeout(20000),
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        const code = data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : "";
        setMessage(Object.hasOwn(errorMessages, code) ? errorMessages[code] :
          "No hemos podido confirmar el resultado. Reintenta esta misma solicitud; no crearemos otra.");
        return;
      }
      const confirmed = requestReceipt(data, submission);
      if (!confirmed) {
        setMessage("No hemos podido verificar el resultado. Conservamos la misma solicitud para reintentar.");
        return;
      }
      setReceipt(confirmed);
      // Retain the exact submission through reload until the user deliberately leaves this flow.
    } catch {
      setMessage("No hemos podido completar la consulta. Conservamos la misma solicitud; no vuelvas a crearla en otra pestaña.");
    } finally {
      inFlight.current = false; setBusy(false);
    }
  }

  if (preview) return <OrderPaymentDetails preview orderId={null} reference="VISTA PREVIA" buyerName={preview.buyerName}
    names={preview.names} totalCents={preview.names.length * 500} phone={null} onBack={() => setPreview(null)} />;

  if (receipt?.status === "pending" && draft) return <OrderPaymentDetails key={receipt.id} preview={false}
    orderId={receipt.id} reference={receipt.reference} buyerName={draft.buyerName} names={draft.attendeeNames}
    totalCents={receipt.totalCents} phone={phone} />;

  if (receipt) return (
    <section className="mx-auto w-full max-w-xl px-5 py-8 sm:py-12">
      <div className="rounded-2xl border border-primary/40 bg-card p-6 sm:p-8">
        <Check aria-hidden="true" className="mb-5 size-10 text-primary" />
        <h1 className="text-3xl font-bold tracking-tight text-white">{receipt.status === "pending" ? "Solicitud recibida" : receipt.status === "confirmed" ? "Pago confirmado" : "Solicitud cerrada"}</h1>
        <p className="mt-3 text-zinc-300">{receipt.status === "pending" ? "Pendiente de confirmación del pago. Tus entradas estarán disponibles cuando la organización compruebe el Bizum." : receipt.status === "confirmed" ? "El pago de esta solicitud ya está confirmado." : "Esta solicitud no puede volver a aprobarse. Consulta su estado en Mis entradas."}</p>
        <dl className="mt-6 space-y-3 border-y border-zinc-800 py-5">
          <div className="flex flex-wrap justify-between gap-2"><dt className="text-zinc-400">Referencia</dt><dd className="break-all font-mono text-white">{receipt.reference}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-zinc-400">Entradas</dt><dd className="text-white">{receipt.quantity}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="font-semibold text-white">Total</dt><dd className="text-3xl font-bold text-primary">{euro(receipt.totalCents)}</dd></div>
        </dl>
        <Button asChild className="mt-6 min-h-12 w-full"><Link href="/ticket">Ir a Mis entradas <ArrowRight aria-hidden="true" /></Link></Button>
      </div>
    </section>
  );

  return (
    <section className="mx-auto w-full max-w-4xl px-5 py-7 sm:px-8 sm:py-12">
      <Link href="/account" className="mb-6 inline-flex min-h-11 items-center gap-2 rounded-lg text-sm text-zinc-300 outline-none hover:text-white focus-visible:ring-2 focus-visible:ring-primary"><ArrowLeft aria-hidden="true" className="size-4" /> Mi cuenta</Link>
      <header className="mb-7 max-w-xl">
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-primary">DIWO X 2.0 · Halloween party</p>
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">Solicitar entradas</h1>
        <p className="mt-3 leading-relaxed text-zinc-300">Tú reúnes al grupo. Una solicitud, un Bizum y una entrada para cada persona.</p>
        <p className="mt-4 flex items-center gap-2 text-sm text-zinc-400"><CalendarDays aria-hidden="true" className="size-4 shrink-0" /> 31 oct 2026 · 23:00 · Casa de campo en Ceutí</p>
      </header>

      {!salesOpen && <div role="status" className="mb-6 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm leading-relaxed text-zinc-200">
        <strong className="block text-primary">{canPreview ? "Vista previa local del paso de pago" : availability.state === "unavailable" ? "No podemos comprobar la venta" : "Venta en preparación"}</strong>
        {canPreview ? "Puedes completar los nombres y pulsar Continuar al pago para revisar la siguiente pantalla. Esta vista previa no crea pedidos ni envía avisos." : availability.state === "unavailable" ? "Actualiza la página para volver a consultar el estado." : "Las entradas saldrán cuando la app esté lista y la organización active la venta. Puedes preparar los nombres."}
      </div>}

      <form onSubmit={submit} aria-busy={busy} className="grid items-start gap-5 md:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-5">
          <section className="rounded-2xl border border-zinc-800 bg-card p-5 sm:p-6" aria-labelledby="buyer-heading">
            <h2 id="buyer-heading" className="mb-4 text-lg font-semibold text-white">01 · El comprador</h2>
            <label htmlFor="buyer-name" className="mb-2 block text-sm font-medium text-zinc-200">Nombre del comprador</label>
            <input id="buyer-name" name="buyerName" autoComplete="name" required value={buyerName} disabled={!!draft || busy}
              onChange={(event) => setBuyerName(event.target.value)} aria-describedby="buyer-help" className={fieldClass} placeholder="Tu nombre y apellidos" />
            <p id="buyer-help" className="mt-3 text-sm leading-relaxed text-zinc-400">Este nombre aparecerá junto a la referencia en el concepto del Bizum.</p>
          </section>
          <section className="rounded-2xl border border-zinc-800 bg-card p-5 sm:p-6" aria-labelledby="attendees-heading">
            <h2 id="attendees-heading" className="text-lg font-semibold text-white">02 · Tu grupo</h2>
            <div className="my-5 flex flex-wrap items-center justify-between gap-4">
              <div><p className="font-medium text-zinc-200">Número de entradas</p><p className="mt-1 text-sm text-zinc-400">5 € por persona</p></div>
              <div className="flex items-center gap-4">
                <Button type="button" variant="secondary" className="size-11 rounded-xl" aria-label="Quitar una entrada" disabled={names.length === 1 || !!draft || busy} onClick={() => setNames((previous) => previous.slice(0, -1))}><Minus aria-hidden="true" /></Button>
                <output aria-live="polite" aria-label="Cantidad de entradas" className="min-w-6 text-center text-2xl font-bold text-white">{names.length}</output>
                <Button type="button" variant="secondary" className="size-11 rounded-xl" aria-label="Añadir una entrada" disabled={!!draft || busy} onClick={() => setNames((previous) => [...previous, ""])}><Plus aria-hidden="true" /></Button>
              </div>
            </div>
            <p id="attendees-help" className="mb-5 flex items-start gap-2 text-sm leading-relaxed text-zinc-400"><Users aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> Una entrada por persona. Tus amigos no necesitan crear una cuenta.</p>
            <div className="space-y-4">{names.map((value, index) => <div key={index}>
              <label htmlFor={`attendee-${index}`} className="mb-2 block text-sm font-medium text-zinc-200">Nombre del asistente · Entrada {index + 1}</label>
              <input id={`attendee-${index}`} name={`attendee-${index}`} autoComplete="off" required value={value} disabled={!!draft || busy}
                aria-describedby="attendees-help" onChange={(event) => setNames((previous) => previous.map((name, position) => position === index ? event.target.value : name))} className={fieldClass} placeholder="Nombre y apellidos" />
            </div>)}</div>
          </section>
        </div>
        <aside className="min-w-0 rounded-2xl border border-primary/30 bg-card p-5 sm:p-6 md:sticky md:top-24" aria-labelledby="summary-heading">
          <Ticket aria-hidden="true" className="mb-4 size-7 text-primary" />
          <h2 id="summary-heading" className="text-lg font-semibold text-white">Tu solicitud</h2>
          <dl className="my-5 space-y-3 border-b border-zinc-800 pb-5">
            <div className="flex justify-between gap-3 text-sm"><dt className="text-zinc-400">{names.length} {names.length === 1 ? "entrada" : "entradas"} × 5 €</dt><dd className="text-white">{euro(names.length * 500)}</dd></div>
            <div className="flex items-baseline justify-between gap-3"><dt className="font-semibold text-white">Total</dt><dd className="text-3xl font-bold text-primary" aria-live="polite">{euro(names.length * 500)}</dd></div>
          </dl>
          <p className="mb-5 text-sm leading-relaxed text-zinc-400">Un único Bizum por el importe total. La organización comprobará el pago antes de emitir las entradas.</p>
          {message && <p role="alert" className="mb-4 rounded-lg border border-zinc-700 p-3 text-sm leading-relaxed text-zinc-200">{message}</p>}
          <Button type="submit" className="min-h-12 w-full whitespace-normal rounded-xl py-3 font-semibold" disabled={(!salesOpen && !canPreview) || !restored || !userId || storageBlocked || busy}>
            {busy ? "Enviando solicitud…" : draft ? "Reintentar misma solicitud" : "Continuar al pago"}<ArrowRight aria-hidden="true" />
          </Button>
          {!!draft && <p className="mt-3 text-xs leading-relaxed text-zinc-400">Los nombres están bloqueados para conservar el mismo pedido al reintentar.</p>}
          <p className="mt-4 text-xs leading-relaxed text-zinc-400">Te esperamos entre las 23:30 y la 01:30. La dirección exacta se compartirá por WhatsApp el último día.</p>
        </aside>
      </form>
    </section>
  );
}
