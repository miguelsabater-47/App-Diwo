import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Clock3 } from "lucide-react";
import type { OrderView } from "@/lib/order-view-model";

type PendingOrder = Pick<OrderView, "id" | "reference" | "quantity" | "names" | "totalCents" | "actualEvent" | "technical" | "eventTitle">;
const euro = (cents: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);

export function PendingOrderCard({ order, preview = false }: { order: PendingOrder; preview?: boolean }) {
  const href = preview ? `/ticket/payment/preview?quantity=${order.quantity}` : `/ticket/payment/${encodeURIComponent(order.id)}`;
  return <article className="diwo-pending-card" aria-label={`Solicitud ${order.reference}`} data-scroll-reveal>
    {order.technical && <p className="diwo-pending-technical">Prueba técnica conservada · No realices un pago por esta solicitud.</p>}
    <div className="diwo-pending-top">
      <div className="diwo-pending-status-row">
        <p className="diwo-pending-state"><Clock3 aria-hidden="true" /><span>Solicitud pendiente</span></p>
        <p className="diwo-pending-reference">#{order.reference}</p>
      </div>
      <Link href={href} className="diwo-pending-link" aria-label={`Ver las instrucciones de pago de la solicitud ${order.reference}`}>Ver instrucciones de pago <ArrowRight aria-hidden="true" /></Link>
    </div>
    {order.actualEvent && !order.technical ? <Image src="/foto-de-perfil-wpp.jpg" alt="Cartel DIWO X 2.0 · Halloween House Party"
      width={800} height={350} sizes="(max-width: 639px) calc(100vw - 80px), 664px" className="diwo-pending-poster" />
      : <p className="diwo-pending-event">{order.eventTitle}</p>}
    <div className="diwo-pending-summary">
      <div>
        <p className="diwo-pending-label">Entradas solicitadas</p>
        <p className="diwo-pending-quantity">{order.quantity} {order.quantity === 1 ? "entrada" : "entradas"}</p>
        <ul className="diwo-pending-names">{order.names.map((name, index) => <li key={index}>1 × {name}</li>)}</ul>
      </div>
      <div className="diwo-pending-price"><p className="diwo-pending-label">Importe total</p><p>{euro(order.totalCents)}</p></div>
    </div>
  </article>;
}
