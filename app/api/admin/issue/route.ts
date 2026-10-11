import { NextResponse } from "next/server";
import { assertAdmin } from "../_utils";

export async function POST() {
  const gate = await assertAdmin();
  return NextResponse.json({ error: gate.reason }, { status: gate.status });
}
