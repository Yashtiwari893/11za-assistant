// src/lib/autoResponder.ts
// AI Auto-Responder — RAG/general chat fallback, invoked after feature handlers.

import { getSupabaseClient } from '@/lib/infrastructure/database'
import { geminiCompletion } from '@/lib/ai/provider'
import { sendWhatsAppMessage } from '@/lib/whatsapp/client'
import { getContext } from '@/lib/infrastructure/sessionContext'
import { AI_MODELS, APP, WHATSAPP_AUTH_TOKEN, WHATSAPP_ORIGIN } from '@/config'
import type { AutoResponseResult } from '@/types'

// ─── Constants ────────────────────────────────────────────────

const GROQ_TEMPERATURE = 0.3

const ZARA_BASE_RULES = `
You are ZARA, a warm and intelligent personal assistant on WhatsApp.

## PERSONALITY
- Reply in the SAME language/mix as the user (Hinglish, Hindi, English, or Gujarati).
- Be SHORT — 1 to 3 lines max for most replies. No long paragraphs.
- Be WARM and HUMAN — not robotic or generic.
- Use emojis sparingly (1-2 per message max).
- Address user by name if you know it.

## WHAT ZARA CAN DO (feature list)
1. ⏰ Reminders — "kal 5 baje remind karo"
2. 📋 Lists/Tasks — "grocery mein milk add karo"
3. 📁 Documents — "mera aadhar dikhao" or send a photo/PDF
4. 🌅 Morning Briefing — "aaj ka summary"
5. 💬 General Questions — answer anything!

## CONVERSATIONAL CUES
- If user says "done", "ok", "thanks" → reply warmly: "Great! Aur kuch chahiye? 😊"
- If user says "hi" / "hello" → greet back and ask how to help.
- If user asks what ZARA can do → give the feature list above briefly.

## STRICT RULES
1. NEVER say "I've added it", "I've set it", "I've sent it" if a tool action wasn't just performed.
2. NEVER hallucinate user data. If you don't know → say so honestly.
3. NEVER make excuses. Be direct.
4. NEVER reveal you are an AI model or mention training data.
5. If asked about things outside ZARA's feature scope → answer helpfully but note that ZARA is best at reminders, lists, and documents.

## ABUSE MANAGEMENT
- If abusive language detected → calmly say: "Main yahan professionally help karne ke liye hoon. Respectful baat karein! 😊"
- Do NOT repeat or engage with abusive words.
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

// BUG-12 FIX: Use sessionContext as the ONE unified history source
// whatsapp_messages table misses feature handler responses (reminder set, task added, etc.)
async function fetchConversationHistory(userId: string | undefined, fromNumber: string): Promise<HistoryMessage[]> {
  try {
    // PRIMARY: Use session history (includes feature handler responses)
    const sessionHistory = userId
      ? ((await getContext(userId)).conversation_history || [])
      : []

    if (sessionHistory.length > 0) {
      return sessionHistory
        .slice(-APP.CONVERSATION_HISTORY_LIMIT)
        .map(h => ({
          role: (h.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
          content: String(h.content).substring(0, APP.MAX_PER_MESSAGE_LENGTH)
        }))
    }

    // FALLBACK: whatsapp_messages table (for new users without session history)
    const { data } = await supabase
      .from('whatsapp_messages')
      .select('content_text, event_type')
      .or(`from_number.eq.${fromNumber},to_number.eq.${fromNumber}`)
      .order('received_at', { ascending: true })
      .limit(APP.CONVERSATION_HISTORY_LIMIT * 2)

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
  } catch (err) {
    console.warn('[autoResponder] fetchConversationHistory failed:', (err as Error).message)
    return []
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

  const response = await geminiCompletion(
    [
      { role: 'system', content: systemPrompt },
      ...history as any,
      { role: 'user', content: userText },
    ],
    {
      model: AI_MODELS.AUTO_RESPONDER,
      temperature: GROQ_TEMPERATURE,
      maxTokens: APP.MAX_REPLY_TOKENS,
    }
  )

  const raw = response.content?.trim()
  if (!raw || raw.length < 2) return null

  return raw.replace(FORBIDDEN_AI_PHRASE_PATTERN, 'available information')
}

// ─── Main Handler ─────────────────────────────────────────────

export async function generateAutoResponse(
  fromNumber: string,
  toNumber: string,
  messageText: string,
  messageId: string,
  userId?: string // Optional — used for unified session history (BUG-12 fix)
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
    // Fetch history from unified source (session context if userId available)
    const history = await fetchConversationHistory(userId, cleanFrom)
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

    // Outgoing message is persisted by sendWhatsAppMessage wrapper.
    await markMessageAsResponded(messageId)

    console.log('[autoResponder] Response sent successfully')

    return { success: true, response: reply, sent: true }

  } catch (err: unknown) {
    // Known recoverable error: Gemini quota/rate limit
    if (typeof err === 'object' && err !== null && (err as { status?: number }).status === 429) {
      console.warn('[autoResponder] Gemini quota/rate limit hit')
      return { success: false, error: 'AI service busy or quota exceeded — please check console or try again later' }
    }

    console.error('[autoResponder] Unexpected error:', err)
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}