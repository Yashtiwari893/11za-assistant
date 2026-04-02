import { NextRequest, NextResponse } from "next/server"
import { getSupabaseClient } from "@/lib/infrastructure/database"

const supabaseAdmin = getSupabaseClient()

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const phone_number = searchParams.get('phone_number')

    if (!phone_number) {
      return NextResponse.json({ error: "Phone number is required" }, { status: 400 })
    }

    const cleanPhone = phone_number.replace(/[\s\-(). ]/g, '')

    // 1. Delete all mappings for this phone
    // Note: If you want to delete the actual RAG files as well, 
    // you would first fetch the file_ids, then delete them from rag_files.
    // However, files might be shared, so it's safer to just delete the mapping for now.
    const { error } = await supabaseAdmin
      .from("phone_document_mapping")
      .delete()
      .eq("phone_number", cleanPhone)

    if (error) throw error

    return NextResponse.json({ success: true, message: "Phone mapping deleted successfully" })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to delete'
    console.error("Delete phone mapping error:", error)
    return NextResponse.json(
      { error: message },
      { status: 500 }
    )
  }
}
