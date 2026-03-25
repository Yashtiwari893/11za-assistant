// src/lib/whatsappSender.ts
// WhatsApp Message Sender — 11za.in API — Bulletproof version

const API_BASE = 'https://api.11za.in/apis'
const SEND_MESSAGE_URL = `${API_BASE}/sendMessage/sendMessages`
const SEND_MEDIA_URL = `${API_BASE}/sendMessage/sendMedia`
const SEND_TEMPLATE_URL = `${API_BASE}/template/sendTemplate`

// Timeout — 11za API agar 10 sec mein jawab na de
const REQUEST_TIMEOUT_MS = 10_000

// Max message length — WhatsApp limit 4096 chars
const MAX_MESSAGE_LENGTH = 4000

// ─── TYPES ────────────────────────────────────────────────────
export type SendMessageResult = {
    success: boolean
    error?: string
    response?: unknown
    status?: number
}

export type MediaType = 'image' | 'document' | 'audio' | 'video'

// ─── HELPERS ──────────────────────────────────────────────────
function validateCredentials(authToken: string, origin: string): string | null {
    if (!authToken?.trim()) return 'Auth token is missing'
    if (!origin?.trim()) return 'Origin website is missing'
    return null
}

function validatePhone(phone: string): string | null {
    const cleaned = phone.replace(/\D/g, '')
    if (cleaned.length < 10 || cleaned.length > 15) return 'Invalid phone number'
    return null
}

function truncateMessage(msg: string): string {
    if (msg.length <= MAX_MESSAGE_LENGTH) return msg
    console.warn('[whatsappSender] Message truncated — was', msg.length, 'chars')
    return msg.substring(0, MAX_MESSAGE_LENGTH) + '...'
}

async function fetchWithTimeout(
    url: string,
    options: RequestInit,
    timeoutMs = REQUEST_TIMEOUT_MS
): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
        return await fetch(url, { ...options, signal: controller.signal })
    } finally {
        clearTimeout(timer)
    }
}

// ─── SEND TEXT MESSAGE ────────────────────────────────────────
export async function sendWhatsAppMessage(
    phoneNumber: string,
    message: string,
    authToken: string,
    originWebsite: string
): Promise<SendMessageResult> {
    try {
        // ── GUARDRAIL 1: Credentials check ────────────────────────
        const credErr = validateCredentials(authToken, originWebsite)
        if (credErr) {
            console.error('[whatsappSender]', credErr)
            return { success: false, error: credErr }
        }

        // ── GUARDRAIL 2: Phone validate ────────────────────────────
        const phoneErr = validatePhone(phoneNumber)
        if (phoneErr) {
            console.error('[whatsappSender]', phoneErr, ':', phoneNumber)
            return { success: false, error: phoneErr }
        }

        // ── GUARDRAIL 3: Empty message ─────────────────────────────
        if (!message?.trim()) {
            return { success: false, error: 'Message cannot be empty' }
        }

        // ── GUARDRAIL 4: Message too long ──────────────────────────
        const safeMessage = truncateMessage(message.trim())

        const payload = {
            sendto: phoneNumber.replace(/\D/g, ''),
            authToken: authToken.trim(),
            originWebsite: originWebsite.trim(),
            contentType: 'text',
            text: safeMessage,
        }

        console.log('[whatsappSender] Sending to:', phoneNumber)

        const response = await fetchWithTimeout(SEND_MESSAGE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        })

        const data = await response.json().catch(() => ({}))

        // ── GUARDRAIL 5: API error response ───────────────────────
        if (!response.ok) {
            console.error('[whatsappSender] API error:', response.status, data)

            // 429 Rate limit
            if (response.status === 429) {
                return { success: false, error: '11za rate limit — try again shortly', status: 429 }
            }
            // 401 Unauthorized
            if (response.status === 401) {
                return { success: false, error: 'Invalid 11za auth token', status: 401 }
            }

            return {
                success: false,
                error: `11za API error: ${response.status}`,
                response: data,
                status: response.status
            }
        }

        console.log('[whatsappSender] Sent successfully to:', phoneNumber)
        return { success: true, response: data }

    } catch (err: any) {
        // ── GUARDRAIL 6: Timeout ───────────────────────────────────
        if (err?.name === 'AbortError') {
            console.error('[whatsappSender] Request timeout after', REQUEST_TIMEOUT_MS, 'ms')
            return { success: false, error: '11za API timeout — message may not have sent' }
        }

        console.error('[whatsappSender] Unexpected error:', err?.message)
        return {
            success: false,
            error: err instanceof Error ? err.message : 'Unknown error'
        }
    }
}

