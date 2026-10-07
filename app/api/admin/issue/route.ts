import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { assertAdmin } from "../_utils";

export async function POST(req: Request) {
  const gate = await assertAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: gate.status });

  const { code } = await req.json().catch(() => ({} as { code?: unknown }));
  if (!code || typeof code !== "string") {
    return NextResponse.json({ error: "invalid_code" }, { status: 400 });
  }

  const { data, error } = await supabaseServer.rpc("issue_code", { p_code: code });

  if (error) {
    if (error.message?.includes("code_unavailable")) {
      return NextResponse.json({ error: "code_unavailable" }, { status: 409 });
    }
    return NextResponse.json({ error: "server_error", details: error.message }, { status: 500 });
  }

  return NextResponse.json({ code: data.code, record: data }, { status: 200 });
}
