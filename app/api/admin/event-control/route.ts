import { readAdminEvent } from "@/lib/admin-event-reader";
import { handleManualAccess } from "@/lib/admin-event-core";
import { createSessionSupabaseClient } from "@/lib/supabase-session";
import { readCurrentAppAccess } from "@/lib/app-authorization-core";
import { configuredAppOrigin } from "@/lib/local-access";

export const dynamic = "force-dynamic";
const reply = (data: unknown, status: number) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.origin !== configuredAppOrigin(process.env) || request.headers.get("sec-fetch-site") === "cross-site") return reply({ error: "operation_not_authorized" }, 403);
  const search = url.searchParams.get("q") ?? "", rawPage = url.searchParams.get("page") ?? "0";
  if (search.length > 120 || !/^\d{1,5}$/.test(rawPage) || [...url.searchParams.keys()].some(k => !["q", "page"].includes(k))) return reply({ error: "invalid_request" }, 400);
  const result = await readAdminEvent(search.trim(), Number(rawPage));
  return result.ok ? reply(result.data, 200) : reply({ error: result.status === 409 ? "event_unavailable" : "event_read_failed" }, result.status);
}
export function POST(request: Request) {
  return handleManualAccess(request, async () => {
    const session = await createSessionSupabaseClient();
    const access = await readCurrentAppAccess(async () => session);
    if (!access.ok) return access;
    if (session.status !== "ready") return { ok: false, status: 502 };
    return { ok: true, role: access.role, client: session.client };
  }, configuredAppOrigin(process.env));
}
