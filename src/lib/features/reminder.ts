// src/lib/features/reminder.ts
// Reminder CRUD — Production-grade with guardrails

import { getSupabaseClient } from '@/lib/infrastructure/database'
import { parseDateTime } from '@/lib/ai/dateParser'
import { sendWhatsAppMessage } from '@/lib/whatsapp/client'
import {
  reminderSet, reminderList, reminderSnoozed, errorMessage,
} from '@/lib/whatsapp/templates'
import { truncateWhatsAppMessage } from '@/lib/whatsapp/message'
import type { Language } from '@/types'
import { APP } from '@/config'

const supabase = getSupabaseClient()

// ─── TITLE CLEANER ────────────────────────────────────────────

function cleanReminderTitle(raw: string): string {
  let cleaned = raw
    // Action/instruction words
    .replace(/\b(remind|reminder|yaad|dilana|dilao|set|karo|karna|please|bhai|yaar|mujhe|mein|ko|ka|ki|ke)\b/gi, '')
    // Time context words
    .replace(/\b(kal|aaj|parso|subah|dopahar|shaam|raat|tonight|tomorrow|today|cal)\b/gi, '')
    .replace(/\b(bje|baje|bajey|am|pm|AM|PM|o'clock|oclock|baj[ey])\b/gi, '')
    // Days of week
    .replace(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, '')
    .replace(/\b(somwar|mangalwar|budhwar|guruwar|shukrawar|shaniwar|raviwar)\b/gi, '')
    // Months
    .replace(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/gi, '')
    // Structural Hinglish filler
    .replace(/\b(mujhe|main|total|teen|char|ek|do|dusra|teesra|karne|hain|date|hai|aur|wala|wali|pe|par|laga|de|na)\b/gi, '')
    // Time patterns
    .replace(/\b\d{1,2}:\d{2}\b/g, '')
    .replace(/\b\d{1,2}\s*bje\b/gi, '')
    .replace(/\b\d{1,2}\s*baje\b/gi, '')
    .replace(/\b\d{1,2}\s*(am|pm)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()

  // CRITICAL: Cap title length — no sentence-length titles allowed
  if (cleaned.length > 50) {
    cleaned = cleaned.substring(0, 50).replace(/\s+\S*$/, '').trim()
  }

  // If cleaning removed everything, take first 5 meaningful words from original
  if (cleaned.length < 3) {
    const words = raw.split(/\s+/).filter(w =>
      w.length > 2 && !/^(mujhe|mein|karo|karna|set|please|bhai|kal|aaj|hai|ka|ki|ke|ko|do|na|ek|teen|total|hain)$/i.test(w)
    )
    cleaned = words.slice(0, 5).join(' ').trim()
  }

  return cleaned.length > 2 ? cleaned : 'Reminder'
}

// ─── SET REMINDER ─────────────────────────────────────────────

export async function handleSetReminder(params: {
  userId: string
  phone: string
  language: Language
  message: string
  dateTimeText?: string
  reminderTitle?: string
  prefix?: string
}) {
  const { userId, phone, language, message, dateTimeText, reminderTitle, prefix = '' } = params

  const textToParse = dateTimeText ?? message
  const parsed = await parseDateTime(textToParse)

  if (!parsed || !parsed.date && !parsed.isRecurring) {
    await sendWhatsAppMessage({
      to: phone,
      message: prefix + (language === 'hi'
        ? '❓ Maaf kijiye, mujhe time samajh nahi aaya. Kripya sahi se likhein, jaise "kal subah 9 baje" ya "Friday 5 PM".'
        : "❓ Sorry, I couldn't understand the time. Please try something like 'tomorrow 9am' or 'Friday 5pm'.")
    })
    return
  }

  // Guard: Past / Too close (Min 60s)
  if (parsed.date) {
    const diffMs = parsed.date.getTime() - Date.now()
    if (diffMs < APP.MIN_REMINDER_LEAD_TIME_MS) {
      await sendWhatsAppMessage({
        to: phone,
        message: prefix + (language === 'hi'
          ? '⚠️ Maaf kijiye, par main thik se yaad dilane ke liye kam se kam 1 minute ka waqt leti hoon। Kripya 60 seconds se zyada ka samay chuniye! 😊'
          : "⚠️ Sorry, but I need at least 1 minute's gap to set a reminder correctly. Please pick a time at least 60 seconds away! 😊")
      })
      return
    }
  }

  const rawTitle = reminderTitle ?? message
  const title = cleanReminderTitle(rawTitle)

  // Guard: Duplicate check
  if (parsed.date) {
    const { data: existing } = await supabase
      .from('reminders')
      .select('id, scheduled_at')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .ilike('title', `%${title.substring(0, 40)}%`)
      .gte('scheduled_at', new Date().toISOString())
      .limit(1)

    if (existing && existing.length > 0) {
      const existingTime = new Date(existing[0].scheduled_at).toLocaleString('en-IN', {
        timeZone: APP.DEFAULT_TIMEZONE,
        dateStyle: 'medium',
        timeStyle: 'short'
      })
      await sendWhatsAppMessage({
        to: phone,
        message: language === 'hi'
          ? `⚠️ "${title}" ka reminder already set hai — ${existingTime} ke liye!\n\nNew reminder chahiye toh thoda alag title likho.`
          : `⚠️ A reminder for "${title}" already exists at ${existingTime}!\n\nWrite a slightly different title for a new one.`
      })
      return
    }
  }

  // Guard: Title too short
  if (!title || title.length < 3) {
    await sendWhatsAppMessage({
      to: phone,
      message: language === 'hi'
        ? '❓ Reminder kis cheez ka set karu? Thoda detail mein batao।'
        : '❓ What should I remind you about? Please add a little more detail.'
    })
    return
  }

  // Store as UTC — parsed.date already has correct timezone from Groq (+05:30)
  // JS Date.toISOString() automatically converts to UTC
  // DO NOT manually subtract IST offset — that causes double-conversion bug
  let finalScheduledAt: string | null = null
  if (parsed.date) {
    finalScheduledAt = parsed.date.toISOString()
  }

  const { error } = await supabase
    .from('reminders')
    .insert({
      user_id: userId,
      title,
      scheduled_at: finalScheduledAt,
      recurrence: parsed.recurrence ?? null,
      recurrence_time: parsed.recurrenceTime ?? null,
      status: 'pending'
    })

  if (error) {
    console.error('[reminder] Insert failed:', error)
    await sendWhatsAppMessage({ to: phone, message: errorMessage(language) })
    return
  }

  await sendWhatsAppMessage({
    to: phone,
    message: prefix + reminderSet(title, parsed.humanReadable, language)
  })
}

// ─── LIST REMINDERS ───────────────────────────────────────────

export async function handleListReminders(params: {
  userId: string
  phone: string
  language: Language
  prefix?: string
}) {
  const { userId, phone, language, prefix = '' } = params

  const { data, error } = await supabase
    .from('reminders')
    .select('title, scheduled_at, recurrence')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .order('scheduled_at', { ascending: true })
    .limit(10)

  if (error) {
    await sendWhatsAppMessage({ to: phone, message: prefix + errorMessage(language) })
    return
  }

  if (!data || data.length === 0) {
    await sendWhatsAppMessage({
      to: phone,
      message: prefix + (language === 'hi'
        ? '📭 Abhi koi pending reminder nahi hai।'
        : '📭 You have no pending reminders.')
    })
    return
  }

  const reminders = data.map(r => ({
    title: r.title,
    scheduledAt: new Date(r.scheduled_at),
    recurrence: r.recurrence
  }))

  const lines = reminders.map((r, i) => {
    const time = r.scheduledAt.toLocaleString('en-IN', {
      timeZone: APP.DEFAULT_TIMEZONE,
      dateStyle: 'medium',
      timeStyle: 'short'
    })
    const recurTag = r.recurrence ? ` _(${r.recurrence})_` : ''
    return `${i + 1}. *${r.title}*${recurTag}\n    📅 ${time}`
  }).join('\n\n')

  const header = language === 'hi' ? '⏰ *Aapke Reminders:*' : '⏰ *Your Reminders:*'
  await sendWhatsAppMessage({ to: phone, message: prefix + truncateWhatsAppMessage(`${header}\n\n${lines}`) })
}

// ─── SNOOZE REMINDER ──────────────────────────────────────────

export async function handleSnoozeReminder(params: {
  reminderId?: string
  userId?: string
  phone: string
  language: Language
  minutes?: number
  customText?: string
  prefix?: string
}) {
  const { reminderId, userId, phone, language, minutes, customText, prefix = '' } = params
  let targetReminderId = reminderId

  if (!targetReminderId && userId) {
    const { data: recent } = await supabase
      .from('reminders')
      .select('id')
      .eq('user_id', userId)
      .in('status', ['sent', 'pending'])
      .order('scheduled_at', { ascending: false })
      .limit(1)
      .single()

    if (recent) targetReminderId = recent.id
  }

  if (!targetReminderId) {
    await sendWhatsAppMessage({
      to: phone,
      message: prefix + (language === 'hi'
        ? '🤔 Koi recent reminder nahi mila jise snooze kar saku।'
        : '🤔 No recent reminder found to snooze.')
    })
    return
  }

  let newTime: Date

  if (minutes) {
    newTime = new Date(Date.now() + minutes * 60 * 1000)
  } else if (customText) {
    const parsed = await parseDateTime(customText)
    if (!parsed.date) {
      await sendWhatsAppMessage({
        to: phone,
        message: prefix + (language === 'hi'
          ? '❓ Kitne time baad remind karna hai? Jaise "1 ghante baad" ya "shaam 5 bje"'
          : '❓ When should I remind you? E.g. "in 1 hour" or "at 5pm"')
      })
      return
    }
    const diffMs = parsed.date.getTime() - Date.now()
    if (diffMs < APP.MIN_REMINDER_LEAD_TIME_MS) {
      await sendWhatsAppMessage({
        to: phone,
        message: prefix + (language === 'hi'
          ? '⚠️ Maaf kijiye, par main thik se yaad dilane ke liye kam se kam 1 minute ka waqt leti hoon। 😊'
          : "⚠️ Sorry, I need at least a 1-minute delay to snooze properly. 😊")
      })
      return
    }
    newTime = parsed.date
  } else {
    newTime = new Date(Date.now() + 15 * 60 * 1000) // default 15 min
  }

  await supabase
    .from('reminders')
    .update({ scheduled_at: newTime.toISOString(), status: 'pending' })
    .eq('id', targetReminderId)

  const humanReadable = newTime.toLocaleString('en-IN', {
    timeZone: APP.DEFAULT_TIMEZONE,
    timeStyle: 'short',
    dateStyle: 'short'
  })

  await sendWhatsAppMessage({
    to: phone,
    message: prefix + reminderSnoozed(humanReadable, language)
  })
}

// ─── CANCEL REMINDER ──────────────────────────────────────────

export async function handleCancelReminder(params: {
  userId: string
  phone: string
  language: Language
  titleHint?: string
  prefix?: string
}) {
  const { userId, phone, language, titleHint, prefix = '' } = params

  if (titleHint) {
    const { data: found } = await supabase
      .from('reminders')
      .select('id, title')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .ilike('title', `%${titleHint}%`)
      .limit(1)
      .single()

    if (!found) {
      await sendWhatsAppMessage({
        to: phone,
        message: prefix + (language === 'hi'
          ? `❓ "${titleHint}" naam ka koi pending reminder nahi mila।`
          : `❓ No pending reminder found matching "${titleHint}".`)
      })
      return
    }

    await supabase.from('reminders').update({ status: 'cancelled' }).eq('id', found.id)

    await sendWhatsAppMessage({
      to: phone,
      message: prefix + (language === 'hi'
        ? `🗑️ *${found.title}* reminder cancel ho gaya!`
        : `🗑️ *${found.title}* reminder cancelled!`)
    })
    return
  }

  const { data: recent } = await supabase
    .from('reminders')
    .select('id, title')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!recent) {
    await sendWhatsAppMessage({
      to: phone,
      message: prefix + (language === 'hi'
        ? '📭 Koi pending reminder nahi hai cancel karne ke liye।'
        : '📭 No pending reminders to cancel.')
    })
    return
  }

  await supabase.from('reminders').update({ status: 'cancelled' }).eq('id', recent.id)

  await sendWhatsAppMessage({
    to: phone,
    message: prefix + (language === 'hi'
      ? `🗑️ *${recent.title}* reminder cancel ho gaya!`
      : `🗑️ *${recent.title}* reminder cancelled!`)
  })
}

// ─── MARK DONE ────────────────────────────────────────────────

export async function handleReminderDone(params: {
  reminderId: string
  phone: string
  language: Language
  prefix?: string
}) {
  const { reminderId, phone, language, prefix = '' } = params

  await supabase.from('reminders').update({ status: 'sent' }).eq('id', reminderId)

  await sendWhatsAppMessage({
    to: phone,
    message: prefix + (language === 'hi' ? '✅ Done mark ho gaya!' : '✅ Marked as done!')
  })
}