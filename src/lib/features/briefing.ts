// src/lib/features/briefing.ts
// Morning Briefing — Bulletproof version with guardrails

import { createClient } from '@supabase/supabase-js'
import { sendWhatsAppMessage } from '@/lib/whatsapp/client'
import { morningBriefing, type Language } from '@/lib/whatsapp/templates'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// IST timezone helper
const IST = 'Asia/Kolkata'

function getTodayIST(): { start: string; end: string; dateStr: string } {
  const now = new Date()
  const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: IST }).format(now) // "YYYY-MM-DD"
  return {
    dateStr,
    start: `${dateStr}T00:00:00+05:30`,
    end: `${dateStr}T23:59:59+05:30`,
  }
}

// ─── SEND BRIEFING TO ONE USER ────────────────────────────────
export async function sendBriefingToUser(user: {
  user_id: string
  phone: string
  name: string | null
  language: string
  pending_tasks: number
  todays_reminders: number
}) {
  const lang = (user.language as Language) ?? 'en'
  const name = user.name?.trim() || (lang === 'hi' ? 'Aap' : 'there')
  const { start, end, dateStr } = getTodayIST()

  // ── GUARDRAIL 1: Already sent today? ──────────────────────
  const { data: alreadySent } = await supabase
    .from('briefing_logs')
    .select('id')
    .eq('user_id', user.user_id)
    .eq('date', dateStr)
    .single()

  if (alreadySent) {
    console.log(`[briefing] Already sent to ${user.phone} today — skipping`)
    return
  }

  // ── Fetch today's reminders detail ────────────────────────
  const { data: reminders } = await supabase
    .from('reminders')
    .select('title, scheduled_at')
    .eq('user_id', user.user_id)
    .eq('status', 'pending')
    .gte('scheduled_at', start)
    .lte('scheduled_at', end)
    .order('scheduled_at', { ascending: true })
    .limit(5)

  // ── Fetch pending tasks list ───────────────────────────────
  const { data: tasks } = await supabase
    .from('tasks')
    .select('content, lists(name)')
    .eq('user_id', user.user_id)
    .eq('completed', false)
    .limit(5)

  // ── Build message ──────────────────────────────────────────
  let message = morningBriefing(name, user.pending_tasks, user.todays_reminders, lang)

  // Add reminder details
  if (reminders && reminders.length > 0) {
    const reminderLines = reminders.map(r => {
      const time = new Date(r.scheduled_at).toLocaleTimeString('en-IN', {
        timeZone: IST, timeStyle: 'short'
      })
      return `  • ${r.title} — ${time}`
    }).join('\n')

    message += (lang === 'hi'
      ? `\n\n⏰ *Aaj ke Reminders:*\n`
      : `\n\n⏰ *Today's Reminders:*\n`) + reminderLines
  }

  // Add pending tasks (top 3)
  if (tasks && tasks.length > 0) {
    const taskLines = tasks.slice(0, 3).map(t => {
      const listName = (t.lists as any)?.name ?? 'general'
      return `  • ${t.content} _(${listName})_`
    }).join('\n')

    const remaining = user.pending_tasks - Math.min(tasks.length, 3)
    const moreText = remaining > 0
      ? (lang === 'hi' ? `\n  _...aur ${remaining} aur_` : `\n  _...and ${remaining} more_`)
      : ''

    message += (lang === 'hi'
      ? `\n\n📋 *Pending Tasks:*\n`
      : `\n\n📋 *Pending Tasks:*\n`) + taskLines + moreText
  }

  // ── GUARDRAIL 2: Send with retry ──────────────────────────
  try {
    await sendWhatsAppMessage({ to: user.phone, message })
  } catch (sendErr) {
    console.error(`[briefing] Send failed for ${user.phone}:`, sendErr)
    throw sendErr  // Promise.allSettled mein failed count mein jayega
  }

  // ── Log briefing sent ─────────────────────────────────────
  const { error: logErr } = await supabase
    .from('briefing_logs')
    .insert({ user_id: user.user_id, date: dateStr })

  if (logErr) {
    console.error('[briefing] Log insert failed:', logErr)
    // Log fail hua but message gaya — continue karo
  }
}

// ─── SEND BRIEFING TO ALL DUE USERS ──────────────────────────
// Vercel Cron se call hota hai — roz 9 AM IST
export async function sendMorningBriefingToAll() {
  const { data: users, error } = await supabase
    .from('users_due_for_briefing')
    .select('*')

  if (error) {
    console.error('[briefing] Failed to fetch users:', error)
    return { sent: 0, failed: 0 }
  }

  // ── GUARDRAIL 3: No users check ───────────────────────────
  if (!users || users.length === 0) {
    console.log('[briefing] No users due for briefing today')
    return { sent: 0, failed: 0 }
  }

  console.log(`[briefing] Sending to ${users.length} users...`)

  // Parallel bhejo lekin agar ek fail ho toh baaki na roke
  const results = await Promise.allSettled(
    users.map(user => sendBriefingToUser(user))
  )

  const sent = results.filter(r => r.status === 'fulfilled').length
  const failed = results.filter(r => r.status === 'rejected').length

  // Log failures
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error(`[briefing] Failed for user ${users[i]?.phone}:`, r.reason)
    }
  })

  console.log(`[briefing] Done — Sent: ${sent}, Failed: ${failed}`)
  return { sent, failed }
}

// ─── MANUAL BRIEFING (user ne "aaj ka summary" manga) ─────────
export async function handleGetBriefing(params: {
  userId: string
  phone: string
  language: Language
}) {
  const { userId, phone, language } = params
  const { start, end } = getTodayIST()

  // ── Fetch all data in parallel ─────────────────────────────
  const [userRes, taskRes, reminderRes, reminderDetailRes] = await Promise.all([
    supabase.from('users').select('name').eq('id', userId).single(),

    supabase.from('tasks')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('completed', false),

    supabase.from('reminders')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'pending')
      .gte('scheduled_at', start)
      .lte('scheduled_at', end),

    supabase.from('reminders')
      .select('title, scheduled_at')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .gte('scheduled_at', start)
      .lte('scheduled_at', end)
      .order('scheduled_at', { ascending: true })
      .limit(5),
  ])

  const name = userRes.data?.name?.trim() || (language === 'hi' ? 'Aap' : 'there')
  const pendingTasks = taskRes.count ?? 0
  const todayReminders = reminderRes.count ?? 0
  const reminders = reminderDetailRes.data ?? []

  // ── Build message ──────────────────────────────────────────
  let message = morningBriefing(name, pendingTasks, todayReminders, language)

  if (reminders.length > 0) {
    const reminderLines = reminders.map(r => {
      const time = new Date(r.scheduled_at).toLocaleTimeString('en-IN', {
        timeZone: IST, timeStyle: 'short'
      })
      return `  • ${r.title} — ${time}`
    }).join('\n')

    message += (language === 'hi'
      ? `\n\n⏰ *Aaj ke Reminders:*\n`
      : `\n\n⏰ *Today's Reminders:*\n`) + reminderLines
  }

  // ── GUARDRAIL: Nothing to show ────────────────────────────
  if (pendingTasks === 0 && todayReminders === 0) {
    message += (language === 'hi'
      ? `\n\n🎉 _Aaj ke liye sab clear hai! Enjoy your day!_`
      : `\n\n🎉 _All clear for today! Enjoy your day!_`)
  }

  await sendWhatsAppMessage({ to: phone, message })
}