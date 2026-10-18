import type { OrderView } from "./order-view-model";
import type { RequestDraft } from "./order-request-state";

export type RecordedRequest = Pick<OrderView, "id" | "eventId" | "buyerName" | "names" | "status">;
export type BuyerRequestContext = {
  state: "none" | "pending" | "ready" | "history" | "closed";
  eventId: string | null;
  recorded: RecordedRequest[];
};

/** Input must come from the verified actor's personal reader, not admin scope. */
export function buyerRequestContext(orders: OrderView[]): BuyerRequestContext {
  const current = orders.filter(order => order.actualEvent && !order.technical);
  const state = current.some(order => order.status === "pending") ? "pending"
    : current.some(order => order.status === "confirmed" && order.tickets.some(ticket => ticket.status === "valid")) ? "ready"
      : current.some(order => order.status === "confirmed") ? "history"
        : current.length ? "closed" : "none";
  return { state, eventId: current[0]?.eventId ?? null,
    recorded: current.map(({ id, eventId, buyerName, names, status }) => ({ id, eventId, buyerName, names: [...names], status })) };
}

/** An exact owned record resolves ambiguity; matching just the UUID is insufficient. */
export function matchesRecordedRequest(draft: RequestDraft, recorded: RecordedRequest[]): boolean {
  return recorded.some(order => order.id === draft.requestId && order.eventId === draft.eventId &&
    ["pending", "confirmed", "cancelled", "rejected"].includes(order.status) &&
    order.buyerName === draft.buyerName && order.names.length === draft.attendeeNames.length &&
    order.names.every((name, index) => name === draft.attendeeNames[index]));
}

export function buyerRequestCopy(context: BuyerRequestContext | null) {
  switch (context?.state) {
    case "none": return { title: "¿Aún no tienes entradas?", detail: "Sigue los sencillos pasos y no te quedes sin las tuyas.", action: "CONSEGUIR ENTRADAS" };
    case "pending": return { title: "Ya has realizado una solicitud", detail: "Tienes una solicitud pendiente. Consulta su estado y las instrucciones de pago en Mis entradas.", action: "SOLICITAR MÁS ENTRADAS" };
    case "ready": return { title: "Tus entradas ya están listas", detail: "Las tienes en Mis entradas. ¿Vienes con más gente? Puedes hacer otra solicitud.", action: "SOLICITAR MÁS ENTRADAS" };
    case "history": return { title: "Ya has realizado solicitudes", detail: "Consulta tus entradas y su estado en Mis entradas.", action: "SOLICITAR MÁS ENTRADAS" };
    case "closed": return { title: "¿Quieres solicitar entradas?", detail: "Tu solicitud anterior está cerrada. Puedes hacer una nueva.", action: "SOLICITAR ENTRADAS" };
    default: return { title: "Solicita tus entradas", detail: "No hemos podido actualizar el estado de tus solicitudes. Consulta Mis entradas antes de repetir un pedido.", action: "SOLICITAR ENTRADAS" };
  }
}
