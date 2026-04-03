// src/lib/features/task.ts
// Tasks + Lists CRUD — Production-grade with guardrails

import { getSupabaseClient } from '@/lib/infrastructure/database'
import { sendWhatsAppMessage } from '@/lib/whatsapp/client'
import {
  taskAdded, taskList, taskCompleted, errorMessage,
} from '@/lib/whatsapp/templates'
import { truncateWhatsAppMessage } from '@/lib/whatsapp/message'
import type { Language } from '@/types'

const supabase = getSupabaseClient()

// ─── CONTENT CLEANER ──────────────────────────────────────────
// BUG-10 FIX: Only strip clear action/filler words using word boundaries
// DO NOT strip: 'me', 'list', 'grocery', 'ki', 'ka' — these can be part of task names
// "Medicine buy karo" was breaking to "dicine buy" with old regex
function cleanTaskContent(raw: string): string {
  const cleaned = raw
    // Only unambiguous action words (not syllables that could be part of words)
    .replace(/\b(add|karo|kar|please|bhai|yaar|mujhe|mein)\b/gi, '')
    // Remove "mein/me" only when followed by a list indicator — not as a word fragment
    .replace(/\s+mein\s+(daal|add|daalo|daalna)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.length > 1 ? cleaned : raw.trim()
}

// List name normalize karo — "groceries" → "grocery", "todo" → "general"
function normalizeListName(raw: string): string {
  const lower = raw.toLowerCase()
    .replace(/\b(list|meri|daftar|items|show|dikha|bhejo|nikalo|check|get|find)\b/gi, '')
    .trim()

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
  prefix?: string
}) {
  const { userId, phone, language, listName, workspaceId, prefix = '' } = params

  // ── Multi-item Parsing ──────────────────────────────────────
  const items = params.taskContent
    .split(/[\n,،\-\*•]+/) // newline, comma, dash, bullet
    .map(i => i.trim())
    .filter(i => i.length > 2) // avoid tiny fragments

  if (items.length > 1) {
    // Note: This simplified batch insert doesn't use the RPC. 
    // In a real app, we'd loop or use a batch RPC.
    const normalized = normalizeListName(listName)
    // First get/create list ID
    const { data: listId } = await supabase.rpc('get_or_create_list', {
      p_user_id:      userId,
      p_name:         normalized,
      p_workspace_id: workspaceId ?? null
    })

    if (listId) {
      const { error: batchErr } = await supabase.from('tasks').insert(
        items.map(item => ({
          list_id: listId,
          user_id: userId,
          content: item,
          completed: false // FIX: System uses 'completed', not 'status'
        }))
      )

      if (batchErr) {
        console.error('[task] Batch insert failed:', batchErr)
        await sendWhatsAppMessage({ to: phone, message: errorMessage(language) })
        return
      }
    }
    
    await sendWhatsAppMessage({
      to: phone,
      message: prefix + (language === 'hi'
        ? `✅ *${normalized}* list mein ${items.length} items add ho gaye!\n${items.map(i => `• ${i}`).join('\n')}`
        : `✅ Added ${items.length} items to *${normalized}*!\n${items.map(i => `• ${i}`).join('\n')}`)
    })
    return
  }

  // ── GUARDRAIL 1: Empty content check ──────────────────────
  const taskContent = cleanTaskContent(params.taskContent)
  if (!taskContent || taskContent.length < 3) {
    await sendWhatsAppMessage({
      to: phone,
      message: language === 'hi'
        ? '❓ Kya add karna hai? Thoda detail mein batao। Jaise "milk add karo grocery mein"'
        : '❓ What should I add? E.g. "add milk to grocery list"'
    })
    return
  }

  // ── GUARDRAIL 2: List name normalize ──────────────────────
  const finalListName = normalizeListName(params.listName || 'general')

  // ── GUARDRAIL 3: Duplicate task check ─────────────────────
  // Pehle list dhundo
  const { data: existingList } = await supabase
    .from('lists')
    .select('id')
    .eq('user_id', userId)
    .ilike('name', finalListName)
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
        message: prefix + (language === 'hi'
          ? `⚠️ *${taskContent}* already *${finalListName}* list mein hai!`
          : `⚠️ *${taskContent}* is already in your *${finalListName}* list!`)
      })
      return
    }
  }

  // ── Get or create list ────────────────────────────────────
  const { data: listId, error: listErr } = await supabase.rpc('get_or_create_list', {
    p_user_id:      userId,
    p_name:         finalListName,
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
    message: prefix + taskAdded(taskContent, listName, language)
  })
}

