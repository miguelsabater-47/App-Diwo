import Image from "next/image";
import type { ReactNode } from "react";
import { CalendarDays, MapPin, Clock3, CupSoda, Shirt, Disc3 } from "lucide-react";
import { NewOrderLink } from "@/components/new-order-link";
import { buyerRequestContext, buyerRequestCopy, type BuyerRequestContext } from "@/lib/buyer-request-context";

/** Informational only: the request route still owns sales availability. */
export function AttendeeHome({ requestContext = buyerRequestContext([]), requestSection }: { requestContext?: BuyerRequestContext | null; requestSection?: ReactNode } = {}) {
  return <section className="diwo-home" aria-label="DIWO X 2.0">
    <h1 className="diwo-home-welcome">BIENVENIDO/A A DIWO X 2.0</h1>

    <div className="diwo-home-hero">
      <Image src="/hero inicio interfaz.jpg" alt="" fill priority sizes="(max-width: 640px) 92vw, 720px" className="diwo-home-art" />
      <div className="diwo-home-hero-copy">
        <h2>HALLOWEEN<br />HOUSE PARTY</h2>
        <p className="diwo-home-host">Hosted by “La Peste Negra”</p>
        <div className="diwo-home-event-details">
          <div><CalendarDays aria-hidden="true" /><p>Sábado<time dateTime="2026-10-31">31.10.26</time></p></div>
          <div><MapPin aria-hidden="true" /><p>Casa de campo<strong>Ceutí, Murcia</strong></p></div>
        </div>
      </div>
    </div>

    {requestSection ?? renderHomeRequest(requestContext)}

    <section className="diwo-home-information" aria-labelledby="diwo-home-information-title">
      <h2 id="diwo-home-information-title">Lo que necesitas saber</h2>
      <div className="diwo-home-cards">
        <article data-scroll-reveal><Clock3 aria-hidden="true" /><h3>Horario</h3><p>23:30–07:00<br />Acceso hasta la 01:30</p></article>
        <article data-scroll-reveal><CupSoda aria-hidden="true" /><h3>¿Qué incluye?</h3><p>Hielo, vasos y cóctel de bienvenida a los 45 primeros</p></article>
        <article data-scroll-reveal><Shirt aria-hidden="true" /><h3>Dresscode</h3><p>Tu mejor disfraz, cúrratelo anda que es halloween</p></article>
        <article data-scroll-reveal><Disc3 aria-hidden="true" /><h3>Música</h3><p>DJ sets toda la noche<br />+4 djs</p></article>
      </div>
      <p className="diwo-home-smallprint diwo-home-address-note">La dirección exacta se compartirá en el grupo de WhatsApp el último día.</p>
    </section>
  </section>;
}

/** Only this personal section waits for verified order data, not the event artwork. */
export function renderHomeRequest(requestContext: BuyerRequestContext | null) {
  const copy = buyerRequestCopy(requestContext);
  return <section className="diwo-home-tickets" aria-labelledby="diwo-home-tickets-title" data-scroll-reveal>
    <h2 id="diwo-home-tickets-title">{copy.title}</h2>
    <p className="diwo-home-subtitle">{copy.detail}</p>
    <NewOrderLink eventId={requestContext?.eventId ?? null} recorded={requestContext?.recorded ?? []} label={copy.action} />
  </section>;
}
