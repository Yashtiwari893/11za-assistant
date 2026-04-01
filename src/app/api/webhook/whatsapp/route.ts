import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuid } from 'uuid'
import { classifyIntent } from '@/lib/ai/intent'
import { getOrCreateUser, handleOnboarding } from '@/lib/features/onboarding'
import {
  handleSetReminder, handleListReminders,
  handleSnoozeReminder, handleCancelReminder
} from '@/lib/features/reminder'
import {
  handleAddTask, handleListTasks, handleCompleteTask,
  handleDeleteTask
} from '@/lib/features/task'
import {
  handleSaveDocument, handleFindDocument, handleListDocuments,
  handleDeleteDocument
} from '@/lib/features/document'
import { handleGetBriefing } from '@/lib/features/briefing'
import { helpMessage } from '@/lib/whatsapp/templates'
import { sendWhatsAppMessage } from '@/lib/whatsapp/client'
import { speechToText } from '@/lib/speechToText'
import { generateAutoResponse } from '@/lib/autoResponder'
import { getSupabaseClient } from '@/lib/infrastructure/database'
import { logger, setTraceId } from '@/lib/infrastructure/logger'
import { createErrorResponse } from '@/lib/infrastructure/errorHandler'
import { validatePhone, validatePlainText } from '@/lib/infrastructure/inputValidator'
import { retryWithExponentialBackoff } from '@/lib/infrastructure/errorHandler'
import { getContext, updateContext, addToHistory } from '@/lib/infrastructure/sessionContext'
import type { Language } from '@/lib/whatsapp/templates'

