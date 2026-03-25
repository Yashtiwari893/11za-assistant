// src/lib/speechToText.ts
// Voice Note → Text using Groq Whisper — Bulletproof version

import Groq from 'groq-sdk'
import fs from 'fs'
import path from 'path'

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! })

// Supported audio formats by Groq Whisper
const SUPPORTED_FORMATS = ['ogg', 'mp3', 'mp4', 'wav', 'webm', 'm4a', 'flac']

// Max file size Groq accepts — 25MB
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024

export interface STTResult {
    text: string
    language: string   // Groq detect nahi karta — hum message context se guess karenge
    durationEstimate?: string
}

/**
 * Voice Note → Text using Groq Whisper
 * 11za API key se authenticated download
 */
export async function speechToText(audioUrl: string, authToken?: string): Promise<STTResult | null> {
    let audioPath: string | null = null

    try {
        // ── GUARDRAIL 1: URL valid hai? ───────────────────────────
        if (!audioUrl || !audioUrl.startsWith('http')) {
            console.error('[STT] Invalid audio URL:', audioUrl)
            return null
        }

        console.log('[STT] Downloading audio:', audioUrl)

        // ── Download with 11za Auth header ───────────────────────
        const token = authToken || process.env.ELEVEN_ZA_API_KEY
        const headers: Record<string, string> = {}
        if (token) {
            headers['Authorization'] = `Bearer ${token}`
        }

        const res = await fetch(audioUrl, { headers })

        // ── GUARDRAIL 2: Download fail check ──────────────────────
        if (!res.ok) {
            console.error(`[STT] Download failed: ${res.status} ${res.statusText}`)
            return null
        }

        const buffer = Buffer.from(await res.arrayBuffer())

        // ── GUARDRAIL 3: Empty file check ─────────────────────────
        if (buffer.length === 0) {
            console.error('[STT] Downloaded file is empty')
            return null
        }

        // ── GUARDRAIL 4: File size check (max 25MB) ───────────────
        if (buffer.length > MAX_FILE_SIZE_BYTES) {
            console.error(`[STT] File too large: ${buffer.length} bytes`)
            return null
        }

        // ── Determine file extension ──────────────────────────────
        const contentType = res.headers.get('content-type') ?? ''
        const ext = getExtensionFromContentType(contentType)

        audioPath = path.join('/tmp', `voice-${Date.now()}.${ext}`)
        fs.writeFileSync(audioPath, buffer)

        console.log(`[STT] Audio saved: ${audioPath} (${(buffer.length / 1024).toFixed(1)} KB)`)

        // ── GUARDRAIL 5: Supported format check ───────────────────
        if (!SUPPORTED_FORMATS.includes(ext)) {
            console.error(`[STT] Unsupported format: ${ext}`)
            cleanup(audioPath)
            return null
        }

        // ── Groq Whisper transcription ────────────────────────────
        const transcription = await groq.audio.transcriptions.create({
            file: fs.createReadStream(audioPath),
            model: 'whisper-large-v3',
            // response_format: 'verbose_json',  // language detect ke liye — but Groq mein abhi nahi
        })

        cleanup(audioPath)
        audioPath = null

        const text = transcription.text?.trim()

        // ── GUARDRAIL 6: Empty transcription ──────────────────────
        if (!text || text.length === 0) {
            console.warn('[STT] Transcription returned empty text')
            return null
        }

        // ── GUARDRAIL 7: Noise-only filter ────────────────────────
        // Whisper kabhi kabhi noise ko "..." ya "[Music]" transcribe karta hai
        const noisePatterns = /^(\[.*?\]|\.{2,}|uh+|um+|hmm+|\s*)$/i
        if (noisePatterns.test(text)) {
            console.warn('[STT] Transcription looks like noise:', text)
            return null
        }

        console.log(`[STT] Transcribed: "${text.substring(0, 80)}..."`)

        // Language guess — Groq nahi deta, hum Hindi/Gujarati words se guess karenge
        const language = guessLanguage(text)

        return { text, language }

    } catch (err) {
        console.error('[STT] Groq Whisper failed:', err)
        if (audioPath) cleanup(audioPath)
        return null
    }
}

// ─── HELPERS ──────────────────────────────────────────────────

function cleanup(filePath: string) {
    try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    } catch {
        // Ignore cleanup errors
    }
}

function getExtensionFromContentType(contentType: string): string {
    const map: Record<string, string> = {
        'audio/ogg': 'ogg',
        'audio/mpeg': 'mp3',
        'audio/mp4': 'm4a',
        'audio/wav': 'wav',
        'audio/webm': 'webm',
        'audio/x-wav': 'wav',
        'audio/flac': 'flac',
        'video/mp4': 'mp4',
        'application/ogg': 'ogg',
    }
    return map[contentType.split(';')[0].trim()] ?? 'ogg'  // default ogg (WhatsApp standard)
}

function guessLanguage(text: string): string {
    // Hindi common words
    const hindiWords = /\b(karo|karna|bhai|aaj|kal|mera|meri|hai|hain|nahi|aur|ya|jo|ki|ko|se|me|mein|add|list|reminder|yaad)\b/i
    // Gujarati common words
    const gujaratiWords = /\b(chhe|nathi|karvu|mari|tamaru|ane|ke|ma|thi|pan)\b/i

    if (gujaratiWords.test(text)) return 'gu'
    if (hindiWords.test(text)) return 'hi'
    return 'en'
}