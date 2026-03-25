import { NextRequest, NextResponse } from 'next/server'
import { classifyIntent } from '@/lib/ai/intent'
import { getOrCreateUser, handleOnboarding } from '@/lib/features/onboarding'
import {
  handleSetReminder, handleListReminders,
  handleSnoozeReminder, handleCancelReminder
} from '@/lib/features/reminder'
import {
  handleAddTask, handleListTasks, handleCompleteTask,
  handleDeleteTask, handleListAllLists
} from '@/lib/features/task'
import {
  handleSaveDocument, handleFindDocument, handleListDocuments
} from '@/lib/features/document'
import { handleGetBriefing } from '@/lib/features/briefing'
import { helpMessage } from '@/lib/whatsapp/templates'
import { sendWhatsAppMessage } from '@/lib/whatsapp/client'
import { speechToText } from '@/lib/speechToText'
import { generateAutoResponse } from '@/lib/autoResponder'
import { createClient } from '@supabase/supabase-js'
import type { Language } from '@/lib/whatsapp/templates'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// BUG FIX: Proper MIME type resolver - was hardcoded 'image/jpeg' before
function resolveMimeType(rawMime?: string | null, subType?: string | null): string {
  if (rawMime) {
    const clean = rawMime.split(';')[0].trim().toLowerCase()
    const supported = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
    if (supported.includes(clean)) return clean
  }
  if (subType === 'document') return 'application/pdf'
  return 'image/jpeg'
}

