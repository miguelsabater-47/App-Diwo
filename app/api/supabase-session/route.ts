import { NextResponse } from "next/server";
import { getCurrentAppAccess } from "@/lib/app-authorization";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

/** Read-only integration diagnostic. No identities, tokens or upstream errors. */
export async function GET() {
  const access = await getCurrentAppAccess();
  if (!access.ok) {
    return NextResponse.json({ error: access.reason }, { status: access.status, headers });
  }
  return NextResponse.json({ authenticated: true, supabaseConnected: true, appRole: access.role }, { headers });
}