// ─── SEND MEDIA MESSAGE ───────────────────────────────────────
// Image, PDF, audio bhejne ke liye — document vault retrieve karte waqt
export async function sendWhatsAppMedia(
    phoneNumber: string,
    mediaUrl: string,
    mediaType: MediaType,
    caption: string,
    authToken: string,
    originWebsite: string
): Promise<SendMessageResult> {
    try {
        // ── GUARDRAIL 1: Credentials + phone ──────────────────────
        const credErr = validateCredentials(authToken, originWebsite)
        const phoneErr = validatePhone(phoneNumber)
        if (credErr) return { success: false, error: credErr }
        if (phoneErr) return { success: false, error: phoneErr }

        // ── GUARDRAIL 2: Media URL validate ───────────────────────
        if (!mediaUrl?.startsWith('http')) {
            return { success: false, error: 'Invalid media URL' }
        }

        const payload = {
            sendto: phoneNumber.replace(/\D/g, ''),
            authToken: authToken.trim(),
            originWebsite: originWebsite.trim(),
            contentType: mediaType,
            url: mediaUrl,
            caption: caption ? truncateMessage(caption) : '',
        }

        const response = await fetchWithTimeout(SEND_MEDIA_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        })

        const data = await response.json().catch(() => ({}))

        if (!response.ok) {
            console.error('[whatsappSender] Media send failed:', response.status, data)
            return { success: false, error: `Media send failed: ${response.status}`, status: response.status }
        }

        console.log('[whatsappSender] Media sent to:', phoneNumber)
        return { success: true, response: data }

    } catch (err: any) {
        if (err?.name === 'AbortError') {
            return { success: false, error: '11za API timeout' }
        }
        console.error('[whatsappSender] Media error:', err?.message)
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
    }
}

// ─── SEND TEMPLATE MESSAGE ────────────────────────────────────
export async function sendWhatsAppTemplate(
    phoneNumber: string,
    templateData: {
        templateId: string
        parameters?: Record<string, string>
    },
    authToken: string,
    originWebsite: string
): Promise<SendMessageResult> {
    try {
        const credErr = validateCredentials(authToken, originWebsite)
        const phoneErr = validatePhone(phoneNumber)
        if (credErr) return { success: false, error: credErr }
        if (phoneErr) return { success: false, error: phoneErr }

        // ── GUARDRAIL: templateId required ────────────────────────
        if (!templateData?.templateId?.trim()) {
            return { success: false, error: 'templateId is required' }
        }

        const payload = {
            sendto: phoneNumber.replace(/\D/g, ''),
            authToken: authToken.trim(),
            originWebsite: originWebsite.trim(),
            templateId: templateData.templateId.trim(),
            parameters: templateData.parameters ?? {},
        }

        const response = await fetchWithTimeout(SEND_TEMPLATE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        })

        const data = await response.json().catch(() => ({}))

        if (!response.ok) {
            console.error('[whatsappSender] Template failed:', response.status, data)
            return { success: false, error: `Template API error: ${response.status}`, status: response.status }
        }

        return { success: true, response: data }

    } catch (err: any) {
        if (err?.name === 'AbortError') {
            return { success: false, error: '11za API timeout' }
        }
        console.error('[whatsappSender] Template error:', err?.message)
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
    }
}