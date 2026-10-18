export const scanRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
export const scanToken = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
export const scanUuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export type DoorEvent = { id: string; title: string; used: number; pending: number; total: number };
export type ScanResult = { outcome: "admitted" | "already_used" | "revoked" | "unknown" | "wrong_event"; ticketId: string | null; name: string | null; usedAt: string | null };
export function doorEvent(value: unknown): DoorEvent | null {
  if (!scanRecord(value) || !scanUuid(value.id) || typeof value.title !== "string" || !value.title.trim() || value.title.length > 200) return null;
  const { used, pending, total } = value;
  if (![used,pending,total].every(n => typeof n === "number" && Number.isSafeInteger(n) && n >= 0) || (used as number) + (pending as number) !== total) return null;
  return { id: value.id, title: value.title, used: used as number, pending: pending as number, total: total as number };
}
export function scanResult(value: unknown): ScanResult | null {
  if (!scanRecord(value)) return null;
  const { outcome, ticketId, name, usedAt } = value;
  if (outcome === "unknown" || outcome === "wrong_event") {
    return ticketId === null && name === null && usedAt === null ? { outcome, ticketId, name, usedAt } : null;
  }
  if (!["admitted", "already_used", "revoked"].includes(outcome as string) || !scanUuid(ticketId) || typeof name !== "string" || !name.trim() || name.length > 200) return null;
  if (outcome === "revoked" ? usedAt !== null : typeof usedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(usedAt) || !Number.isFinite(Date.parse(usedAt))) return null;
  return { outcome: outcome as ScanResult["outcome"], ticketId, name, usedAt: usedAt as string | null };
}
