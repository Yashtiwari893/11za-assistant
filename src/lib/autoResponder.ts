// src/lib/autoResponder.ts
// AI Auto-Responder — RAG/general chat fallback, invoked after feature handlers.

import { getSupabaseClient } from '@/lib/infrastructure/database'
import { getGroqClient } from '@/lib/ai/clients'
import { sendWhatsAppMessage } from '@/lib/whatsapp/client'
import { getContext } from '@/lib/infrastructure/sessionContext'
import { AI_MODELS, APP, WHATSAPP_AUTH_TOKEN, WHATSAPP_ORIGIN } from '@/config'
import type { AutoResponseResult } from '@/types'

// ─── Constants ────────────────────────────────────────────────

const GROQ_TEMPERATURE = 0.3

// How long (ms) to wait for Groq before aborting — prevents webhook timeouts
const LLM_TIMEOUT_MS = 12_000

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
  documentContext?: string   // RAG — injected doc snippets if relevant
}

// ─── Pure Helpers ─────────────────────────────────────────────

function normalizePhone(value: string): string {
  return value.replace(/\D/g, '')
}

function safeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.substring(0, maxLength)}…` : text
}

/**
 * Merges ZARA base rules with optional per-phone custom prompt.
 *
 * ORDER MATTERS for LLMs: base rules go FIRST as the foundation,
 * custom prompt goes AFTER as additive context/persona tweaks.
 * This ensures STRICT RULES always dominate (recency bias).
 *
 * BUG FIX: was previously reversed — custom prompt was first,
 * so it could silently override STRICT RULES.
 */
function buildSystemPrompt(phoneSpecificPrompt: string, documentContext?: string): string {
  const parts: string[] = [ZARA_BASE_RULES]

  if (phoneSpecificPrompt) {
    parts.push(`## ADDITIONAL CONTEXT FOR THIS ACCOUNT\n${phoneSpecificPrompt}`)
  }

  if (documentContext) {
    parts.push(
      `## RELEVANT DOCUMENTS (use these to answer the user's question)\n${documentContext}\n` +
      `Important: Only use the above document context if it is relevant. Do NOT fabricate document content.`
    )
  }

  return parts.join('\n\n')
}

// ─── Database Queries ─────────────────────────────────────────

/**
 * Atomic idempotency check + lock using upsert.
 * Returns true if we successfully claimed this messageId (should process).
 * Returns false if another worker already claimed it (skip).
 *
 * BUG FIX: The old check+mark pattern had a race condition — two concurrent
 * webhook calls could both pass hasAlreadyResponded() before either marked it.
 * This upsert approach is atomic: only one worker wins.
 */
async function claimMessageForProcessing(messageId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('whatsapp_messages')
    .update({ is_responded: true, response_sent_at: new Date().toISOString() })
    .eq('message_id', messageId)
    .eq('is_responded', false) // Truly atomic: only update if it was false
    .select('id')
    .maybeSingle()

  if (error) {
    console.warn('[autoResponder] claimMessageForProcessing error:', error.message)
    return false
  }

  // data will only exist if the update actually matched a row (i.e., we won the race)
  return !!data
}

/**
 * Reverts the claimed lock if sending ultimately failed.
 * Allows safe retry on next webhook delivery.
 */
async function releaseMessageClaim(messageId: string): Promise<void> {
  await supabase
    .from('whatsapp_messages')
    .update({ is_responded: false, response_sent_at: null })
    .eq('message_id', messageId)
}

async function hasRecentOutgoingMessage(toUserPhone: string): Promise<boolean> {
  // BUG FIX: Was using raw fromNumber (un-normalized). Now uses normalized phone.
  // We check if bot already sent a message TO this user recently.
  const windowStart = new Date(Date.now() - APP.RECENT_OUTGOING_WINDOW_MS).toISOString()

  const { data } = await supabase
    .from('whatsapp_messages')
    .select('id')
    .eq('to_number', toUserPhone)          // normalized phone
    .eq('event_type', 'MtMessage')         // MtMessage = Mobile Terminated = bot → user
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

  try {
    const { data, error } = await supabase
      .from('phone_document_mapping')
      .select('system_prompt, auth_token, origin')
      .eq('phone_number', phoneNumber)
      .limit(1)

    if (error) {
      console.warn('[autoResponder] fetchPhoneConfig DB error:', error.message)
      return defaultConfig
    }

    if (!data || data.length === 0) {
      console.log(`[autoResponder] No DB config for ${phoneNumber} — using defaults.`)
      return defaultConfig
    }

    const row = data[0]
    return {
      systemPrompt: safeString(row.system_prompt),
      authToken: safeString(row.auth_token) || defaultConfig.authToken,
      origin: safeString(row.origin) || defaultConfig.origin,
    }
  } catch (err) {
    console.warn('[autoResponder] fetchPhoneConfig unexpected error:', (err as Error).message)
    return defaultConfig
  }
}

