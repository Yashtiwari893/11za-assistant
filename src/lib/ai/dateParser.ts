// src/lib/ai/dateParser.ts
// Natural Language Date/Time Parser — Production-grade
// "kal 11 bje", "har Sunday 9am", "parso shaam" → JavaScript Date

import { getGroqClient } from '@/lib/ai/clients'
import { AI_MODELS, APP } from '@/config'

const DEFAULT_TZ = APP.DEFAULT_TIMEZONE

// ─── TYPES ────────────────────────────────────────────────────
export interface ParsedDateTime {
  date: Date | null
  isRecurring: boolean
  recurrence: 'daily' | 'weekly' | 'monthly' | null
  recurrenceTime: string | null   // "09:00" HH:MM 24-hr format
  confidence: number              // 0-1
  humanReadable: string           // "Tomorrow at 11:00 AM"
}

const EMPTY: ParsedDateTime = {
  date: null,
  isRecurring: false,
  recurrence: null,
  recurrenceTime: null,
  confidence: 0,
  humanReadable: '',
}

// ─── VALID RECURRENCE VALUES ──────────────────────────────────
const VALID_RECURRENCE = new Set(['daily', 'weekly', 'monthly'])

// ─── RECURRENCE TIME VALIDATOR ────────────────────────────────
// Ensures recurrenceTime is always "HH:MM" (zero-padded, 24-hr, valid range).
// Accepts "9:00", "09:00", "21:30", rejects anything malformed.
function normalizeRecurrenceTime(raw: unknown): string {
  if (typeof raw !== 'string') return '09:00'

  // Strip any accidental AM/PM suffix Groq might add
  const cleaned = raw.replace(/\s*(am|pm)$/i, '').trim()
  const parts = cleaned.split(':')
  if (parts.length !== 2) return '09:00'

  const h = parseInt(parts[0], 10)
  const m = parseInt(parts[1], 10)

  if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return '09:00'

  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// ─── EXTRACT TIME FROM REGEX MATCH ───────────────────────────
/**
 * Converts a regex match (capturing hour, optional minute, optional am/pm/bje)
 * into a "HH:MM" 24-hour string, applying Indian cultural AM/PM defaults.
 *
 * @param match - RegExpMatchArray with groups: [full, hour, minute?, period?]
 * @param fullText - The original full string for context inference (subah/shaam etc.)
 */
function extractTime(match: RegExpMatchArray, fullText: string = ''): string {
  let hour = parseInt(match[1], 10)
  const min = parseInt(match[2] ?? '0', 10)
  const ampm = (match[3] ?? '').toLowerCase().trim()

  // Guard: if hour parsed to NaN, return safe default
  if (isNaN(hour)) return '09:00'

  // Explicit 12-hr conversion
  if (ampm === 'pm' && hour < 12) hour += 12
  else if (ampm === 'am' && hour === 12) hour = 0
  else if (ampm === 'bje' || ampm === 'baje' || ampm === 'bajey' || ampm === '') {
    // ── SMART AM/PM INFERENCE (Indian Context) ─────────────────
    // Priority: explicit context words override numeric defaults.
    const lower = fullText.toLowerCase()
    const hasMorning = /\b(subah|morning|savere|pratah)\b/.test(lower)
    const hasAfternoon = /\b(dopahar|duphar|afternoon)\b/.test(lower)
    const hasEvening = /\b(shaam|sham|evening)\b/.test(lower)
    const hasNight = /\b(raat|night)\b/.test(lower)

    if (hasMorning) {
      // Subah → always AM; handle 12 subah = midnight edge case
      if (hour === 12) hour = 0
      // hour already in AM range, no change needed
    } else if (hasAfternoon) {
      // Dopahar → 12-4 range; push to PM
      if (hour !== 12 && hour < 12) hour += 12
    } else if (hasEvening || hasNight) {
      // Shaam/Raat → push to PM unless already ≥ 12
      if (hour < 12) hour += 12
    } else {
      // No context → apply Indian numeric defaults:
      // 1–6   → PM (people say "1 baje" meaning 1 PM, "6 baje" = 6 PM)
      // 7–11  → AM (7 baje = 7 AM, morning default)
      // 12    → PM (noon)
      // 0     → midnight (edge case, keep as-is)
      if (hour >= 1 && hour <= 6) hour += 12
      // 7–11: stays AM, 12: stays PM (noon), 0: stays midnight
    }
  }

  // Clamp to valid range after all transformations
  hour = Math.max(0, Math.min(23, hour))
  const safeMins = isNaN(min) ? 0 : Math.max(0, Math.min(59, min))

  return `${String(hour).padStart(2, '0')}:${String(safeMins).padStart(2, '0')}`
}

// ─── SAFE NOW IST FORMATTER ───────────────────────────────────
// Intl.DateTimeFormat with hour12:false can return "24:xx" for midnight
// in some runtimes. We normalize that to "00:xx".
function formatNowForPrompt(now: Date, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-IN', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(now)

    const get = (type: string) => parts.find(p => p.type === type)?.value ?? '00'
    let hourStr = get('hour')

    // Some environments return "24" for midnight — normalize
    if (hourStr === '24') hourStr = '00'

    return `${get('day')}/${get('month')}/${get('year')} ${hourStr}:${get('minute')}`
  } catch {
    // Fallback: UTC ISO string if Intl fails
    return now.toISOString()
  }
}

