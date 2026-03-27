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
  | 'GET_BRIEFING'
  | 'ONBOARDING'
  | 'HELP'
  | 'UNKNOWN'

export interface IntentResult {
  intent: Intent
  confidence: number        // 0-1
  extractedData: {
    dateTimeText?: string   // raw date/time string from message e.g. "kal 11 bje"
    taskContent?: string    // e.g. "milk"
    listName?: string       // e.g. "grocery"
    documentQuery?: string  // e.g. "aadhar", "passport"
    reminderTitle?: string  // e.g. "doctor appointment"
  }
}

const SYSTEM_PROMPT = `You are an intent classifier for a WhatsApp personal assistant called ZARA.
Classify the user message into exactly one intent. Return ONLY valid JSON, no explanation.

INTENTS:
- SET_REMINDER: user wants to set a reminder (kal, aaj, time mentioned, "remind me", "yaad dilana")
- SNOOZE_REMINDER: user wants to snooze/delay an existing reminder ("snooze", "baad mein", "15 min baad")
- LIST_REMINDERS: user wants to see their reminders ("meri reminders", "kya hai aaj")
- CANCEL_REMINDER: user wants to cancel a reminder ("cancel karo", "delete reminder")
- ADD_TASK: user wants to add item to a list ("add karo", "list mein daalo", "grocery mein milk")
- LIST_TASKS: user wants to see a list ("meri list", "grocery kya hai", "pending tasks")
- COMPLETE_TASK: user marking something as done ("done", "ho gaya", "complete")
- DELETE_TASK: user wants to remove a task ("remove karo", "delete task")

- FIND_DOCUMENT: user wants to retrieve a SPECIFIC saved document by name.
  RULE: If message contains a specific document name/type + action word → FIND_DOCUMENT
  Extract documentQuery = the document name only.
  Examples:
  → "mera aadhar dikhao" → FIND_DOCUMENT, documentQuery: "aadhar"
  → "fee receipt dikhao" → FIND_DOCUMENT, documentQuery: "fee receipt"
  → "meri fee reciept dikhao" → FIND_DOCUMENT, documentQuery: "fee reciept"
  → "passport do" → FIND_DOCUMENT, documentQuery: "passport"
  → "licence kahan hai" → FIND_DOCUMENT, documentQuery: "licence"
  → "marksheet bhejo" → FIND_DOCUMENT, documentQuery: "marksheet"
  → "insurance document chahiye" → FIND_DOCUMENT, documentQuery: "insurance"

- LIST_DOCUMENTS: user wants to see ALL saved documents (no specific name mentioned).
  RULE: Only use when NO specific document name is mentioned.
  Examples:
  → "mere documents dikhao" → LIST_DOCUMENTS
  → "kya save hai" → LIST_DOCUMENTS
  → "meri files" → LIST_DOCUMENTS
  → "vault dikhao" → LIST_DOCUMENTS
  → "documents list karo" → LIST_DOCUMENTS

- GET_BRIEFING: user wants daily summary ("aaj ka summary", "kya hai aaj", "briefing")
- HELP: user asking what bot can do ("help", "kya kar sakte ho", "menu")
- UNKNOWN: anything else (general chat, questions, greetings, etc.)

CRITICAL RULES:
1. If user mentions a SPECIFIC document name → always FIND_DOCUMENT
2. If user says "mere/meri/all/sab documents" with no specific name → LIST_DOCUMENTS
3. Extract documentQuery = only the document name, remove filler words like mera/meri/dikhao/do/bhejo/chahiye

Return JSON format:
{
  "intent": "INTENT_NAME",
  "confidence": 0.95,
  "extractedData": {
    "dateTimeText": "kal subah 11 bje",
    "reminderTitle": "doctor appointment",
    "taskContent": "milk",
    "listName": "grocery",
    "documentQuery": "aadhar"
  }
}
Only include extractedData fields that are relevant. Empty fields should be omitted.`

export async function classifyIntent(
  message: string,
  language: string = 'en'
): Promise<IntentResult> {
  try {
    const response = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',   // Fast + cheap for classification
      max_tokens: 200,
      response_format: { type: 'json_object' },
      temperature: 0.1,           // Low temp = consistent classification
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Language hint: ${language}\nMessage: ${message}` }
      ]
    })

    const raw = response.choices[0]?.message?.content ?? ''
    const parsed = JSON.parse(raw) as IntentResult
    return parsed
  } catch (err) {
    console.error('[intent] Classification failed:', err)
    // Safe fallback
    return {
      intent: 'UNKNOWN',
      confidence: 0,
      extractedData: {}
    }
  }
}
