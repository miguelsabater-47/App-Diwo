"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, CalendarDays, Check, Minus, Plus, MapPin, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { OrderSummary } from "@/components/order-summary";
import { parseRequestDraft, requestReceipt, type RequestDraft, type RequestReceipt, type SalesAvailability } from "@/lib/order-request-state";

const euro = (cents: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
const fieldClass = "diwo-request-input";
const errorMessages: Record<string, string> = {
  authentication_required: "Tu sesión ha caducado. Vuelve a iniciar sesión y reintenta esta misma solicitud.",
  operation_not_authorized: "No se ha autorizado la operación. Revisa tu sesión antes de continuar.",
  sales_not_open: "La venta todavía no está abierta. Conservamos tu solicitud para reintentarlo cuando se active.",
  request_id_conflict: "Esta solicitud ya existe con otro contenido. Revisa Mis entradas antes de continuar.",
  invalid_request_body: "Revisa el nombre y apellidos de todos los asistentes.",
  request_body_too_large: "La solicitud supera el tamaño técnico permitido. Revisa el contenido antes de continuar.",
};

type Props = { availability: SalesAvailability; previewAllowed: boolean };

export function OrderRequestForm({ availability, previewAllowed }: Props) {
  const { userId, isLoaded } = useAuth();
  const { user, isLoaded: profileLoaded } = useUser();
  const profileName = profileLoaded && user && user.id === userId
    ? [user.firstName, user.lastName].map(part => part?.trim()).filter(Boolean).join(" ") : "";
  return <OrderRequestFields key={`${userId ?? "anonymous"}:${availability.eventId ?? "none"}:${previewAllowed ? "preview" : "live"}`}
    availability={availability} previewAllowed={previewAllowed} userId={userId} isLoaded={isLoaded} profileName={profileName} />;
}

function OrderRequestFields({ availability, previewAllowed, userId, isLoaded, profileName }: Props & {
  availability: SalesAvailability; userId: string | null | undefined; isLoaded: boolean; profileName: string;
}) {
  // null means untouched; an intentionally empty edit must not be autofilled again.
  const [nameOverrides, setNames] = useState<(string | null)[]>([null]);
  const names = nameOverrides.map((name, index) => name ?? (index === 0 ? profileName : ""));
  const [draft, setDraft] = useState<RequestDraft | null>(null);
  // New requests use the first attendee as buyer. Never rewrite an old saved payload.
  const buyerName = draft?.buyerName ?? names[0];
  const [receipt, setReceipt] = useState<RequestReceipt | null>(null);
  const router = useRouter();
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
    if (!isLoaded || restored) return;
    setDraft(null); setReceipt(null); setMessage(null); setStorageBlocked(false);
    setNames([null]);
    try {
      const saved = storageKey ? sessionStorage.getItem(storageKey) : null;
      if (saved && eventId) {
        const previous = parseRequestDraft(saved, eventId);
        if (!previous) throw new Error("invalid_saved_submission");
        setDraft(previous); setNames(previous.attendeeNames);
        setMessage("Hemos recuperado tu última solicitud. Reintentaremos el mismo contenido sin crear otra.");
      }
    } catch {
      setStorageBlocked(true);
      setMessage("No podemos recuperar o conservar tu solicitud en esta pestaña. Revisa Mis entradas antes de continuar.");
    }
    setRestored(true);
  }, [storageKey, eventId, isLoaded, restored]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || (!salesOpen && !canPreview) || !userId || !restored || storageBlocked) return;
    const invalid = names.findIndex((name) => name.trim() === "");
    if (invalid >= 0) {
      setMessage("Introduce el nombre y apellidos de cada asistente (Obligatorio).");
      document.getElementById(`attendee-${invalid}`)?.focus();
      return;
    }
    if (canPreview) {
      if (buyerName.includes("\u0000") || names.some((name) => name.includes("\u0000"))) {
        setMessage("Revisa los nombres antes de continuar."); return;
      }
      setMessage(null);
      router.replace(`/ticket/payment/preview?quantity=${names.length}`);
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
      if (confirmed.status === "pending") router.replace(`/ticket/payment/${encodeURIComponent(confirmed.id)}`);
      // Retain the exact submission through reload until the user deliberately leaves this flow.
    } catch {
      setMessage("No hemos podido completar la consulta. Conservamos la misma solicitud; no vuelvas a crearla en otra pestaña.");
    } finally {
      inFlight.current = false; setBusy(false);
    }
  }

  if (receipt?.status === "pending") return <section role="status" className="diwo-request space-y-4 py-6 text-zinc-300">
    <p>Solicitud enviada correctamente. Abriendo las instrucciones de pago…</p>
    <Link href={`/ticket/payment/${encodeURIComponent(receipt.id)}`} className="inline-flex min-h-11 items-center text-primary underline">Ver las instrucciones de pago</Link>
  </section>;

  if (receipt) return (
    <section className="mx-auto w-full max-w-xl px-5 py-8 sm:py-12">
      <div className="rounded-2xl border border-primary/40 bg-card p-6 sm:p-8">
        <Check aria-hidden="true" className="mb-5 size-10 text-primary" />
        <h1 className="text-3xl font-bold text-white">{receipt.status === "confirmed" ? "Pago confirmado" : "Solicitud cerrada"}</h1>
        <p className="mt-3 text-zinc-300">{receipt.status === "confirmed" ? "El pago de esta solicitud ya está confirmado." : "Esta solicitud no puede volver a aprobarse. Consulta su estado en Mis entradas."}</p>
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
    <section className="diwo-request">
      <h1 className="sr-only">Conseguir entradas</h1>
      <header className="diwo-request-event" aria-label="Información de la fiesta">
        <Image src="/foto-de-perfil-wpp.jpg" alt="Cartel DIWO X 2.0 · Halloween House Party" width={128} height={128} sizes="(max-width: 639px) 96px, 128px" className="diwo-request-poster" />
        <div className="diwo-request-event-copy">
          <h2>DIWO X 2.0</h2><p className="diwo-request-host">Hosted by “La Peste Negra”</p>
          <p className="diwo-request-event-meta"><CalendarDays aria-hidden="true" /><time dateTime="2026-10-31">Sábado, 31 de octubre de 2026</time></p>
          <p className="diwo-request-event-meta"><MapPin aria-hidden="true" /><span>Ceutí, Murcia</span></p>
        </div>
        <p className="diwo-request-unit-price">5,00 €/<br />entrada</p>
      </header>

      {(canPreview || availability.state === "unavailable") && <div role="status" className="mb-6 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm leading-relaxed text-zinc-200">
        <strong className="block text-primary">{canPreview ? "Vista previa local del paso de pago" : "No podemos comprobar la venta"}</strong>
        {canPreview ? "Puedes completar los nombres y abrir la vista previa del pago. Esta vista previa no crea pedidos ni envía avisos." : "Actualiza la página para volver a consultar el estado."}
      </div>}

      <form onSubmit={submit} aria-busy={busy} className="diwo-request-form">
          <section className="diwo-request-quantity" aria-labelledby="quantity-heading">
            <div><h2 id="quantity-heading">¿Cuántas entradas quieres?</h2><p>Selecciona el número de entradas totales</p></div>
            <div className="diwo-request-stepper">
              <Button type="button" className="diwo-request-step" aria-label="Quitar una entrada" disabled={names.length === 1 || !!draft || busy} onClick={() => setNames(previous => previous.slice(0, -1))}><Minus aria-hidden="true" /></Button>
              <output aria-live="polite" aria-label="Cantidad de entradas">{names.length}</output>
              <Button type="button" className="diwo-request-step" aria-label="Añadir una entrada" disabled={!!draft || busy} onClick={() => setNames(previous => [...previous, ""])}><Plus aria-hidden="true" /></Button>
            </div>
          </section>
          <section className="diwo-request-attendees" aria-labelledby="attendees-heading">
            <h2 id="attendees-heading">Asistentes</h2>
            <p id="attendees-help" className="diwo-request-attendees-intro">Introduce el nombre y apellidos de cada asistente (Obligatorio)</p>
            <div className="diwo-request-names">{names.map((value, index) => <div key={index}>
              <label htmlFor={`attendee-${index}`} className="diwo-request-attendee-label"><span><UserRound aria-hidden="true" /></span>Asistente {index + 1}{index === 0 && <strong className="diwo-request-buyer-tag">(comprador)</strong>}</label>
              <input id={`attendee-${index}`} name={`attendee-${index}`} autoComplete={index === 0 ? "name" : "off"} required value={value} disabled={!!draft || busy}
                aria-describedby="attendees-help" onChange={(event) => setNames((previous) => previous.map((name, position) => position === index ? event.target.value : name))} className={fieldClass} placeholder="Nombre y apellidos" />
            </div>)}</div>
          </section>
        <OrderSummary quantity={names.length} totalCents={names.length * 500}>
          {message && <p role="alert" className="mb-4 rounded-lg border border-zinc-700 p-3 text-sm leading-relaxed text-zinc-200">{message}</p>}
          <Button type="submit" className="diwo-request-submit" disabled={(!salesOpen && !canPreview) || !restored || !userId || storageBlocked || busy}>
            {busy ? "ENVIANDO SOLICITUD…" : draft ? "REINTENTAR MISMA SOLICITUD" : canPreview ? "VER VISTA PREVIA DEL PAGO" : "REALIZAR SOLICITUD DE ENTRADAS"}
          </Button>
          {!!draft && <p className="mt-3 text-xs leading-relaxed text-zinc-400">Los nombres están bloqueados para conservar el mismo pedido al reintentar.</p>}
          {draft && draft.buyerName !== draft.attendeeNames[0] && <p className="mt-3 text-xs leading-relaxed text-zinc-400">La solicitud recuperada conserva su comprador original: {draft.buyerName}. No se cambiarán los datos al reintentar.</p>}
        </OrderSummary>
      </form>
    </section>
  );
}