// ─── LOCAL QUICK PARSE ────────────────────────────────────────
// Common patterns detect karo without Groq API call.
// Returns null if no pattern matches (falls through to Groq).
function quickParse(text: string): ParsedDateTime | null {
  const lower = text.toLowerCase().trim()
  const now = new Date()

  // ── Relative: "X seconds baad" ────────────────────────────
  const secMatch = lower.match(/(\d+)\s*(?:sec(?:ond)?s?)\s*(?:baad|later|bad)?/)
  if (secMatch) {
    const secs = parseInt(secMatch[1], 10)
    if (secs > 0 && secs <= 86400) {          // cap at 24h for sanity
      const date = new Date(now.getTime() + secs * 1000)
      return {
        ...EMPTY,
        date,
        confidence: 0.95,
        humanReadable: `In ${secs} second${secs !== 1 ? 's' : ''}`,
      }
    }
  }

  // ── Relative: "X minutes baad" ────────────────────────────
  const minMatch = lower.match(/(\d+)\s*(?:min(?:ute)?s?)\s*(?:baad|later|bad)?/)
  if (minMatch) {
    const mins = parseInt(minMatch[1], 10)
    if (mins > 0 && mins <= 1440) {
      const date = new Date(now.getTime() + mins * 60_000)
      return {
        ...EMPTY,
        date,
        confidence: 0.95,
        humanReadable: `In ${mins} minute${mins !== 1 ? 's' : ''}`,
      }
    }
  }

  // ── Relative: "X ghante baad" ─────────────────────────────
  const hrMatch = lower.match(/(\d+)\s*(?:ghante?|hours?|hr)\s*(?:baad|later|bad)?/)
  if (hrMatch) {
    const hrs = parseInt(hrMatch[1], 10)
    if (hrs > 0 && hrs <= 48) {
      const date = new Date(now.getTime() + hrs * 3_600_000)
      return {
        ...EMPTY,
        date,
        confidence: 0.95,
        humanReadable: `In ${hrs} hour${hrs !== 1 ? 's' : ''}`,
      }
    }
  }

  // ── TIME REGEX for recurring patterns ─────────────────────
  // Only match if a time word or digit+period is present (avoid false positives)
  // Pattern: digit(s) + optional :mm + optional period keyword
  const TIME_PATTERN = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|bje|baje|bajey)?\b/

  // ── Recurring: daily ──────────────────────────────────────
  if (/\b(har\s*din|daily|every\s*day|roz)\b/.test(lower)) {
    const timeMatch = lower.match(TIME_PATTERN)
    // Only use timeMatch if the digit looks like a clock hour (1-23)
    const hour = timeMatch ? parseInt(timeMatch[1], 10) : NaN
    const recurrenceTime = (timeMatch && hour >= 1 && hour <= 23)
      ? extractTime(timeMatch, lower)
      : '09:00'
    return {
      ...EMPTY,
      isRecurring: true,
      recurrence: 'daily',
      recurrenceTime,
      confidence: 0.9,
      humanReadable: `Every day at ${recurrenceTime}`,
    }
  }

  // ── Recurring: weekly ─────────────────────────────────────
  if (/\b(har\s*hafta|weekly|every\s*week)\b/.test(lower)) {
    const timeMatch = lower.match(TIME_PATTERN)
    const hour = timeMatch ? parseInt(timeMatch[1], 10) : NaN
    const recurrenceTime = (timeMatch && hour >= 1 && hour <= 23)
      ? extractTime(timeMatch, lower)
      : '09:00'
    return {
      ...EMPTY,
      isRecurring: true,
      recurrence: 'weekly',
      recurrenceTime,
      confidence: 0.9,
      humanReadable: `Every week at ${recurrenceTime}`,
    }
  }

  // ── Recurring: monthly ────────────────────────────────────
  if (/\b(har\s*mahina|monthly|every\s*month)\b/.test(lower)) {
    const timeMatch = lower.match(TIME_PATTERN)
    const hour = timeMatch ? parseInt(timeMatch[1], 10) : NaN
    const recurrenceTime = (timeMatch && hour >= 1 && hour <= 23)
      ? extractTime(timeMatch, lower)
      : '09:00'
    return {
      ...EMPTY,
      isRecurring: true,
      recurrence: 'monthly',
      recurrenceTime,
      confidence: 0.85,
      humanReadable: `Every month at ${recurrenceTime}`,
    }
  }

  return null  // Groq pe jaao
}

