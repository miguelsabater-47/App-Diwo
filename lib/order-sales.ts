import "server-only";
import { createSessionSupabaseClient } from "@/lib/supabase-session";
import { canonicalEventSlug, remainingTicketCount, salesAvailability, type SalesAvailability } from "@/lib/order-request-state";

export async function getOrderSalesAvailability(): Promise<SalesAvailability> {
  try {
    const session = await createSessionSupabaseClient();
    if (session.status !== "ready") return { state: "unavailable", eventId: null };
    const { data, error } = await session.client.from("events")
      .select("id,slug,title,public_location,is_published,unit_price_cents,currency,timezone,sales_open_at,starts_at,ends_at,arrival_from,arrival_until")
      .eq("slug", canonicalEventSlug).eq("is_published", true).maybeSingle();
    if (error) return { state: "unavailable", eventId: null };
    const availability = salesAvailability(data, Date.now());
    if (!availability.eventId) return availability;
    const result = await session.client.rpc("get_event_ticket_availability", { target_event: availability.eventId });
    const remainingTickets = result.error ? null : remainingTicketCount(result.data);
    return remainingTickets === null ? { state: "unavailable", eventId: null } : { ...availability, remainingTickets };
  } catch {
    return { state: "unavailable", eventId: null };
  }
}
