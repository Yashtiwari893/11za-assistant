// src/lib/features/reminder.ts
// Reminder CRUD — 5 Guardrails ke saath bulletproof version

import { createClient } from '@supabase/supabase-js'
import { parseDateTime } from '@/lib/ai/dateParser'
import { sendWhatsAppMessage } from '@/lib/whatsapp/client'
import {
  reminderSet, reminderList, reminderSnoozed, errorMessage,
  type Language
} from '@/lib/whatsapp/templates'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ─── TITLE CLEANER ────────────────────────────────────────────
// Title se time/date words hata deta hai
function cleanReminderTitle(raw: string): string {
  const cleaned = raw
    .replace(/\b(remind|reminder|yaad|dilana|dilao|set|karo|please|bhai|yaar)\b/gi, '')
    .replace(/\b(kal|aaj|parso|subah|dopahar|shaam|raat|tonight|tomorrow|today)\b/gi, '')
    .replace(/\b(bje|baje|am|pm|AM|PM|o'clock|oclock|baj[ey])\b/gi, '')
    .replace(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, '')
    .replace(/\b(somwar|mangalwar|budhwar|guruwar|shukrawar|shaniwar|raviwar)\b/gi, '')
    .replace(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/gi, '')
    .replace(/\b\d{1,2}:\d{2}\b/g, '')   // "11:30" hata do
    .replace(/\b\d{1,2}\s*bje\b/gi, '')  // "11 bje" hata do
    .replace(/\b\d{1,2}\s*baje\b/gi, '') // "11 baje" hata do
    .replace(/\s+/g, ' ')
    .trim()

  // Agar cleaning ke baad kuch nahi bacha toh original return karo
  return cleaned.length > 2 ? cleaned : raw.trim()
}

// ─── SET REMINDER ─────────────────────────────────────────────
export async function handleSetReminder(params: {
  userId: string
  phone: string
  language: Language
  message: string
  dateTimeText?: string
  reminderTitle?: string
}) {
  const { userId, phone, language, message, dateTimeText, reminderTitle } = params

  // Parse natural language date/time
  const textToParse = dateTimeText ?? message
  const parsed = await parseDateTime(textToParse)

  // ── GUARDRAIL: Date parse hi nahi hua ─────────────────────
  if (!parsed.date && !parsed.isRecurring) {
    await sendWhatsAppMessage({
      to: phone,
      message: language === 'hi'
        ? '❓ Kab remind karna hai? Jaise "kal 5 bje" ya "har Sunday 9am"'
        : '❓ When should I remind you? E.g. "tomorrow 5pm" or "every Sunday 9am"'
    })
    return
  }

  // ── GUARDRAIL 1: Past time check ──────────────────────────
  if (parsed.date && parsed.date < new Date()) {
    await sendWhatsAppMessage({
      to: phone,
      message: language === 'hi'
        ? '⚠️ Ye time toh nikal gaya! Aage ka time batao।'
        : '⚠️ That time has already passed! Please give a future time.'
    })
    return
  }

  // ── GUARDRAIL 2: Minimum 2 minutes future ─────────────────
  const minTime = new Date(Date.now() + 2 * 60 * 1000)
  if (parsed.date && parsed.date < minTime) {
    await sendWhatsAppMessage({
      to: phone,
      message: language === 'hi'
        ? '⚠️ Kam se kam 2 minute aage ka time do!'
        : '⚠️ Please set a reminder at least 2 minutes in the future!'
    })
    return
  }

  // ── Title — extracted ya cleaned ──────────────────────────
  const rawTitle = reminderTitle ?? message
  const title = cleanReminderTitle(rawTitle)

  // ── GUARDRAIL 3: Duplicate check ──────────────────────────
  if (parsed.date) {
    const { data: existing } = await supabase
      .from('reminders')
      .select('id, scheduled_at')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .ilike('title', `%${title.substring(0, 20)}%`)  // pehle 20 chars match karo
      .gte('scheduled_at', new Date().toISOString())
      .limit(1)

    if (existing && existing.length > 0) {
      const existingTime = new Date(existing[0].scheduled_at).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
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

  // ── GUARDRAIL 4: Title too short ya empty ─────────────────
  if (!title || title.length < 2) {
    await sendWhatsAppMessage({
      to: phone,
      message: language === 'hi'
        ? '❓ Reminder kis cheez ka set karu? Thoda detail mein batao।'
        : '❓ What should I remind you about? Please add a little more detail.'
    })
    return
  }

  // ── Save to Supabase ───────────────────────────────────────
  const { error } = await supabase
    .from('reminders')
    .insert({
      user_id: userId,
      title,
      scheduled_at: parsed.date?.toISOString() ?? null,
      recurrence: parsed.recurrence ?? null,
      recurrence_time: parsed.recurrenceTime ?? null,  // GUARDRAIL 5: recurring fix
      status: 'pending'
    })

  if (error) {
    console.error('[reminder] Insert failed:', error)
    await sendWhatsAppMessage({ to: phone, message: errorMessage(language) })
    return
  }

  // ── Confirm to user ────────────────────────────────────────
  await sendWhatsAppMessage({
    to: phone,
    message: reminderSet(title, parsed.humanReadable, language)
  })
}

// ─── LIST REMINDERS ───────────────────────────────────────────
export async function handleListReminders(params: {
  userId: string
  phone: string
  language: Language
}) {
  const { userId, phone, language } = params

  const { data, error } = await supabase
    .from('reminders')
    .select('title, scheduled_at, recurrence')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .order('scheduled_at', { ascending: true })
    .limit(10)

  if (error) {
    await sendWhatsAppMessage({ to: phone, message: errorMessage(language) })
    return
  }

  if (!data || data.length === 0) {
    await sendWhatsAppMessage({
      to: phone,
      message: language === 'hi'
        ? '📭 Abhi koi pending reminder nahi hai।'
        : '📭 You have no pending reminders.'
    })
    return
  }

  const reminders = data.map(r => ({
    title: r.title,
    scheduledAt: new Date(r.scheduled_at),
    recurrence: r.recurrence
  }))

  // Format list
  const lines = reminders.map((r, i) => {
    const time = r.scheduledAt.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'medium',
      timeStyle: 'short'
    })
    const recurTag = r.recurrence ? ` _(${r.recurrence})_` : ''
    return `${i + 1}. *${r.title}*${recurTag}\n    📅 ${time}`
  }).join('\n\n')

  const header = language === 'hi' ? '⏰ *Aapke Reminders:*' : '⏰ *Your Reminders:*'
  await sendWhatsAppMessage({ to: phone, message: `${header}\n\n${lines}` })
}

// ─── SNOOZE REMINDER ──────────────────────────────────────────
export async function handleSnoozeReminder(params: {
  reminderId?: string
  userId?: string
  phone: string
  language: Language
  minutes?: number
  customText?: string
}) {
  const { reminderId, userId, phone, language, minutes, customText } = params

  let targetReminderId = reminderId

  // No reminderId — most recent pending/sent reminder dhundo
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
      message: language === 'hi'
        ? '🤔 Koi recent reminder nahi mila jise snooze kar saku।'
        : '🤔 No recent reminder found to snooze.'
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
        message: language === 'hi'
          ? '❓ Kitne time baad remind karna hai? Jaise "1 ghante baad" ya "shaam 5 bje"'
          : '❓ When should I remind you? E.g. "in 1 hour" or "at 5pm"'
      })
      return
    }
    // ── Snooze past time check ──
    if (parsed.date < new Date()) {
      await sendWhatsAppMessage({
        to: phone,
        message: language === 'hi'
          ? '⚠️ Ye time nikal gaya! Aage ka time do।'
          : '⚠️ That time has passed! Give a future time.'
      })
      return
    }
    newTime = parsed.date
  } else {
    newTime = new Date(Date.now() + 15 * 60 * 1000) // default 15 min
  }

  // Update reminder
  await supabase
    .from('reminders')
    .update({
      scheduled_at: newTime.toISOString(),
      status: 'pending'
    })
    .eq('id', targetReminderId)

  const humanReadable = newTime.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    timeStyle: 'short',
    dateStyle: 'short'
  })

  await sendWhatsAppMessage({
    to: phone,
    message: reminderSnoozed(humanReadable, language)
  })
}

