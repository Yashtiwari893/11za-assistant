import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { phone_number, intent, system_prompt, auth_token, origin } = body

    if (!phone_number) {
      return NextResponse.json({ error: "Phone number is required" }, { status: 400 })
    }

    const cleanPhone = phone_number.replace(/[\s\-(). ]/g, '')

    // BUG FIX: onConflict: "phone_number" worked only if unique constraint was on phone_number alone
    // Schema has UNIQUE(phone_number, file_id) - composite key
    // Fix: Manual check then update or insert
    const { data: existing } = await supabaseAdmin
      .from("phone_document_mapping")
      .select("id")
      .eq("phone_number", cleanPhone)
      .limit(1)
      .single()

    if (existing) {
      const { error } = await supabaseAdmin
        .from("phone_document_mapping")
        .update({
          intent: intent ?? null,
          system_prompt: system_prompt ?? null,
          auth_token: auth_token ?? null,
          origin: origin ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
      if (error) throw error
    } else {
      const { error } = await supabaseAdmin
        .from("phone_document_mapping")
        .insert({
          phone_number: cleanPhone,
          intent: intent ?? null,
          system_prompt: system_prompt ?? null,
          auth_token: auth_token ?? null,
          origin: origin ?? null,
          file_id: null,
        })
      if (error) throw error
    }

    return NextResponse.json({ success: true, message: "Settings saved successfully" })
  } catch (error: any) {
    console.error("Update phone settings error:", error)
    return NextResponse.json({ error: error.message || "Failed to update" }, { status: 500 })
  }
}
