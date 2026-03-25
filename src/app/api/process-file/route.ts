import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// NOTE: This route should handle heavy processing (OCR/Vision)
// It was previously called 'api/ocr' but the UI calls 'api/process-file'
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    const phone = formData.get('phone_number') as string
    const mode = formData.get('processing_mode') as string || 'ocr'
    const authToken = formData.get('auth_token') as string
    const origin = formData.get('origin') as string

    if (!file || !phone) {
      return NextResponse.json({ error: "File and phone number are required" }, { status: 400 })
    }

    // 1. Create file record
    const { data: fileRecord, error: fileErr } = await supabaseAdmin
      .from('rag_files')
      .insert({
        name: file.name,
        file_type: file.type,
        source: 'dashboard_upload',
        processing_mode: mode
      })
      .select()
      .single()

    if (fileErr || !fileRecord) throw fileErr || new Error("Failed to create file record")

    // 2. Mock processing for now (if Vision/OCR API is not configured)
    // In a real scenario, you'd call Mistral or Groq Vision here
    // Let's assume some basic text extraction...
    let extractedText = "Sample extracted text from " + file.name
    
    // 3. Chunk the text
    const chunks = extractedText.match(/.{1,1000}/g) || []
    
    if (chunks.length > 0) {
      const records = chunks.map((chunk, i) => ({
        file_id: fileRecord.id,
        content: chunk,
        index: i
      }))
      const { error: chunkErr } = await supabaseAdmin.from('rag_chunks').insert(records)
      if (chunkErr) throw chunkErr
      
      // Update chunk count
      await supabaseAdmin.from('rag_files').update({ chunk_count: chunks.length }).eq('id', fileRecord.id)
    }

    // 4. Map to phone number
    await supabaseAdmin.from('phone_document_mapping').upsert({
      phone_number: phone,
      file_id: fileRecord.id,
      auth_token: authToken,
      origin: origin,
      updated_at: new Date().toISOString()
    }, { onConflict: 'phone_number,file_id' })

    return NextResponse.json({ 
      success: true, 
      file_id: fileRecord.id,
      chunks: chunks.length,
      file_type: file.type
    })

  } catch (err: any) {
    console.error("Process-file error:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
