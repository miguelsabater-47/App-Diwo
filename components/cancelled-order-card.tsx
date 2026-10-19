import { CircleX } from "lucide-react";
import type { OrderView } from "@/lib/order-view-model";

type CancelledOrder = Pick<OrderView, "reference" | "quantity" | "names" | "totalCents" | "technical">;
const euro = (cents: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);

/** Closed request summary only: no payment, ticket or reactivation actions. */
export function CancelledOrderCard({ order }: { order: CancelledOrder }) {
  return <article className="diwo-pending-card diwo-cancelled-card" aria-label={`Solicitud cancelada ${order.reference}`}>
    {order.technical && <p className="diwo-pending-technical">Prueba técnica conservada · Estas entradas no son válidas para DIWO X 2.0.</p>}
    <div className="diwo-pending-status-row">
      <p className="diwo-pending-state is-cancelled"><CircleX aria-hidden="true" /><span>Solicitud cancelada</span></p>
      <p className="diwo-pending-reference">#{order.reference}</p>
    </div>
    <div className="diwo-pending-summary">
      <div>
        <p className="diwo-pending-label">Entradas solicitadas</p>
        <p className="diwo-pending-quantity">{order.quantity} {order.quantity === 1 ? "entrada" : "entradas"}</p>
        <ul className="diwo-pending-names">{order.names.map((name, index) => <li key={index}>1 × {name}</li>)}</ul>
      </div>
      <div className="diwo-pending-price"><p className="diwo-pending-label">Importe total</p><p>{euro(order.totalCents)}</p></div>
    </div>
    <p className="diwo-cancelled-message">Esta solicitud ha sido cancelada.</p>
  </article>;
}
