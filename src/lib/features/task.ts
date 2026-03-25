// src/lib/features/task.ts
// Tasks + Lists CRUD — Guardrails ke saath bulletproof version

import { createClient } from '@supabase/supabase-js'
import { sendWhatsAppMessage } from '@/lib/whatsapp/client'
import {
  taskAdded, taskList, taskCompleted, errorMessage,
  type Language
} from '@/lib/whatsapp/templates'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ─── CONTENT CLEANER ──────────────────────────────────────────
// Task content se filler words hata do
function cleanTaskContent(raw: string): string {
  const cleaned = raw
    .replace(/\b(add|karo|kar|do|please|bhai|yaar|mein|me|list|grocery|ko|ki|ka)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.length > 1 ? cleaned : raw.trim()
}

// List name normalize karo — "groceries" → "grocery", "todo" → "general"
function normalizeListName(raw: string): string {
  const lower = raw.toLowerCase().trim()
  const aliases: Record<string, string> = {
    'groceries': 'grocery',
    'sabzi':     'grocery',
    'kirana':    'grocery',
    'shopping':  'grocery',
    'todo':      'general',
    'to-do':     'general',
    'to do':     'general',
    'kaam':      'general',
    'work':      'office',
    'office tasks': 'office',
  }
  return aliases[lower] ?? lower
}

// ─── ADD TASK ─────────────────────────────────────────────────
export async function handleAddTask(params: {
  userId: string
  phone: string
  language: Language
  taskContent: string
  listName: string
  workspaceId?: string
}) {
  const { userId, phone, language, workspaceId } = params

  // ── GUARDRAIL 1: Empty content check ──────────────────────
  const taskContent = cleanTaskContent(params.taskContent)
  if (!taskContent || taskContent.length < 2) {
    await sendWhatsAppMessage({
      to: phone,
      message: language === 'hi'
        ? '❓ Kya add karna hai? Thoda detail mein batao। Jaise "milk add karo grocery mein"'
        : '❓ What should I add? E.g. "add milk to grocery list"'
    })
    return
  }

  // ── GUARDRAIL 2: List name normalize ──────────────────────
  const listName = normalizeListName(params.listName || 'general')

  // ── GUARDRAIL 3: Duplicate task check ─────────────────────
  // Pehle list dhundo
  const { data: existingList } = await supabase
    .from('lists')
    .select('id')
    .eq('user_id', userId)
    .ilike('name', listName)
    .single()

  if (existingList) {
    const { data: dupTask } = await supabase
      .from('tasks')
      .select('id, content')
      .eq('list_id', existingList.id)
      .eq('completed', false)
      .ilike('content', `%${taskContent}%`)
      .limit(1)

    if (dupTask && dupTask.length > 0) {
      await sendWhatsAppMessage({
        to: phone,
        message: language === 'hi'
          ? `⚠️ *${taskContent}* already *${listName}* list mein hai!`
          : `⚠️ *${taskContent}* is already in your *${listName}* list!`
      })
      return
    }
  }

  // ── Get or create list ────────────────────────────────────
  const { data: listId, error: listErr } = await supabase.rpc('get_or_create_list', {
    p_user_id:      userId,
    p_name:         listName,
    p_workspace_id: workspaceId ?? null
  })

  if (listErr) {
    console.error('[task] get_or_create_list error:', listErr)
    await sendWhatsAppMessage({ to: phone, message: errorMessage(language) })
    return
  }

  // ── Insert task ───────────────────────────────────────────
  const { error } = await supabase.from('tasks').insert({
    list_id: listId,
    user_id: userId,
    content: taskContent,
  })

  if (error) {
    console.error('[task] insert error:', error)
    await sendWhatsAppMessage({ to: phone, message: errorMessage(language) })
    return
  }

  await sendWhatsAppMessage({
    to: phone,
    message: taskAdded(taskContent, listName, language)
  })
}

// ─── LIST TASKS ───────────────────────────────────────────────
export async function handleListTasks(params: {
  userId: string
  phone: string
  language: Language
  listName: string
}) {
  const { userId, phone, language } = params
  const listName = normalizeListName(params.listName)

  const { data: list } = await supabase
    .from('lists')
    .select('id, name')
    .eq('user_id', userId)
    .ilike('name', `%${listName}%`)
    .single()

  // ── GUARDRAIL: List exist nahi karti ──────────────────────
  if (!list) {
    await sendWhatsAppMessage({
      to: phone,
      message: language === 'hi'
        ? `📭 "${listName}" naam ki koi list nahi hai।\n\n_"${listName} mein kuch add karo" bolke list banao!_`
        : `📭 No list found named "${listName}".\n\n_Say "add something to ${listName}" to create it!_`
    })
    return
  }

  const { data: tasks } = await supabase
    .from('tasks')
    .select('content, completed')
    .eq('list_id', list.id)
    .order('created_at', { ascending: true })

  // ── GUARDRAIL: List empty hai ──────────────────────────────
  if (!tasks || tasks.length === 0) {
    await sendWhatsAppMessage({
      to: phone,
      message: language === 'hi'
        ? `📭 *${list.name}* list abhi khali hai।\n\n_Kuch add karo: "${list.name} mein milk add karo"_`
        : `📭 *${list.name}* list is empty.\n\n_Add something: "add milk to ${list.name}"_`
    })
    return
  }

  await sendWhatsAppMessage({
    to: phone,
    message: taskList(list.name, tasks, language)
  })
}

// ─── COMPLETE TASK ────────────────────────────────────────────
export async function handleCompleteTask(params: {
  userId: string
  phone: string
  language: Language
  taskContent: string
  listName?: string
}) {
  const { userId, phone, language, listName } = params
  const taskContent = cleanTaskContent(params.taskContent)

  // ── GUARDRAIL: Empty content ───────────────────────────────
  if (!taskContent || taskContent.length < 2) {
    await sendWhatsAppMessage({
      to: phone,
      message: language === 'hi'
        ? '❓ Kaunsa task complete karna hai? Naam batao।'
        : '❓ Which task did you complete? Please mention the name.'
    })
    return
  }

  let query = supabase
    .from('tasks')
    .select('id, content, list_id')
    .eq('user_id', userId)
    .eq('completed', false)
    .ilike('content', `%${taskContent}%`)

  // List filter agar diya ho
  if (listName) {
    const normalizedList = normalizeListName(listName)
    const { data: list } = await supabase
      .from('lists')
      .select('id')
      .eq('user_id', userId)
      .ilike('name', `%${normalizedList}%`)
      .single()
    if (list) query = query.eq('list_id', list.id)
  }

  const { data: tasks } = await query.limit(1)

  // ── GUARDRAIL: Task nahi mila ──────────────────────────────
  if (!tasks || tasks.length === 0) {
    await sendWhatsAppMessage({
      to: phone,
      message: language === 'hi'
        ? `❓ "${taskContent}" naam ka koi pending task nahi mila।\n\n_"Meri list dikhao" bolke check karo।_`
        : `❓ No pending task found matching "${taskContent}".\n\n_Say "show my list" to check._`
    })
    return
  }

  await supabase
    .from('tasks')
    .update({
      completed:    true,
      completed_at: new Date().toISOString()
    })
    .eq('id', tasks[0].id)

  await sendWhatsAppMessage({
    to: phone,
    message: taskCompleted(tasks[0].content, language)
  })
}

// ─── DELETE TASK ──────────────────────────────────────────────
export async function handleDeleteTask(params: {
  userId: string
  phone: string
  language: Language
  taskContent: string
  listName?: string
}) {
  const { userId, phone, language, listName } = params
  const taskContent = cleanTaskContent(params.taskContent)

  let query = supabase
    .from('tasks')
    .select('id, content')
    .eq('user_id', userId)
    .ilike('content', `%${taskContent}%`)

  if (listName) {
    const { data: list } = await supabase
      .from('lists')
      .select('id')
      .eq('user_id', userId)
      .ilike('name', `%${normalizeListName(listName)}%`)
      .single()
    if (list) query = query.eq('list_id', list.id)
  }

  const { data: tasks } = await query.limit(1)

  if (!tasks || tasks.length === 0) {
    await sendWhatsAppMessage({
      to: phone,
      message: language === 'hi'
        ? `❓ "${taskContent}" naam ka koi task nahi mila delete karne ke liye।`
        : `❓ No task found matching "${taskContent}" to delete.`
    })
    return
  }

  await supabase.from('tasks').delete().eq('id', tasks[0].id)

  await sendWhatsAppMessage({
    to: phone,
    message: language === 'hi'
      ? `🗑️ *${tasks[0].content}* delete ho gaya!`
      : `🗑️ *${tasks[0].content}* deleted!`
  })
}

// ─── CLEAR COMPLETED TASKS ────────────────────────────────────
// "Meri grocery list saaf karo" — completed tasks hata do
export async function handleClearCompleted(params: {
  userId: string
  phone: string
  language: Language
  listName: string
}) {
  const { userId, phone, language } = params
  const listName = normalizeListName(params.listName)

  const { data: list } = await supabase
    .from('lists')
    .select('id, name')
    .eq('user_id', userId)
    .ilike('name', `%${listName}%`)
    .single()

  if (!list) {
    await sendWhatsAppMessage({
      to: phone,
      message: language === 'hi'
        ? `📭 "${listName}" list nahi mili।`
        : `📭 List "${listName}" not found.`
    })
    return
  }

  const { count } = await supabase
    .from('tasks')
    .delete({ count: 'exact' })
    .eq('list_id', list.id)
    .eq('completed', true)

  await sendWhatsAppMessage({
    to: phone,
    message: language === 'hi'
      ? `🧹 *${list.name}* list se ${count ?? 0} completed tasks hata diye!`
      : `🧹 Cleared ${count ?? 0} completed tasks from *${list.name}*!`
  })
}

// ─── LIST ALL LISTS ───────────────────────────────────────────
export async function handleListAllLists(params: {
  userId: string
  phone: string
  language: Language
}) {
  const { userId, phone, language } = params

  const { data: lists } = await supabase
    .from('lists')
    .select('id, name, tasks(count)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (!lists || lists.length === 0) {
    await sendWhatsAppMessage({
      to: phone,
      message: language === 'hi'
        ? '📭 Abhi koi list nahi hai।\n\n_"Grocery mein milk add karo" bol ke shuru karo!_'
        : '📭 No lists yet.\n\n_Say "Add milk to grocery" to create one!_'
    })
    return
  }

  const listText = lists.map(l => {
    const taskCount = (l.tasks as any)?.[0]?.count ?? 0
    return `• *${l.name}* — ${taskCount} item${taskCount !== 1 ? 's' : ''}`
  }).join('\n')

  await sendWhatsAppMessage({
    to: phone,
    message: (language === 'hi'
      ? `📋 *Aapki Lists:*\n\n`
      : `📋 *Your Lists:*\n\n`) +
      `${listText}\n\n` +
      (language === 'hi'
        ? `_Dekhne ke liye naam bolo। Jaise "grocery list dikhao"_`
        : `_Say a list name to view. E.g. "show grocery list"_`)
  })
}