export async function handleListTasks(params: {
  userId: string
  phone: string
  language: Language
  listName: string
  isGenericSearch?: boolean
  prefix?: string
}) {
  const { userId, phone, language, isGenericSearch, prefix = '' } = params
  
  // ── 1. GENERIC SEARCH HANDLING ──────────────────────────────
  // If user says "tasks" or "list", show them all available lists
  const cleanedListName = params.listName?.toLowerCase().replace(/\b(list|lists|dikhao|dekho|show)\b/gi, '').trim() || ''
  if (isGenericSearch || !params.listName || !cleanedListName || ['task', 'tasks', 'list', 'lists', 'all', 'sab', ''].includes(cleanedListName)) {
    return await handleListAllLists({ userId, phone, language })
  }

  const listName = normalizeListName(params.listName)

  const { data: lists } = await supabase
    .from('lists')
    .select('id, name')
    .eq('user_id', userId)
    .ilike('name', `%${listName}%`)
    .order('created_at', { ascending: false })
    .limit(1)

  const list = lists?.[0]

  // ── 2. FUZZY FALLBACK ─────────────────────────────────────
  // If no exact/partial list found, show all lists to help them
  if (!list) {
    const listHint = language === 'hi' 
      ? `"${listName}" naam ki list nahi mili. Aapki playlists:` 
      : `Couldn't find a list named "${listName}". Here are your lists:`
    
    return await handleListAllLists({ userId, phone, language })
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
      message: prefix + (language === 'hi'
        ? `📭 *${list.name}* list abhi khali hai।\n\n_Kuch add karo: "${list.name} mein milk add karo"_`
        : `📭 *${list.name}* list is empty.\n\n_Add something: "add milk to ${list.name}"_`)
    })
    return
  }

    const listMessage = taskList(list.name, tasks, language)
    await sendWhatsAppMessage({
    to: phone,
      message: prefix + truncateWhatsAppMessage(listMessage)
  })
}