// ─── CANCEL REMINDER ──────────────────────────────────────────
export async function handleCancelReminder(params: {
  userId: string
  phone: string
  language: Language
  titleHint?: string   // user ne kaunsa cancel karna hai hint diya
}) {
  const { userId, phone, language, titleHint } = params

  // Agar title hint hai toh match karke cancel karo
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
        message: language === 'hi'
          ? `❓ "${titleHint}" naam ka koi pending reminder nahi mila।`
          : `❓ No pending reminder found matching "${titleHint}".`
      })
      return
    }

    await supabase
      .from('reminders')
      .update({ status: 'cancelled' })
      .eq('id', found.id)

    await sendWhatsAppMessage({
      to: phone,
      message: language === 'hi'
        ? `🗑️ *${found.title}* reminder cancel ho gaya!`
        : `🗑️ *${found.title}* reminder cancelled!`
    })
    return
  }

  // No hint — most recent cancel karo
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
      message: language === 'hi'
        ? '📭 Koi pending reminder nahi hai cancel karne ke liye।'
        : '📭 No pending reminders to cancel.'
    })
    return
  }

  await supabase
    .from('reminders')
    .update({ status: 'cancelled' })
    .eq('id', recent.id)

  await sendWhatsAppMessage({
    to: phone,
    message: language === 'hi'
      ? `🗑️ *${recent.title}* reminder cancel ho gaya!`
      : `🗑️ *${recent.title}* reminder cancelled!`
  })
}

// ─── MARK DONE ────────────────────────────────────────────────
export async function handleReminderDone(params: {
  reminderId: string
  phone: string
  language: Language
}) {
  const { reminderId, phone, language } = params

  await supabase
    .from('reminders')
    .update({ status: 'sent' })
    .eq('id', reminderId)

  await sendWhatsAppMessage({
    to: phone,
    message: language === 'hi' ? '✅ Done mark ho gaya!' : '✅ Marked as done!'
  })
}