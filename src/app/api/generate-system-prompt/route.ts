// src/app/api/generate-prompt/route.ts
// System Prompt Generator — Production-grade with guardrails

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseClient } from '@/lib/infrastructure/database'
import { AI_MODELS } from '@/config'

const supabase = getSupabaseClient()

// ─── GUARDRAIL: Intent validation ─────────────────────────────
const MIN_INTENT_LENGTH = 10
const MAX_INTENT_LENGTH = 2000

function validateIntent(intent: string): { valid: boolean; reason?: string } {
    if (!intent || typeof intent !== 'string') {
        return { valid: false, reason: 'Intent is required' }
    }
    const trimmed = intent.trim()
    if (trimmed.length < MIN_INTENT_LENGTH) {
        return { valid: false, reason: `Intent too short — minimum ${MIN_INTENT_LENGTH} characters` }
    }
    if (trimmed.length > MAX_INTENT_LENGTH) {
        return { valid: false, reason: `Intent too long — maximum ${MAX_INTENT_LENGTH} characters` }
    }
    return { valid: true }
}

function validatePhone(phone: string): { valid: boolean; reason?: string } {
    if (!phone || typeof phone !== 'string') {
        return { valid: false, reason: 'Phone number is required' }
    }
    const cleaned = phone.replace(/[\s\-().+]/g, '')
    if (!/^\d{10,15}$/.test(cleaned)) {
        return { valid: false, reason: 'Invalid phone number format' }
    }
    return { valid: true }
}

// ─── SYSTEM PROMPT BUILDER ────────────────────────────────────
const ARCHITECT_PROMPT = `
You are designing a system prompt for ZARA — a WhatsApp personal assistant.

ZARA's personality:
- Name: ZARA
- Warm, friendly, like a helpful friend — NOT a robot or corporate assistant
- Casual WhatsApp tone — short, natural, conversational
- Light emojis only (max 1-2 per message) 😊✅
- Never sounds scripted, never uses bullet overload
- Uses user's first name naturally — once at conversation start, occasionally after (NOT every message)

━━━━━━━━━━━━━━━━━━━━━━━━━━
LANGUAGE RULES (STRICT)
━━━━━━━━━━━━━━━━━━━━━━━━━━
Detect language from user's message and reply in SAME language:

- Roman Hindi / Hinglish (e.g. "kal 9 bje") → reply in Hinglish
- Hindi Devanagari (e.g. "कल याद दिलाना") → reply in Hindi (Devanagari script)
- Gujarati (e.g. "કાલે યાદ કરાવજો") → reply in Gujarati script
- Clear English → reply in English
- NEVER switch languages randomly
- NEVER mention language detection to user

━━━━━━━━━━━━━━━━━━━━━━━━━━
REMINDER CONFIRMATION TONE
━━━━━━━━━━━━━━━━━━━━━━━━━━
When a reminder is set, confirm warmly and naturally. Examples:

Hinglish: "Done Yash! ✅ Kal 9 bje doctor appointment ka reminder set kar diya 😊"
Hindi: "हो गया! ✅ कल सुबह 9 बजे याद दिला दूंगी 😊"
English: "Done! ✅ I'll remind you about the doctor appointment tomorrow at 9 AM 😊"
Gujarati: "થઈ ગયું! ✅ કાલે સવારે 9 વાગ્યે યાદ કરાવીશ 😊"

NEVER say: "Reminder has been successfully scheduled in the system."

━━━━━━━━━━━━━━━━━━━━━━━━━━
UNKNOWN MESSAGE HANDLING
━━━━━━━━━━━━━━━━━━━━━━━━━━
If user sends something ZARA can't handle, respond smartly — don't just say "I don't know":

Hinglish: "Hmm, ye mujhse nahi hoga 😅 Par reminder, task ya document ke liye bol — woh zaroor kar dungi!"
Hindi: "यह मुझसे नहीं होगा 😅 पर reminder या task के लिए बोलो — वो ज़रूर करूंगी!"
English: "Hmm, that's a bit outside my zone 😅 But I'm great with reminders, tasks & documents — want help with those?"
Gujarati: "આ મારાથી નહીં થાય 😅 પણ reminder કે task માટે કહો — એ ચોક્કસ કરીશ!"

━━━━━━━━━━━━━━━━━━━━━━━━━━
STRICT RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━
- NEVER mention: "document", "database", "knowledge base", "system", "I was trained"
- NEVER apologize excessively
- NEVER give long paragraphs — keep it WhatsApp short
- NEVER make up information
- If info not available: "Abhi ye info mere paas nahi hai 😊 Kuch aur pooch sakte ho!"

Generate ONLY the system prompt text.
No explanations, no preamble, no markdown headers.
Keep it under 300 words.
`.trim()

