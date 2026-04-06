// src/lib/ai/dateParser.ts
// Natural Language Date/Time Parser — Production-grade
// "kal 11 bje", "har Sunday 9am", "parso shaam" → JavaScript Date

import { getGeminiClient } from '@/lib/ai/clients'
import { AI_MODELS, APP } from '@/config'

const DEFAULT_TZ = APP.DEFAULT_TIMEZONE

// ─── TYPES ────────────────────────────────────────────────────
export interface ParsedDateTime {
  date: Date | null
  isRecurring: boolean
  recurrence: 'daily' | 'weekly' | 'monthly' | null
  recurrenceTime: string | null   // "09:00" HH:MM format
  confidence: number          // 0-1
  humanReadable: string          // "Tomorrow at 11:00 AM"
}

const EMPTY: ParsedDateTime = {
  date: null,
  isRecurring: false,
  recurrence: null,
  recurrenceTime: null,
  confidence: 0,
  humanReadable: '',
}

// ─── LOCAL QUICK PARSE ────────────────────────────────────────
// Common patterns detect karo without Groq API call
function quickParse(text: string): ParsedDateTime | null {
  const lower = text.toLowerCase().trim()
  const now = new Date()

  // "X seconds baad" / "X sec baad"
  const secMatch = lower.match(/(\d+)\s*(sec|second|seconds)\s*(baad|later|bad)?/)
  if (secMatch) {
    const secs = parseInt(secMatch[1])
    if (secs > 0) {
      const date = new Date(now.getTime() + secs * 1000)
      return { ...EMPTY, date, confidence: 0.95, humanReadable: `In ${secs} second${secs > 1 ? 's' : ''}` }
    }
  }

  // "X minutes baad" / "X min baad"
  const minMatch = lower.match(/(\d+)\s*(min|minute|minutes)\s*(baad|later|bad)?/)
  if (minMatch) {
    const mins = parseInt(minMatch[1])
    if (mins > 0 && mins <= 1440) {
      const date = new Date(now.getTime() + mins * 60_000)
      return { ...EMPTY, date, confidence: 0.95, humanReadable: `In ${mins} minute${mins > 1 ? 's' : ''}` }
    }
  }

  // "X ghante baad" / "X hour baad"
  const hrMatch = lower.match(/(\d+)\s*(ghante?|hour|hr)\s*(baad|later|bad)?/)
  if (hrMatch) {
    const hrs = parseInt(hrMatch[1])
    if (hrs > 0 && hrs <= 48) {
      const date = new Date(now.getTime() + hrs * 3_600_000)
      return { ...EMPTY, date, confidence: 0.95, humanReadable: `In ${hrs} hour${hrs > 1 ? 's' : ''}` }
    }
  }

  // Recurring: "har din" / "daily" / "everyday"
  if (/\b(har\s*din|daily|every\s*day|roz)\b/.test(lower)) {
    const timeMatch = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|bje|baje)?/)
    const recurrenceTime = timeMatch ? extractTime(timeMatch, lower) : '09:00'
    return { ...EMPTY, isRecurring: true, recurrence: 'daily', recurrenceTime, confidence: 0.9, humanReadable: `Every day at ${recurrenceTime}` }
  }

  // Recurring: "har hafta" / "weekly"
  if (/\b(har\s*hafta|weekly|every\s*week)\b/.test(lower)) {
    const timeMatch = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|bje|baje)?/)
    const recurrenceTime = timeMatch ? extractTime(timeMatch, lower) : '09:00'
    return { ...EMPTY, isRecurring: true, recurrence: 'weekly', recurrenceTime, confidence: 0.9, humanReadable: `Every week at ${recurrenceTime}` }
  }

  // Recurring: "har mahina" / "monthly"
  if (/\b(har\s*mahina|monthly|every\s*month)\b/.test(lower)) {
    const recurrenceTime = '09:00'
    return { ...EMPTY, isRecurring: true, recurrence: 'monthly', recurrenceTime, confidence: 0.85, humanReadable: `Every month` }
  }

  return null  // Groq pe jaao
}

