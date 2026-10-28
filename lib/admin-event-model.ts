import { scanRecord, scanUuid } from "./door-scan-model";

export type EventAttendee = {
  id: string; name: string; code: string; status: "valid" | "used" | "revoked";
  usedAt: string | null; kind: "general" | "extra";
};
export type EventControl = {
  event: { id: string; title: string; timezone: string; phase: "upcoming" | "live" | "ended" };
  checkedAt: string; used: number; pending: number; total: number; percentage: number;
  general: number; extras: number; results: EventAttendee[]; matches: number;
  recent: EventAttendee[]; latest: EventAttendee[]; historyTotal: number; page: number;
};
const time = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
const fold = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");

/** One safe ticket snapshot drives both counters and history. No QR or subjects. */
export function eventControl(rawEvent: unknown, rawRows: unknown[], search = "", page = 0, now = new Date()): EventControl | null {
  if (!scanRecord(rawEvent) || !scanUuid(rawEvent.id) || typeof rawEvent.title !== "string" ||
      typeof rawEvent.timezone !== "string" || !time(rawEvent.starts_at) || !time(rawEvent.ends_at) ||
      Date.parse(rawEvent.ends_at) <= Date.parse(rawEvent.starts_at)) return null;
  try { new Intl.DateTimeFormat("es", { timeZone: rawEvent.timezone }); } catch { return null; }
  const rows: EventAttendee[] = [], seen = new Set<string>();
  for (const row of rawRows) {
    if (!scanRecord(row) || !scanUuid(row.id) || seen.has(row.id) || row.event_id !== rawEvent.id ||
        typeof row.attendee_name !== "string" || !row.attendee_name.trim() ||
        !["valid", "used", "revoked"].includes(String(row.status)) ||
        (row.status === "used" ? !time(row.used_at) : row.used_at !== null) ||
        !Number.isSafeInteger(row.ticket_position) || (row.ticket_position as number) < 1 ||
        (row.order_id !== null && !scanUuid(row.order_id))) return null;
    // General tickets must still belong to a confirmed order; extras have no order.
    const order = row.orders;
    if (row.order_id !== null && (!scanRecord(order) || order.status !== "confirmed" || typeof order.reference !== "string")) return null;
    const reference = scanRecord(order) && typeof order.reference === "string" ? order.reference : row.id;
    rows.push({ id: row.id, name: row.attendee_name, code: `${reference} · #${row.ticket_position}`,
      status: row.status as EventAttendee["status"], usedAt: row.used_at as string | null,
      kind: row.order_id === null ? "extra" : "general" });
    seen.add(row.id);
  }
  const valid = rows.filter(r => r.status !== "revoked"), used = valid.filter(r => r.status === "used").length;
  const history = rows.filter(r => r.status === "used").sort((a, b) => Date.parse(b.usedAt!) - Date.parse(a.usedAt!) || b.id.localeCompare(a.id));
  const query = fold(search.trim()), results = query ? rows.filter(r => fold(`${r.name} ${r.code} ${r.id}`).includes(query)) : [];
  return {
    event: { id: rawEvent.id, title: rawEvent.title, timezone: rawEvent.timezone,
      phase: now.getTime() < Date.parse(rawEvent.starts_at) ? "upcoming" : now.getTime() < Date.parse(rawEvent.ends_at) ? "live" : "ended" },
    checkedAt: now.toISOString(), used, pending: valid.length - used, total: valid.length,
    percentage: valid.length ? Math.round(used / valid.length * 100) : 0,
    general: valid.filter(r => r.kind === "general").length, extras: valid.filter(r => r.kind === "extra").length,
    results: results.slice(page * 20, page * 20 + 20), matches: results.length,
    recent: history.slice(page * 20, page * 20 + 20), latest: history.slice(0, 5), historyTotal: history.length, page,
  };
}

/** Runtime boundary for client responses, including failed/corrupt backend reads. */
export function parseEventControl(value: unknown): EventControl | null {
  if (!scanRecord(value) || !scanRecord(value.event) || !scanUuid(value.event.id) ||
      typeof value.event.title !== "string" || typeof value.event.timezone !== "string" ||
      !["upcoming", "live", "ended"].includes(String(value.event.phase)) || !time(value.checkedAt)) return null;
  for (const key of ["used", "pending", "total", "percentage", "general", "extras", "matches", "historyTotal", "page"]) {
    if (!Number.isSafeInteger(value[key]) || (value[key] as number) < 0) return null;
  }
  if ((value.used as number) + (value.pending as number) !== value.total ||
      (value.general as number) + (value.extras as number) !== value.total ||
      value.percentage !== (value.total ? Math.round((value.used as number) / (value.total as number) * 100) : 0)) return null;
  try { new Intl.DateTimeFormat("es", { timeZone: value.event.timezone }); } catch { return null; }
  for (const key of ["results", "recent", "latest"]) {
    if (!Array.isArray(value[key]) || value[key].length > (key === "latest" ? 5 : 20)) return null;
    const seen = new Set<string>();
    for (const row of value[key]) {
      if (!scanRecord(row) || !scanUuid(row.id) || seen.has(row.id) || typeof row.name !== "string" ||
          typeof row.code !== "string" || !["general", "extra"].includes(String(row.kind)) ||
          !["valid", "used", "revoked"].includes(String(row.status)) ||
          (row.status === "used" ? !time(row.usedAt) : row.usedAt !== null) || (key !== "results" && row.status !== "used")) return null;
      seen.add(row.id);
    }
  }
  const safe = value as EventControl;
  const attendee = (r: EventAttendee): EventAttendee => ({ id:r.id,name:r.name,code:r.code,status:r.status,usedAt:r.usedAt,kind:r.kind });
  return {
    event: { id:safe.event.id,title:safe.event.title,timezone:safe.event.timezone,phase:safe.event.phase },
    checkedAt:safe.checkedAt,used:safe.used,pending:safe.pending,total:safe.total,percentage:safe.percentage,
    general:safe.general,extras:safe.extras,matches:safe.matches,historyTotal:safe.historyTotal,page:safe.page,
    results:safe.results.map(attendee),recent:safe.recent.map(attendee),latest:safe.latest.map(attendee),
  };
}
