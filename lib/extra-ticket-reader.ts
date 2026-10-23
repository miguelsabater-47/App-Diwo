import "server-only";
import { createSessionSupabaseClient } from "@/lib/supabase-session";
import { readCurrentAppAccess } from "@/lib/app-authorization-core";
import { hasConfiguredClerkKeys } from "@/lib/local-access";
import { readOrderPages } from "@/lib/order-view-model";
import { extraTicketRows } from "@/lib/extra-ticket-model";
import { ownedTicket, ticketId } from "@/lib/owned-ticket-model";
import { renderOwnedTicketQr } from "@/lib/owned-ticket-qr";
import type { OwnedTicketResult } from "@/lib/owned-ticket-reader";

async function adminSession() {
  if (!hasConfiguredClerkKeys(process.env)) return null;
  const session = await createSessionSupabaseClient();
  const access = await readCurrentAppAccess(async () => session);
  return session.status === "ready" && access.ok && access.role === "admin" ? session : null;
}
async function stillAdmin(session: NonNullable<Awaited<ReturnType<typeof adminSession>>>) {
  const access = await readCurrentAppAccess(async () => session);
  return access.ok && access.role === "admin";
}
export async function readAdminExtraTickets() {
  try {
    const session = await adminSession();
    if (!session) return { ok: false as const, status: 403 };
    const rows = await readOrderPages(async (from, to) => {
      const result = await session.client.rpc("list_extra_tickets", {}, { count: "exact" }).range(from, to);
      // The shared paginator uses `id`; the RPC deliberately names it ticket_id.
      return { ...result, data: Array.isArray(result.data) ? result.data.map(row => ({ ...row, id: row.ticket_id })) : result.data };
    });
    const tickets = extraTicketRows(rows);
    if (!await stillAdmin(session)) return { ok: false as const, status: 403 };
    return tickets ? { ok: true as const, tickets } : { ok: false as const, status: 502 };
  } catch { return { ok: false as const, status: 502 }; }
}
export async function readAdminExtraTicket(target: unknown): Promise<OwnedTicketResult> {
  if (!ticketId(target)) return { ok: false, status: 404, reason: "not_found" };
  try {
    const session = await adminSession();
    if (!session) return { ok: false, status: 403, reason: "access" };
    const { data, error } = await session.client.rpc("read_extra_ticket", { target_ticket: target.toLowerCase() });
    if (error || !Array.isArray(data) || data.length > 1) return { ok: false, status: 502, reason: "unavailable" };
    if (!data.length) return { ok: false, status: 404, reason: "not_found" };
    const ticket = ownedTicket(data[0], 0);
    if (!ticket || ticket.id !== target.toLowerCase() || ticket.eventSlug !== "diwo-x-2-2026" || !/^EX-[A-F0-9]{12}$/.test(ticket.orderReference)) return { ok: false, status: 502, reason: "unavailable" };
    const qrDataUrl = ticket.qrToken ? await renderOwnedTicketQr(ticket.qrToken) : null;
    if (!await stillAdmin(session)) return { ok: false, status: 403, reason: "access" };
    const { qrToken: _privateToken, ...safe } = ticket;
    void _privateToken;
    return { ok: true, technical: false, ticket: { ...safe, qrDataUrl } };
  } catch { return { ok: false, status: 502, reason: "unavailable" }; }
}