function extractTime(match: RegExpMatchArray, fullText?: string): string {
  let hour = parseInt(match[1])
  const min = parseInt(match[2] ?? '0')
  const ampm = (match[3] ?? '').toLowerCase()

  if (ampm === 'pm' && hour < 12) hour += 12
  if (ampm === 'am' && hour === 12) hour = 0

  // ─── SMART AM/PM INFERENCE for bje/baje (Indian context) ────
  // When user says "2 baje" without am/pm, apply cultural defaults:
  // - "subah" (morning) context → AM
  // - "shaam/raat" context → PM
  // - No context: 1-5 → PM (afternoon), 6-11 → AM (morning), 12 → PM
  if (ampm === 'bje' || ampm === 'baje' || ampm === 'bajey' || !ampm) {
    const lower = (fullText || '').toLowerCase()
    const hasMorning = /\b(subah|morning|savere|pratah)\b/.test(lower)
    const hasEvening = /\b(shaam|sham|evening|raat|night|dopahar|afternoon)\b/.test(lower)

    if (hasMorning && hour <= 12) {
      // Keep as-is (AM)
    } else if (hasEvening && hour < 12) {
      hour += 12
    } else if (!hasMorning && !hasEvening) {
      // Default Indian context: 1-5 = PM (afternoon), 6-11 = AM, 12 = PM
      if (hour >= 1 && hour <= 5) hour += 12
      // 6-11 stay as AM, 12 stays as PM (noon)
    }
  }

  return `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

// ─── GROQ PROMPT ─────────────────────────────────────────────
function buildPrompt(text: string, nowIST: string, tz: string): string {
  return `Current date/time (IST): ${nowIST}
Timezone: ${tz}

Parse this date/time expression and return ONLY valid JSON. No explanation.
Expression: "${text}"

Hindi/Hinglish reference:
- kal = tomorrow | aaj = today | parso = day after tomorrow
- subah = morning (default 9 AM) | dopahar = afternoon (2 PM) | shaam = evening (6 PM) | raat = night (9 PM)
- bje / baje = o'clock
- somwar=Monday, mangalwar=Tuesday, budhwar=Wednesday, guruwar=Thursday, shukrawar=Friday, shaniwar=Saturday, raviwar=Sunday
- har din = every day | har hafta = every week | har mahina = every month
- har Sunday/Monday etc = weekly recurring on that day
- "cal" = kal = tomorrow

## CRITICAL AM/PM RULES (Indian Context)
- If user says just a number like "2 baje" or "5 bje" WITHOUT am/pm:
  - Hours 1-5 → default to PM (afternoon) unless "subah" is mentioned
  - Hours 6-11 → default to AM (morning) unless "shaam/raat" is mentioned  
  - 12 baje → default to PM (noon)
- "subah 6 baje" = 6:00 AM | "shaam 6 baje" = 6:00 PM
- "dopahar 2 baje" = 2:00 PM | "raat 9 baje" = 9:00 PM
- ALWAYS output isoDateTime with +05:30 offset (IST)

Output format:
{
  "isoDateTime": "2024-03-23T14:00:00+05:30",
  "isRecurring": false,
  "recurrence": null,
  "recurrenceTime": null,
  "confidence": 0.95,
  "humanReadable": "Tomorrow at 2:00 PM"
}

For recurring reminders:
{ "isoDateTime": null, "isRecurring": true, "recurrence": "weekly", "recurrenceTime": "14:00", "confidence": 0.9, "humanReadable": "Every week at 2:00 PM" }

If cannot parse at all:
{ "isoDateTime": null, "isRecurring": false, "recurrence": null, "recurrenceTime": null, "confidence": 0, "humanReadable": "" }`
}

// ─── MAIN PARSER ──────────────────────────────────────────────
export async function parseDateTime(
  text: string,
  userTimezone: string = DEFAULT_TZ
): Promise<ParsedDateTime> {

  // ── GUARDRAIL 1: Empty text ────────────────────────────────
  if (!text?.trim()) return EMPTY

  const cleanText = text.trim()

  // ── GUARDRAIL 2: Text too long ────────────────────────────
  if (cleanText.length > 300) {
    return { ...EMPTY, humanReadable: cleanText }
  }

  // ── Step 1: Try local quick parse first (no API cost) ──────
  const quick = quickParse(cleanText)
  if (quick && quick.confidence >= 0.9) return quick

  // ── Step 2: Gemini NLU parse ─────────────────────────────────
  const now = new Date()
  const nowIST = new Intl.DateTimeFormat('en-IN', {
    timeZone: userTimezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(now)

  try {
    const gemini = getGeminiClient()
    const model = gemini.getGenerativeModel({ 
        model: AI_MODELS.DATE_PARSER,
        generationConfig: {
            temperature: 0.05,
            maxOutputTokens: 200,
            responseMimeType: "application/json"
        }
    })

    const prompt = buildPrompt(cleanText, nowIST, userTimezone)
    
    const result = await model.generateContent(prompt)
    const raw = result.response.text()
    const parsed = JSON.parse(raw)

    // ── GUARDRAIL 3: Validate parsed result ───────────────────
    const parsedDate = parsed.isoDateTime ? new Date(parsed.isoDateTime) : null

    // ── GUARDRAIL 4: Date in valid range ──────────────────────
    if (parsedDate) {
      const oneYearAhead = new Date(now.getTime() + 365 * 24 * 3_600_000)
      const fiveMinAgo = new Date(now.getTime() - 5 * 60_000)

      if (parsedDate < fiveMinAgo) {
        // Groq ne past time parse kiya — tomorrow assume karo
        console.warn('[dateParser] Past time parsed — adjusting to tomorrow')
        parsedDate.setDate(parsedDate.getDate() + 1)
      }

      if (parsedDate > oneYearAhead) {
        console.warn('[dateParser] Date too far in future — ignoring')
        return { ...EMPTY, humanReadable: cleanText }
      }
    }

    // ── GUARDRAIL 5: Recurrence validate ─────────────────────
    const validRecurrence = ['daily', 'weekly', 'monthly']
    const recurrence = validRecurrence.includes(parsed.recurrence)
      ? parsed.recurrence
      : null

    // ── GUARDRAIL 6: Confidence threshold ────────────────────
    const confidence = Number(parsed.confidence ?? 0)
    if (confidence < 0.3 && !parsedDate && !parsed.isRecurring) {
      return { ...EMPTY, humanReadable: cleanText }
    }

    return {
      date: parsedDate,
      isRecurring: Boolean(parsed.isRecurring),
      recurrence,
      recurrenceTime: parsed.recurrenceTime ?? null,
      confidence,
      humanReadable: parsed.humanReadable || cleanText,
    }

  } catch (err: unknown) {
    // ── GUARDRAIL 7: JSON parse fail ─────────────────────────
    const error = err instanceof Error ? err : new Error('Unknown error')
    if (error instanceof SyntaxError) {
      console.error('[dateParser] JSON parse failed — Groq returned invalid JSON')
    } else if (typeof err === 'object' && err !== null && 'status' in err && (err as { status: number }).status === 429) {
      console.warn('[dateParser] Groq rate limited')
    } else {
      console.error('[dateParser] Groq parsing failed:', error.message)
    }

    return { ...EMPTY, humanReadable: cleanText }
  }
}