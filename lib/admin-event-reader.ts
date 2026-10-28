import "server-only";
import { createSessionSupabaseClient } from "@/lib/supabase-session";
import { readCurrentAppAccess } from "@/lib/app-authorization-core";
import { readOrderPages } from "@/lib/order-view-model";
import { eventControl, parseEventControl } from "@/lib/admin-event-model";

export async function readAdminEvent(search = "", page = 0) {
  try {
    const session = await createSessionSupabaseClient();
    const access = await readCurrentAppAccess(async () => session);
    if (!access.ok) return { ok: false as const, status: access.status };
    if (!["admin", "door_staff"].includes(access.role)) return { ok: false as const, status: 403 };
    if (session.status !== "ready") return { ok: false as const, status: 502 };
    // Shared door reads use a bounded security-definer DTO, NOT staff table access.
    const snapshot = await session.client.rpc("read_event_control", { search_query: search, page_number: page });
    if (!snapshot.error) {
      const data = parseEventControl(snapshot.data);
      const final = await readCurrentAppAccess(async () => session);
      if (!final.ok || !["admin", "door_staff"].includes(final.role)) return { ok: false as const, status: 403 };
      return data ? { ok: true as const, data } : { ok: false as const, status: 502 };
    }
    // Before the draft is installed, only existing admin RLS is a safe fallback.
    // Staff never gets direct SELECT, and an error is never a verified empty list.
    if (snapshot.error.code === "42501") return { ok: false as const, status: 403 };
    if (snapshot.error.code !== "PGRST202") return { ok: false as const, status: 502 };
    if (access.role !== "admin") return { ok: false as const, status: 503 };
    const event = await session.client.from("events").select("id,title,timezone,starts_at,ends_at")
      .eq("slug", "diwo-x-2-2026").eq("is_published", true).maybeSingle();
    if (event.error) return { ok: false as const, status: 502 };
    if (!event.data) return { ok: false as const, status: 409 };
    const eventRow = event.data;
    // Existing admin RLS admits general AND extra tickets. Named columns only.
    // Paginate on the server; never send the whole attendee list to the browser.
    // At DIWO's scale this single stream avoids separate drifting count queries.
    const rows = await readOrderPages((from, to) => session.client.from("tickets")
      .select("id,event_id,order_id,ticket_position,attendee_name,status,used_at,orders(reference,status)", { count: "exact" })
      .eq("event_id", eventRow.id).order("id").range(from, to));
    const finalAccess = await readCurrentAppAccess(async () => session);
    if (!finalAccess.ok || finalAccess.role !== "admin") return { ok: false as const, status: 403 };
    const data = eventControl(eventRow, rows, search, page);
    return data ? { ok: true as const, data } : { ok: false as const, status: 502 };
  } catch { return { ok: false as const, status: 502 }; }
}