function parseWebhookPayload(body: any) {
  return {
    phone: body?.from || '',
    to: body?.to || '',
    message: body?.content?.text || body?.content?.media?.caption || '',
    buttonId: body?.content?.button_id || null,
    mediaUrl: body?.content?.media?.url || null,
    mediaType: body?.content?.contentType || 'text',
    mimeType: body?.content?.media?.mimeType || body?.content?.media?.mime_type || null,
    subType: body?.content?.media?.type || null,
    messageId: body?.messageId || '',
    name: body?.whatsapp?.senderName || null,
    event: body?.event || 'MoMessage'
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    console.log('📩 Webhook:', JSON.stringify(body, null, 2))

    const { phone, to, message, buttonId, mediaUrl, mediaType, mimeType, subType, messageId, name, event } = parseWebhookPayload(body)

    if (!phone || !messageId) return NextResponse.json({ ok: true })

    const { data: botCreds } = await supabaseAdmin
      .from('phone_document_mapping')
      .select('auth_token')
      .eq('phone_number', to)
      .limit(1)
    const authToken = botCreds?.[0]?.auth_token || process.env.ELEVEN_ZA_API_KEY

    const { error: logErr } = await supabaseAdmin.from('whatsapp_messages').insert([{
      message_id: messageId,
      channel: 'whatsapp',
      from_number: phone,
      to_number: to,
      received_at: new Date().toISOString(),
      content_type: mediaType,
      content_text: message || null,
      sender_name: name,
      event_type: event,
      is_in_24_window: true,
      is_responded: false,
      raw_payload: body,
    }])

    if (logErr && (logErr as any).code === '23505') {
      console.log('ℹ️ Duplicate message ignored')
      return NextResponse.json({ ok: true })
    }

    if (event !== 'MoMessage') return NextResponse.json({ ok: true })

    const user = await getOrCreateUser(phone)
    if (!user) return NextResponse.json({ ok: true })
    if (name && !user.name) {
      await supabaseAdmin.from('users').update({ name }).eq('id', user.id)
    }

    const lang = (user.language as Language) ?? 'en'

    if (!user.onboarded) {
      await handleOnboarding(user, message, buttonId)
      return NextResponse.json({ ok: true })
    }

    let processedMessage = message
    if (mediaType === 'media' && (subType === 'voice' || subType === 'audio') && mediaUrl) {
      const stt = await speechToText(mediaUrl, authToken)
      processedMessage = stt?.text || message
      console.log('🎙 Transcribed:', processedMessage)
    }

    const isImageOrDoc = mediaType === 'image' || mediaType === 'document' || subType === 'image' || subType === 'document'
    if (mediaUrl && isImageOrDoc && subType !== 'voice' && subType !== 'audio') {
      // BUG FIX: Use resolveMimeType instead of hardcoded 'image/jpeg'
      const resolvedMime = resolveMimeType(mimeType, subType)
      await handleSaveDocument({
        userId: user.id, phone, language: lang,
        mediaUrl: mediaUrl!, mediaType: resolvedMime,
        caption: processedMessage || undefined, authToken
      })
      return NextResponse.json({ ok: true })
    }

    if (!processedMessage?.trim()) return NextResponse.json({ ok: true })

    const { data: session } = await supabaseAdmin
      .from('sessions')
      .select('context')
      .eq('user_id', user.id)
      .single()

    const ctx = session?.context as any
    if (ctx?.pending_action === 'awaiting_label') {
      const label = processedMessage.trim()
      await supabaseAdmin.from('documents')
        .update({ label })
        .eq('storage_path', ctx.document_path)
        .eq('user_id', user.id)
      await supabaseAdmin.from('sessions')
        .update({ context: {} })
        .eq('user_id', user.id)
      await sendWhatsAppMessage({
        to: phone,
        message: lang === 'hi'
          ? `📁 *${label}* ke naam se save ho gaya!\n\n_"${label} dikhao" bolke wapas paa sakte ho._`
          : `📁 Saved as *${label}*!\n\nSay "show ${label}" anytime to get it back.`
      })
      return NextResponse.json({ ok: true })
    }

    const result = await classifyIntent(processedMessage, lang)
    const { intent, extractedData } = result
    console.log('🔍 Intent:', intent, extractedData)

    switch (intent) {
      case 'SET_REMINDER':
        await handleSetReminder({
          userId: user.id, phone, language: lang,
          message: processedMessage,
          dateTimeText: extractedData.dateTimeText,
          reminderTitle: extractedData.reminderTitle
        })
        break

      case 'LIST_REMINDERS':
        await handleListReminders({ userId: user.id, phone, language: lang })
        break

      // BUG FIX: Was calling handleListReminders() instead of handleCancelReminder()!
      case 'CANCEL_REMINDER':
        await handleCancelReminder({
          userId: user.id, phone, language: lang,
          titleHint: extractedData.reminderTitle
        })
        break

      case 'SNOOZE_REMINDER':
        await handleSnoozeReminder({
          userId: user.id, phone, language: lang,
          customText: extractedData.dateTimeText ?? processedMessage
        })
        break

      case 'ADD_TASK':
        await handleAddTask({
          userId: user.id, phone, language: lang,
          taskContent: extractedData.taskContent ?? processedMessage,
          listName: extractedData.listName ?? 'general'
        })
        break

      case 'LIST_TASKS':
        if (extractedData.listName) {
          await handleListTasks({ userId: user.id, phone, language: lang, listName: extractedData.listName })
        } else {
          await handleListAllLists({ userId: user.id, phone, language: lang })
        }
        break

      case 'COMPLETE_TASK':
        await handleCompleteTask({
          userId: user.id, phone, language: lang,
          taskContent: extractedData.taskContent ?? processedMessage,
          listName: extractedData.listName
        })
        break

      // BUG FIX: DELETE_TASK case was completely missing from switch!
      case 'DELETE_TASK':
        await handleDeleteTask({
          userId: user.id, phone, language: lang,
          taskContent: extractedData.taskContent ?? processedMessage,
          listName: extractedData.listName
        })
        break

      case 'FIND_DOCUMENT':
        await handleFindDocument({
          userId: user.id, phone, language: lang,
          query: extractedData.documentQuery ?? processedMessage
        })
        break

      case 'LIST_DOCUMENTS':
        await handleListDocuments({ userId: user.id, phone, language: lang })
        break

      case 'GET_BRIEFING':
        await handleGetBriefing({ userId: user.id, phone, language: lang })
        break

      case 'HELP':
        await sendWhatsAppMessage({ to: phone, message: helpMessage(lang) })
        break

      case 'UNKNOWN':
      default:
        console.log('🤖 Falling back to RAG Chat')
        await generateAutoResponse(phone, to, processedMessage, messageId)
        break
    }

    return NextResponse.json({ ok: true })

  } catch (err) {
    console.error('🔥 WEBHOOK_ERROR:', err)
    return NextResponse.json({ ok: true })
  }
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('hub.verify_token')
  const challenge = req.nextUrl.searchParams.get('hub.challenge')
  if (token === process.env.WEBHOOK_VERIFY_TOKEN) {
    return new Response(challenge ?? 'ok')
  }
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
