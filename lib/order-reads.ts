import "server-only";
import { createSessionSupabaseClient } from "@/lib/supabase-session";
import { readCurrentAppAccess } from "@/lib/app-authorization-core";
import { orderReadScope, orderViews, readOrderPages, type OrderView } from "@/lib/order-view-model";
import { hasDevelopmentClerkKeys } from "@/lib/local-access";

const orderColumns = "id,event_id,reference,buyer_name,attendee_names,quantity,unit_price_cents,total_cents,currency,status,payment_reported_at,confirmed_at,created_at";
const ticketColumns = "id,order_id,event_id,ticket_position,attendee_name,status,issued_at,used_at,revoked_at";
type ReadResult = { ok: true; orders: OrderView[] } | { ok: false; status: number };

/** Explicit ownership remains in PERSONAL queries even though admin RLS can see all. */
export async function readOrderOverview(kind: "buyer" | "admin"): Promise<ReadResult> {
  if (!hasDevelopmentClerkKeys(process.env)) return { ok: false, status: 503 };
  try {
    const session = await createSessionSupabaseClient();
    const access = await readCurrentAppAccess(async () => session);
    if (!access.ok) return { ok: false, status: access.status };
    if (session.status !== "ready") return { ok: false, status: 502 };
    const scope = orderReadScope(access.role, session.actorId, kind);
    if (!scope) return { ok: false, status: 403 };
    const orders = await readOrderPages((from, to) => {
      let query = session.client.from("orders").select(orderColumns, { count: "exact" })
        .order("created_at", { ascending: false }).order("id", { ascending: false });
      if (scope.buyerId) query = query.eq("buyer_clerk_id", scope.buyerId);
      return query.range(from, to);
    });
    const tickets: unknown[] = [];
    const events: unknown[] = [];
    const orderIds = orders.map((o) => (o as { id: string }).id);
    const eventIds = [...new Set(orders.map((o) => (o as { event_id: string }).event_id))];
    // Chunk IN filters to avoid URL limits; pagination is transport, never attendance capacity.
    for (let start = 0; start < orderIds.length; start += 50) {
      tickets.push(...await readOrderPages((from, to) => session.client.from("tickets").select(ticketColumns, { count: "exact" })
        .in("order_id", orderIds.slice(start, start + 50)).order("id").range(from, to)));
    }
    for (let start = 0; start < eventIds.length; start += 50) {
      events.push(...await readOrderPages((from, to) => session.client.from("events").select("id,slug", { count: "exact" })
        .in("id", eventIds.slice(start, start + 50)).order("id").range(from, to)));
    }
    // Recheck after multi-request read: revoked admin cannot receive buffered admin data.
    const finalAccess = await readCurrentAppAccess(async () => session);
    if (!finalAccess.ok) return { ok: false, status: finalAccess.status };
    if (!orderReadScope(finalAccess.role, session.actorId, kind)) return { ok: false, status: 403 };
    const safe = orderViews(orders, tickets, events);
    return safe ? { ok: true, orders: safe } : { ok: false, status: 502 };
  } catch { return { ok: false, status: 502 }; }
}
