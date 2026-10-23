import { readAdminExtraTicket } from "@/lib/extra-ticket-reader";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const result = await readAdminExtraTicket((await context.params).id);
  return Response.json(result.ok ? result : { error: result.reason }, {
    status: result.ok ? 200 : result.status, headers: { "Cache-Control": "private, no-store" },
  });
}
