import Groq from 'groq-sdk'

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

export type Intent =
  | 'SET_REMINDER'
  | 'SNOOZE_REMINDER'
  | 'LIST_REMINDERS'
  | 'CANCEL_REMINDER'
  | 'ADD_TASK'
  | 'LIST_TASKS'
  | 'COMPLETE_TASK'
  | 'DELETE_TASK'
  | 'FIND_DOCUMENT'
  | 'LIST_DOCUMENTS'
  | 'DELETE_DOCUMENT'
  | 'DELETE_ALL_DOCUMENTS'
  | 'CLEAR_COMPLETED'
  | 'LIST_ALL_LISTS'
  | 'GET_BRIEFING'
  | 'ONBOARDING'
  | 'HELP'
  | 'UNKNOWN'

export interface IntentResult {
  intent: Intent
  confidence: number
  extractedData: {
    dateTimeText?: string
    taskContent?: string
    listName?: string
    documentQuery?: string
    reminderTitle?: string
    isMultiTask?: boolean
    taskItems?: string[]
  }
}

const SYSTEM_PROMPT = `You are ZARA's intent classifier for a WhatsApp assistant.
Users speak in Hinglish (Hindi + English mixed). Be smart about it.

## YOUR JOB
Extract:
1. intent (from list below)
2. confidence (0.0 to 1.0)
3. extractedData (relevant fields)

## INTENTS & EXAMPLES

SET_REMINDER:
- "kal 5 bje doctor ko call karna hai"
- "remind me tomorrow 8am gym"
- "shaam 7 baje yaad dilana meeting ke liye"
- "Friday ko 3pm pe alarm lagao"

LIST_REMINDERS:
- "mere reminders dikhao"
- "kya kya yaad dilana hai"
- "aaj ke reminders"

SNOOZE_REMINDER:
- "reminder 1 ghante baad karo"
- "snooze karo 30 min"

CANCEL_REMINDER:
- "doctor wala reminder cancel karo"
- "sab reminders stop karo"

ADD_TASK:
- "add milk, eggs, bread to grocery list"
- "dhaniya, mirch aur tamatar shopper mein add karo"
- "Wedding list: Haldi, Mehndi, Card distribution"
- "office task: send report, call boss"

LIST_TASKS:
- "grocery list mein kya kya hai"
- "show my shopper list"
- "tasks dikhao"

COMPLETE_TASK:
- "milk done"
- "eggs ho gaye"
- "bread check mark karo"

DELETE_TASK:
- "tamatar hatao shopper se"
- "remove milk"
- "list se coriander hatao"

CLEAR_COMPLETED:
- "done tasks hatao"
- "clear completed tasks"
- "safai karo list ki"

LIST_ALL_LISTS:
- "mere saare lists dikhao"
- "show all my lists"
- "lists manage"

FIND_DOCUMENT:
- "sensiphere logo dikhao"
- "aadhar card ki photo bhejo"
- "give me my fee receipt"
- "my driving license please"

LIST_DOCUMENTS:
- "saare documents dikhao"
- "mere vault mein kya kya hai"
- "list my docs"

DELETE_DOCUMENT:
- "fee receipt delete karo"
- "aadhar wali file hatao"
- "sensiphere logo remove karo"

DELETE_ALL_DOCUMENTS:
- "saare documents delete kar do"
- "khali kar do vault"
- "remove everything"

GET_BRIEFING:
- "aaj ka briefing do"
- "morning update"
- "aaj kya kya hai"

HELP:
- "help"
- "kya kar sakte ho"
- "features batao"

UNKNOWN:
- General chat, questions, recipes, weather, jokes
- "kya haal hai"
- "chicken recipe batao"
- "aaj ka mausam kaisa hai"

## CRITICAL RULES
1. "Create X list with items" = ADD_TASK, NEVER FIND_DOCUMENT
2. If message has list items (bullet points, commas) = ADD_TASK
3. "dikhao/show/bhejo" alone on saved file name = FIND_DOCUMENT
4. Multiple tasks in one message = ADD_TASK with all items
5. Low confidence (< 0.6) = UNKNOWN, let auto-responder handle

## RESPONSE FORMAT (JSON only, no markdown)
{
  "intent": "INTENT_NAME",
  "confidence": 0.95,
  "extractedData": {
    "dateTimeText": "kal 5 bje",
    "reminderTitle": "doctor call",
    "taskContent": "milk, eggs, bread",
    "listName": "grocery",
    "documentQuery": "aadhar",
    "isMultiTask": true,
    "taskItems": ["milk", "eggs", "bread"]
  }
}
`

export async function classifyIntent(message: string, lang: string = 'en', context?: any): Promise<IntentResult> {
  const now = new Date()
  const istOffset = 5.5 * 60 * 60 * 1000
  const istDate = new Date(now.getTime() + istOffset)
  
  const dateStr = istDate.toDateString()
  const timeStr = istDate.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit' })

  // Context-aware hints
  const contextHint = context?.last_intent 
    ? `\nPrevious intent: ${context.last_intent}. Last list: ${context.last_list_name || 'none'}.`
    : ''

  try {
    const completion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { 
          role: 'user', 
          content: `Current local time (IST): ${dateStr}, ${timeStr}. Language: ${lang}.${contextHint}\n\nMessage: "${message}"` 
        }
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1,
      response_format: { type: 'json_object' }
    })

    const result = JSON.parse(completion.choices[0]?.message?.content || '{}')
    return {
      intent: (result.intent as Intent) || 'UNKNOWN',
      confidence: result.confidence || 0,
      extractedData: result.extractedData || {}
    }
  } catch (error) {
    console.error('[intent] classification error:', error)
    return { intent: 'UNKNOWN', confidence: 0, extractedData: {} }
  }
}
