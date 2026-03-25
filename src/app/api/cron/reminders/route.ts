import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendWhatsAppMessage } from '@/lib/whatsapp/client'
import type { Language } from '@/lib/whatsapp/templates'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: Request) {
  const authHeader = (req as any).headers?.get?.('authorization')
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { data: dueReminders, error } = await supabase
      .from('due_reminders_view')
      .select('reminder_id, user_id, title, note, scheduled_at, recurrence, recurrence_time, phone, language')

    if (error) {
      console.error('[cron/reminders] DB fetch error:', error)
      return NextResponse.json({ error: 'DB fetch failed' }, { status: 500 })
    }

    if (!dueReminders || dueReminders.length === 0) {
      return NextResponse.json({ processed: 0 })
    }

    console.log(`[cron/reminders] Processing ${dueReminders.length} reminders...`)
    let processed = 0, failed = 0

    for (const reminder of dueReminders) {
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
