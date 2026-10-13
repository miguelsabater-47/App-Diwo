import Link from "next/link";
import { OwnedTicketActions } from "@/components/owned-ticket-actions";
import type { OwnedTicketResult } from "@/lib/owned-ticket-reader";

export function OwnedTicketDetail({ result }: { result: OwnedTicketResult }) {
  if (!result.ok) return <main className="mx-auto max-w-2xl px-5 py-10"><p role="alert" className="rounded-2xl border border-zinc-800 bg-card p-6 text-zinc-200">No hemos podido cargar el detalle de tu entrada. Inténtalo de nuevo más tarde.</p><Link className="mt-5 inline-block text-primary underline" href="/ticket">Volver a Mis entradas</Link></main>;
  const { ticket, technical } = result;
  const date = new Intl.DateTimeFormat("es-ES", { dateStyle: "full", timeStyle: "short", timeZone: ticket.timezone });
  const euro = new Intl.NumberFormat("es-ES", { style: "currency", currency: ticket.currency });
  const state = ticket.status === "valid" ? "Válida · Sin utilizar" : ticket.status === "used" ? "Entrada utilizada" : "Anulada · Esta entrada no permite el acceso";
  return <main className="mx-auto w-full max-w-2xl px-5 py-8 sm:py-12">
    <Link className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" href="/ticket">← Volver a Mis entradas</Link>
    <article id="owned-ticket-export" className="mt-5 rounded-3xl border border-zinc-800 bg-card p-6 text-zinc-100 shadow-xl sm:p-9">
      {technical && <p className="mb-6 rounded-xl border border-amber-500/50 bg-amber-950/30 p-4 text-sm font-semibold text-amber-200">PRUEBA TÉCNICA · Esta entrada no es válida para DIWO X 2.0.</p>}
      <p className="font-mono text-xs tracking-widest text-primary">DIWO X 2.0 · ENTRADA INDIVIDUAL</p>
      <h1 className="mt-3 text-3xl font-bold">{ticket.attendeeName}</h1><h2 className="mt-2 text-xl text-zinc-300">{ticket.eventTitle}</h2>
      <p className="mt-5 leading-relaxed text-zinc-300">{date.format(new Date(ticket.startsAt))} – {date.format(new Date(ticket.endsAt))}<br />{ticket.publicLocation}</p>
      <p className="mt-4 text-sm text-zinc-400">Entrada {ticket.id.slice(0, 8).toUpperCase()} · {euro.format(ticket.unitPriceCents / 100)}</p>
      <p className={`mt-6 rounded-xl border p-4 font-semibold ${ticket.status === "valid" ? "border-emerald-700 bg-emerald-950/30 text-emerald-200" : ticket.status === "used" ? "border-zinc-700 text-zinc-200" : "border-red-800 bg-red-950/30 text-red-200"}`}>{state}</p>
      {ticket.usedAt && <p className="mt-2 text-sm text-zinc-400">Utilizada: {date.format(new Date(ticket.usedAt))}</p>}
      {ticket.revokedAt && <p className="mt-2 text-sm text-zinc-400">Anulada: {date.format(new Date(ticket.revokedAt))}</p>}
      {ticket.status === "valid" && ticket.qrDataUrl ? <div className="mx-auto mt-7 max-w-xs rounded-2xl bg-white p-4"><img data-ticket-qr className="block h-auto w-full" src={ticket.qrDataUrl} alt={`Código QR de la entrada de ${ticket.attendeeName}`} /></div> : ticket.status === "valid" ? <p role="status" className="mt-6 text-sm text-zinc-300">El código QR no está disponible. No se ha generado un código de sustitución.</p> : null}
      {technical && <p className="mt-5 text-center text-xs font-semibold text-amber-200">PRUEBA TÉCNICA · NO VÁLIDA PARA EL EVENTO REAL</p>}
    </article>
    {ticket.status === "valid" && ticket.qrDataUrl && <OwnedTicketActions ticketId={ticket.id} technical={technical} />}
    <p className="mt-4 text-center text-xs text-zinc-500">La dirección exacta se comunicará por WhatsApp el último día.</p>
  </main>;
}
