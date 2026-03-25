import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  try {
    const { data: mappings, error } = await supabaseAdmin
      .from("phone_document_mapping")
      .select(`id, phone_number, intent, system_prompt`)
      // SECURITY FIX: auth_token aur origin removed - kabhi frontend ko expose mat karo
      .order("phone_number", { ascending: true })

    if (error) throw error

    // FIX: Each mapping must have a 'files' array to prevent frontend crash
    const sanitized = (mappings || []).map(m => ({
      ...m,
      files: [] // Default for now, as frontend expects this
    }))

    return NextResponse.json({ success: true, groups: sanitized })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed" },
      { status: 500 }
    )
  }
}