const supabaseAdmin = getSupabaseClient()

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
  // ─── TRACE ID & LOGGING ────────────────────────────────
  const traceId = uuid()
  setTraceId(traceId)

  try {
    const body = await req.json()
    logger.info('📩 Webhook received', { traceId, eventType: body.event })

    // ─── PARSE & VALIDATE WEBHOOK PAYLOAD ──────────────────
    const { phone, to, message, buttonId, mediaUrl, mediaType, mimeType, subType, messageId, name, event } = parseWebhookPayload(body)

    // ─── VALIDATE REQUIRED FIELDS ──────────────────────────
    if (!phone || !messageId) {
      logger.warn('Invalid webhook - missing required fields', { phone, messageId })
      return NextResponse.json({ ok: true }) // Silent ignore
    }

    // ─── VALIDATE PHONE NUMBERS ────────────────────────────
    let cleanFromPhone: string
    let cleanToPhone: string
    try {
      cleanFromPhone = validatePhone(phone)
      cleanToPhone = validatePhone(to)
    } catch (err) {
      logger.warn('Invalid phone format', { phone, to })
      return NextResponse.json({ ok: true })
    }

    // ─── ATOMIC DEDUPLICATION ─────────────────────────────
    // We try to insert first. If it fails with 23505 (Unique violation), it's a duplicate.
    // This is faster and safer than (SELECT then INSERT).
    try {
      const { error: logErr } = await supabaseAdmin.from('whatsapp_messages').insert([{
        message_id: messageId,
        channel: 'whatsapp',
        from_number: cleanFromPhone,
        to_number: cleanToPhone,
        received_at: new Date().toISOString(),
        content_type: mediaType,
        content_text: message ? validatePlainText(message, 10000) : null,
        sender_name: name ? validatePlainText(name, 100) : null,
        event_type: event,
        is_in_24_window: true,
        is_responded: false,
        raw_payload: body,
        trace_id: traceId,
      }])

      if (logErr) {
        if ((logErr as any).code === '23505') {
          logger.info('ℹ️ Duplicate message ignored (Insert conflict)', { messageId })
          return NextResponse.json({ ok: true }) // Silent ignore
        }
        throw logErr
      }
    } catch (logErr) {
      // If DB is failing, we might have issues, but for now we skip to avoid infinite loops
      logger.error('Failed to log message', { messageId }, logErr as Error)
    }

    // ─── ONLY PROCESS INCOMING MESSAGES ────────────────────
    if (event !== 'MoMessage') {
      logger.debug('Ignored non-MoMessage event', { event })
      return NextResponse.json({ ok: true })
    }

    // ─── GET OR CREATE USER (with retries) ─────────────────
    let user = await retryWithExponentialBackoff(
      () => getOrCreateUser(cleanFromPhone, name),
      3
    )

    if (!user) {
      logger.error('Failed to create user', { phone: cleanFromPhone })
      return NextResponse.json({ ok: true }) // Silent fail
    }

    // ─── UPDATE USER NAME IF AVAILABLE ────────────────────
    if (name && !user.name) {
      try {
        await supabaseAdmin.from('users').update({ name: validatePlainText(name, 100) }).eq('id', user.id)
      } catch (err) {
        logger.warn('Failed to update user name', { userId: user.id })
      }
    }

    const lang = (user.language as Language) ?? 'en'

    // ─── HANDLE ONBOARDING FLOW ───────────────────────────
    if (!user.onboarded) {
      await handleOnboarding(user, message, buttonId)
      return NextResponse.json({ ok: true })
    }

    // ─── PROCESS MESSAGE CONTENT ──────────────────────────
    let processedMessage = message

    // Convert voice/audio to text
    if (mediaType === 'media' && (subType === 'voice' || subType === 'audio') && mediaUrl) {
      try {
        const { data: botCreds } = await supabaseAdmin
          .from('phone_document_mapping')
          .select('auth_token')
          .eq('phone_number', cleanToPhone)
          .limit(1)
        const authToken = botCreds?.[0]?.auth_token || process.env.ELEVEN_ZA_API_KEY

        const stt = await speechToText(mediaUrl, authToken)
        processedMessage = stt?.text || message
        logger.info('🎙 Voice transcribed', { userId: user.id, length: processedMessage?.length })
      } catch (sttErr) {
        logger.error('Speech-to-text failed', { userId: user.id }, sttErr as Error)
        processedMessage = message // Fallback to original
      }
    }

    // ─── HANDLE IMAGE/DOCUMENT UPLOADS ─────────────────────
    const isImageOrDoc = mediaType === 'image' || mediaType === 'document' || subType === 'image' || subType === 'document'
    if (mediaUrl && isImageOrDoc && subType !== 'voice' && subType !== 'audio') {
      const resolvedMime = resolveMimeType(mimeType, subType)
      await handleSaveDocument({
        userId: user.id,
        phone: cleanFromPhone,
        language: lang,
        mediaUrl: mediaUrl!,
        mediaType: resolvedMime,
        caption: processedMessage || undefined,
        authToken: undefined,
      })
      return NextResponse.json({ ok: true })
    }

    // ─── EMPTY MESSAGE CHECK ──────────────────────────────
    if (!processedMessage?.trim()) {
      logger.debug('Empty message - ignoring')
      return NextResponse.json({ ok: true })
    }

    // ─── LOAD SESSION CONTEXT ─────────────────────────────
    const ctx = await getContext(user.id)

    // ─── HANDLE PENDING ACTIONS (e.g., awaiting document label) ─
    if (ctx?.pending_action === 'awaiting_label') {
      const rawLabel = processedMessage.trim()
      const cleanLabel = rawLabel.replace(/[^a-zA-Z0-9\s\u0900-\u097F]/g, '').substring(0, 50)
      
      const updateQuery = ctx.document_id 
        ? supabaseAdmin.from('documents').update({ label: cleanLabel }).eq('id', ctx.document_id)
        : supabaseAdmin.from('documents').update({ label: cleanLabel }).eq('storage_path', ctx.document_path).eq('user_id', user.id)

      await updateQuery
      
      await supabaseAdmin.from('sessions').update({ context: {} }).eq('user_id', user.id)
      
      await sendWhatsAppMessage({
        to: cleanFromPhone,
        message: lang === 'hi'
          ? `📁 *${cleanLabel}* के नाम से save हो गया!\n\n_"${cleanLabel} दिखाओ" बोलकर फिर से पा सकते हो।_`
          : `📁 Saved as *${cleanLabel}*!\n\nSay "show ${cleanLabel}" anytime to get it back.`
      })
      return NextResponse.json({ ok: true })
    }

    // ─── INTENT CLASSIFICATION ───────────────────────────
    logger.debug('Classifying intent', { userId: user.id })
    
    // Safety Guard: Conversational cues shouldn't trigger heavy features
    const lowerMessage = processedMessage.toLowerCase().trim()
    const conversationalCues = ['done', 'ok', 'okay', 'thanks', 'thank you', 'dhanyawad', 'shukriya', 'thnx', 'wow', 'good']
    
    let intentResult;
    if (conversationalCues.includes(lowerMessage)) {
      intentResult = { intent: 'UNKNOWN', confidence: 1.0, extractedData: {} }
    } else {
      intentResult = await classifyIntent(processedMessage, lang, ctx)
    }

    logger.info('Intent classified', {
      userId: user.id,
      intent: intentResult.intent,
      confidence: intentResult.confidence,
    })

    // ─── KEYWORD-BASED INTENT OVERRIDE (Safety Net) ───────
    // Recovery/Find override
    if (lowerMessage.includes('dikhao') || lowerMessage.includes('show') || lowerMessage.includes('nikalo') || lowerMessage.includes('bhejo')) {
      if (intentResult.intent === 'UNKNOWN' || intentResult.confidence < 0.8) {
        intentResult.intent = 'FIND_DOCUMENT'
        intentResult.confidence = 0.99
      }
    }

    // Deletion override
    if (lowerMessage.includes('delete') || lowerMessage.includes('hatao') || lowerMessage.includes('mitao') || lowerMessage.includes('remove')) {
      if (intentResult.intent === 'UNKNOWN' || intentResult.confidence < 0.8) {
        intentResult.intent = 'DELETE_DOCUMENT'
        intentResult.confidence = 0.99
      }
    }

    // ─── ABUSE/GALI DETECTION ────────────────────────────
    const abusePattern = /\b(kutte|bc|bhenchod|madarchod|mc|hrami|saale|sale|kamine|kutta)\b/i
    const hasAbuse = abusePattern.test(lowerMessage)
    let abuseWarning = ''

    if (hasAbuse) {
      abuseWarning = lang === 'hi' 
        ? '⚠️ Main yahan aapki help ke liye hoon professionally. Kripya respect ke saath baat karein taaki main behtar assist kar sakoon! 😊\n\n'
        : '⚠️ I am here to help you professionally. Please keep our conversation respectful so I can assist you better! 😊\n\n'
    }

    // ─── ROUTE TO FEATURE HANDLERS ────────────────────────
    let isHandled = false
    const { intent, extractedData } = intentResult

    // Helper to send message with optional abuse warning
    const sendReply = async (msg: string) => {
      await sendWhatsAppMessage({ to: cleanFromPhone, message: abuseWarning + msg })
    }

    try {
      switch (intent) {
        case 'SET_REMINDER':
          // Pass abuseWarning to handleSetReminder so it can prepend if needed
          await handleSetReminder({
            userId: user.id,
            phone: cleanFromPhone,
            language: lang,
            message: processedMessage,
            dateTimeText: extractedData.dateTimeText || processedMessage,
            reminderTitle: extractedData.reminderTitle || processedMessage,
            prefix: abuseWarning
          })
          isHandled = true
          break

        case 'LIST_REMINDERS':
          await handleListReminders({
            userId: user.id,
            phone: cleanFromPhone,
            language: lang,
          })
          isHandled = true
          break

        case 'ADD_TASK':
          await handleAddTask({
            userId: user.id,
            phone: cleanFromPhone,
            language: lang,
            taskContent: extractedData.taskContent || processedMessage,
            listName: extractedData.listName || 'general',
            prefix: abuseWarning
          })
          isHandled = true
          break

        case 'LIST_TASKS':
          await handleListTasks({
            userId: user.id,
            phone: cleanFromPhone,
            language: lang,
            listName: extractedData.listName || 'general',
            prefix: abuseWarning
          })
          isHandled = true
          break

        case 'COMPLETE_TASK':
          await handleCompleteTask({
            userId: user.id,
            phone: cleanFromPhone,
            language: lang,
            taskContent: extractedData.taskContent || processedMessage,
            prefix: abuseWarning
          })
          isHandled = true
          break

        case 'DELETE_TASK':
          await handleDeleteTask({
            userId: user.id,
            phone: cleanFromPhone,
            language: lang,
            taskContent: extractedData.taskContent || processedMessage,
            prefix: abuseWarning
          })
          isHandled = true
          break

        case 'FIND_DOCUMENT':
          try {
            await handleFindDocument({
              userId: user.id,
              phone: cleanFromPhone,
              language: lang,
              query: extractedData?.documentQuery 
                || processedMessage.replace(/(dikhao|show|bhejo|send|do|de|nikalo|lao|find|get|kahan|where)/gi, '').trim()
                || processedMessage,
            })
            isHandled = true
          } catch (docErr) {
            logger.error('FindDocument internal fail', { userId: user.id }, docErr as Error)
            // Even if it failed, if it reached here it was likely handled or at least tried specifically
            isHandled = true 
          }
          break

        case 'LIST_DOCUMENTS':
          await handleListDocuments({
            userId: user.id,
            phone: cleanFromPhone,
            language: lang,
          })
          isHandled = true
          break

        case 'DELETE_DOCUMENT':
          await handleDeleteDocument({
            userId: user.id,
            phone: cleanFromPhone,
            language: lang,
            query: extractedData?.documentQuery 
              || processedMessage.replace(/(delete|hatao|mitao|remove|remove karo|hata|delete)/gi, '').trim()
              || processedMessage,
          })
          isHandled = true
          break

        case 'GET_BRIEFING':
          await handleGetBriefing({
            userId: user.id,
            phone: cleanFromPhone,
            language: lang,
          })
          isHandled = true
          break

        case 'HELP':
          await sendWhatsAppMessage({ to: cleanFromPhone, message: helpMessage(lang) })
          isHandled = true
          break

        default: 
          break
      }

      // Background context update (non-blocking)
      if (isHandled) {
        try {
          await updateContext(user.id, {
            last_intent: intent,
            last_list_name: extractedData?.listName || ctx.last_list_name || undefined,
            last_document_query: extractedData?.documentQuery || ctx.last_document_query || undefined,
          })
          await addToHistory(user.id, 'user', processedMessage)
        } catch (ctxErr) {
          logger.warn('Session context update failed (silent)', { userId: user.id }, ctxErr as Error)
        }
      } else {
        // Not handled by any feature? Use Auto-Responder
        const autoResp = await generateAutoResponse(cleanFromPhone, cleanToPhone, processedMessage, messageId)
        if (autoResp.response) {
          await addToHistory(user.id, 'user', processedMessage)
          await addToHistory(user.id, 'assistant', autoResp.response)
        }
      }

      // Mark as responded ATOMICALLY
      await supabaseAdmin.from('whatsapp_messages')
        .update({ is_responded: true, response_sent_at: new Date().toISOString() })
        .eq('message_id', messageId)
        .catch((e) => logger.error('Failed to mark as responded', { messageId }, e))

    } catch (featureErr) {
      logger.error('Feature handler error', { userId: user.id, intent }, featureErr as Error)

      if (!isHandled) {
        try {
          await generateAutoResponse(cleanFromPhone, cleanToPhone, processedMessage, messageId)
        } catch (fallbackErr) {
          logger.error('Auto-responder fail', fallbackErr as Error)
        }
      }
    }

    logger.info('✅ Message processed successfully', { userId: user.id, traceId })
    return NextResponse.json({ ok: true })

  } catch (err) {
    logger.error('Webhook error', { traceId }, err as Error)
    return createErrorResponse(err, traceId)
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
