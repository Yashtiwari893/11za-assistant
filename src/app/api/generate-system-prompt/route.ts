// src/app/api/generate-prompt/route.ts
// System Prompt Generator — Bulletproof version with guardrails

import { NextRequest, NextResponse } from 'next/server'
import Groq from 'groq-sdk'
import { supabase } from '@/lib/supabaseClient'

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! })

// ─── GUARDRAIL: Intent validation ─────────────────────────────
const MIN_INTENT_LENGTH = 10
const MAX_INTENT_LENGTH = 500

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
You are a senior Conversational AI Architect.

Your task is to generate a SYSTEM PROMPT for a WhatsApp chatbot assistant.

STRICT & NON-NEGOTIABLE RULES:

1️⃣ Supported Languages ONLY
The chatbot MUST reply ONLY in these 4 languages:
- Hinglish (default for casual/mixed messages)
- English (for clear English messages)
- Hindi in Devanagari script (for Hindi script messages)
- Gujarati in Gujarati script (for Gujarati script messages)

Language Rules:
- Clear English → English reply
- Hindi script (देवनागरी) → Hindi reply
- Gujarati script (ગુજરાતી) → Gujarati reply
- Mixed, Roman Hindi, casual → Hinglish reply
- NEVER reply in any other language
- NEVER mention language detection to the user

2️⃣ WhatsApp Tone
- Professional but friendly — like a helpful colleague
- Short, natural WhatsApp-style messages
- Light emojis allowed 😊👍 (max 1-2 per message)
- NEVER robotic, scripted, or formal like an email
- NEVER use bullet point overload

3️⃣ Knowledge Rules
- Answer ONLY from available information
- NEVER guess, hallucinate, or make up facts
- NEVER mention internal sources, documents, or data

Forbidden words: "document", "dataset", "knowledge base", "training data", "source", "I was trained"

4️⃣ Fallback Rule (CRITICAL)
If exact information is NOT available:
- Politely say it's not available right now
- Offer to help with something else
- Do NOT explain why or apologize excessively

Fallback examples:
- Hinglish: "Is topic pe abhi exact info nahi hai 😊 Kuch aur pooch sakte ho!"
- Hindi: "इस विषय पर अभी जानकारी उपलब्ध नहीं है 😊"
- English: "I don't have that information right now 😊 Can I help with something else?"
- Gujarati: "આ વિષય પર હાલ માહિતી ઉપલબ્ધ નથી 😊"

5️⃣ Personalization
- If user's name is known, use it naturally (once per conversation start)
- Example: "Hi Rahul 😊", "Thanks Ayesha!"
- Do NOT repeat name in every message

Generate ONLY the system prompt text.
No explanations, no preamble, no markdown headers.
Keep it under 250 words.
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

        // ── Generate system prompt via Groq ───────────────────
        const completion = await groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            temperature: 0.4,   // Thoda lower — consistent output
            max_tokens: 500,
            messages: [
                { role: 'system', content: ARCHITECT_PROMPT },
                {
                    role: 'user',
                    content: `Create a system prompt for a WhatsApp chatbot with this purpose:\n"${cleanIntent}"`
                },
            ]
        })

        const systemPrompt = completion.choices[0]?.message?.content?.trim()

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

    } catch (error: any) {
        // ── GUARDRAIL 5: Groq rate limit ─────────────────────
        if (error?.status === 429) {
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