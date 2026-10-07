import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { assertAdmin } from "../_utils";

export async function GET() {
  const gate = await assertAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: gate.status });

  const { data, error } = await supabaseServer
    .from("codes")
    .select("code")
    .is("issued_at", null)
    .is("redeemed_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  if (error) {
    return NextResponse.json({ error: "server_error", details: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "no_available_codes" }, { status: 404 });
  }

  return NextResponse.json({ code: data.code });
}