/**
 * Fetches conversation history from unified source.
 *
 * BUG FIX: Fallback DB query was using raw fromNumber (with + and spaces)
 * instead of normalized phone — causing silent empty results.
 *
 * BUG FIX: Added deduplication to prevent overlap between session and DB sources.
 */
async function fetchConversationHistory(
  userId: string | undefined,
  normalizedFromPhone: string,   // Already normalized — explicit param name to prevent re-use of raw
): Promise<HistoryMessage[]> {
  try {
    // PRIMARY: Session context (includes feature handler responses like reminder confirmations)
    if (userId) {
      const ctx = await getContext(userId)
      const sessionHistory: HistoryMessage[] = (ctx.conversation_history ?? [])
        .slice(-APP.CONVERSATION_HISTORY_LIMIT)
        .map(h => ({
          role: (h.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
          content: truncate(String(h.content || ''), APP.MAX_PER_MESSAGE_LENGTH),
        }))
        .filter(h => h.content.length > 0)

      if (sessionHistory.length > 0) return sessionHistory
    }

    // FALLBACK: whatsapp_messages table
    // Uses normalizedFromPhone — BUG FIX (was raw fromNumber before)
    const { data, error } = await supabase
      .from('whatsapp_messages')
      .select('content_text, event_type')
      .or(`from_number.eq.${normalizedFromPhone},to_number.eq.${normalizedFromPhone}`)
      .order('received_at', { ascending: true })
      .limit(APP.CONVERSATION_HISTORY_LIMIT * 2)

    if (error) {
      console.warn('[autoResponder] History DB query error:', error.message)
      return []
    }

    // Deduplicate consecutive messages with same role+content (session/DB overlap)
    const messages: HistoryMessage[] = []
    let lastKey = ''

    for (const row of data ?? []) {
      if (
        typeof row.content_text !== 'string' ||
        !row.content_text.trim() ||
        (row.event_type !== 'MoMessage' && row.event_type !== 'MtMessage')
      ) continue

      const role: 'user' | 'assistant' = row.event_type === 'MoMessage' ? 'user' : 'assistant'
      const content = truncate(safeString(row.content_text), APP.MAX_PER_MESSAGE_LENGTH)
      const key = `${role}:${content}`

      if (key !== lastKey) {
        messages.push({ role, content })
        lastKey = key
      }
    }

    return messages.slice(-APP.CONVERSATION_HISTORY_LIMIT)

  } catch (err) {
    console.warn('[autoResponder] fetchConversationHistory failed:', (err as Error).message)
    return []
  }
}

// ─── LLM ──────────────────────────────────────────────────────

/**
 * Calls Groq with a timeout (AbortController).
 *
 * BUG FIX: No timeout previously — Groq hangs would cause webhook timeouts
 * and the user would get no response at all.
 */
async function generateLlmReply(params: GenerateLlmReplyParams): Promise<string | null> {
  const { systemPrompt, history, userText, documentContext } = params

  // Inject document context into the last user message if available
  // (More reliable than a separate system block for RAG grounding)
  const finalUserContent = documentContext
    ? `${userText}\n\n[Relevant context provided separately in system prompt]`
    : userText

  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort()
    console.warn('[autoResponder] LLM call timed out after', LLM_TIMEOUT_MS, 'ms')
  }, LLM_TIMEOUT_MS)

  try {
    const completion = await getGroqClient().chat.completions.create(
      {
        model: AI_MODELS.AUTO_RESPONDER,
        messages: [
          { role: 'system', content: systemPrompt },
          ...history,
          { role: 'user', content: finalUserContent },
        ],
        temperature: GROQ_TEMPERATURE,
        max_tokens: APP.MAX_REPLY_TOKENS,
      },
      { signal: controller.signal }   // Pass abort signal to Groq SDK
    )

    const raw = completion.choices[0]?.message?.content?.trim()
    if (!raw || raw.length < 2) return null

    return raw.replace(FORBIDDEN_AI_PHRASE_PATTERN, 'available information')

  } finally {
    clearTimeout(timeout)
  }
}

// ─── Main Handler ─────────────────────────────────────────────

