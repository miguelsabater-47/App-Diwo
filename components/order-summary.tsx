import type { ReactNode } from "react";

const euro = (cents: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);

export function OrderSummary({ quantity, totalCents, children }: {
  quantity: number; totalCents: number; children?: ReactNode;
}) {
  return <aside className="diwo-request-summary" aria-label="Resumen de la solicitud">
    <dl>
      <div className="diwo-request-subtotal"><dt>{quantity} {quantity === 1 ? "entrada" : "entradas"} × {euro(500)}</dt><dd>{euro(totalCents)}</dd></div>
      <div className="diwo-request-total"><dt>Total</dt><dd aria-live="polite">{euro(totalCents)}</dd></div>
    </dl>
    {children && <div className="diwo-request-summary-actions">{children}</div>}
  </aside>;
}