// ─── GROQ PROMPT ─────────────────────────────────────────────
function buildPrompt(text: string, nowIST: string, tz: string): string {
  return `Current date/time (IST): ${nowIST}
Timezone: ${tz}

Parse this date/time expression and return ONLY valid JSON with no markdown, no backticks, no explanation.
Expression: "${text}"

Hindi/Hinglish reference:
- kal = tomorrow | aaj = today | parso = day after tomorrow | narsoo = 3 days from now
- subah = morning (default 9 AM) | dopahar = afternoon (default 2 PM) | shaam = evening (default 6 PM) | raat = night (default 9 PM)
- bje / baje / bajey = o'clock (Indian time marker)
- somwar=Monday, mangalwar=Tuesday, budhwar=Wednesday, guruwar=Thursday, shukrawar=Friday, shaniwar=Saturday, raviwar=Sunday
- har din = every day | har hafta = every week | har mahina = every month
- "cal" or "kal" = tomorrow

## CRITICAL AM/PM RULES (Indian Context — apply strictly)
When user says a number with bje/baje/bajey or no period marker:
  - Hours 1–6  → PM (afternoon/evening) UNLESS "subah" is present → then AM
  - Hours 7–11 → AM (morning) UNLESS "shaam" or "raat" is present → then PM
  - Hour 12    → PM (noon) always
  - Hour 0     → AM (midnight)
If user says explicit "am"/"pm" in English, honour it exactly.

## OUTPUT RULES
- isoDateTime MUST include +05:30 IST offset.
- recurrenceTime MUST be "HH:MM" 24-hour zero-padded (e.g. "09:00", "18:30").
- confidence: float 0.0–1.0.
- humanReadable: English phrase describing the parsed time.
- If cannot parse: set isoDateTime=null, confidence=0, humanReadable="".

Output ONLY this JSON object:
{
  "isoDateTime": "2026-04-08T11:00:00+05:30",
  "isRecurring": false,
  "recurrence": null,
  "recurrenceTime": null,
  "confidence": 0.95,
  "humanReadable": "Tomorrow at 11:00 AM"
}`
}

// ─── ADVANCE DATE IF IN PAST ──────────────────────────────────
// Pushes a past date forward to the next valid occurrence (next day, etc.)
// Returns null if still in past after max reasonable adjustments.
function resolveIfPast(parsedDate: Date, now: Date): Date | null {
  const fiveMinAgo = new Date(now.getTime() - 5 * 60_000)
  if (parsedDate >= fiveMinAgo) return parsedDate

  // Try advancing one day (most common case: user said "5 baje" meaning later today but Groq picked yesterday)
  const advanced = new Date(parsedDate.getTime())
  advanced.setDate(advanced.getDate() + 1)

  if (advanced >= fiveMinAgo) {
    console.warn('[dateParser] Past time detected — advanced by 1 day:', {
      original: parsedDate.toISOString(),
      adjusted: advanced.toISOString(),
    })
    return advanced
  }

  // Still in past — don't return stale data
  console.warn('[dateParser] Date still in past after +1 day adjustment — discarding')
  return null
}

