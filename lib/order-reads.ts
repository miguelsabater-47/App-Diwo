import "server-only";
import { createSessionSupabaseClient } from "@/lib/supabase-session";
import { readCurrentAppAccess } from "@/lib/app-authorization-core";
import { orderReadScope, orderViews, readOrderPages, readOrderChunks, type OrderView } from "@/lib/order-view-model";
import { hasConfiguredClerkKeys } from "@/lib/local-access";
import { readAdminOrderContacts } from "@/lib/admin-order-contacts";

const orderColumns = "id,event_id,reference,buyer_name,attendee_names,quantity,unit_price_cents,total_cents,currency,status,payment_reported_at,confirmed_at,created_at";
const ticketColumns = "id,order_id,event_id,ticket_position,attendee_name,status,issued_at,used_at,revoked_at";
type ReadResult = { ok: true; orders: OrderView[] } | { ok: false; status: number };

/** Explicit ownership remains in PERSONAL queries even though admin RLS can see all. */
export async function readOrderOverview(kind: "buyer" | "admin", options: { contacts?: boolean } = {}): Promise<ReadResult> {
  if (!hasConfiguredClerkKeys(process.env)) return { ok: false, status: 503 };
  const includeContacts = kind === "admin" && options.contacts === true;
  try {
    const session = await createSessionSupabaseClient();
    const access = await readCurrentAppAccess(async () => session);
    if (!access.ok) return { ok: false, status: access.status };
    if (session.status !== "ready") return { ok: false, status: 502 };
    const scope = orderReadScope(access.role, session.actorId, kind);
    if (!scope) return { ok: false, status: 403 };
    const orders = await readOrderPages((from, to) => {
      let query = session.client.from("orders").select(includeContacts ? `${orderColumns},buyer_clerk_id` : orderColumns, { count: "exact" })
        .order("created_at", { ascending: false }).order("id", { ascending: false });
      if (scope.buyerId) query = query.eq("buyer_clerk_id", scope.buyerId);
      return query.range(from, to);
    });
    const orderIds = orders.map((o) => (o as { id: string }).id);
    const eventIds = [...new Set(orders.map((o) => (o as { event_id: string }).event_id))];
    // At most three chunks per stream (six requests total), never unbounded.
    // Authorization rechecks remain sequential and uncached.
    const readTickets = () => readOrderChunks(orderIds, batch =>
      readOrderPages((from, to) => session.client.from("tickets").select(ticketColumns, { count: "exact" })
        .in("order_id", batch).order("id").range(from, to)));
    const readEvents = () => readOrderChunks(eventIds, batch =>
      readOrderPages((from, to) => session.client.from("events").select("id,slug", { count: "exact" })
        .in("id", batch).order("id").range(from, to)));
    // Internal subjects are never forwarded; contact enrichment is current-account
    // display only, not a historical email snapshot or any source of role authority.
    const buyers = new Map<string, string>();
    for (const row of includeContacts ? orders : []) {
      const raw = row as { id: string; buyer_clerk_id?: unknown };
      if (typeof raw.buyer_clerk_id === "string") buyers.set(raw.id, raw.buyer_clerk_id);
    }
    const readContacts = async () => {
      if (!includeContacts) return null;
      // This fresh pre-check is deliberately not shared/cached. Directory reads
      // can overlap DB reads, but may never start after admin access is denied.
      const beforeContacts = await readCurrentAppAccess(async () => session);
      if (!beforeContacts.ok) return { ok: false, status: beforeContacts.status } as const;
      if (!orderReadScope(beforeContacts.role, session.actorId, "admin")) return { ok: false, status: 403 } as const;
      return { ok: true, emails: await readAdminOrderContacts([...buyers.values()]) } as const;
    };
    const [tickets, events, contacts] = await Promise.all([readTickets(), readEvents(), readContacts()]);
    // Recheck after ALL streams, including directory response. A revoked admin
    // must never receive buffered orders or contacts, regardless of finish order.
    const finalAccess = await readCurrentAppAccess(async () => session);
    if (!finalAccess.ok) return { ok: false, status: finalAccess.status };
    if (!orderReadScope(finalAccess.role, session.actorId, kind)) return { ok: false, status: 403 };
    if (contacts && !contacts.ok) return { ok: false, status: contacts.status };
    const safe = orderViews(orders, tickets, events);
    if (!safe) return { ok: false, status: 502 };
    if (!contacts) return { ok: true, orders: safe };
    return { ok: true, orders: safe.map(row => ({ ...row, buyerEmail: contacts.emails.get(buyers.get(row.id) ?? "") ?? null })) };
  } catch { return { ok: false, status: 502 }; }
}