// ─── COMPLETE TASK ────────────────────────────────────────────
export async function handleCompleteTask(params: {
  userId: string
  phone: string
  language: Language
  taskContent: string
  listName?: string
  prefix?: string
}) {
  const { userId, phone, language, listName, prefix = '' } = params
  const taskContent = cleanTaskContent(params.taskContent)

  // ── GUARDRAIL: Empty content ───────────────────────────────
  if (!taskContent || taskContent.length < 3) {
    await sendWhatsAppMessage({
      to: phone,
      message: prefix + (language === 'hi'
        ? '❓ Kaunsa task complete karna hai? Naam batao।'
        : '❓ Which task did you complete? Please mention the name.')
    })
    return
  }

  const lowerContent = taskContent.toLowerCase().trim()
  if (['ok', 'okay', 'done', 'yes', 'no'].includes(lowerContent)) {
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
    const { data: lists } = await supabase
      .from('lists')
      .select('id')
      .eq('user_id', userId)
      .ilike('name', `%${normalizedList}%`)
      .order('created_at', { ascending: false })
      .limit(1)
    
    const list = lists?.[0]
    if (list) query = query.eq('list_id', list.id)
  }

  const { data: tasks } = await query.limit(1)

  // ── GUARDRAIL: Task nahi mila ──────────────────────────────
  if (!tasks || tasks.length === 0) {
    // If it's a generic "done" or very short, don't show the error.
    // This allows the webhook to handle it via autoResponder for a smoother conversation.
    const lowerContent = taskContent.toLowerCase().trim()
    if (lowerContent === 'last item' || lowerContent === 'done' || lowerContent.length < 3) {
      return
    }

    await sendWhatsAppMessage({
      to: phone,
      message: prefix + (language === 'hi'
        ? `❓ Merri list mein "${taskContent}" nahi mila. Kripya check karein.`
        : `❓ Couldn't find "${taskContent}" in your list. Please check.`)
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
    message: prefix + taskCompleted(tasks[0].content, language)
  })
}

// ─── DELETE TASK ──────────────────────────────────────────────
export async function handleDeleteTask(params: {
  userId: string
  phone: string
  language: Language
  taskContent: string
  listName?: string
  prefix?: string
}) {
  const { userId, phone, language, listName, prefix = '' } = params
  
  // Strip action keywords from task content
  const rawTaskContent = params.taskContent
    .replace(/\b(delete|remove|hata|hatao|mitao|clear)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  
  // Reject if nothing meaningful left or it's a generic word
  const genericTerms = ['task', 'tasks', 'item', 'items', 'all', 'everything', 'sab', 'saari', 'saare', 'list', 'lists']
  if (!rawTaskContent || genericTerms.includes(rawTaskContent.toLowerCase())) {
    await sendWhatsAppMessage({
      to: phone,
      message: prefix + (language === 'hi'
        ? `❓ Kripya delete karne ke liye exact task ka naam batao.`
        : `❓ Please tell me the exact task name to delete.`)
    })
    return
  }
  
  const taskContent = cleanTaskContent(rawTaskContent)

  let query = supabase
    .from('tasks')
    .select('id, content')
    .eq('user_id', userId)
    .ilike('content', `%${taskContent}%`)

  if (listName) {
    const { data: lists } = await supabase
      .from('lists')
      .select('id')
      .eq('user_id', userId)
      .ilike('name', `%${normalizeListName(listName)}%`)
      .order('created_at', { ascending: false })
      .limit(1)
    
    const list = lists?.[0]
    if (list) query = query.eq('list_id', list.id)
  }

  const { data: tasks } = await query.limit(1)

  if (!tasks || tasks.length === 0) {
    await sendWhatsAppMessage({
      to: phone,
      message: prefix + (language === 'hi'
        ? `❓ Delete karne ke liye "${taskContent}" nahi mila.`
        : `❓ Couldn't find "${taskContent}" to delete.`)
    })
    return
  }

  await supabase.from('tasks').delete().eq('id', tasks[0].id)

  await sendWhatsAppMessage({
    to: phone,
    message: prefix + (language === 'hi'
      ? `🗑️ *${tasks[0].content}* delete ho gaya!`
      : `🗑️ *${tasks[0].content}* deleted!`)
  })
}

// ─── DELETE LIST ──────────────────────────────────────────────
export async function handleDeleteList(params: {
  userId: string
  phone: string
  language: Language
  listName: string
  prefix?: string
}) {
  const { userId, phone, language, prefix = '' } = params
  const rawListName = params.listName
    .replace(/\b(delete|remove|hata|hatao|mitao|clear|list|all|everything|sab|saari|saare)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()

  const listName = normalizeListName(rawListName)

  if (!listName || ['all', 'task', 'tasks', 'list', 'lists', 'general'].includes(listName)) {
    const { data: allLists } = await supabase
      .from('lists')
      .select('name')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(5)

    const availableLists = allLists && allLists.length > 0
      ? allLists.map(item => `*${item.name}*`).join(', ')
      : ''

    await sendWhatsAppMessage({
      to: phone,
      message: prefix + (language === 'hi'
        ? `❓ Kripya delete karne ke liye exact list ka naam batao.${availableLists ? `\n\nAapki lists: ${availableLists}` : ''}`
        : `❓ Please tell me the exact list name to delete.${availableLists ? `\n\nYour lists: ${availableLists}` : ''}`)
    })
    return
  }

  const { data: lists } = await supabase
    .from('lists')
    .select('id, name')
    .eq('user_id', userId)
    .ilike('name', `%${listName}%`)
    .order('created_at', { ascending: false })
    .limit(1)

  const list = lists?.[0]

  if (!list) {
    const { data: allLists } = await supabase
      .from('lists')
      .select('name')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(5)

    const availableLists = allLists && allLists.length > 0
      ? allLists.map(item => `*${item.name}*`).join(', ')
      : ''

    await sendWhatsAppMessage({
      to: phone,
      message: prefix + (language === 'hi'
        ? `❓ "${listName}" naam ki list nahi mili.${availableLists ? `\n\nAapki lists: ${availableLists}` : ''}`
        : `❓ Couldn't find a list named "${listName}" to delete.${availableLists ? `\n\nYour lists: ${availableLists}` : ''}`)
    })
    return
  }

  // Deleting the list will cascade delete tasks in a real prod DB,
  // but let's be explicit and delete tasks first for safety if needed,
  // or just rely on cascade if we have FK set.
  // Actually, we'll delete tasks first.
  await supabase.from('tasks').delete().eq('list_id', list.id)
  await supabase.from('lists').delete().eq('id', list.id)

  await sendWhatsAppMessage({
    to: phone,
    message: prefix + (language === 'hi'
      ? `✅ *${list.name}* list aur uske saare tasks delete ho gaye!`
      : `✅ Deleted *${list.name}* list and all its tasks!`)
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

  const { data: lists } = await supabase
    .from('lists')
    .select('id, name')
    .eq('user_id', userId)
    .ilike('name', `%${listName}%`)
    .order('created_at', { ascending: false })
    .limit(1)

  const list = lists?.[0]

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
    const taskCount = (l.tasks as Array<{ count: number }> | null)?.[0]?.count ?? 0
    return `• *${l.name}* — ${taskCount} item${taskCount !== 1 ? 's' : ''}`
  }).join('\n')

  const allListMessage = (language === 'hi'
    ? `📋 *Aapki Lists:*\n\n`
    : `📋 *Your Lists:*\n\n`) +
    `${listText}\n\n` +
    (language === 'hi'
      ? `_Dekhne ke liye naam bolo। Jaise "grocery list dikhao"_`
      : `_Say a list name to view. E.g. "show grocery list"_`)

  await sendWhatsAppMessage({
    to: phone,
    message: truncateWhatsAppMessage(allListMessage)
  })
}