/** Accept only a cancellation receipt for this exact order. */
export function orderClosure(value: unknown, orderId: string): boolean {
  if (!value || typeof value !== "object" || !("order" in value)) return false;
  const row = value.order;
  return !!row && typeof row === "object" && "id" in row && row.id === orderId &&
    "status" in row && row.status === "cancelled" &&
    "closedAt" in row && typeof row.closedAt === "string" && /^\d{4}-\d{2}-\d{2}T/.test(row.closedAt) &&
    Number.isFinite(Date.parse(row.closedAt));
}
