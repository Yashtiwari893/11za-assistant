import { NextRequest, NextResponse } from "next/server"
import { getSupabaseClient } from "@/lib/infrastructure/database"

const supabaseAdmin = getSupabaseClient()

export async function GET() {
  try {
    const { data: files, error } = await supabaseAdmin
      .from("rag_files")
      .select("id, name, file_type, created_at, chunk_count")
      .order("created_at", { ascending: false })

    if (error) throw error

    return NextResponse.json({ success: true, files })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch files'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: "File ID is required" }, { status: 400 })
    }

    // 1. Delete all chunks (due to CASCADE or manual)
    await supabaseAdmin.from("rag_chunks").delete().eq("file_id", id)
    
    // 2. Delete mappings
    await supabaseAdmin.from("phone_document_mapping").delete().eq("file_id", id)

    // 3. Delete file record
    const { error } = await supabaseAdmin.from("rag_files").delete().eq("id", id)

    if (error) throw error

    return NextResponse.json({ success: true, message: "File deleted successfully" })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to delete file'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
