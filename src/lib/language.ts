// src/lib/ai/detectLanguage.ts
// Language Detection — Fast local first, Groq fallback
// Groq API call bachao — 90% cases local detection se handle ho jaate hain

import Groq from 'groq-sdk'
import type { Language } from '@/lib/whatsapp/templates'

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! })

// ─── LOCAL DETECTION (fast, no API call) ──────────────────────
// Common words se language detect karo — Groq se 100x faster
const GUJARATI_WORDS = /\b(chhe|nathi|karvu|mari|tamaru|ane|thi|pan|chhu|kevi|kem|su|hatu|hati|thay|karo|apo|avu|jao|malo|moko|vaat|kahu|lao|jai)\b/i
const HINDI_WORDS = /\b(hai|hain|nahi|karo|karna|bhai|aaj|kal|mera|meri|aur|ya|jo|ki|ko|se|mein|add|list|reminder|yaad|dilana|subah|shaam|raat|dopahar|accha|theek|bilkul|haan|nahi|wala|wali|kya|kyun|kab|kahan|kaun)\b/i
const GUJARATI_SCRIPT = /[\u0A80-\u0AFF]/  // Gujarati Unicode range
const HINDI_SCRIPT = /[\u0900-\u097F]/  // Devanagari Unicode range
const ENGLISH_ONLY = /^[a-zA-Z0-9\s.,!?'"@#$%&*()\-_+=:;<>/\\[\]{}|~`]+$/

// ─── LANGUAGE MAP ─────────────────────────────────────────────
// Groq response → our Language type
const LANGUAGE_MAP: Record<string, Language> = {
    'english': 'en',
    'hindi': 'hi',
    'gujarati': 'gu',
    'hinglish': 'hi',  // Hinglish → Hindi replies
    'en': 'en',
    'hi': 'hi',
    'gu': 'gu',
}

// ─── LOCAL FAST DETECTION ─────────────────────────────────────
function detectLocally(text: string): Language | null {
    // Script-based detection (most reliable)
    if (GUJARATI_SCRIPT.test(text)) return 'gu'
    if (HINDI_SCRIPT.test(text)) return 'hi'

    // Pure English
    if (ENGLISH_ONLY.test(text)) return 'en'

    // Word-based detection
    if (GUJARATI_WORDS.test(text)) return 'gu'
    if (HINDI_WORDS.test(text)) return 'hi'

    return null  // Confident detection nahi hua — Groq pe jao
}

// ─── MAIN: DETECT LANGUAGE ────────────────────────────────────
export async function detectLanguage(text: string): Promise<Language> {
    // ── GUARDRAIL 1: Empty text ────────────────────────────────
    if (!text || text.trim().length === 0) return 'en'

    const cleanText = text.trim()

    // ── GUARDRAIL 2: Very short text — default en ─────────────
    if (cleanText.length < 3) return 'en'

    // ── Step 1: Try local detection first (FREE + FAST) ────────
    const localResult = detectLocally(cleanText)
    if (localResult) {
        return localResult
    }

    // ── Step 2: Groq fallback for ambiguous text ───────────────
    try {
        const completion = await groq.chat.completions.create({
            model: 'llama3-8b-8192',  // Smaller model — faster + cheaper
            temperature: 0,
            max_tokens: 10,                 // Sirf language name chahiye
            messages: [
                {
                    role: 'system',
                    content: 'Detect the language of the text. Reply with ONLY one word: "english", "hindi", or "gujarati". Nothing else.'
                },
                {
                    role: 'user',
                    content: cleanText.substring(0, 200)  // Pura text nahi — 200 chars kaafi
                }
            ]
        })

        const raw = completion.choices?.[0]?.message?.content
            ?.toLowerCase()
            ?.trim()
            ?.replace(/[^a-z]/g, '')  // Sirf letters

        // ── GUARDRAIL 3: Map to valid Language type ──────────────
        if (raw && LANGUAGE_MAP[raw]) {
            return LANGUAGE_MAP[raw]
        }

        // Partial match karo
        if (raw?.includes('gujarati')) return 'gu'
        if (raw?.includes('hindi')) return 'hi'
        if (raw?.includes('english')) return 'en'

        return 'en'  // Safe default

    } catch (err: any) {
        // ── GUARDRAIL 4: Groq rate limit ────────────────────────
        if (err?.status === 429) {
            console.warn('[detectLanguage] Rate limited — defaulting to en')
        } else {
            console.error('[detectLanguage] Groq failed:', err?.message)
        }
        return 'en'  // Always safe fallback
    }
}

// ─── SYNC VERSION (no API call — for quick checks) ────────────
// Webhook mein jab turant decision chahiye
export function detectLanguageSync(text: string): Language {
    if (!text || text.trim().length === 0) return 'en'
    return detectLocally(text.trim()) ?? 'en'
}