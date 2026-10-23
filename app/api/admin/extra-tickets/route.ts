import { runOrderMutation } from "@/lib/order-mutations";
import { readAdminExtraTickets } from "@/lib/extra-ticket-reader";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { return runOrderMutation(request, "issue-extras"); }
export async function GET() {
  const result = await readAdminExtraTickets();
  return Response.json(result.ok ? { tickets: result.tickets } : { error: "extra_tickets_unavailable" }, {
    status: result.ok ? 200 : result.status, headers: { "Cache-Control": "private, no-store" },
  });
}
