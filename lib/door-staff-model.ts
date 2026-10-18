export type StaffRole = "user" | "door_staff" | "admin";
export type StaffMember = { staffId: string; name: string; email: string | null; version: string };
export type StaffCandidate = { staffId: string; name: string; email: string; role: StaffRole; version: string | null };
export const staffIdValid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
export const staffTimeValid = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v));
export const staffEmail = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@\u0000-\u001f]+@[^\s@\u0000-\u001f]+\.[^\s@\u0000-\u001f]+$/.test(email) ? email : null;
};
export const staffRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export function staffCandidate(value: unknown, email: string): StaffCandidate | null {
  if (!staffRecord(value) || !staffIdValid(value.staffId) || typeof value.name !== "string" || !value.name.trim() ||
    value.email !== email || typeof value.role !== "string" || !["user", "door_staff", "admin"].includes(value.role) ||
    (value.version !== null && !staffTimeValid(value.version)) || (value.role !== "user" && value.version === null)) return null;
  return { staffId: value.staffId, name: value.name, email, role: value.role as StaffRole, version: value.version as string | null };
}
export function staffMembers(value: unknown): StaffMember[] | null {
  if (!Array.isArray(value)) return null;
  const ids = new Set<string>(), result: StaffMember[] = [];
  for (const row of value) {
    if (!staffRecord(row) || !staffIdValid(row.staffId) || ids.has(row.staffId) || !staffTimeValid(row.version) ||
      typeof row.name !== "string" || !row.name.trim() || (row.email !== null && staffEmail(row.email) !== row.email)) return null;
    ids.add(row.staffId); result.push({ staffId: row.staffId, name: row.name, email: row.email as string | null, version: row.version });
  }
  return result;
}
export function staffReceipt(value: unknown, staffId: string, role: "user" | "door_staff"): boolean {
  return staffRecord(value) && value.staffId === staffId && value.role === role && staffTimeValid(value.version);
}
