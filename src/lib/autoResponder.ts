// src/lib/autoResponder.ts
// AI Auto-Responder — RAG/general chat fallback, invoked after feature handlers.

import { getSupabaseClient } from '@/lib/infrastructure/database'
import { getGroqClient } from '@/lib/ai/clients'
import { sendWhatsAppMessage } from '@/lib/whatsapp/client'
import { AI_MODELS, APP, WHATSAPP_AUTH_TOKEN, WHATSAPP_ORIGIN } from '@/config'
import type { AutoResponseResult } from '@/types'

// ─── Constants ────────────────────────────────────────────────

const GROQ_TEMPERATURE = 0.3

const ZARA_BASE_RULES = `
You are ZARA, a premium AI assistant for business and life.
- Reply like a professional executive assistant — smart, efficient, polite.
- Use a mix of English and Hindi (Hinglish) as per the user's vibe.
- Keep replies VERY SHORT — 1 to 2 lines max.
- IDENTITY: If someone asks "Kaun ho" or "AI Chat kya hai", explain that "AI Chat" is a feature where you can talk to ZARA about anything (e.g. general advice, chatting), not just tasks or documents.
- When someone says "done", "ok", or "thanks", reply with a warm professional closing like "Great! Let me know if you need anything else. 😊" or "Noted. Aapki help karke khushi hui! ✅"

━━━━━━━━━━━━━━━━━━━━━━━━━━
STRICT PROTECTION RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━
2. NO EXCUSES / HALLUCINATION PROTECTION:
   - NEVER say "I've added it" or "Sent it" if you didn't just perform that tool action.
   - If data (like a task list) is missing or not found, simply say: "I couldn't find that in your account. Please try clarify the name! 😊"
   - DO NOT make up excuses like "I added it but didn't send it yet".
   - DO NOT guess or hallucinate user data.

3. ABUSE / GALI MANAGEMENT:
   - If a user uses abusive language or "Gali" (e.g., sale, kutte, bc, etc.), STAY CALM and PROFESSIONAL.
   - DO NOT repeat the abusive words. Simply say: "I'm here to help you professionally. Let's keep our conversation respectful so I can assist you better! 😊"
`.trim()

/** Strips AI self-reference phrases that would break the ZARA persona. */
const FORBIDDEN_AI_PHRASE_PATTERN =
  /knowledge base|training data|I was trained|my dataset|as an AI language model/gi

// ─── Clients ──────────────────────────────────────────────────

const supabase = getSupabaseClient()

// ─── Types ────────────────────────────────────────────────────

export type { AutoResponseResult }

interface PhoneConfig {
  systemPrompt: string
  authToken: string
  origin: string
}

interface HistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

interface PersistBotMessageParams {
  botMessageId: string
  fromNumber: string
  toNumber: string
  replyText: string
  originalMessageId: string
}

interface GenerateLlmReplyParams {
  systemPrompt: string
  history: HistoryMessage[]
  userText: string
}

// ─── Pure Helpers ─────────────────────────────────────────────

function normalizePhone(value: string): string {
  return value.replace(/\D/g, '')
}

function safeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.substring(0, maxLength)}...` : text
}

/**
 * Merges the per-phone custom prompt with the shared ZARA base rules.
 * If no custom prompt exists, the base rules are used standalone.
 */
function buildSystemPrompt(phoneSpecificPrompt: string): string {
  return phoneSpecificPrompt
    ? `${phoneSpecificPrompt}\n\n${ZARA_BASE_RULES}`
    : ZARA_BASE_RULES
}

// ─── Database Queries ─────────────────────────────────────────

async function hasAlreadyResponded(messageId: string): Promise<boolean> {
  const { data } = await supabase
    .from('whatsapp_messages')
    .select('id')
    .eq('message_id', messageId)
    .eq('is_responded', true)
    .maybeSingle()

  return !!data
}

async function hasRecentOutgoingMessage(toNumber: string): Promise<boolean> {
  const windowStart = new Date(Date.now() - APP.RECENT_OUTGOING_WINDOW_MS).toISOString()

  const { data } = await supabase
    .from('whatsapp_messages')
    .select('id')
    .eq('to_number', toNumber)
    .eq('event_type', 'MtMessage')
    .gte('received_at', windowStart)
    .limit(1)

  return !!data && data.length > 0
}

async function fetchPhoneConfig(phoneNumber: string): Promise<PhoneConfig> {
  const defaultConfig: PhoneConfig = {
    systemPrompt: '',
    authToken: WHATSAPP_AUTH_TOKEN,
    origin: WHATSAPP_ORIGIN,
  }

  const { data } = await supabase
    .from('phone_document_mapping')
    .select('system_prompt, auth_token, origin')
    .eq('phone_number', phoneNumber)
    .limit(1)

  if (!data || data.length === 0) {
    console.log(`[autoResponder] No DB config for ${phoneNumber} — using environment defaults.`)
    return defaultConfig
  }

  const row = data[0]
  return {
    systemPrompt: safeString(row.system_prompt),
    authToken: safeString(row.auth_token) || defaultConfig.authToken,
    origin: safeString(row.origin) || defaultConfig.origin,
  }
}

async function fetchConversationHistory(fromNumber: string): Promise<HistoryMessage[]> {
  const { data } = await supabase
    .from('whatsapp_messages')
    .select('content_text, event_type')
    .or(`from_number.eq.${fromNumber},to_number.eq.${fromNumber}`)
    .order('received_at', { ascending: true })
    .limit(APP.CONVERSATION_HISTORY_LIMIT * 2) // Over-fetch, then trim to last N

  return (data ?? [])
    .filter(
      (row) =>
        typeof row.content_text === 'string' &&
        row.content_text.trim().length > 0 &&
        (row.event_type === 'MoMessage' || row.event_type === 'MtMessage')
    )
    .map((row) => ({
      role: row.event_type === 'MoMessage' ? ('user' as const) : ('assistant' as const),
      content: truncate(safeString(row.content_text), APP.MAX_PER_MESSAGE_LENGTH),
    }))
    .slice(-APP.CONVERSATION_HISTORY_LIMIT)
}

async function persistBotMessage(params: PersistBotMessageParams): Promise<void> {
  const { botMessageId, fromNumber, toNumber, replyText, originalMessageId } = params

  const { error } = await supabase.from('whatsapp_messages').insert({
    message_id: botMessageId,
    channel: 'whatsapp',
    from_number: fromNumber,
    to_number: toNumber,
    received_at: new Date().toISOString(),
    content_type: 'text',
    content_text: replyText,
    sender_name: APP.BOT_SENDER_NAME,
    event_type: 'MtMessage',
    is_in_24_window: true,
    raw_payload: {
      source: 'auto_responder',
      bot_response: true,
      original_id: originalMessageId,
    },
  })

  if (error) {
    // Message was already delivered — log but don't fail the request.
    console.warn('[autoResponder] Bot message persist failed:', error)
  }
}

async function markMessageAsResponded(messageId: string): Promise<void> {
  await supabase
    .from('whatsapp_messages')
    .update({
      is_responded: true,
      response_sent_at: new Date().toISOString(),
    })
    .eq('message_id', messageId)
}

// ─── LLM ──────────────────────────────────────────────────────

/**
 * Calls the Groq LLM with the assembled prompt and conversation history.
 * Returns the sanitized reply string, or null if the response is empty.
 */
async function generateLlmReply(params: GenerateLlmReplyParams): Promise<string | null> {
  const { systemPrompt, history, userText } = params

  const completion = await getGroqClient().chat.completions.create({
    model: AI_MODELS.AUTO_RESPONDER,
    messages: [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: userText },
    ],
    temperature: GROQ_TEMPERATURE,
    max_tokens: APP.MAX_REPLY_TOKENS,
  })

  const raw = completion.choices[0]?.message?.content?.trim()
  if (!raw || raw.length < 2) return null

  return raw.replace(FORBIDDEN_AI_PHRASE_PATTERN, 'available information')
}

// ─── Main Handler ─────────────────────────────────────────────

export async function generateAutoResponse(
  fromNumber: string,
  toNumber: string,
  messageText: string,
  messageId: string
): Promise<AutoResponseResult> {
  try {
    console.log('[autoResponder] Triggered')

    // Guard: required fields present
    if (!fromNumber || !toNumber || !messageId) {
      return { success: false, error: 'Missing required parameters' }
    }

    const cleanFrom = normalizePhone(fromNumber)
    const cleanTo = normalizePhone(toNumber)

    // Guard: valid phone number format
    if (cleanFrom.length < APP.MIN_PHONE_LENGTH || cleanTo.length < APP.MIN_PHONE_LENGTH) {
      return { success: false, error: 'Invalid phone numbers' }
    }

    // Guard: idempotency — don't reply to a message we've already handled
    if (await hasAlreadyResponded(messageId)) {
      console.log('[autoResponder] Duplicate — already responded to:', messageId)
      return { success: true, response: 'Duplicate prevention — already responded', sent: false }
    }

    // Guard: suppress reply if a bot message was sent in the last 10 seconds
    if (await hasRecentOutgoingMessage(cleanFrom)) {
      console.log('[autoResponder] Recent outgoing message detected — skipping to avoid double reply')
      return { success: true, response: 'Safety skip — recent reply detected', sent: false }
    }

    // Guard: non-empty message body
    const userText = safeString(messageText)
    if (!userText) {
      return { success: false, error: 'Empty message — nothing to respond to' }
    }

    const safeUserText = truncate(userText, APP.MAX_MESSAGE_LENGTH)

    console.log('[autoResponder] From:', cleanFrom, '| To:', cleanTo)

    const phoneConfig = await fetchPhoneConfig(cleanTo)

    // Guard: WhatsApp credentials must be available
    if (!phoneConfig.authToken || !phoneConfig.origin) {
      console.error('[autoResponder] WhatsApp credentials missing')
      return { success: false, error: 'WhatsApp API credentials not configured' }
    }

    // Fetch history and build prompt — history is I/O, prompt is pure
    const history = await fetchConversationHistory(cleanFrom)
    const systemPrompt = buildSystemPrompt(phoneConfig.systemPrompt)

    const reply = await generateLlmReply({ systemPrompt, history, userText: safeUserText })

    // Guard: non-empty LLM response
    if (!reply) {
      console.warn('[autoResponder] LLM returned empty response')
      return { success: false, error: 'AI returned empty response' }
    }

    const sendResult = await sendWhatsAppMessage({
      to: cleanFrom,
      message: reply,
      authToken: phoneConfig.authToken,
      origin: phoneConfig.origin
    })

    if (!sendResult.success) {
      console.error('[autoResponder] WhatsApp send failed:', sendResult.error)
      return { success: false, response: reply, sent: false, error: 'WhatsApp send failed' }
    }

    const botMessageId = `auto_${messageId}_${Date.now()}`

    // Persist the bot's outgoing message and mark the original as handled — run in parallel.
    await Promise.all([
      persistBotMessage({
        botMessageId,
        fromNumber: cleanTo,
        toNumber: cleanFrom,
        replyText: reply,
        originalMessageId: messageId,
      }),
      markMessageAsResponded(messageId),
    ])

    console.log('[autoResponder] Response sent successfully')

    return { success: true, response: reply, sent: true }

  } catch (err: unknown) {
    // Known recoverable error: Groq rate limit
    if (typeof err === 'object' && err !== null && (err as { status?: number }).status === 429) {
      console.warn('[autoResponder] Groq rate limit hit')
      return { success: false, error: 'AI service busy — please try again in a moment' }
    }

    console.error('[autoResponder] Unexpected error:', err)
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}