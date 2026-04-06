// src/lib/language.ts
// Language Detection — Fast local first, Gemini fallback

import { getGeminiClient } from '@/lib/ai/clients'
import { AI_MODELS } from '@/config'
import type { Language } from '@/types'

// ─── LOCAL DETECTION (fast, no API call) ──────────────────────
// Common words se language detect karo — Groq se 100x faster
const GUJARATI_WORDS = /\b(chhe|nathi|karvu|mari|tamaru|ane|thi|pan|chhu|kevi|kem|su|hatu|hati|thay|karo|apo|avu|jao|malo|moko|vaat|kahu|lao|jai)\b/i
const HINDI_WORDS = /\b(hai|hain|nahi|karo|karna|bhai|aaj|kal|mera|meri|aur|ya|jo|ki|ko|se|mein|add|list|reminder|yaad|dilana|subah|shaam|raat|dopahar|accha|theek|bilkul|haan|nahi|wala|wali|kya|kyun|kab|kahan|kaun)\b/i
const GUJARATI_SCRIPT = /[\u0A80-\u0AFF]/  // Gujarati Unicode range
const HINDI_SCRIPT = /[\u0900-\u097F]/  // Devanagari Unicode range
const ENGLISH_ONLY = /^[a-zA-Z0-9\s.,!?'"@#$%&*()\-_+=:;<>/\\[\]{}|~`]+$/

// ─── LANGUAGE MAP ─────────────────────────────────────────────
// Gemini response → our Language type
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
    // Script-based detection (most reliable — unicode script)
    if (GUJARATI_SCRIPT.test(text)) return 'gu'
    if (HINDI_SCRIPT.test(text)) return 'hi'

    // BUG-13 FIX: Check Hindi/Gujarati WORDS before ENGLISH_ONLY
    // Hinglish is written in English alphabets but has Hindi words
    // Previously ENGLISH_ONLY check fired first → returned 'en' for Hinglish
    if (GUJARATI_WORDS.test(text)) return 'gu'
    if (HINDI_WORDS.test(text)) return 'hi'

    // Pure English (only after eliminating Hindi/Gujarati)
    if (ENGLISH_ONLY.test(text)) return 'en'

    return null  // Confident detection nahi hua — Gemini pe jao
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

    // ── Step 2: Gemini fallback for ambiguous text ───────────────
    try {
        const gemini = getGeminiClient()
        const model = gemini.getGenerativeModel({ 
            model: AI_MODELS.LANGUAGE_DETECT,
            generationConfig: {
                temperature: 0,
                maxOutputTokens: 10,
            }
        })

        const prompt = `Detect the language of the text below. Reply with ONLY one word: "english", "hindi", or "gujarati". Nothing else.\n\nText: ${cleanText.substring(0, 200)}`
        
        const result = await model.generateContent(prompt)
        const raw = result.response.text()
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

    } catch (err: unknown) {
        // ── GUARDRAIL 4: Gemini failure ────────────────────────
        const error = err as { status?: number; message?: string }
        console.error('[detectLanguage] Gemini failed:', error?.message)
        return 'en'  // Always safe fallback
    }
}

// ─── SYNC VERSION (no API call — for quick checks) ────────────
// Webhook mein jab turant decision chahiye
export function detectLanguageSync(text: string): Language {
    if (!text || text.trim().length === 0) return 'en'
    return detectLocally(text.trim()) ?? 'en'
}