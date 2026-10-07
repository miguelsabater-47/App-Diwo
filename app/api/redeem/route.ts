import "server-only"
import { NextResponse } from "next/server"
import { auth, currentUser } from "@clerk/nextjs/server"
import { createClient } from "@supabase/supabase-js"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(url, serviceKey, { auth: { persistSession: false } })

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const body = await req.json()
  const code = String(body?.code ?? "").toUpperCase().trim()
  if (!/^[A-Z0-9]{6}$/.test(code)) return NextResponse.json({ error: "invalid_code" }, { status: 400 })

  const user = await currentUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const email = user.emailAddresses?.[0]?.emailAddress ?? ""
  const fullName = user.fullName ?? ""

  const { data, error } = await supabase.rpc("redeem_code", {
    p_code: code,
    p_clerk_id: userId,
    p_email: email,
    p_full_name: fullName,
  })

  if (error) {
    const m = error.message || ""
    if (m.includes("code_not_found")) return NextResponse.json({ error: "code_not_found" }, { status: 404 })
    if (m.includes("code_already_redeemed")) return NextResponse.json({ error: "code_already_redeemed" }, { status: 409 })
    if (m.includes("invalid_code_format")) return NextResponse.json({ error: "invalid_code" }, { status: 400 })
    if (m.includes("user_already_has_ticket")) return NextResponse.json({ error: "user_already_has_ticket" }, { status: 409 })
    return NextResponse.json({ error: "server_error" }, { status: 500 })
  }

  return NextResponse.json({ ticket: data })
}
