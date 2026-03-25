// src/lib/features/document.ts
// Document Vault — Bulletproof version with all guardrails

import { createClient } from '@supabase/supabase-js'
import { sendWhatsAppMessage } from '@/lib/whatsapp/client'
import {
  documentSaved, documentNotFound, errorMessage,
  type Language
} from '@/lib/whatsapp/templates'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Max file size — 10MB
const MAX_FILE_SIZE = 10 * 1024 * 1024

// Supported MIME types
const SUPPORTED_TYPES = [
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic',
  'application/pdf'
]

// ─── SAVE DOCUMENT ────────────────────────────────────────────
export async function handleSaveDocument(params: {
  userId: string
  phone: string
  language: Language
  mediaUrl: string
  mediaType: string
  caption?: string
  authToken?: string
}) {
  const { userId, phone, language, mediaUrl, mediaType, caption, authToken } = params

  // ── GUARDRAIL 1: Supported type check ─────────────────────
  const normalizedType = mediaType.split(';')[0].trim().toLowerCase()
  if (!SUPPORTED_TYPES.includes(normalizedType)) {
    await sendWhatsAppMessage({
      to: phone,
      message: language === 'hi'
        ? '⚠️ Sirf photos (JPG/PNG) aur PDF files save ho sakti hain।'
        : '⚠️ Only photos (JPG/PNG) and PDF files can be saved.'
    })
    return
  }

  // ── Download with 11za Auth ────────────────────────────────
  const mediaBuffer = await downloadMedia(mediaUrl, authToken)

  // ── GUARDRAIL 2: Download fail ─────────────────────────────
  if (!mediaBuffer) {
    console.error('[document] downloadMedia failed for URL:', mediaUrl)
    await sendWhatsAppMessage({ to: phone, message: errorMessage(language) })
    return
  }

  // ── GUARDRAIL 3: File size check ───────────────────────────
  if (mediaBuffer.length > MAX_FILE_SIZE) {
    await sendWhatsAppMessage({
      to: phone,
      message: language === 'hi'
        ? '⚠️ File bahut badi hai। 10MB se chhoti file bhejo।'
        : '⚠️ File is too large. Please send a file smaller than 10MB.'
    })
    return
  }

  // ── GUARDRAIL 4: Empty file ────────────────────────────────
  if (mediaBuffer.length === 0) {
    await sendWhatsAppMessage({ to: phone, message: errorMessage(language) })
    return
  }

  // ── Label + path ───────────────────────────────────────────
  const label = cleanLabel(caption?.trim()) || guessLabel(normalizedType)
  const ext = getExtension(normalizedType)
  const docType = normalizedType.includes('pdf') ? 'pdf' : 'image'
  const storagePath = `${userId}/${Date.now()}_${label.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\-]/g, '')}.${ext}`

  // ── GUARDRAIL 5: Duplicate label check ────────────────────
  if (caption?.trim()) {
    const { data: existing } = await supabase
      .from('documents')
      .select('id, uploaded_at')
      .eq('user_id', userId)
      .ilike('label', label)
      .limit(1)

    if (existing && existing.length > 0) {
      const uploadedDate = new Date(existing[0].uploaded_at).toLocaleDateString('en-IN', {
        timeZone: 'Asia/Kolkata', dateStyle: 'medium'
      })
      await sendWhatsAppMessage({
        to: phone,
        message: language === 'hi'
          ? `⚠️ *${label}* naam ka document already save hai (${uploadedDate})।\n\nNaya save karna hai? Thoda alag naam do — jaise "*${label} 2*"।`
          : `⚠️ A document named *${label}* already exists (${uploadedDate}).\n\nWant to save a new one? Use a slightly different name like "*${label} 2*".`
      })
      return
    }
  }

  // ── Upload to Supabase Storage ─────────────────────────────
  const { error: uploadErr } = await supabase.storage
    .from('documents')
    .upload(storagePath, mediaBuffer, { contentType: normalizedType, upsert: false })

  if (uploadErr) {
    console.error('[document] Upload failed:', uploadErr)
    await sendWhatsAppMessage({ to: phone, message: errorMessage(language) })
    return
  }

  // ── Save metadata to DB ────────────────────────────────────
  const { error: dbErr } = await supabase.from('documents').insert({
    user_id: userId,
    label,
    storage_path: storagePath,
    doc_type: docType,
    mime_type: normalizedType,
    file_size: mediaBuffer.length,
  })

  if (dbErr) {
    console.error('[document] DB insert failed:', dbErr)
    // Storage se bhi hata do agar DB fail ho
    await supabase.storage.from('documents').remove([storagePath])
    await sendWhatsAppMessage({ to: phone, message: errorMessage(language) })
    return
  }

  // ── No caption — ask for label, save session state ─────────
  if (!caption?.trim()) {
    await saveSessionState(userId, {
      pending_action: 'awaiting_label',
      document_path: storagePath,
      doc_type: docType
    })

    await sendWhatsAppMessage({
      to: phone,
      message: language === 'hi'
        ? `📁 Document save ho gaya!\n\nIse kya naam du?\n_Jaise: "aadhar", "passport", "driving licence", "bill"_`
        : `📁 Document saved!\n\nWhat should I call this?\n_E.g. "aadhar", "passport", "driving licence", "bill"_`
    })
    return
  }

  await sendWhatsAppMessage({
    to: phone,
    message: documentSaved(label, language)
  })
}

