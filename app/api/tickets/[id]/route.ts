import { NextResponse } from "next/server";
import { readOwnedTicket } from "@/lib/owned-ticket-reader";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "Pragma": "no-cache", "Vary": "Cookie" };

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const result = await readOwnedTicket(id);
  if (!result.ok) return NextResponse.json({ error: result.reason === "not_found" ? "not_found" : "unavailable" }, { status: result.status, headers });
  return NextResponse.json(result, { headers });
}