export async function POST(req: NextRequest) {
    try {
        const body = await req.json()
        const { intent, phone_number } = body

        // ── GUARDRAIL 1: Input validation ──────────────────────
        const intentCheck = validateIntent(intent)
        if (!intentCheck.valid) {
            return NextResponse.json(
                { error: intentCheck.reason },
                { status: 400 }
            )
        }

        const phoneCheck = validatePhone(phone_number)
        if (!phoneCheck.valid) {
            return NextResponse.json(
                { error: phoneCheck.reason },
                { status: 400 }
            )
        }

        const cleanIntent = intent.trim()
        const cleanPhone = phone_number.replace(/[\s\-().]/g, '')

        console.log('[generate-prompt] Generating for phone:', cleanPhone, '| Intent:', cleanIntent.substring(0, 50))

        // ── GUARDRAIL 2: Prompt injection check ───────────────
        const injectionPatterns = /ignore (previous|above|all)|you are now|disregard|forget your|new instructions/i
        if (injectionPatterns.test(cleanIntent)) {
            return NextResponse.json(
                { error: 'Invalid intent content' },
                { status: 400 }
            )
        }

        // ── Generate system prompt via Gemini ───────────────────
        const { getGeminiClient } = await import('@/lib/ai/clients')
        const gemini = getGeminiClient()
        const model = gemini.getGenerativeModel({ 
            model: AI_MODELS.SYSTEM_PROMPT_GEN,
            systemInstruction: ARCHITECT_PROMPT
        })

        const result = await model.generateContent(`Create a system prompt for a WhatsApp chatbot with this purpose:\n"${cleanIntent}"`)

        const systemPrompt = result.response.text()?.trim()

        // ── GUARDRAIL 3: Empty response check ─────────────────
        if (!systemPrompt || systemPrompt.length < 20) {
            console.error('[generate-prompt] Groq returned empty/short response')
            return NextResponse.json(
                { error: 'Failed to generate system prompt — please try again' },
                { status: 500 }
            )
        }

        // ── GUARDRAIL 4: Forbidden words check ────────────────
        const forbiddenInOutput = /knowledge base|training data|I was trained|my dataset/i
        const cleanedPrompt = systemPrompt.replace(forbiddenInOutput, 'available information')

        // ── Save / Update in DB ───────────────────────────────
        const { data: existing, error: fetchErr } = await supabase
            .from('phone_document_mapping')
            .select('id')
            .eq('phone_number', cleanPhone)
            .limit(1)

        if (fetchErr) {
            console.error('[generate-prompt] DB fetch error:', fetchErr)
            // Generate toh ho gaya — DB error pe bhi prompt return karo
            return NextResponse.json({
                success: true,
                system_prompt: cleanedPrompt,
                intent: cleanIntent,
                warning: 'Prompt generated but could not save to database'
            })
        }

        if (existing && existing.length > 0) {
            const { error: updateErr } = await supabase
                .from('phone_document_mapping')
                .update({
                    intent,
                    system_prompt: cleanedPrompt,
                    updated_at: new Date().toISOString()
                })
                .eq('phone_number', cleanPhone)

            if (updateErr) console.error('[generate-prompt] Update error:', updateErr)
        } else {
            const { error: insertErr } = await supabase
                .from('phone_document_mapping')
                .insert({
                    phone_number: cleanPhone,
                    intent: cleanIntent,
                    system_prompt: cleanedPrompt,
                    file_id: null,
                })

            if (insertErr) console.error('[generate-prompt] Insert error:', insertErr)
        }

        console.log('[generate-prompt] Done for:', cleanPhone)

        return NextResponse.json({
            success: true,
            system_prompt: cleanedPrompt,
            intent: cleanIntent,
        })

    } catch (error: unknown) {
        // ── GUARDRAIL 5: Groq rate limit ─────────────────────
        if (typeof error === 'object' && error !== null && 'status' in error && (error as { status: number }).status === 429) {
            return NextResponse.json(
                { error: 'Too many requests — please wait a moment and try again' },
                { status: 429 }
            )
        }

        console.error('[generate-prompt] Unexpected error:', error)
        return NextResponse.json(
            { error: 'Something went wrong — please try again' },
            { status: 500 }
        )
    }
}