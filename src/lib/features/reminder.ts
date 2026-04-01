// src/lib/features/reminder.ts

import { createClient } from '@supabase/supabase-js'
import { parseDateTime } from '@/lib/ai/dateParser'
import { sendWhatsAppMessage } from '@/lib/whatsapp/client'
import {
  reminderSet,
  reminderList,
  reminderSnoozed,
  errorMessage,
  type Language,
} from '@/lib/whatsapp/templates'

// ─── Constants ────────────────────────────────────────────────

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000
const MIN_LEAD_TIME_MS = 60_000       // 60 seconds
const DEFAULT_SNOOZE_MINUTES = 15
const DUPLICATE_TITLE_MATCH_LENGTH = 20
const REMINDER_LIST_LIMIT = 10

const IST_LOCALE_OPTIONS: Intl.DateTimeFormatOptions = {
  timeZone: 'Asia/Kolkata',
  dateStyle: 'medium',
  timeStyle: 'short',
}

// ─── Supabase Client ──────────────────────────────────────────

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ─── Types ────────────────────────────────────────────────────

interface BaseParams {
  phone: string
  language: Language
}

interface SetReminderParams extends BaseParams {
  userId: string
  message: string
  dateTimeText?: string
  reminderTitle?: string
}

interface ListRemindersParams extends BaseParams {
  userId: string
}

interface SnoozeReminderParams extends BaseParams {
  reminderId?: string
  userId?: string
  minutes?: number
  customText?: string
}

interface CancelReminderParams extends BaseParams {
  userId: string
  titleHint?: string
}

interface MarkDoneParams extends BaseParams {
  reminderId: string
}

// ─── Helpers ──────────────────────────────────────────────────

/**
 * Strips time, date, and filler words from a raw reminder title
 * so that only the meaningful subject remains.
 * Falls back to the original string if the cleaned result is too short.
 */
