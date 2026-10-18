/** Public recipient explicitly supplied by Miguel for the payment instructions. */
export const approvedBizumPhone = "638038828";

export function paymentPhone(value: string | undefined): string | null {
  if (value === undefined) return approvedBizumPhone;
  if (!value) return null;
  const normalized = value.replace(/[\s()-]/g, "");
  return /^(?:\+34)?[67]\d{8}$/.test(normalized) ? normalized : null;
}

export function paymentNotice(value: unknown, orderId: string):
  { status: "pending" | "confirmed"; reportedAt: string | null } | null {
  if (!value || typeof value !== "object" || !("order" in value)) return null;
  const row = value.order;
  if (!row || typeof row !== "object" || !("id" in row) || row.id !== orderId ||
      !("status" in row) || !["pending", "confirmed"].includes(String(row.status)) ||
      !("paymentReportedAt" in row)) return null;
  const at = row.paymentReportedAt;
  if (at !== null && (typeof at !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(at) || !Number.isFinite(Date.parse(at)))) return null;
  if (row.status === "pending" && at === null) return null;
  return { status: row.status as "pending" | "confirmed", reportedAt: at as string | null };
}

export function paymentApproval(value: unknown, orderId: string, quantity: number): boolean {
  if (!value || typeof value !== "object" || !("order" in value)) return false;
  const row = value.order;
  return !!row && typeof row === "object" && "id" in row && row.id === orderId &&
    "status" in row && row.status === "confirmed" && "issuedTicketCount" in row && row.issuedTicketCount === quantity &&
    "confirmedAt" in row && typeof row.confirmedAt === "string" && /^\d{4}-\d{2}-\d{2}T/.test(row.confirmedAt) &&
    Number.isFinite(Date.parse(row.confirmedAt));
}
