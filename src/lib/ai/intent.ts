import { getGroqClient } from '@/lib/ai/clients'
import { AI_MODELS } from '@/config'
import { retryWithExponentialBackoff } from '@/lib/infrastructure/errorHandler'
import type { Intent, IntentResult } from '@/types'

export type { Intent, IntentResult }

// ─── SYSTEM PROMPT — Production-Grade Intent Classifier ──────────────────────
const SYSTEM_PROMPT = `You are ZARA's intent classifier for a WhatsApp personal assistant.
Users speak in Hinglish (Hindi + English mix), Hindi, Gujarati, or English. Be very smart about it.

## YOUR JOB
Analyze the user's message and return a JSON with:
1. "intent" — from the INTENTS list
2. "confidence" — 0.0 to 1.0
3. "extractedData" — structured fields based on intent

## INTENTS (pick exactly one)
SET_REMINDER, LIST_REMINDERS, SNOOZE_REMINDER, CANCEL_REMINDER,
ADD_TASK, LIST_TASKS, COMPLETE_TASK, DELETE_TASK, DELETE_LIST,
FIND_DOCUMENT, LIST_DOCUMENTS, DELETE_DOCUMENT,
GET_BRIEFING, HELP, UNKNOWN

## EXTRACTION RULES
- SUBJECT fields (reminderTitle, taskContent, documentQuery, listName) must be CLEAN — no verbs, no preambles.
  "delete my grocery list" → listName: "grocery", intent: DELETE_LIST
  "add milk to shopping list" → taskContent: "milk", listName: "shopping"

- reminderTitle should be 2-5 words MAX. Never a full sentence. Extract the CORE subject.
  "kal 2 baje doctor appointment ka reminder" → reminderTitle: "doctor appointment", dateTimeText: "kal 2 baje"

- dateTimeText: extract the EXACT time/date phrase from the message (e.g. "kal 2 baje", "friday 5pm", "10 min baad")

- If user says "tasks", "list", "all", "sab" → set isGenericSearch: true

- If user references something vague ("it", "vo wala", "pehle wala", "usse"), use the CONVERSATION CONTEXT provided to resolve it.

- If user is EXPLAINING what they want to do (not giving actual data), return UNKNOWN.
  "Mujhe address save karna hai" → UNKNOWN (user is asking HOW, not giving data)
  "Address save karo: Rahul, 123 MG Road" → ADD_TASK (has actual data)

## MULTI-REMINDER SUPPORT
If user sets multiple reminders in one message, set:
  isMultiReminder: true
  reminderItems: [{ title: "...", dateTimeText: "..." }, ...]
Example: "3 reminder set kar: 2pm, 5pm, 8pm" →
  { intent: "SET_REMINDER", isMultiReminder: true, reminderItems: [
    { title: "Reminder 1", dateTimeText: "today 2pm" },
    { title: "Reminder 2", dateTimeText: "today 5pm" },
    { title: "Reminder 3", dateTimeText: "today 8pm" }
  ]}

## AM/PM HINTS FOR TIME
- Indian context: "2 baje" / "3 baje" (1-5 range) without am/pm usually means AFTERNOON (PM)
- "subah" = morning (AM), "dopahar" = afternoon (PM), "shaam" = evening (PM), "raat" = night (PM)
- Always include the time context keywords (subah/shaam/etc) in dateTimeText if present

## FEW-SHOT EXAMPLES

Message: "Kal 2 baje reminder laga do"
→ {"intent":"SET_REMINDER","confidence":0.95,"extractedData":{"reminderTitle":"Reminder","dateTimeText":"kal 2 baje"}}

Message: "Mere reminders dikhao"
→ {"intent":"LIST_REMINDERS","confidence":0.95,"extractedData":{}}

Message: "Grocery mein doodh add karo"
→ {"intent":"ADD_TASK","confidence":0.95,"extractedData":{"taskContent":"doodh","listName":"grocery"}}

Message: "Meri grocery list dikhao"  
→ {"intent":"LIST_TASKS","confidence":0.95,"extractedData":{"listName":"grocery"}}

Message: "Tasks dikhao"
→ {"intent":"LIST_TASKS","confidence":0.95,"extractedData":{"isGenericSearch":true}}

Message: "Mujhe address save karna hai to kaise karun"
→ {"intent":"UNKNOWN","confidence":0.9,"extractedData":{}}

Message: "Maine kya bola tha wapas bhejo"
→ Use conversation history to understand context. If last message was about a document → FIND_DOCUMENT. If unclear → UNKNOWN.

Message: "Done" / "Ok" / "Thanks"
→ {"intent":"UNKNOWN","confidence":1.0,"extractedData":{}}

Message: "Reminder cancel karo"
→ {"intent":"CANCEL_REMINDER","confidence":0.95,"extractedData":{}}

Message: "10 min baad yaad dila dena"
→ {"intent":"SET_REMINDER","confidence":0.95,"extractedData":{"reminderTitle":"Reminder","dateTimeText":"10 min baad"}}

Message: "Mera aadhar dikhao"
→ {"intent":"FIND_DOCUMENT","confidence":0.95,"extractedData":{"documentQuery":"aadhar"}}

Message: "Help"
→ {"intent":"HELP","confidence":1.0,"extractedData":{}}

Message: "Aaj ka summary"
→ {"intent":"GET_BRIEFING","confidence":0.95,"extractedData":{}}

Message: "Doodh ho gaya"
→ {"intent":"COMPLETE_TASK","confidence":0.9,"extractedData":{"taskContent":"doodh"}}

Message: "Snooze kar do 30 min"
→ {"intent":"SNOOZE_REMINDER","confidence":0.95,"extractedData":{"snoozeMinutes":30}}

## RESPONSE FORMAT
Return ONLY valid JSON. No explanation text.`