function cleanReminderTitle(raw: string): string {
  const cleaned = raw
    // Filler / action words
    .replace(/\b(remind|reminder|yaad|dilana|dilao|set|karo|please|bhai|yaar)\b/gi, '')
    // Relative day words (Hindi + English)
    .replace(/\b(kal|aaj|parso|subah|dopahar|shaam|raat|tonight|tomorrow|today)\b/gi, '')
    // Time suffixes
    .replace(/\b(bje|baje|am|pm|AM|PM|o'clock|oclock|baj[ey])\b/gi, '')
    // English weekdays
    .replace(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, '')
    // Hindi weekdays
    .replace(/\b(somwar|mangalwar|budhwar|guruwar|shukrawar|shaniwar|raviwar)\b/gi, '')
    // English month names
    .replace(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/gi, '')
    // Clock time patterns: "11:30"
    .replace(/\b\d{1,2}:\d{2}\b/g, '')
    // Hindi time patterns: "11 bje" / "11 baje"
    .replace(/\b\d{1,2}\s*bje\b/gi, '')
    .replace(/\b\d{1,2}\s*baje\b/gi, '')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim()

  return cleaned.length > 2 ? cleaned : raw.trim()
}

/**
 * Converts a date parsed in IST context to its UTC equivalent.
 * The AI parser treats the user's "12:00 PM" as UTC, so we subtract
 * the IST offset (UTC+5:30) to get the correct UTC timestamp.
 */
function toUtcFromIstParsed(date: Date): Date {
  return new Date(date.getTime() - IST_OFFSET_MS)
}

function formatIst(date: Date): string {
  return date.toLocaleString('en-IN', IST_LOCALE_OPTIONS)
}

async function replyWith(phone: string, message: string): Promise<void> {
  await sendWhatsAppMessage({ to: phone, message })
}

// ─── Set Reminder ─────────────────────────────────────────────

export async function handleSetReminder(params: SetReminderParams): Promise<void> {
  const { userId, phone, language, message, dateTimeText, reminderTitle } = params

  const textToParse = dateTimeText ?? message
  const parsed = await parseDateTime(textToParse)

  // Guard: unparseable date/time
  if (!parsed.date && !parsed.isRecurring) {
    await replyWith(
      phone,
      language === 'hi'
        ? '❓ Kab remind karna hai? Jaise "kal 5 bje" ya "har Sunday 9am"'
        : '❓ When should I remind you? E.g. "tomorrow 5pm" or "every Sunday 9am"'
    )
    return
  }

  // Guard: scheduled time is in the past or too soon
  if (parsed.date) {
    const leadTimeMs = parsed.date.getTime() - Date.now()
    if (leadTimeMs < MIN_LEAD_TIME_MS) {
      await replyWith(
        phone,
        language === 'hi'
          ? '⚠️ Maaf kijiye, par main thik se yaad dilane ke liye kam se kam 1 minute ka waqt leti hoon। Kripya 60 seconds se zyada ka samay chuniye! 😊'
          : "⚠️ I apologize, but I require at least 1 minute's lead time to ensure your reminder is processed accurately. Please set it for at least 60 seconds from now! 😊"
      )
      return
    }
  }

  const title = cleanReminderTitle(reminderTitle ?? message)

  // Guard: title is empty or too short after cleaning
  if (!title || title.length < 2) {
    await replyWith(
      phone,
      language === 'hi'
        ? '❓ Reminder kis cheez ka set karu? Thoda detail mein batao।'
        : '❓ What should I remind you about? Please add a little more detail.'
    )
    return
  }

  // Guard: duplicate reminder with similar title around the same time
  if (parsed.date) {
    const { data: existing } = await supabase
      .from('reminders')
      .select('id, scheduled_at')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .ilike('title', `%${title.substring(0, DUPLICATE_TITLE_MATCH_LENGTH)}%`)
      .gte('scheduled_at', new Date().toISOString())
      .limit(1)

    if (existing && existing.length > 0) {
      const existingTimeFormatted = formatIst(new Date(existing[0].scheduled_at))
      await replyWith(
        phone,
        language === 'hi'
          ? `⚠️ "${title}" ka reminder already set hai — ${existingTimeFormatted} ke liye!\n\nNew reminder chahiye toh thoda alag title likho.`
          : `⚠️ A reminder for "${title}" already exists at ${existingTimeFormatted}!\n\nWrite a slightly different title for a new one.`
      )
      return
    }
  }

  const scheduledAt = parsed.date ? toUtcFromIstParsed(parsed.date).toISOString() : null

  const { error } = await supabase.from('reminders').insert({
    user_id: userId,
    title,
    scheduled_at: scheduledAt,
    recurrence: parsed.recurrence ?? null,
    recurrence_time: parsed.recurrenceTime ?? null,
    status: 'pending',
  })

  if (error) {
    console.error('[reminder] Insert failed:', error)
    await replyWith(phone, errorMessage(language))
    return
  }

  await replyWith(phone, reminderSet(title, parsed.humanReadable, language))
}

// ─── List Reminders ───────────────────────────────────────────

export async function handleListReminders(params: ListRemindersParams): Promise<void> {
  const { userId, phone, language } = params

  const { data, error } = await supabase
    .from('reminders')
    .select('title, scheduled_at, recurrence')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .order('scheduled_at', { ascending: true })
    .limit(REMINDER_LIST_LIMIT)

  if (error) {
    await replyWith(phone, errorMessage(language))
    return
  }

  if (!data || data.length === 0) {
    await replyWith(
      phone,
      language === 'hi'
        ? '📭 Abhi koi pending reminder nahi hai।'
        : '📭 You have no pending reminders.'
    )
    return
  }

  const lines = data
    .map((r, i) => {
      const time = formatIst(new Date(r.scheduled_at))
      const recurrenceTag = r.recurrence ? ` _(${r.recurrence})_` : ''
      return `${i + 1}. *${r.title}*${recurrenceTag}\n    📅 ${time}`
    })
    .join('\n\n')

  const header = language === 'hi' ? '⏰ *Aapke Reminders:*' : '⏰ *Your Reminders:*'
  await replyWith(phone, `${header}\n\n${lines}`)
}

// ─── Snooze Reminder ──────────────────────────────────────────

export async function handleSnoozeReminder(params: SnoozeReminderParams): Promise<void> {
  const { reminderId, userId, phone, language, minutes, customText } = params

  const targetReminderId = await resolveReminderId(reminderId, userId)

  if (!targetReminderId) {
    await replyWith(
      phone,
      language === 'hi'
        ? '🤔 Koi recent reminder nahi mila jise snooze kar saku।'
        : '🤔 No recent reminder found to snooze.'
    )
    return
  }

  let newTime: Date

  if (minutes) {
    newTime = new Date(Date.now() + minutes * 60 * 1000)
  } else if (customText) {
    const parsed = await parseDateTime(customText)

    if (!parsed.date) {
      await replyWith(
        phone,
        language === 'hi'
          ? '❓ Kitne time baad remind karna hai? Jaise "1 ghante baad" ya "shaam 5 bje"'
          : '❓ When should I remind you? E.g. "in 1 hour" or "at 5pm"'
      )
      return
    }

    // Guard: snooze time must be at least 60 seconds away
    if (parsed.date.getTime() - Date.now() < MIN_LEAD_TIME_MS) {
      await replyWith(
        phone,
        language === 'hi'
          ? '⚠️ Maaf kijiye, par main thik se yaad dilane ke liye kam se kam 1 minute ka waqt leti hoon। 😊'
          : "⚠️ I apologize, but I require at least 1 minute's lead time to snooze properly. 😊"
      )
      return
    }

    newTime = parsed.date
  } else {
    newTime = new Date(Date.now() + DEFAULT_SNOOZE_MINUTES * 60 * 1000)
  }

  await supabase
    .from('reminders')
    .update({ scheduled_at: newTime.toISOString(), status: 'pending' })
    .eq('id', targetReminderId)

  await replyWith(phone, reminderSnoozed(formatIst(newTime), language))
}

/**
 * Resolves a reminder ID — returns the provided ID directly, or
 * looks up the most recent sent/pending reminder for the given user.
 */
async function resolveReminderId(
  reminderId: string | undefined,
  userId: string | undefined
): Promise<string | null> {
  if (reminderId) return reminderId

  if (!userId) return null

  const { data } = await supabase
    .from('reminders')
    .select('id')
    .eq('user_id', userId)
    .in('status', ['sent', 'pending'])
    .order('scheduled_at', { ascending: false })
    .limit(1)
    .single()

  return data?.id ?? null
}

// ─── Cancel Reminder ──────────────────────────────────────────

export async function handleCancelReminder(params: CancelReminderParams): Promise<void> {
  const { userId, phone, language, titleHint } = params

  if (titleHint) {
    await cancelByTitleHint({ userId, phone, language, titleHint })
  } else {
    await cancelMostRecent({ userId, phone, language })
  }
}

async function cancelByTitleHint(params: {
  userId: string
  phone: string
  language: Language
  titleHint: string
}): Promise<void> {
  const { userId, phone, language, titleHint } = params

  const { data: found } = await supabase
    .from('reminders')
    .select('id, title')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .ilike('title', `%${titleHint}%`)
    .limit(1)
    .single()

  if (!found) {
    await replyWith(
      phone,
      language === 'hi'
        ? `❓ "${titleHint}" naam ka koi pending reminder nahi mila।`
        : `❓ No pending reminder found matching "${titleHint}".`
    )
    return
  }

  await supabase
    .from('reminders')
    .update({ status: 'cancelled' })
    .eq('id', found.id)

  await replyWith(
    phone,
    language === 'hi'
      ? `🗑️ *${found.title}* reminder cancel ho gaya!`
      : `🗑️ *${found.title}* reminder cancelled!`
  )
}

async function cancelMostRecent(params: {
  userId: string
  phone: string
  language: Language
}): Promise<void> {
  const { userId, phone, language } = params

  const { data: recent } = await supabase
    .from('reminders')
    .select('id, title')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!recent) {
    await replyWith(
      phone,
      language === 'hi'
        ? '📭 Koi pending reminder nahi hai cancel karne ke liye।'
        : '📭 No pending reminders to cancel.'
    )
    return
  }

  await supabase
    .from('reminders')
    .update({ status: 'cancelled' })
    .eq('id', recent.id)

  await replyWith(
    phone,
    language === 'hi'
      ? `🗑️ *${recent.title}* reminder cancel ho gaya!`
      : `🗑️ *${recent.title}* reminder cancelled!`
  )
}

// ─── Mark Done ────────────────────────────────────────────────

export async function handleReminderDone(params: MarkDoneParams): Promise<void> {
  const { reminderId, phone, language } = params

  await supabase
    .from('reminders')
    .update({ status: 'sent' })
    .eq('id', reminderId)

  await replyWith(
    phone,
    language === 'hi' ? '✅ Done mark ho gaya!' : '✅ Marked as done!'
  )
}