export async function generateAutoResponse(
  fromNumber: string,
  toNumber: string,
  messageText: string,
  messageId: string,
  userId?: string,
  documentContext?: string,   // RAG — injected by caller if a doc query was detected
): Promise<AutoResponseResult> {
  try {
    console.log('[autoResponder] Triggered for messageId:', messageId)

    // ── Guard: required fields ────────────────────────────────
    if (!fromNumber || !toNumber || !messageId) {
      return { success: false, error: 'Missing required parameters' }
    }

    const cleanFrom = normalizePhone(fromNumber)
    const cleanTo   = normalizePhone(toNumber)

    // ── Guard: valid phone length ─────────────────────────────
    if (cleanFrom.length < APP.MIN_PHONE_LENGTH || cleanTo.length < APP.MIN_PHONE_LENGTH) {
      return { success: false, error: 'Invalid phone numbers' }
    }

    // ── Guard: non-empty message ──────────────────────────────
    const userText = safeString(messageText)
    if (!userText) {
      return { success: false, error: 'Empty message — nothing to respond to' }
    }

    // ── Guard: idempotency (atomic claim — fixes race condition) ──
    // claimMessageForProcessing does check+mark atomically.
    // If claim fails (already processed), bail out immediately.
    const claimed = await claimMessageForProcessing(messageId)
    if (!claimed) {
      console.log('[autoResponder] Duplicate or already claimed:', messageId)
      return { success: true, response: 'Duplicate prevention', sent: false }
    }

    // ── Guard: suppress if bot sent something very recently ───
    // BUG FIX: now uses cleanFrom (normalized) consistently
    if (await hasRecentOutgoingMessage(cleanFrom)) {
      console.log('[autoResponder] Recent outgoing message — releasing claim and skipping')
      await releaseMessageClaim(messageId)   // Release so it can be retried if needed
      return { success: true, response: 'Safety skip — recent reply detected', sent: false }
    }

    const safeUserText = truncate(userText, APP.MAX_MESSAGE_LENGTH)

    console.log('[autoResponder] From:', cleanFrom, '| To:', cleanTo)

    // ── Fetch config and history in parallel ──────────────────
    const [phoneConfig, history] = await Promise.all([
      fetchPhoneConfig(cleanTo),
      fetchConversationHistory(userId, cleanFrom),   // BUG FIX: pass normalized phone
    ])

    // ── Guard: WhatsApp credentials ───────────────────────────
    if (!phoneConfig.authToken || !phoneConfig.origin) {
      console.error('[autoResponder] WhatsApp credentials missing for:', cleanTo)
      await releaseMessageClaim(messageId)
      return { success: false, error: 'WhatsApp API credentials not configured' }
    }

    // Build prompt — base rules dominate (BUG FIX: order corrected)
    const systemPrompt = buildSystemPrompt(phoneConfig.systemPrompt, documentContext)

    // ── LLM call with timeout ─────────────────────────────────
    let reply: string | null
    try {
      reply = await generateLlmReply({ systemPrompt, history, userText: safeUserText, documentContext })
    } catch (llmErr: unknown) {
      const isAbort = llmErr instanceof Error && llmErr.name === 'AbortError'
      console.error('[autoResponder] LLM error:', isAbort ? 'Timed out' : (llmErr as Error).message)
      await releaseMessageClaim(messageId)
      return {
        success: false,
        error: isAbort ? 'AI response timed out — please try again' : 'AI generation failed',
      }
    }

    // ── Guard: non-empty LLM response ─────────────────────────
    if (!reply) {
      console.warn('[autoResponder] LLM returned empty response')
      await releaseMessageClaim(messageId)
      return { success: false, error: 'AI returned empty response' }
    }

    // ── Send WhatsApp message ─────────────────────────────────
    const sendResult = await sendWhatsAppMessage({
      to: cleanFrom,
      message: reply,
      authToken: phoneConfig.authToken,
      origin: phoneConfig.origin,
    })

    if (!sendResult.success) {
      console.error('[autoResponder] WhatsApp send failed:', sendResult.error)
      // BUG FIX: Release the claim so the message can be retried on next webhook delivery
      await releaseMessageClaim(messageId)
      return { success: false, response: reply, sent: false, error: 'WhatsApp send failed' }
    }

    // Claim stays locked (message successfully processed)
    console.log('[autoResponder] Response sent successfully for:', messageId)
    return { success: true, response: reply, sent: true }

  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null && (err as { status?: number }).status === 429) {
      console.warn('[autoResponder] Groq rate limit hit (429)')
      return { success: false, error: 'AI service busy — please try again in a moment' }
    }

    console.error('[autoResponder] Unexpected error:', err)
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}