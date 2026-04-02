// src/lib/features/document.ts
// Document Vault — Production-grade with all guardrails

import { getSupabaseClient } from '@/lib/infrastructure/database'
import { sendWhatsAppMessage } from '@/lib/whatsapp/client'
import {
  documentSaved, documentNotFound, errorMessage,
} from '@/lib/whatsapp/templates'
import { truncateWhatsAppMessage } from '@/lib/whatsapp/message'
import type { Language } from '@/types'
import { updateContext } from '@/lib/infrastructure/sessionContext'

const supabase = getSupabaseClient()

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
  let label = cleanLabel(caption?.trim()) || guessLabel(normalizedType)
  // Ensure label is not too short or invalid
  if (!label || label.length < 3) {
    label = `doc_${Date.now().toString().slice(-6)}`
  }
  const ext = getExtension(normalizedType)
  const docType = normalizedType.includes('pdf') ? 'pdf' : 'image'

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

  // ── CHECK: Is Google Drive connected? ─────────────────────
  const { isDriveConnected, uploadToDrive } = await import('@/lib/googleDrive')
  const driveConnected = await isDriveConnected(userId)

  let driveFileId: string | null = null
  let storagePath: string | null = null

  if (driveConnected) {
    // ── Save to Google Drive ───────────────────────────────
    const fileName = `${label.replace(/\s+/g, '_')}_${Date.now()}.${ext}`
    const driveResult = await uploadToDrive({
      userId,
      fileBuffer: mediaBuffer,
      fileName,
      mimeType: normalizedType
    })

    if (!driveResult) {
      console.error('[document] Drive upload failed, falling back to Supabase')
      // Fall through to Supabase
    } else {
      driveFileId = driveResult.fileId
      console.log('[document] Saved to Drive:', driveFileId)
    }
  }

  // ── If Drive not connected, we notify but CONTINUE saving to Supabase ──
  if (!driveConnected && !driveFileId) {
    const connectUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/google?phone=${phone}`
    await sendWhatsAppMessage({
      to: phone,
      message: language === 'hi'
        ? `📁 *Document safe hai, par Backup ke liye apni Google Drive connect karo!*\n\n👉 ${connectUrl}\n\n_Ek bar connect karte hi, aapke purane documents bhi Drive par aa jayenge! 😊_`
        : `📁 *Document is safe, but connect Google Drive for Backup!*\n\n👉 ${connectUrl}\n\n_Old documents will also be synced once you connect! 😊_`
    })
    // No return here — proceed to save to Supabase
  }

  // ── If Drive failed (or not connected), save to Supabase as primary/fallback ──
  if (!driveFileId) {
    storagePath = `${userId}/${Date.now()}_${label.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\-]/g, '')}.${ext}`
    const { error: uploadErr } = await supabase.storage
      .from('documents')
      .upload(storagePath, mediaBuffer, { contentType: normalizedType, upsert: false })

    if (uploadErr) {
      console.error('[document] Supabase fallback upload failed:', uploadErr)
      await sendWhatsAppMessage({ to: phone, message: errorMessage(language) })
      return
    }
  }

  // ── Save metadata to DB ────────────────────────────────────
  const { data: inserted, error: dbErr } = await supabase.from('documents').insert({
    user_id: userId,
    label,
    storage_path: storagePath,
    drive_file_id: driveFileId,
    storage_type: driveFileId ? 'google_drive' : 'supabase',
    doc_type: docType,
    mime_type: normalizedType,
    file_size: mediaBuffer.length,
  }).select('id').single()

  if (dbErr) {
    console.error('[document] DB insert failed:', dbErr)
    // Cleanup drive file if DB failed
    if (driveFileId) console.warn('[document] Drive file saved but DB failed:', driveFileId)
    if (storagePath) await supabase.storage.from('documents').remove([storagePath])
    await sendWhatsAppMessage({ to: phone, message: errorMessage(language) })
    return
  }

  // ── No caption — ask for label ──────────────────────────
  if (!caption?.trim()) {
    await updateContext(userId, {
      pending_action: 'awaiting_label',
      document_id: inserted?.id, // Use ID for reliability
      document_path: storagePath || undefined,
      drive_file_id: driveFileId || undefined,
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
  if (!label || label.length < 3) {
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
  await updateContext(userId, { pending_action: undefined, document_id: undefined, document_path: undefined })

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

  // 1. Clean the query
  const cleanQuery = query.toLowerCase()
    .replace(/\b(mera|meri|mujhe|de|do|dikhao|wala|wali|card|copy|pdf|photo|chahiye|find|my|show|give|me|document|vault|nikalo|check|lao|bhejo|of|the|a|an)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  const finalQuery = cleanQuery || query.trim().toLowerCase()

  // 2. PRIORITY 1: Exact Match (Best for keywords like "1", "11", "Aadhar")
  const { data: exactMatch } = await supabase
    .from('documents')
    .select('*')
    .eq('user_id', userId)
    .ilike('label', finalQuery) // Exact label match (case insensitive)
    .order('uploaded_at', { ascending: false })
    .limit(1)

  let results = exactMatch || []

  // 3. PRIORITY 2: Fuzzy/Partial Word Search (If no exact match)
  if (results.length === 0) {
    const words = finalQuery.split(/\s+/).filter(w =>
      w.length > 2 || /^\d+$/.test(w) // Allow short numbers but not short fluff
    )

    if (words.length > 0) {
      const orConditions = words.map(w => `label.ilike.%${w}%`).join(',')
      const { data: partialMatch } = await supabase
        .from('documents')
        .select('*')
        .eq('user_id', userId)
        .or(orConditions)
        .order('uploaded_at', { ascending: false })

      results = partialMatch || []
    }
  }

  // ── GUARDRAIL: Not found ───────────────────────────────────
  if (results.length === 0) {
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

  // ── Get file URL: Drive or Supabase ───────────────────────
  let fileUrl: string | null = null

  if (doc.drive_file_id) {
    // Fetch from Google Drive
    const { getDriveFileLink } = await import('@/lib/googleDrive')
    fileUrl = await getDriveFileLink(userId, doc.drive_file_id)
  }

  if (!fileUrl && doc.storage_path) {
    // Fallback: Supabase signed URL (15 min)
    const { data: signedData } = await supabase.storage
      .from('documents')
      .createSignedUrl(doc.storage_path, 900)
    fileUrl = signedData?.signedUrl ?? null
  }

  if (!fileUrl) {
    console.error('[document] Could not generate file URL')
    await sendWhatsAppMessage({ to: phone, message: errorMessage(language) })
    return
  }

  await sendWhatsAppMessage({
    to: phone,
    message: language === 'hi'
      ? `📁 *${doc.label}* mila!\n\n_(Link 15 min ke liye valid hai)_`
      : `📁 Found *${doc.label}*!\n\n_(Link valid for 15 min)_`,
    mediaUrl: fileUrl,
    mediaType: doc.doc_type === 'pdf' ? 'document' : 'image'
  })

  return doc.id
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

  let message = (language === 'hi'
    ? `📁 *Aapka Vault (${docs.length} documents):*\n\n`
    : `📁 *Your Vault (${docs.length} documents):*\n\n`) +
    `${docList}\n\n` +
    (language === 'hi'
      ? `_Koi document pane ke liye naam bolo। Jaise "aadhar dikhao"_`
      : `_Say a name to retrieve. E.g. "show aadhar"_`)

  await sendWhatsAppMessage({
    to: phone,
    message: truncateWhatsAppMessage(message)
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

// ─── SYNC PENDING DOCUMENTS TO DRIVE ──────────────────────────
export async function syncPendingDocumentsToDrive(userId: string) {
  try {
    const { data: pendingDocs } = await supabase
      .from('documents')
      .select('*')
      .eq('user_id', userId)
      .eq('storage_type', 'supabase')
      .is('drive_file_id', null)

    if (!pendingDocs || pendingDocs.length === 0) return

    // Import uploadToDrive dynamically
    const { uploadToDrive } = await import('@/lib/googleDrive')

    console.log(`[sync] Syncing ${pendingDocs.length} docs for user ${userId}`)

    for (const doc of pendingDocs) {
      try {
        const { data: fileData, error: downloadErr } = await supabase.storage
          .from('documents')
          .download(doc.storage_path!)

        if (downloadErr || !fileData) continue

        const buffer = Buffer.from(await fileData.arrayBuffer())

        const driveResult = await uploadToDrive({
          userId,
          fileBuffer: buffer,
          fileName: `${doc.label.replace(/\s+/g, '_')}_${Date.now()}.${getExtension(doc.mime_type)}`,
          mimeType: doc.mime_type
        })

        if (driveResult?.fileId) {
          await supabase.from('documents').update({
            drive_file_id: driveResult.fileId,
            storage_type: 'google_drive'
          }).eq('id', doc.id)
          console.log(`[sync] Successfully synced: ${doc.label}`)
        }
      } catch (err) {
        console.error('[sync] Individual doc sync failed:', err)
      }
    }
  } catch (err) {
    console.error('[sync] Global sync error:', err)
  }
}

function cleanLabel(raw?: string): string {
  if (!raw) return ''
  return raw
    .replace(/\b(mera|meri|ka|ki|ke|save|karo|naam|label|please|bhai|document|photo|file|bill|aadhar|passport|license|licence|certificate|scan|copy|original)\b/gi, '')
    .replace(/[^a-zA-Z0-9\s\u0900-\u097F_-]/g, '') // Keep hyphens and underscores
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .substring(0, 100) // Cap at 100 chars
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