export async function classifyIntent(
  message: string,
  lang: string = 'en',
  context?: any
): Promise<IntentResult> {
  const now = new Date()
  const timeStr = now.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'full',
    timeStyle: 'short',
    hour12: true,
  })

  // ─── Context Hints (for resolving "it", "that", "vo wala") ────
  const hints: string[] = []
  if (context?.last_referenced_id) hints.push(`Last referenced item ID: ${context.last_referenced_id}`)
  if (context?.last_list_name) hints.push(`Active list: ${context.last_list_name}`)
  if (context?.last_intent) hints.push(`Previous action: ${context.last_intent}`)
  if (context?.last_document_query) hints.push(`Last document searched: ${context.last_document_query}`)
  const contextHint = hints.length > 0 ? `\n\n[CONTEXT HINTS: ${hints.join(' | ')}]` : ''

  // ─── Conversation History (for full context awareness) ────────
  const historyMessages = (context?.conversation_history || []).slice(-6) as Array<{role: string, content: string}>
  const historyStr = historyMessages.length > 0
    ? `\n\n[RECENT CONVERSATION:\n${historyMessages.map(h => `${h.role === 'user' ? 'User' : 'Zara'}: ${h.content}`).join('\n')}\n]`
    : ''

  try {
    const completion = await retryWithExponentialBackoff(
      async () => getGroqClient().chat.completions.create({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Current time (IST): ${timeStr}. User language: ${lang}.${contextHint}${historyStr}\n\nUser message: "${message}"`
          }
        ],
        model: AI_MODELS.INTENT_CLASSIFIER,
        temperature: 0.05,
        response_format: { type: 'json_object' },
        max_tokens: 400,
      }),
      2 // 2 retries on failure
    )

    const raw = completion.choices[0]?.message?.content || '{}'
    const result = JSON.parse(raw)

    return {
      intent: (result.intent as Intent) || 'UNKNOWN',
      confidence: typeof result.confidence === 'number' ? result.confidence : 0,
      extractedData: result.extractedData || result // Handle both formats
    }
  } catch (err) {
    console.error('[classifyIntent] Error:', err)
    return {
      intent: 'UNKNOWN',
      confidence: 0,
      extractedData: {}
    }
  }
}
