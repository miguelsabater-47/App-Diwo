import { createHash } from "node:crypto";
import type { AppRole } from "./app-authorization-core";
import { staffEmail, staffIdValid, staffRecord, staffTimeValid, type StaffCandidate, type StaffMember } from "./door-staff-model";

type RpcResult = { data: unknown; error: unknown };
type Session = { ok: false; status: number; reason: string } | { ok: true; role: AppRole; client: { rpc(name: string, args?: Record<string, unknown>): PromiseLike<RpcResult> } };
export type DirectoryUser = { id: string; firstName: string | null; lastName: string | null; primaryEmailAddressId: string | null; banned: boolean; locked: boolean;
  emailAddresses: { id: string; emailAddress: string; verification: { status: string } | null }[] };
export type StaffDirectory = { byEmail(email: string): Promise<{ data: DirectoryUser[]; totalCount: number }>; byIds(ids: string[]): Promise<DirectoryUser[]> };
type Dependencies = { authorize(): Promise<Session>; directory: StaffDirectory; origin?: string | null };
const reply = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
class StaffFailure extends Error {
  readonly status: number; readonly reason: string;
  constructor(status: number, reason: string) { super(reason); this.status = status; this.reason = reason; }
}
function fail(status: number, reason: string): never { throw new StaffFailure(status, reason); }
const subjectValid = (v: unknown): v is string => typeof v === "string" && /^user_[A-Za-z0-9_-]+$/.test(v);
export const staffReference = (subject: string) => createHash("sha256").update(`diwo:staff:${subject}`).digest("hex");
const displayName = (user: DirectoryUser, fallback: string) => [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || fallback;
function rpcError(error: unknown) {
  if (staffRecord(error) && error.code === "42501") fail(403, "operation_not_authorized");
  if (staffRecord(error) && error.code === "PGRST202") fail(503, "staff_configuration_required");
  if (staffRecord(error) && error.code === "22023") {
    const known: Record<string, number> = { admin_identity_is_protected: 409, staff_state_changed: 409, staff_account_not_found: 404, invalid_staff_request: 400 };
    if (typeof error.message === "string" && Object.hasOwn(known, error.message)) fail(known[error.message], error.message);
  }
  fail(502, "staff_operation_failed");
}
async function rpc(session: Extract<Session, { ok: true }>, name: string, args?: Record<string, unknown>) {
  const result = await session.client.rpc(name, args);
  if (result.error !== null) rpcError(result.error);
  return result.data;
}
async function stillAdmin(session: Extract<Session, { ok: true }>) {
  if (await rpc(session, "get_current_app_role") !== "admin") fail(403, "operation_not_authorized");
}
async function exactAccount(email: string, directory: StaffDirectory): Promise<DirectoryUser> {
  const found = await directory.byEmail(email);
  if (!found.totalCount && !found.data.length) fail(404, "registered_account_required");
  if (found.totalCount > 1 || found.data.length > 1) fail(409, "account_not_unique");
  if (found.totalCount !== 1 || found.data.length !== 1) fail(502, "staff_directory_unavailable");
  const user = found.data[0];
  if (!subjectValid(user.id) || !user.emailAddresses.some(e => staffEmail(e.emailAddress) === email)) fail(502, "staff_directory_unavailable");
  if (!user.emailAddresses.some(e => staffEmail(e.emailAddress) === email && e.verification?.status === "verified")) fail(409, "verified_email_required");
  if (user.banned || user.locked) fail(409, "staff_account_unavailable");
  return user;
}
function roleRow(data: unknown, staffId: string) {
  if (!Array.isArray(data) || data.length !== 1 || !staffRecord(data[0])) fail(502, "staff_operation_failed");
  const row = data[0];
  if (row.staff_id !== staffId || typeof row.app_role !== "string" || !["user", "door_staff", "admin"].includes(row.app_role) ||
    (row.version !== null && !staffTimeValid(row.version)) || (row.app_role !== "user" && row.version === null)) fail(502, "staff_operation_failed");
  return row;
}
async function body(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) fail(400, "invalid_staff_request");
  const decoder = new TextDecoder("utf-8", { fatal: true }); let size = 0, text = "";
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > 2048) { await reader.cancel(); fail(413, "staff_request_too_large"); }
      text += decoder.decode(next.value, { stream: true });
    }
    text += decoder.decode();
    const parsed: unknown = JSON.parse(text);
    if (!staffRecord(parsed)) fail(400, "invalid_staff_request");
    return parsed;
  } catch (error) { if (error instanceof StaffFailure) throw error; return fail(400, "invalid_staff_request"); }
  finally { reader.releaseLock(); }
}
function shape(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).length !== keys.length || keys.some(k => !(k in value))) fail(400, "invalid_staff_request");
}
export async function handleDoorStaff(request: Request, dependencies: Dependencies): Promise<Response> {
  try {
    if (!["GET", "POST"].includes(request.method)) fail(405, "method_not_allowed");
    const origin = dependencies.origin === undefined ? "http://localhost:3000" : dependencies.origin;
    if (!origin || new URL(request.url).origin !== origin || request.headers.get("sec-fetch-site") === "cross-site" ||
      (request.method === "POST" && request.headers.get("origin") !== origin)) fail(403, "request_origin_not_allowed");
    if (request.method === "POST" && (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "") ||
      ![null, "identity"].includes(request.headers.get("content-encoding")))) fail(415, "json_request_required");
    const session = await dependencies.authorize();
    if (!session.ok) return reply({ error: session.reason }, session.status);
    if (session.role !== "admin") fail(403, "operation_not_authorized");
    if (request.method === "GET") {
      const rows = await rpc(session, "list_door_staff");
      if (!Array.isArray(rows)) fail(502, "staff_operation_failed");
      const seen = new Set<string>();
      for (const row of rows) {
        if (!staffRecord(row) || !subjectValid(row.clerk_subject) || !staffIdValid(row.staff_id) ||
          staffReference(row.clerk_subject) !== row.staff_id || !staffTimeValid(row.version) ||
          Number(row.total_count) !== rows.length || seen.has(row.staff_id)) fail(502, "staff_operation_failed");
        seen.add(row.staff_id);
      }
      const users = rows.length ? await dependencies.directory.byIds(rows.map(row => row.clerk_subject)) : [];
      if (new Set(users.map(u => u.id)).size !== users.length || users.some(u => !rows.some(r => r.clerk_subject === u.id))) fail(502, "staff_directory_unavailable");
      const staff: StaffMember[] = rows.map(row => {
        const user = users.find(u => u.id === row.clerk_subject);
        const verified = user?.emailAddresses.filter(e => e.verification?.status === "verified" && staffEmail(e.emailAddress));
        const address = verified?.find(e => e.id === user?.primaryEmailAddressId) ?? verified?.[0];
        const email = address ? staffEmail(address.emailAddress) : null;
        return { staffId: row.staff_id, name: user ? displayName(user, email ?? "Cuenta sin correo verificado") : "Cuenta no disponible", email, version: row.version };
      });
      await stillAdmin(session);
      return reply({ staff });
    }
    const input = await body(request);
    if (input.action === "lookup" || input.action === "grant") {
      shape(input, input.action === "lookup" ? ["action", "email"] : ["action", "email", "staffId", "version"]);
      const email = staffEmail(input.email);
      if (!email) fail(400, "invalid_staff_request");
      if (input.action === "grant" && (!staffIdValid(input.staffId) || (input.version !== null && !staffTimeValid(input.version)))) fail(400, "invalid_staff_request");
      const user = await exactAccount(email, dependencies.directory);
      const staffId = staffReference(user.id);
      if (input.action === "lookup") {
        const row = roleRow(await rpc(session, "read_staff_target", { target_subject: user.id }), staffId);
        await stillAdmin(session);
        const candidate: StaffCandidate = { staffId, name: displayName(user, email), email, role: row.app_role as StaffCandidate["role"], version: row.version as string | null };
        return reply({ candidate });
      }
      if (input.staffId !== staffId) fail(409, "staff_account_changed");
      // Resolve the verified email AGAIN at mutation time; no client subject/role.
      const row = roleRow(await rpc(session, "grant_door_staff", { target_subject: user.id, expected_version: input.version }), staffId);
      if (row.app_role !== "door_staff" || !staffTimeValid(row.version)) fail(502, "staff_operation_failed");
      return reply({ member: { staffId, role: "door_staff", version: row.version } });
    }
    if (input.action === "revoke") {
      shape(input, ["action", "staffId", "version"]);
      if (!staffIdValid(input.staffId) || !staffTimeValid(input.version)) fail(400, "invalid_staff_request");
      // A deleted/renamed/unverified Clerk account must still be revocable.
      const row = roleRow(await rpc(session, "revoke_door_staff", { target_staff_id: input.staffId, expected_version: input.version }), input.staffId);
      if (row.app_role !== "user" || !staffTimeValid(row.version)) fail(502, "staff_operation_failed");
      return reply({ member: { staffId: input.staffId, role: "user", version: row.version } });
    }
    return fail(400, "invalid_staff_request");
  } catch (error) {
    // Do not return/log Clerk records, emails from exceptions, subjects or tokens.
    return error instanceof StaffFailure ? reply({ error: error.reason }, error.status) : reply({ error: "staff_operation_failed" }, 502);
  }
}
