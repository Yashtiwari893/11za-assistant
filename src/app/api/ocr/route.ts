import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseClient } from '@/lib/infrastructure/database'
import { getClaudeClient } from '@/lib/ai/clients'
import { AI_MODELS } from '@/config'

const supabaseAdmin = getSupabaseClient()

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const image = formData.get('image') as File | null
    const shouldStore = formData.get('store') === 'true'
    const authToken = formData.get('auth_token') as string | null
    const origin = formData.get('origin') as string | null
    const phoneNumbers = formData.get('phone_numbers') as string | null

    if (!image) {
      return NextResponse.json({ error: 'Image file required' }, { status: 400 })
    }

    // Validate file type
    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic']
    if (!validTypes.includes(image.type)) {
      return NextResponse.json({ error: 'Only JPG, PNG, WEBP, HEIC images supported' }, { status: 400 })
    }

    // Convert to base64 for Claude Vision
    const arrayBuffer = await image.arrayBuffer()
    const base64 = Buffer.from(arrayBuffer).toString('base64')
    const mimeType = image.type

    // Call Claude Vision
    const claude = getClaudeClient()
    const response = await claude.messages.create({
      model: AI_MODELS.CHAT_PRIMARY,
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mimeType as any,
                data: base64,
              },
            },
            {
              type: 'text',
              text: 'Transcribe all the text in this image accurately. Return only the markdown with no extra conversational filler.',
            },
          ],
        },
      ],
    })

    const extractedText = response.content[0].type === 'text' ? response.content[0].text : ''

    if (!shouldStore || !extractedText) {
      return NextResponse.json({ text: extractedText, stored: false })
    }

    // Store to DB with embeddings if requested
    if (!authToken || !origin) {
      return NextResponse.json({ text: extractedText, stored: false, error: 'auth_token and origin required to store' })
    }

    // Create rag_file entry
    const { data: fileRecord, error: fileErr } = await supabaseAdmin
      .from('rag_files')
      .insert({ name: image.name || 'ocr_image', file_type: 'image', auth_token: authToken, origin })
      .select()
      .single()

    if (fileErr || !fileRecord) {
      return NextResponse.json({ text: extractedText, stored: false, error: 'DB insert failed' }, { status: 500 })
    }

    // Chunk text
    const chunkSize = 500
    const chunks: string[] = []
    for (let i = 0; i < extractedText.length; i += chunkSize) {
      const chunk = extractedText.substring(i, i + chunkSize).trim()
      if (chunk.length > 10) chunks.push(chunk)
    }

    let phoneMapped = 0

    // Map to phone numbers if provided
    if (phoneNumbers) {
      const phones = phoneNumbers.split(',').map(p => p.trim()).filter(Boolean)
      for (const phone of phones) {
        await supabaseAdmin.from('phone_document_mapping').upsert({
          phone_number: phone,
          file_id: fileRecord.id,
          auth_token: authToken,
          origin
        }, { onConflict: 'phone_number,file_id' })
        phoneMapped++
      }
    }

    return NextResponse.json({
      text: extractedText,
      stored: true,
      file_id: fileRecord.id,
      chunks: chunks.length,
      phone_numbers_mapped: phoneMapped
    })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'OCR processing failed'
    console.error('[OCR] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
