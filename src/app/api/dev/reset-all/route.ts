import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function DELETE(req: NextRequest) {
  // SECURITY FIX: Production mein disabled
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Disabled in production" }, { status: 403 })
  }
  // Dev secret check
  const devSecret = req.headers.get("x-dev-secret")
  if (!devSecret || devSecret !== process.env.DEV_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    let { error } = await supabaseAdmin.from("messages").delete().not("id", "is", null)
    if (error) throw error
    ;({ error } = await supabaseAdmin.from("rag_chunks").delete().not("id", "is", null))
    if (error) throw error
    ;({ error } = await supabaseAdmin.from("rag_files").delete().not("id", "is", null))
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
