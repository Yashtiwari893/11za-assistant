import { getGroqClient } from '@/lib/ai/clients'
import { AI_MODELS } from '@/config'
import type { Intent, IntentResult } from '@/types'

export type { Intent, IntentResult }


const SYSTEM_PROMPT = `You are ZARA's intent classifier for a WhatsApp assistant.
Users speak in Hinglish (Hindi + English mixed). Be smart about it.

## YOUR JOB
Extract:
1. intent (from supported list)
2. confidence (0.0 to 1.0)
3. extractedData:
   - SUBJECT fields (reminderTitle, taskContent, documentQuery, listName) must NOT contain verbs (delete, add, remove, etc.) or preambles like "my", "the", "a".
   - If user says "tasks", "list", or "all", set "isGenericSearch": true.
   - If user says "it" or references a previous item, use the CONTEXT HINTS provided below to identify the SUBJECT.

## CRITICAL EXTRACTION RULES
- NO VERBS in titles: "delete my grocery list" -> listName: "grocery", intent: DELETE_LIST. NOT "delete my grocery".
- GENERIC SEARCH: "task list", "reminders dikhao", "list clear karo" -> isGenericSearch: true.
- CONTEXT PRIORITY: If message is "send it", look for "last_referenced_id" in hints.
- RESPONSE FORMAT: Strictly JSON.

## INTENTS
SET_REMINDER, LIST_REMINDERS, SNOOZE_REMINDER, CANCEL_REMINDER, ADD_TASK, LIST_TASKS, COMPLETE_TASK, DELETE_TASK, DELETE_LIST, FIND_DOCUMENT, LIST_DOCUMENTS, DELETE_DOCUMENT, GET_BRIEFING, HELP, UNKNOWN

## EXAMPLES BY INTENT
- HELP: "help", "kya kar sakte ho", "features batao", "commands", "manual".
- UNKNOWN: "hey", "hi", "kaise ho?", "ai chat kya hai?", "zara kaun hai?", "weather kaisa hai?". (Conversational or identity stuff)
- LIST_TASKS: "grocery list dikhao", "tasks kya hain" (isGenericSearch: true for second).
- DELETE_LIST: "delete my grocery list", "grocery list hata do".
- FIND_DOCUMENT: "marksheet show karo", "aadhar card nikalo".
`

export async function classifyIntent(
  message: string,
  lang: string = 'en',
  context?: any
): Promise<IntentResult> {
  const now = new Date()
  const istOffset = 5.5 * 60 * 60 * 1000
  const istDate = new Date(now.getTime() + istOffset)

  const dateStr = istDate.toDateString()
  const timeStr = istDate.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit' })

  // Context-aware hints (crucial for resolving "it", "that", "this")
  const hints = []
  if (context?.last_referenced_id) hints.push(`Topic of previous exchange: ${context.last_referenced_id}`)
  if (context?.last_list_name) hints.push(`Active list name: ${context.last_list_name}`)
  if (context?.last_intent) hints.push(`Previous action: ${context.last_intent}`)
  
  const contextHint = hints.length > 0 ? `\n\n[CONVERSATION CONTEXT: ${hints.join('. ')}]` : ''

  try {
    const completion = await getGroqClient().chat.completions.create({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Current local time (IST): ${dateStr}, ${timeStr}. Language: ${lang}.${contextHint}\n\nMessage: "${message}"`
        }
      ],
      model: AI_MODELS.INTENT_CLASSIFIER,
      temperature: 0.1,
      response_format: { type: 'json_object' }
    })

    const result = JSON.parse(completion.choices[0]?.message?.content || '{}')
    return {
      intent: (result.intent as Intent) || 'UNKNOWN',
      confidence: result.confidence || 0,
      extractedData: result.extractedData || {}
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
