// src/lib/autoResponder.ts
// AI Auto-Responder — RAG/general chat fallback, invoked after SAM feature handlers.

import { createClient } from '@supabase/supabase-js'
import { sendWhatsAppMessage } from './whatsappSender'
import Groq from 'groq-sdk'

// ─── Constants ────────────────────────────────────────────────

const CONVERSATION_HISTORY_LIMIT = 10
const MAX_REPLY_TOKENS = 300
const MAX_MESSAGE_LENGTH = 4000       // Groq context safety ceiling
const MAX_PER_MESSAGE_LENGTH = 500    // Per-history-entry truncation
const RECENT_OUTGOING_WINDOW_MS = 10_000
const MIN_PHONE_LENGTH = 10

const ZARA_BASE_RULES = `
You are ZARA, a premium AI assistant for business and life.
- Reply like a professional executive assistant — smart, efficient, polite.
- Use a mix of English and Hindi (Hinglish) as per the user's vibe.
- Keep replies VERY SHORT — 1 to 2 lines max.
- When someone says "done", "ok", or "thanks", reply with a warm professional closing like "Great! Let me know if you need anything else. 😊" or "Noted. Aapki help karke khushi hui! ✅"

━━━━━━━━━━━━━━━━━━━━━━━━━━
STRICT PROTECTION RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━
1. HALLUCINATION PROTECTION: 
   - NEVER say "I have set the reminder" or "Task added" in this chat. 
   - Only the system can set reminders. If the user asks for a reminder here, say: "Please specify the time and title clearly so I can set it for you! 😊"
   - NEVER pretend to have done an action (like deleting or finding a file) that you haven't actually performed.

2. ABUSE/GALI MANAGEMENT:
   - If a user uses abusive language or "Gali" (e.g., sale, kutte, bc, etc.), STAY CALM and PROFESSIONAL.
   - DO NOT repeat the abusive words. For example, if they say "kutta", do NOT say "kutta nahi aaya to kya hua".
   - Simply say: "I'm here to help you professionally. Let's keep our conversation respectful so I can assist you better! 😊"
   - Do not argue or take it personally. Just offer help with features.
`.trim()

const FORBIDDEN_AI_PHRASES =
    /knowledge base|training data|I was trained|my dataset|as an AI language model/i

// ─── Supabase & Groq Clients ──────────────────────────────────

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! })

// ─── Types ────────────────────────────────────────────────────

export interface AutoResponseResult {
    success: boolean
    response?: string
    sent?: boolean
    error?: string
    noDocuments?: boolean
    processed_by?: string
}

interface PhoneConfig {
    systemPrompt: string
    authToken: string
    origin: string
}

interface HistoryMessage {
    role: 'user' | 'assistant'
    content: string
}

// ─── Helpers ──────────────────────────────────────────────────

function normalizePhone(value: string): string {
    return value.replace(/\D/g, '')
}

function safeString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

function truncate(text: string, maxLength: number): string {
    return text.length > maxLength ? `${text.substring(0, maxLength)}...` : text
}

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
    const windowStart = new Date(Date.now() - RECENT_OUTGOING_WINDOW_MS).toISOString()

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
        authToken: process.env.WHATSAPP_AUTH_TOKEN ?? '',
        origin: process.env.WHATSAPP_ORIGIN ?? '',
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
        .limit(CONVERSATION_HISTORY_LIMIT * 2) // Over-fetch, then trim to last N

    return (data ?? [])
        .filter(
            (row) =>
                typeof row.content_text === 'string' &&
                row.content_text.trim().length > 0 &&
                (row.event_type === 'MoMessage' || row.event_type === 'MtMessage')
        )
        .map((row) => ({
            role: row.event_type === 'MoMessage' ? ('user' as const) : ('assistant' as const),
            content: truncate(safeString(row.content_text), MAX_PER_MESSAGE_LENGTH),
        }))
        .slice(-CONVERSATION_HISTORY_LIMIT)
}

async function persistBotMessage(params: {
    botMessageId: string
    fromNumber: string
    toNumber: string
    replyText: string
    originalMessageId: string
}): Promise<void> {
    const { botMessageId, fromNumber, toNumber, replyText, originalMessageId } = params

    const { error } = await supabase.from('whatsapp_messages').insert({
        message_id: botMessageId,
        channel: 'whatsapp',
        from_number: fromNumber,
        to_number: toNumber,
        received_at: new Date().toISOString(),
        content_type: 'text',
        content_text: replyText,
        sender_name: '11za Assistant',
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

// ─── LLM ─────────────────────────────────────────────────────

async function generateLlmReply(params: {
    systemPrompt: string
    history: HistoryMessage[]
    userText: string
}): Promise<string | null> {
    const { systemPrompt, history, userText } = params

    const completion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
            { role: 'system', content: systemPrompt },
            ...history,
            { role: 'user', content: userText },
        ],
        temperature: 0.3,
        max_tokens: MAX_REPLY_TOKENS,
    })

    const raw = completion.choices[0]?.message?.content?.trim()
    if (!raw || raw.length < 2) return null

    return raw.replace(FORBIDDEN_AI_PHRASES, 'available information')
}

// ─── Main ─────────────────────────────────────────────────────

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
        if (cleanFrom.length < MIN_PHONE_LENGTH || cleanTo.length < MIN_PHONE_LENGTH) {
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

        const safeUserText = truncate(userText, MAX_MESSAGE_LENGTH)

        console.log('[autoResponder] From:', cleanFrom, '| To:', cleanTo)

        const phoneConfig = await fetchPhoneConfig(cleanTo)

        // Guard: WhatsApp credentials must be available
        if (!phoneConfig.authToken || !phoneConfig.origin) {
            console.error('[autoResponder] WhatsApp credentials missing')
            return { success: false, error: 'WhatsApp API credentials not configured' }
        }

        const history = await fetchConversationHistory(cleanFrom)
        const systemPrompt = buildSystemPrompt(phoneConfig.systemPrompt)

        const reply = await generateLlmReply({ systemPrompt, history, userText: safeUserText })

        // Guard: non-empty LLM response
        if (!reply) {
            console.warn('[autoResponder] LLM returned empty response')
            return { success: false, error: 'AI returned empty response' }
        }

        const sendResult = await sendWhatsAppMessage(
            cleanFrom,
            reply,
            phoneConfig.authToken,
            phoneConfig.origin
        )

        if (!sendResult.success) {
            console.error('[autoResponder] WhatsApp send failed:', sendResult.error)
            return { success: false, response: reply, sent: false, error: 'WhatsApp send failed' }
        }

        const botMessageId = `auto_${messageId}_${Date.now()}`

        await persistBotMessage({
            botMessageId,
            fromNumber: cleanTo,
            toNumber: cleanFrom,
            replyText: reply,
            originalMessageId: messageId,
        })

        await markMessageAsResponded(messageId)

        console.log('[autoResponder] Response sent successfully')

        return { success: true, response: reply, sent: true }
    } catch (err: unknown) {
        // Guard: Groq rate limit — surface a user-friendly error
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