import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { hasDevelopmentClerkKeys } from "@/lib/local-access";

export async function GET() {
  if (!hasDevelopmentClerkKeys(process.env)) {
    return NextResponse.json({ error: "local_configuration_required" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const { userId } = await auth();
  return NextResponse.json(
    { authenticated: Boolean(userId) },
    { status: userId ? 200 : 401, headers: { "Cache-Control": "private, no-store" } },
  );
}
