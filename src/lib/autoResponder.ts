// src/lib/autoResponder.ts
// AI Auto Responder — Bulletproof version with guardrails
// Ye RAG/General chat fallback hai — SAM features ke baad call hota hai

import { createClient } from '@supabase/supabase-js'
import { sendWhatsAppMessage } from './whatsappSender'
import Groq from 'groq-sdk'

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! })

// ─── CONSTANTS ────────────────────────────────────────────────
const MAX_HISTORY = 10   // Last N messages for context
const MAX_REPLY_TOKENS = 300
const MAX_MSG_LENGTH = 4000 // Groq context limit safety

// ─── TYPES ────────────────────────────────────────────────────
export type AutoResponseResult = {
    success: boolean
    response?: string
    sent?: boolean
    error?: string
    noDocuments?: boolean
}

// ─── HELPERS ──────────────────────────────────────────────────
function normalizePhone(num: string): string {
    return num.replace(/\D/g, '')
}

function safeString(val: unknown): string {
    return typeof val === 'string' ? val.trim() : ''
}

function truncate(text: string, maxLen: number): string {
    return text.length > maxLen ? text.substring(0, maxLen) + '...' : text
}

// ─── MAIN ─────────────────────────────────────────────────────
export async function generateAutoResponse(
    fromNumber: string,
    toNumber: string,
    messageText: string,
    messageId: string
): Promise<AutoResponseResult> {
    try {
        console.log('[autoResponder] Triggered')

        // ── GUARDRAIL 1: Input validation ─────────────────────────
        if (!fromNumber || !toNumber || !messageId) {
            return { success: false, error: 'Missing required parameters' }
        }

        const cleanFrom = normalizePhone(fromNumber)
        const cleanTo = normalizePhone(toNumber)

        if (cleanFrom.length < 10 || cleanTo.length < 10) {
            return { success: false, error: 'Invalid phone numbers' }
        }

        // ── GUARDRAIL 2: Empty message ────────────────────────────
        const userText = safeString(messageText)
        if (!userText) {
            return { success: false, error: 'Empty message — nothing to respond to' }
        }

        // ── GUARDRAIL 3: Message too long ─────────────────────────
        const safeUserText = truncate(userText, MAX_MSG_LENGTH)

        console.log('[autoResponder] From:', cleanFrom, '| To:', cleanTo)

        // ── 1. PHONE CONFIG ───────────────────────────────────────
        let systemPromptBase = ''
        let auth_token = process.env.WHATSAPP_AUTH_TOKEN ?? ''
        let origin = process.env.WHATSAPP_ORIGIN ?? ''

        // Exact match pehle
        const { data: exactMatch } = await supabaseAdmin
            .from('phone_document_mapping')
            .select('system_prompt, intent, auth_token, origin')
            .eq('phone_number', cleanTo)
            .limit(1)

        // Fallback — koi bhi mapping
        let phoneMappings = exactMatch
        if (!phoneMappings || phoneMappings.length === 0) {
            const { data: fallback } = await supabaseAdmin
                .from('phone_document_mapping')
                .select('system_prompt, intent, auth_token, origin')
                .limit(1)
            phoneMappings = fallback
        }

        if (phoneMappings && phoneMappings.length > 0) {
            const m = phoneMappings[0]
            systemPromptBase = safeString(m.system_prompt)
            auth_token = safeString(m.auth_token) || auth_token
            origin = safeString(m.origin) || origin
        }

        // ── GUARDRAIL 4: WhatsApp credentials check ───────────────
        if (!auth_token || !origin) {
            console.error('[autoResponder] WhatsApp credentials missing')
            return { success: false, error: 'WhatsApp API credentials not configured' }
        }

        // ── 2. CONVERSATION HISTORY ───────────────────────────────
        const { data: historyRows } = await supabaseAdmin
            .from('whatsapp_messages')
            .select('content_text, event_type')
            .or(`from_number.eq.${cleanFrom},to_number.eq.${cleanFrom}`)
            .order('received_at', { ascending: true })
            .limit(MAX_HISTORY * 2) // Extra fetch, filter karenge

        const history = (historyRows ?? [])
            .filter(m =>
                typeof m.content_text === 'string' &&
                m.content_text.trim().length > 0 &&
                (m.event_type === 'MoMessage' || m.event_type === 'MtMessage')
            )
            .map(m => ({
                role: m.event_type === 'MoMessage' ? 'user' as const : 'assistant' as const,
                content: truncate(safeString(m.content_text), 500), // Each message truncate
            }))
            .slice(-MAX_HISTORY) // Last N only

        // ── 3. SYSTEM PROMPT ──────────────────────────────────────
        const baseRules = `You are 11za, a smart and friendly personal assistant on WhatsApp.

STRICT RULES:
- Reply like a helpful human friend — warm, natural, conversational
- Keep replies SHORT — 1 to 3 lines max (WhatsApp style)
- Match the user's language automatically:
  * Clear English → English
  * Hindi script → Hindi
  * Gujarati script → Gujarati
  * Mixed/casual/Roman Hindi → Hinglish
- Answer general knowledge questions naturally
- NEVER mention documents, training data, or knowledge base
- If you don't know something: "Abhi exact info nahi hai 😊 Kuch aur pooch sakte ho!"
- Light emojis OK (1-2 max) — no overuse
- NEVER give long paragraphs or bullet-point lists`.trim()

        const systemPrompt = systemPromptBase
            ? `${systemPromptBase}\n\n${baseRules}`
            : baseRules

        // ── 4. BUILD MESSAGES ─────────────────────────────────────
        const messages = [
            { role: 'system' as const, content: systemPrompt },
            ...history,
            { role: 'user' as const, content: safeUserText },
        ]

        // ── 5. LLM CALL ───────────────────────────────────────────
        const completion = await groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages,
            temperature: 0.3,       // Consistent but not robotic
            max_tokens: MAX_REPLY_TOKENS,
        })

        const reply = completion.choices[0]?.message?.content?.trim()

        // ── GUARDRAIL 5: Empty AI response ────────────────────────
        if (!reply || reply.length < 2) {
            console.warn('[autoResponder] LLM returned empty response')
            return { success: false, error: 'AI returned empty response' }
        }

        // ── GUARDRAIL 6: Forbidden content filter ─────────────────
        const forbidden = /knowledge base|training data|I was trained|my dataset|as an AI language model/i
        const cleanReply = reply.replace(forbidden, 'available information')

        // ── 6. SEND WHATSAPP ──────────────────────────────────────
        const sendResult = await sendWhatsAppMessage(
            cleanFrom,
            cleanReply,
            auth_token,
            origin
        )

        if (!sendResult.success) {
            console.error('[autoResponder] WhatsApp send failed:', sendResult.error)
            return { success: false, response: cleanReply, sent: false, error: 'WhatsApp send failed' }
        }

        // ── 7. SAVE BOT MESSAGE ───────────────────────────────────
        const botMessageId = `auto_${messageId}_${Date.now()}`

        const { error: insertErr } = await supabaseAdmin
            .from('whatsapp_messages')
            .insert({
                message_id: botMessageId,
                channel: 'whatsapp',
                from_number: cleanTo,
                to_number: cleanFrom,
                received_at: new Date().toISOString(),
                content_type: 'text',
                content_text: cleanReply,
                sender_name: '11za Assistant',
                event_type: 'MtMessage',
                is_in_24_window: true,
            })

        if (insertErr) {
            // Message gaya — log karo but fail mat karo
            console.warn('[autoResponder] Bot message save failed:', insertErr)
        }

        // ── 8. MARK ORIGINAL AS RESPONDED ────────────────────────
        await supabaseAdmin
            .from('whatsapp_messages')
            .update({
                is_responded: true,
                response_sent_at: new Date().toISOString(),
            })
            .eq('message_id', messageId)

        console.log('[autoResponder] Response sent successfully')

        return { success: true, response: cleanReply, sent: true }

    } catch (err: any) {
        // ── GUARDRAIL 7: Groq rate limit ──────────────────────────
        if (err?.status === 429) {
            console.warn('[autoResponder] Groq rate limit hit')
            return { success: false, error: 'AI service busy — please try again in a moment' }
        }

        console.error('[autoResponder] Unexpected error:', err)
        return {
            success: false,
            error: err instanceof Error ? err.message : 'Unknown error'
        }
    }
}