// ─── UPDATE DOCUMENT LABEL (pending_action: awaiting_label) ───
export async function handleUpdateDocumentLabel(params: {
  userId: string
  phone: string
  language: Language
  label: string
  documentPath: string
}) {
  const { userId, phone, language, documentPath } = params
  const label = cleanLabel(params.label) || params.label.trim()

  // ── GUARDRAIL: Label too short ─────────────────────────────
  if (!label || label.length < 2) {
    await sendWhatsAppMessage({
      to: phone,
      message: language === 'hi'
        ? '❓ Thoda acha naam do। Jaise "aadhar", "passport", "bill 2024"'
        : '❓ Please give a proper name. E.g. "aadhar", "passport", "bill 2024"'
    })
    return
  }

  await supabase
    .from('documents')
    .update({ label })
    .eq('user_id', userId)
    .eq('storage_path', documentPath)

  // Clear session state
  await saveSessionState(userId, {})

  await sendWhatsAppMessage({
    to: phone,
    message: language === 'hi'
      ? `📁 *${label}* ke naam se save ho gaya!\n\n_"${label} dikhao" bol ke kabhi bhi wapas pao।_`
      : `📁 Saved as *${label}*!\n\n_Say "${label} dikhao" anytime to get it back._`
  })
}

// ─── FIND DOCUMENT ────────────────────────────────────────────
export async function handleFindDocument(params: {
  userId: string
  phone: string
  language: Language
  query: string
}) {
  const { userId, phone, language, query } = params

  // Clean conversational words from query
  const cleanQuery = query.toLowerCase()
    .replace(/\b(mera|meri|mujhe|de|do|dikhao|wala|wali|card|copy|pdf|photo|chahiye|find|my|the|show|give|me|document|vault|nikalo|check|lao|bhejo)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  const finalQuery = cleanQuery.length > 1 ? cleanQuery : query.trim()
  const words = finalQuery.split(/\s+/).filter(w => w.length > 1)

  if (words.length === 0) {
    await sendWhatsAppMessage({
      to: phone,
      message: language === 'hi'
        ? '❓ Kaunsa document chahiye? Naam batao। Jaise "aadhar dikhao" ya "passport do"'
        : '❓ Which document do you need? E.g. "show aadhar" or "give passport"'
    })
    return
  }

  // OR search — koi bhi word match kare
  const orConditions = words.map(w => `label.ilike.%${w}%`).join(',')

  const { data: results, error } = await supabase
    .from('documents')
    .select('*')
    .eq('user_id', userId)
    .or(orConditions)
    .order('uploaded_at', { ascending: false })

  // ── GUARDRAIL: Not found ───────────────────────────────────
  if (error || !results || results.length === 0) {
    // List karo available documents taaki user ko pata chale
    const { data: allDocs } = await supabase
      .from('documents')
      .select('label')
      .eq('user_id', userId)
      .limit(5)

    let notFoundMsg = documentNotFound(query, language)

    if (allDocs && allDocs.length > 0) {
      const docNames = allDocs.map(d => `_${d.label}_`).join(', ')
      notFoundMsg += language === 'hi'
        ? `\n\nAapke saved documents: ${docNames}`
        : `\n\nYour saved documents: ${docNames}`
    }

    await sendWhatsAppMessage({ to: phone, message: notFoundMsg })
    return
  }

  const doc = results[0]

  // ── Generate signed URL (15 min valid) ────────────────────
  const { data: signedData } = await supabase.storage
    .from('documents')
    .createSignedUrl(doc.storage_path, 900)

  if (!signedData?.signedUrl) {
    console.error('[document] Signed URL generation failed')
    await sendWhatsAppMessage({ to: phone, message: errorMessage(language) })
    return
  }

  await sendWhatsAppMessage({
    to: phone,
    message: language === 'hi'
      ? `📁 *${doc.label}* mila!\n\n_(Link 15 min ke liye valid hai)_`
      : `📁 Found *${doc.label}*!\n\n_(Link valid for 15 min)_`,
    mediaUrl: signedData.signedUrl,
    mediaType: doc.doc_type === 'pdf' ? 'document' : 'image'
  })
}

// ─── LIST ALL DOCUMENTS ───────────────────────────────────────
export async function handleListDocuments(params: {
  userId: string
  phone: string
  language: Language
}) {
  const { userId, phone, language } = params

  const { data: docs } = await supabase
    .from('documents')
    .select('label, doc_type, uploaded_at, file_size')
    .eq('user_id', userId)
    .order('uploaded_at', { ascending: false })
    .limit(20)

  if (!docs || docs.length === 0) {
    await sendWhatsAppMessage({
      to: phone,
      message: language === 'hi'
        ? '📭 Vault abhi khali hai। Koi bhi photo ya PDF bhejo — save ho jaayega!'
        : '📭 Your vault is empty. Send any photo or PDF to save it!'
    })
    return
  }

  const docList = docs.map(d => {
    const size = d.file_size ? ` (${(d.file_size / 1024).toFixed(0)}KB)` : ''
    const icon = d.doc_type === 'pdf' ? '📄' : '🖼️'
    return `${icon} *${d.label}*${size}`
  }).join('\n')

  await sendWhatsAppMessage({
    to: phone,
    message: (language === 'hi'
      ? `📁 *Aapka Vault (${docs.length} documents):*\n\n`
      : `📁 *Your Vault (${docs.length} documents):*\n\n`) +
      `${docList}\n\n` +
      (language === 'hi'
        ? `_Koi document pane ke liye naam bolo। Jaise "aadhar dikhao"_`
        : `_Say a name to retrieve. E.g. "show aadhar"_`)
  })
}

// ─── DELETE DOCUMENT ──────────────────────────────────────────
export async function handleDeleteDocument(params: {
  userId: string
  phone: string
  language: Language
  query: string
}) {
  const { userId, phone, language, query } = params

  const { data: docs } = await supabase
    .from('documents')
    .select('id, label, storage_path')
    .eq('user_id', userId)
    .ilike('label', `%${query}%`)
    .limit(1)

  if (!docs || docs.length === 0) {
    await sendWhatsAppMessage({
      to: phone,
      message: language === 'hi'
        ? `❓ "${query}" naam ka koi document nahi mila।`
        : `❓ No document found matching "${query}".`
    })
    return
  }

  const doc = docs[0]

  // Storage se delete
  await supabase.storage.from('documents').remove([doc.storage_path])
  // DB se delete
  await supabase.from('documents').delete().eq('id', doc.id)

  await sendWhatsAppMessage({
    to: phone,
    message: language === 'hi'
      ? `🗑️ *${doc.label}* delete ho gaya!`
      : `🗑️ *${doc.label}* deleted successfully!`
  })
}

// ─── HELPERS ──────────────────────────────────────────────────

async function downloadMedia(url: string, authToken?: string): Promise<Buffer | null> {
  try {
    const token = authToken || process.env.ELEVEN_ZA_API_KEY
    const headers: Record<string, string> = {}
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    const res = await fetch(url, { headers })
    if (!res.ok) {
      console.error(`[document] Download failed: ${res.status} ${res.statusText}`)
      return null
    }
    const arrayBuffer = await res.arrayBuffer()
    return Buffer.from(arrayBuffer)
  } catch (err) {
    console.error('[document] downloadMedia error:', err)
    return null
  }
}

function cleanLabel(raw?: string): string {
  if (!raw) return ''
  return raw
    .replace(/\b(mera|meri|ka|ki|ke|save|karo|naam|label|please|bhai)\b/gi, '')
    .replace(/[^a-zA-Z0-9\s\u0900-\u097F]/g, '') // Hindi chars allow karo
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function guessLabel(mimeType: string): string {
  if (mimeType.includes('pdf')) return 'document'
  if (mimeType.includes('image')) return 'photo'
  return 'file'
}

function getExtension(mimeType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'application/pdf': 'pdf',
  }
  return map[mimeType] ?? 'jpg'
}

async function saveSessionState(userId: string, context: object) {
  const { data: existing } = await supabase
    .from('sessions')
    .select('id')
    .eq('user_id', userId)
    .single()

  if (existing) {
    await supabase.from('sessions').update({ context }).eq('id', existing.id)
  } else {
    await supabase.from('sessions').insert({ user_id: userId, context })
  }
}