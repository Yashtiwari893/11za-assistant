import { NextResponse } from 'next/server'
import { getSupabaseClient } from '@/lib/infrastructure/database'
import { sendWhatsAppMessage } from '@/lib/whatsapp/client'
import type { Language, DueReminderRow } from '@/types'

const supabase = getSupabaseClient()

function isAuthorizedCronRequest(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return false

  const xCronSecret = req.headers.get('x-cron-secret')
  if (xCronSecret && xCronSecret === cronSecret) return true

  const authHeader = req.headers.get('authorization')
  if (authHeader === `Bearer ${cronSecret}`) return true

  const url = new URL(req.url)
  if (url.searchParams.get('secret') === cronSecret) return true

  return false
}

async function processReminders(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Primary query expects the latest view shape.
    const primary = await supabase
      .from('due_reminders_view')
      .select('reminder_id, title, note, scheduled_at, recurrence, recurrence_time, phone, language')

    let dueReminders = primary.data as DueReminderRow[] | null
    let error = primary.error

    // Backward-compatible fallback for environments with an older view definition.
    if (error?.code === '42703') {
      console.warn('[cron/reminders] Falling back to legacy due_reminders_view columns:', error.message)
      const legacy = await supabase
        .from('due_reminders_view')
        .select('reminder_id, title, note, scheduled_at, phone, language')

      dueReminders = legacy.data as DueReminderRow[] | null
      error = legacy.error
    }

    if (error) {
      console.error('[cron/reminders] DB fetch error:', error)
      return NextResponse.json({ error: 'DB fetch failed' }, { status: 500 })
    }

    if (!dueReminders || dueReminders.length === 0) {
      return NextResponse.json({ processed: 0 })
    }

    console.log(`[cron/reminders] Processing ${dueReminders.length} reminders...`)
    let processed = 0, failed = 0

    for (const reminder of dueReminders as DueReminderRow[]) {
      try {
        const lang = (reminder.language as Language) ?? 'en'
        const noteText = reminder.note ? `\n📌 ${reminder.note}` : ''
        const message = lang === 'hi'
          ? `⏰ *Reminder*\n\n📝 ${reminder.title}${noteText}\n\n_Done? "done" likho। Snooze? "snooze" likho।_`
          : `⏰ *Reminder*\n\n📝 ${reminder.title}${noteText}\n\n_Done? Reply "done". Snooze? Reply "snooze"._`

        await sendWhatsAppMessage({ to: reminder.phone, message })

        if (reminder.recurrence && reminder.recurrence !== 'none' && reminder.recurrence_time) {
          const nextDate = getNextRecurrenceDate(reminder.recurrence, reminder.recurrence_time)
          await supabase.from('reminders')
            .update({ scheduled_at: nextDate.toISOString(), status: 'pending' })
            .eq('id', reminder.reminder_id)
        } else {
          await supabase.from('reminders')
            .update({ status: 'sent' })
            .eq('id', reminder.reminder_id)
        }
        processed++
      } catch (err) {
        console.error(`[cron/reminders] Failed for ${reminder.reminder_id}:`, err)
        failed++
      }
    }

    return NextResponse.json({ processed, failed })
  } catch (err) {
    console.error('[cron/reminders] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(req: Request) {
  return processReminders(req)
}

export async function POST(req: Request) {
  return processReminders(req)
}

function getNextRecurrenceDate(recurrence: string, timeStr: string): Date {
  const [h, m] = timeStr.split(':').map(Number)
  const next = new Date()
  if (recurrence === 'daily') next.setDate(next.getDate() + 1)
  else if (recurrence === 'weekly') next.setDate(next.getDate() + 7)
  else if (recurrence === 'monthly') next.setMonth(next.getMonth() + 1)
  // IST to UTC: subtract 5:30
  let hours = h - 5
  let mins = m - 30
  if (mins < 0) { mins += 60; hours-- }
  if (hours < 0) { hours += 24; next.setDate(next.getDate() - 1) }
  next.setHours(hours, mins, 0, 0)
  return next
}