// ─── MAIN PARSER ──────────────────────────────────────────────
export async function parseDateTime(
  text: string,
  userTimezone: string = DEFAULT_TZ
): Promise<ParsedDateTime> {

  // ── GUARDRAIL 1: Empty / non-string input ─────────────────
  if (!text || typeof text !== 'string' || !text.trim()) return EMPTY

  const cleanText = text.trim()

  // ── GUARDRAIL 2: Text too long ────────────────────────────
  if (cleanText.length > 300) {
    console.warn('[dateParser] Input too long — returning raw text as humanReadable')
    return { ...EMPTY, humanReadable: cleanText.slice(0, 300) }
  }

  // ── GUARDRAIL 3: Validate timezone ───────────────────────
  const safeTimezone = (() => {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: userTimezone })
      return userTimezone
    } catch {
      console.warn('[dateParser] Invalid timezone, falling back to default:', userTimezone)
      return DEFAULT_TZ
    }
  })()

  // ── Step 1: Try local quick parse first (no API cost) ──────
  const quick = quickParse(cleanText)
  if (quick && quick.confidence >= 0.9) return quick

  // ── Step 2: Groq NLU parse ─────────────────────────────────
  const now = new Date()
  const nowIST = formatNowForPrompt(now, safeTimezone)

  try {
    const response = await getGroqClient().chat.completions.create({
      model: AI_MODELS.DATE_PARSER,
      max_tokens: 200,
      temperature: 0.05,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: buildPrompt(cleanText, nowIST, safeTimezone),
      }],
    })

    const raw = response.choices[0]?.message?.content
    if (!raw) {
      console.warn('[dateParser] Groq returned empty content')
      return { ...EMPTY, humanReadable: cleanText }
    }

    // ── GUARDRAIL 4: Strip accidental markdown fences ─────────
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      console.error('[dateParser] JSON parse failed. Raw Groq output:', raw)
      return { ...EMPTY, humanReadable: cleanText }
    }

    // ── GUARDRAIL 5: Validate confidence (NaN-safe) ───────────
    const rawConfidence = parsed.confidence
    const confidence = (typeof rawConfidence === 'number' && isFinite(rawConfidence))
      ? Math.max(0, Math.min(1, rawConfidence))   // clamp 0-1
      : 0

    // ── GUARDRAIL 6: Parse isoDateTime safely ─────────────────
    let parsedDate: Date | null = null
    if (typeof parsed.isoDateTime === 'string' && parsed.isoDateTime) {
      const candidate = new Date(parsed.isoDateTime)
      if (!isNaN(candidate.getTime())) {
        parsedDate = candidate
      } else {
        console.warn('[dateParser] Groq returned unparseable isoDateTime:', parsed.isoDateTime)
      }
    }

    // ── GUARDRAIL 7: Resolve past dates ───────────────────────
    if (parsedDate) {
      const resolved = resolveIfPast(parsedDate, now)
      if (resolved === null) {
        return { ...EMPTY, humanReadable: cleanText }
      }
      parsedDate = resolved

      // ── GUARDRAIL 8: Future cap (1 year) ───────────────────
      const oneYearAhead = new Date(now.getTime() + 365 * 24 * 3_600_000)
      if (parsedDate > oneYearAhead) {
        console.warn('[dateParser] Date too far in future — discarding:', parsedDate.toISOString())
        return { ...EMPTY, humanReadable: cleanText }
      }
    }

    // ── GUARDRAIL 9: Validate recurrence fields ───────────────
    const recurrence = VALID_RECURRENCE.has(String(parsed.recurrence))
      ? (parsed.recurrence as 'daily' | 'weekly' | 'monthly')
      : null

    const recurrenceTime = (parsed.isRecurring && parsed.recurrenceTime)
      ? normalizeRecurrenceTime(parsed.recurrenceTime)
      : null

    // ── GUARDRAIL 10: Low confidence with no useful data ──────
    if (confidence < 0.3 && !parsedDate && !parsed.isRecurring) {
      console.warn('[dateParser] Low confidence and no date parsed — returning empty')
      return { ...EMPTY, humanReadable: cleanText }
    }

    // ── GUARDRAIL 11: humanReadable safety ───────────────────
    const humanReadable = (typeof parsed.humanReadable === 'string' && parsed.humanReadable.trim())
      ? parsed.humanReadable.trim()
      : cleanText

    return {
      date: parsedDate,
      isRecurring: Boolean(parsed.isRecurring),
      recurrence,
      recurrenceTime,
      confidence,
      humanReadable,
    }

  } catch (err: unknown) {
    // ── GUARDRAIL 12: Categorized error handling ──────────────
    if (err instanceof SyntaxError) {
      console.error('[dateParser] Unexpected SyntaxError during processing')
    } else if (
      typeof err === 'object' && err !== null &&
      'status' in err && (err as { status: number }).status === 429
    ) {
      console.warn('[dateParser] Groq rate limited (429) — consider exponential backoff')
    } else if (
      typeof err === 'object' && err !== null &&
      'status' in err && (err as { status: number }).status >= 500
    ) {
      console.error('[dateParser] Groq server error:', (err as { status: number }).status)
    } else {
      console.error('[dateParser] Unexpected error:', err instanceof Error ? err.message : err)
    }

    return { ...EMPTY, humanReadable: cleanText }
  }
}