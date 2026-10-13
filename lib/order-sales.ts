import "server-only";
import { createSessionSupabaseClient } from "@/lib/supabase-session";
import { canonicalEventSlug, salesAvailability, type SalesAvailability } from "@/lib/order-request-state";

export async function getOrderSalesAvailability(): Promise<SalesAvailability> {
  try {
    const session = await createSessionSupabaseClient();
    if (session.status !== "ready") return { state: "unavailable", eventId: null };
    const { data, error } = await session.client.from("events")
      .select("id,slug,title,public_location,is_published,unit_price_cents,currency,timezone,sales_open_at,starts_at,ends_at,arrival_from,arrival_until")
      .eq("slug", canonicalEventSlug).eq("is_published", true).maybeSingle();
    if (error) return { state: "unavailable", eventId: null };
    return salesAvailability(data, Date.now());
  } catch {
    return { state: "unavailable", eventId: null };
  }
}
