import Image from "next/image";
import { CalendarDays, Clock3, MapPin, UserRound } from "lucide-react";
import type { ReadyTicket } from "@/lib/ticket-carousel-model";

export function OwnedTicketCard({ result, designPreview = false, active = true, displayNumber }: {
  result: ReadyTicket; designPreview?: boolean; active?: boolean; displayNumber?: string;
}) {
  const { ticket, technical } = result;
  const actualParty = !technical && ticket.eventSlug === "diwo-x-2-2026";
  const date = new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeZone: ticket.timezone }).format(new Date(ticket.startsAt)).replaceAll("/", ".");
  const weekday = new Intl.DateTimeFormat("es-ES", { weekday: "long", timeZone: ticket.timezone }).format(new Date(ticket.startsAt));
  const clock = (value: string) => new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: ticket.timezone }).format(new Date(value));
  const usedDate = (value: string) => new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeStyle: "short", timeZone: ticket.timezone }).format(new Date(value));
  const state = ticket.status === "valid" ? "Válida · Sin utilizar" : ticket.status === "used" ? "Entrada utilizada" : "Anulada · Esta entrada no permite el acceso";
  return <article id={active ? designPreview ? "owned-ticket-design" : "owned-ticket-export" : undefined} data-ticket-id={ticket.id} className="diwo-ticket-card">
    {technical && <p className="diwo-ticket-technical">PRUEBA TÉCNICA · Esta entrada no es válida para DIWO X 2.0.</p>}
    <div className="diwo-ticket-artwork">
      <Image src="/imagen entrada.jpg" alt="Cartel DIWO X 2.0 · Halloween House Party" width={1400} height={840} loading="eager" unoptimized className="diwo-ticket-art" />
      <p className="diwo-ticket-order">#{ticket.orderReference}</p>
    </div>
    <div className="diwo-ticket-body">
      <h2 className="diwo-ticket-attendee"><UserRound aria-hidden="true" /><span>{ticket.attendeeName}</span></h2>
      <div className="diwo-ticket-grid">
        <div className="diwo-ticket-qr-column">
          {designPreview ? <div role="img" aria-label="Espacio reservado para el QR de la entrada" className="diwo-ticket-qr diwo-ticket-qr-placeholder">QR</div>
            : ticket.status === "valid" && ticket.qrDataUrl ? <div className="diwo-ticket-qr">
              {/* eslint-disable-next-line @next/next/no-img-element -- Private QR data URL must never be sent to an image optimizer. */}
              <img data-ticket-qr={active ? true : undefined} src={ticket.qrDataUrl} alt={`Código QR de la entrada de ${ticket.attendeeName}`} />
            </div> : <p role="status" className="diwo-ticket-unavailable">{ticket.status === "valid" ? "El código QR no está disponible. No se ha generado un código de sustitución." : state}</p>}
        </div>
        <div className="diwo-ticket-info">
          <h3>{ticket.eventTitle}</h3>
          {actualParty && <p className="diwo-ticket-host">Hosted by “La Peste Negra”</p>}
          <dl className="diwo-ticket-schedule">
            <div><dt><CalendarDays aria-hidden="true" /><span>{weekday.charAt(0).toLocaleUpperCase("es") + weekday.slice(1)}</span></dt><dd>{date}</dd></div>
            <div><dt><Clock3 aria-hidden="true" /><span>Horario</span></dt><dd>{clock(ticket.startsAt)}–{clock(ticket.endsAt)}</dd></div>
            <div className="diwo-ticket-location"><dt><MapPin aria-hidden="true" /><span>Ubicación</span></dt><dd>{actualParty ? "Ceutí, Murcia" : ticket.publicLocation}</dd></div>
          </dl>
        </div>
      </div>
      <div className="diwo-ticket-foot">
        <p className="diwo-ticket-number">N.º de entrada: {displayNumber ?? (designPreview ? `TK-${ticket.id.slice(0, 6).toUpperCase()}` : ticket.id.slice(0, 8).toUpperCase())}</p>
        {actualParty && <p className="diwo-ticket-arrival">Entrada antes de la 1:30</p>}
      </div>
      {ticket.status !== "valid" && <p className={`diwo-ticket-state diwo-ticket-state-${ticket.status}`}>{state}</p>}
      {ticket.usedAt && <p className="diwo-ticket-audit">Utilizada: {usedDate(ticket.usedAt)}</p>}
      {ticket.revokedAt && <p className="diwo-ticket-audit">Anulada: {usedDate(ticket.revokedAt)}</p>}
      {technical && <p className="diwo-ticket-technical">PRUEBA TÉCNICA · NO VÁLIDA PARA EL EVENTO REAL</p>}
    </div>
  </article>;
}
