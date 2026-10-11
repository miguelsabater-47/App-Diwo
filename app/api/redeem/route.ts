import { NextResponse } from "next/server";

/** Retired code redemption must not initialize a privileged database client. */
export async function POST() {
  return NextResponse.json({ error: "legacy_workflow_disabled" }, { status: 503 });
}
