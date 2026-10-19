import type { OrderView } from "./order-view-model";
import { paymentApproval } from "./order-payment-state";
import { orderClosure } from "./order-closure-state";

export type AdminRequest = OrderView & { buyerEmail?: string | null };
export type RequestFilter = "pending" | "confirmed" | "closed";
export type RequestDecision = "approve" | "cancel";
const fold = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
export const requestStatus = { pending: "Pendiente", confirmed: "Confirmada", cancelled: "Cancelada", rejected: "Rechazada" };

export function requestRows(rows: AdminRequest[], history: boolean, filter: RequestFilter, search: string) {
  const query = fold(search.trim());
  return rows.filter(row => history ? !row.actualEvent || row.technical : row.actualEvent && !row.technical)
    .filter(row => filter === "closed" ? ["cancelled", "rejected"].includes(row.status) : row.status === filter)
    .filter(row => fold([row.buyerName, row.buyerEmail ?? "", row.reference, ...row.names].join(" ")).includes(query))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id));
}
export function requestCounts(rows: AdminRequest[], history: boolean) {
  const scope = rows.filter(row => history ? !row.actualEvent || row.technical : row.actualEvent && !row.technical);
  return { pending: scope.filter(row => row.status === "pending").length,
    confirmed: scope.filter(row => row.status === "confirmed").length,
    closed: scope.filter(row => ["cancelled", "rejected"].includes(row.status)).length };
}
export function canDecideRequest(row: AdminRequest) { return row.status === "pending" && row.actualEvent && !row.technical; }
export function requestReceipt(decision: RequestDecision, data: unknown, row: AdminRequest): { status: "confirmed" | "cancelled"; at: string } | null {
  const valid = decision === "approve" ? paymentApproval(data, row.id, row.quantity) : orderClosure(data, row.id);
  if (!valid || !data || typeof data !== "object" || !("order" in data) || !data.order || typeof data.order !== "object") return null;
  const order = data.order;
  const at = decision === "approve" && "confirmedAt" in order ? order.confirmedAt : "closedAt" in order ? order.closedAt : null;
  return typeof at === "string" ? { status: decision === "approve" ? "confirmed" : "cancelled", at } : null;
}

/** Local visual simulator only: these IDs/references are never submitted to writers. */
export function requestDesignExamples(): AdminRequest[] {
  return [
    { buyerName: "Álvaro García", buyerEmail: "alvaro@example.com", names: ["Álvaro García", "Carlos López"], reference: "A7K9", createdAt: "2026-10-17T14:24:00Z" },
    { buyerName: "Claudia Romero", buyerEmail: "claudia@example.com", names: ["Claudia Romero", "Asistente 2", "Asistente 3"], reference: "M8R2", createdAt: "2026-10-17T13:48:00Z" },
    { buyerName: "Javier López", buyerEmail: "javier@example.com", names: ["Javier López"], reference: "P3X6", createdAt: "2026-10-17T12:12:00Z" },
  ].map((row, index) => ({ ...row, id: `f0170000-0000-4000-8000-00000000000${index + 1}`,
    eventId: "f0170000-0000-4000-8000-000000000010", quantity: row.names.length, totalCents: row.names.length * 500,
    status: "pending", reportedAt: null, confirmedAt: null, eventTitle: "DIWO X 2.0", actualEvent: true, technical: false, tickets: [] }));
}
