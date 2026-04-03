# 🔬 ZARA Chatbot — Deep Analysis & Bug Report

> **Analyst:** Senior AI Engineer + Conversational Architect  
> **Files Analyzed:** 15+ core files  
> **Bugs Found:** 22 (6 Critical, 9 Major, 7 Minor)  
> **Date:** 2026-04-03

---

## 📁 Files Analyzed

| # | File | Purpose | Lines |
|---|------|---------|-------|
| 1 | [intent.ts](file:///c:/zara-complete/src/lib/ai/intent.ts) | Intent Classifier (Brain) | 78 |
| 2 | [chatbotIntelligence.ts](file:///c:/zara-complete/src/lib/infrastructure/chatbotIntelligence.ts) | Advanced Chat Engine | 345 |
| 3 | [autoResponder.ts](file:///c:/zara-complete/src/lib/autoResponder.ts) | AI Fallback Responder | 343 |
| 4 | [reminder.ts](file:///c:/zara-complete/src/lib/features/reminder.ts) | Reminder CRUD | 371 |
| 5 | [task.ts](file:///c:/zara-complete/src/lib/features/task.ts) | Task/List CRUD | 564 |
| 6 | [document.ts](file:///c:/zara-complete/src/lib/features/document.ts) | Document Vault | 535 |
| 7 | [route.ts](file:///c:/zara-complete/src/app/api/webhook/whatsapp/route.ts) | Webhook Router | 483 |
| 8 | [dateParser.ts](file:///c:/zara-complete/src/lib/ai/dateParser.ts) | Date/Time NLU Parser | 230 |
| 9 | [sessionContext.ts](file:///c:/zara-complete/src/lib/infrastructure/sessionContext.ts) | Session Memory | 55 |
| 10 | [onboarding.ts](file:///c:/zara-complete/src/lib/features/onboarding.ts) | User Onboarding | 148 |
| 11 | [language.ts](file:///c:/zara-complete/src/lib/ai/language.ts) | Language Detection | 112 |
| 12 | [templates.ts](file:///c:/zara-complete/src/lib/whatsapp/templates.ts) | Message Templates | 205 |
| 13 | [inputValidator.ts](file:///c:/zara-complete/src/lib/infrastructure/inputValidator.ts) | Input Validation | 300 |
| 14 | [briefing.ts](file:///c:/zara-complete/src/lib/features/briefing.ts) | Morning Briefing | 226 |
| 15 | [config/index.ts](file:///c:/zara-complete/src/config/index.ts) | Configuration | 112 |

---

## 🚨 CRITICAL BUGS (6)

### BUG-01: Intent Classifier Has No Conversation History
**File:** [intent.ts:49-61](file:///c:/zara-complete/src/lib/ai/intent.ts#L49-L61)  
**Severity:** 🔴 CRITICAL  
**Symptom from chat log:** Zara doesn't understand "Maine kya address bola tha?" because she has zero memory of what just happened.

**Problem:** The intent classifier only sends the current single message to the LLM. It doesn't send the conversation history. So when user says "vo wala", "it", "usse", "pehle wala" — the LLM has zero context.

**Root Cause:** `classifyIntent()` only passes `context.last_intent`, `last_list_name`, and `last_referenced_id` as text hints — but NOT the actual conversation messages. The LLM can't resolve pronouns or references.

**Fix Required:**
```diff
// intent.ts — Add conversation history to the classifier
+ const historyMessages = context?.conversation_history?.slice(-5) || []
+ const historyStr = historyMessages.length > 0
+   ? `\n\n[RECENT MESSAGES:\n${historyMessages.map(h => `${h.role}: ${h.content}`).join('\n')}\n]`  
+   : ''
  
  content: `Current local time (IST): ${dateStr}, ${timeStr}. Language: ${lang}.${contextHint}
-           \n\nMessage: "${message}"`
+           ${historyStr}\n\nMessage: "${message}"`
```

---

### BUG-02: Reminder Time Defaults to AM Instead of PM
**File:** [dateParser.ts:88-98](file:///c:/zara-complete/src/lib/ai/dateParser.ts#L88-L98)  
**Severity:** 🔴 CRITICAL  
**Symptom from chat log:** User says "2 baje" (meant 2 PM) → Zara sets 2 AM. User says "do subah mein nahi bajate" (correcting) but Zara doesn't fix it properly.

**Problem:** In `extractTime()`, when user says "2 bje" or "2 baje" (without AM/PM), the code treats it as raw 24-hour format. So "2 baje" → 02:00 (2 AM). But in Indian culture, "2 baje" almost always means 2 PM (afternoon). 

**Root Cause:** The `extractTime` function doesn't apply any contextual AM/PM inference. The `bje/baje` case just falls through with no adjustment.

**Fix Required:**
```diff
function extractTime(match: RegExpMatchArray): string {
  let hour = parseInt(match[1])
  const min = parseInt(match[2] ?? '0')
  const ampm = (match[3] ?? '').toLowerCase()

  if (ampm === 'pm' && hour < 12) hour += 12
  if (ampm === 'am' && hour === 12) hour = 0
- // bje/baje — already 24hr format assume
+ // bje/baje — apply smart AM/PM inference
+ // In Indian context: 1-5 baje without context = likely PM (afternoon)
+ // 6-11 baje = likely AM (morning) unless "shaam" context
+ if ((ampm === 'bje' || ampm === 'baje' || !ampm) && hour >= 1 && hour <= 5) {
+   hour += 12 // Default to PM for 1-5 baje
+ }

  return `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}
```

Also need to add context keywords in the Groq prompt:
```diff
// dateParser.ts buildPrompt()
+ - IMPORTANT AM/PM RULE: If user says just a number like "2 baje" or "5 bje" without am/pm:
+   - 1-5 baje = default AFTERNOON (PM) unless "subah" is mentioned
+   - 6-11 baje = default MORNING (AM) unless "shaam/raat" is mentioned
+   - 12 baje = NOON (PM)
```

---

### BUG-03: Reminder Title = Entire User Message (Garbage Title)
**File:** [reminder.ts:75-76](file:///c:/zara-complete/src/lib/features/reminder.ts#L75-L76) + [route.ts:289-290](file:///c:/zara-complete/src/app/api/webhook/whatsapp/route.ts#L289-L290)  
**Severity:** 🔴 CRITICAL  
**Symptom from chat log:** Reminder title became: *"Mujhe total teen karne hain cal ki date mein Ek karna hai do dusra karna hai teesra karna hai"* — this is the FULL user message, not a title.

**Problem:** Two issues:
1. **Webhook** passes `extractedData.reminderTitle || processedMessage` — if LLM doesn't extract a clean title, it falls back to the full message
2. **`cleanReminderTitle()`** only strips *known* filler words. It doesn't understand sentence structure. A sentence like "Mujhe total teen karne hain cal ki date mein..." has too many words to strip individually.

**Fix Required:**
1. Add LLM-based title extraction as a fallback
2. Improve `cleanReminderTitle` to cap title at ~40 chars and use the most meaningful phrase
3. In intent.ts prompt, explicitly instruct: "reminderTitle should be 2-5 words MAX"

```diff
// reminder.ts
function cleanReminderTitle(raw: string): string {
  let cleaned = raw
    .replace(/\b(remind|reminder|yaad|dilana|dilao|set|karo|please|bhai|yaar|mujhe|mein|ek|do|teen|total|karne|hain|date|cal|karna|hai|dusra|teesra|aur)\\b/gi, '')
    ...
    .trim()

+ // CRITICAL: Cap title length — no sentence-length titles
+ if (cleaned.length > 50) {
+   // Take first meaningful phrase (up to 50 chars, break at word boundary)
+   cleaned = cleaned.substring(0, 50).replace(/\s+\S*$/, '').trim()
+ }
+ 
+ // If still too short after cleaning, use first 5 words of original
+ if (cleaned.length < 3) {
+   cleaned = raw.split(/\s+/).slice(0, 5).join(' ').trim()
+ }

  return cleaned.length > 2 ? cleaned : raw.trim()
}
```

---

### BUG-04: Multiple Reminders Not Parsed from Single Message
**File:** [intent.ts](file:///c:/zara-complete/src/lib/ai/intent.ts) + [route.ts:282-294](file:///c:/zara-complete/src/app/api/webhook/whatsapp/route.ts#L282-L294)  
**Severity:** 🔴 CRITICAL  
**Symptom from chat log:** User says "teen reminder set karo — 2 PM, 5 PM, 8 PM" → Zara sets only ONE reminder with the entire sentence as the title.

**Problem:** The system has NO multi-reminder parsing. When user sends a message with 3 reminders, the intent classifier returns a single `SET_REMINDER` intent. There's no mechanism to split it.

**Fix Required:**
- Add `isMultiReminder: boolean` and `reminderItems: [{title, time}]` to `extractedData` in the intent classifier
- In `route.ts`, loop through items and call `handleSetReminder` for each
- Add instruction to the intent prompt:

```
If user sets multiple reminders in one message (e.g. "3 reminders: 2pm, 5pm, 8pm"),
set isMultiReminder: true and provide reminderItems: [{title: "Reminder 1", dateTimeText: "today 2pm"}, ...]
```

---

### BUG-05: Keyword Override Breaks Real Intent — "dikhao/show" Always = FIND_DOCUMENT
**File:** [route.ts:245-258](file:///c:/zara-complete/src/app/api/webhook/whatsapp/route.ts#L245-L258)  
**Severity:** 🔴 CRITICAL  

**Problem:** The keyword override block forces `FIND_DOCUMENT` whenever "dikhao" or "show" appears:
```typescript
if (lowerMessage.includes('dikhao') || lowerMessage.includes('show')) {
  intentResult.intent = 'FIND_DOCUMENT'
}
```

But "reminder list dikhao" should be `LIST_REMINDERS`, "task dikhao" should be `LIST_TASKS`, "grocery dikhao" should be `LIST_TASKS`. This override **hijacks** valid intents.

Similarly for delete — "task delete karo" gets forced to `DELETE_DOCUMENT` instead of `DELETE_TASK`.

**Fix Required:**
```diff
- if (lowerMessage.includes('dikhao') || lowerMessage.includes('show') || ...) {
-   if (intentResult.intent === 'UNKNOWN' || intentResult.confidence < 0.8) {
-     intentResult.intent = 'FIND_DOCUMENT'
-   }
- }
+ // Only override to FIND_DOCUMENT if no task/reminder keywords are present
+ const isTaskContext = /\b(task|list|grocery|todo|kaam|saaman|reminder)\b/i.test(lowerMessage)
+ if (!isTaskContext && (lowerMessage.includes('dikhao') || lowerMessage.includes('show'))) {
+   if (intentResult.intent === 'UNKNOWN' || intentResult.confidence < 0.8) {
+     intentResult.intent = 'FIND_DOCUMENT'
+   }
+ }
```

---

### BUG-06: Double Timezone Conversion — Reminders Fire at Wrong Time
**File:** [reminder.ts:116-122](file:///c:/zara-complete/src/lib/features/reminder.ts#L116-L122)  
**Severity:** 🔴 CRITICAL  

**Problem:** The dateParser already returns an ISO datetime with `+05:30` offset (IST). But `handleSetReminder` then **manually subtracts** 5.5 hours again:
```typescript
const istOffset = 5.5 * 60 * 60 * 1000
const utcDate = new Date(parsed.date.getTime() - istOffset) 
```

If the Groq LLM returns `2026-04-03T14:00:00+05:30` (2 PM IST), JavaScript `new Date()` already correctly interprets this as UTC 08:30. Then the code subtracts **another** 5.5 hours → stores 3:00 AM UTC = 8:30 AM IST. **Reminder fires 5.5 hours early!**

This explains why the chat log shows "3:30 AM" for a "2 baje" reminder.

**Fix Required:**
```diff
- // Timezone Correction (IST to UTC)  
- let finalScheduledAt: string | null = null
- if (parsed.date) {
-   const istOffset = 5.5 * 60 * 60 * 1000
-   const utcDate = new Date(parsed.date.getTime() - istOffset)
-   finalScheduledAt = utcDate.toISOString()
- }
+ // The parsed.date from Groq already has correct timezone info
+ // Just convert to ISO string directly — JS handles UTC conversion
+ let finalScheduledAt: string | null = null
+ if (parsed.date) {
+   finalScheduledAt = parsed.date.toISOString()
+ }
```

---

## ⚠️ MAJOR BUGS (9)

### BUG-07: "Address Save" Creates a Task Item Instead of Asking for Data
**File:** [intent.ts](file:///c:/zara-complete/src/lib/ai/intent.ts) + [route.ts](file:///c:/zara-complete/src/app/api/webhook/whatsapp/route.ts)  
**Severity:** 🟠 MAJOR  

**Problem:** User says "Mujhe ek address save karna hai" → Zara classifies it as `ADD_TASK` and adds "adress sev" to the General list. The classifier doesn't distinguish between "I want to save" (instruction) vs "save milk" (action).

**Fix:** Add few-shot examples to intent prompt:
```
## IMPORTANT EXAMPLES (Hinglish)
- "Mujhe address save karna hai" → intent: UNKNOWN (user is explaining, not giving data)
- "Add milk to grocery" → intent: ADD_TASK, taskContent: "milk", listName: "grocery"
- "Address save karo: Rahul, 123 MG Road, Delhi" → intent: ADD_TASK (has actual data)
```

---

### BUG-08: No SNOOZE_REMINDER or CANCEL_REMINDER Handling in Route
**File:** [route.ts:280-420](file:///c:/zara-complete/src/app/api/webhook/whatsapp/route.ts#L280-L420)  
**Severity:** 🟠 MAJOR  

**Problem:** The `switch(intent)` block has NO cases for `SNOOZE_REMINDER` or `CANCEL_REMINDER`, even though these are defined in the Intent type and the functions exist in `reminder.ts`. If user says "reminder cancel karo", the intent *might* classify correctly but route will fall through to `default` → autoResponder.

**Fix:** Add missing switch cases.

---

### BUG-09: Session Context Race Condition — Double Read-Write
**File:** [sessionContext.ts:26-38](file:///c:/zara-complete/src/lib/infrastructure/sessionContext.ts#L26-L38)  
**Severity:** 🟠 MAJOR  

**Problem:** `updateContext()` does `getContext()` first (read), then `upsert` (write). If two webhook calls arrive simultaneously for the same user, both read the same old context, then both write — one overwrites the other. The `addToHistory()` has the same issue.

**Fix:** Use Supabase RPC or a single atomic query instead of separate read+write.

---

### BUG-10: `cleanTaskContent` Strips Too Many Words — Including Valid Task Content
**File:** [task.ts:16-22](file:///c:/zara-complete/src/lib/features/task.ts#L16-L22)  
**Severity:** 🟠 MAJOR  

**Problem:** The regex strips common words like "me", "list", "grocery", "ki", "ka" which can be part of valid task content. Example: "***Me***dicine buy karo" → "dicine buy" (broken). "***Ka***li mirch add karo" → "li mirch" (broken).

**Fix:** Use word boundary more carefully or do extraction via LLM instead of regex.

---

### BUG-11: `document.ts` cleanLabel Strips Valid Document Names
**File:** [document.ts:508-517](file:///c:/zara-complete/src/lib/features/document.ts#L508-L517)  
**Severity:** 🟠 MAJOR  

**Problem:** `cleanLabel()` strips words like "aadhar", "passport", "license", "certificate", "bill" — but these are exactly the labels users WANT for their documents! A caption "mera aadhar save karo" becomes "" after cleaning, because "mera", "aadhar", "save", "karo" are all stripped.

**Fix:** Remove document-name words from the strip list:
```diff
- .replace(/\b(mera|meri|ka|ki|ke|save|karo|naam|label|please|bhai|document|photo|file|bill|aadhar|passport|license|licence|certificate|scan|copy|original)\b/gi, '')
+ .replace(/\b(mera|meri|ka|ki|ke|save|karo|naam|label|please|bhai|document|photo|file)\b/gi, '')
```
Keep "aadhar", "passport", "bill", "certificate", "license" — they're the actual label the user wants.

---

### BUG-12: Conversation History Not Passed to AutoResponder Properly
**File:** [autoResponder.ts:149-169](file:///c:/zara-complete/src/lib/autoResponder.ts#L149-L169)  
**Severity:** 🟠 MAJOR  

**Problem:** `fetchConversationHistory()` fetches from `whatsapp_messages` table, but the *current* user message hasn't been marked as responded yet. Also, bot responses from feature handlers (reminder set, task added) are NOT stored in `whatsapp_messages` — they're sent directly via `sendWhatsAppMessage()`. So the autoResponder's history is incomplete.

**Fix:** Either:
1. Store all feature handler responses in `whatsapp_messages`, or
2. Use the `sessions.conversation_history` (sessionContext) instead of `whatsapp_messages` for history

---

### BUG-13: Language Detection Classifies Hinglish as English
**File:** [language.ts:34-36](file:///c:/zara-complete/src/lib/ai/language.ts#L34-L36)  
**Severity:** 🟠 MAJOR  

**Problem:** `ENGLISH_ONLY` regex matches `[a-zA-Z0-9\s...]` — but Hinglish is also written in English alphabets! "Mujhe reminder set karna hai" passes the `ENGLISH_ONLY` test → returns `'en'`. User then gets English responses instead of Hinglish.

**Fix:** Check `HINDI_WORDS` BEFORE the `ENGLISH_ONLY` check:
```diff
function detectLocally(text: string): Language | null {
    if (GUJARATI_SCRIPT.test(text)) return 'gu'
    if (HINDI_SCRIPT.test(text)) return 'hi'
-   if (ENGLISH_ONLY.test(text)) return 'en'
    if (GUJARATI_WORDS.test(text)) return 'gu'
    if (HINDI_WORDS.test(text)) return 'hi'
+   if (ENGLISH_ONLY.test(text)) return 'en'
    return null
}
```

---

### BUG-14: Duplicate Check Uses Partial Title Match — False Positives
**File:** [reminder.ts:80-102](file:///c:/zara-complete/src/lib/features/reminder.ts#L80-L102)  
**Severity:** 🟠 MAJOR  

**Problem:** `ilike('title', '%${title.substring(0, 20)}%')` — uses only first 20 chars for matching. If two reminders have similar starts like "Call Mom at..." and "Call Mom tomorrow...", the second one will be blocked as a "duplicate".

**Fix:** Use full title or at least 40 chars, and also match within a smaller time window (±30 min) instead of just "any future time".

---

### BUG-15: Webhook Doesn't Mark `is_responded` for Feature Handler Responses
**File:** [route.ts:446-452](file:///c:/zara-complete/src/app/api/webhook/whatsapp/route.ts#L446-L452)  
**Severity:** 🟠 MAJOR  

**Problem:** The `is_responded` update happens AFTER the switch block, but if any handler throws an error, it falls to the catch block which calls `generateAutoResponse` (which internally marks the message too). But if the feature handler sends a message but doesn't throw, and then the `is_responded` update fails — the next webhook retry will re-process the same message.

This can cause duplicate reminders, duplicate tasks, etc.

---

## 📋 MINOR BUGS (7)

### BUG-16: `humanizeResponse` Inserts Name at Wrong Position
**File:** [chatbotIntelligence.ts:299-301](file:///c:/zara-complete/src/lib/infrastructure/chatbotIntelligence.ts#L299-L301)  
**Severity:** 🟡 MINOR  

**Problem:** `response.substring(0, 1) + opening + response.substring(1)` — inserts the name AFTER the first character. "✅ Done!" → "✅ Hey Yash!  Done!" (double space, broken emoji context).

---

### BUG-17: `addToHistory` Called Only for AutoResponder, Not Feature Handlers
**File:** [route.ts:432-442](file:///c:/zara-complete/src/app/api/webhook/whatsapp/route.ts#L432-L442)  
**Severity:** 🟡 MINOR  

**Problem:** When a feature handler (SET_REMINDER, ADD_TASK) processes a message, only `addToHistory(user.id, 'user', processedMessage)` is called — the assistant's response is NOT added to history. So the conversation context is always incomplete.

---

### BUG-18: `errorHandler.ts` `retryWithExponentialBackoff` Not Used Consistently
**Severity:** 🟡 MINOR  

**Problem:** Only `getOrCreateUser` uses retry. The Groq API calls in `dateParser`, `intent`, `autoResponder` — none use retry. Rate limit 429 errors could be recovered with a simple retry.

---

### BUG-19: `cleanReminderTitle` Doesn't Handle Numbers-Only Titles
**File:** [reminder.ts:16-33](file:///c:/zara-complete/src/lib/features/reminder.ts#L16-L33)  
**Severity:** 🟡 MINOR  

**Problem:** If user says "2 baje ka reminder", after cleaning all time/filler words, the result is "" (empty). Falls back to the raw string which might also be just times.

---

### BUG-20: `validatePlainText` strips HTML but not markdown — Allows Bold Injection
**File:** [inputValidator.ts:81-94](file:///c:/zara-complete/src/lib/infrastructure/inputValidator.ts#L81-L94)  
**Severity:** 🟡 MINOR  

WhatsApp uses markdown (*bold*, _italic_). A malicious user could inject `*bold*` text to make bot responses look official. Minor risk.

---

### BUG-21: IST Time Display Shows Wrong Time in Reminder List
**File:** [reminder.ts:187-191](file:///c:/zara-complete/src/lib/features/reminder.ts#L187-L191)  
**Severity:** 🟡 MINOR  

**Problem:** The `scheduled_at` in DB is already offset by BUG-06's double conversion. So `toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })` adds ANOTHER offset when displaying. Result: displayed times are 5.5 hours off from what user expected.

**Fix:** Fixing BUG-06 automatically fixes this.

---

### BUG-22: Abuse Pattern Too Aggro — Catches "sale" (as in discount)
**File:** [route.ts:261](file:///c:/zara-complete/src/app/api/webhook/whatsapp/route.ts#L261)  
**Severity:** 🟡 MINOR  

**Problem:** `\b(sale)\b` matches "sale" as in shopping sale. User saying "Amazon sale kab hai?" gets an abuse warning.

**Fix:** Remove "sale" from the abuse list or use bigram context ("saale" is abuse, "sale" alone is not).

---

## 🏗️ Architecture Improvements Needed

### 1. Intent Classifier Needs Few-Shot Examples (Hinglish)
Add 8-10 examples directly in the system prompt:

```
EXAMPLES:
User: "Kal 2 baje reminder laga do" → {intent: "SET_REMINDER", reminderTitle: "Reminder", dateTimeText: "kal 2 baje PM"}
User: "Mere reminders dikhao" → {intent: "LIST_REMINDERS"}
User: "Grocery mein doodh add karo" → {intent: "ADD_TASK", taskContent: "doodh", listName: "grocery"}
User: "Mujhe address save karna hai batao kaise" → {intent: "UNKNOWN"} (user is asking HOW, not giving data)
User: "Done" → {intent: "UNKNOWN"} (conversational, not a command)
User: "Vo wala bhejo" → Use CONTEXT to resolve "vo wala"
User: "3 reminder set kar: 2pm, 5pm, 8pm" → {intent: "SET_REMINDER", isMultiReminder: true, ...}
```

### 2. Conversation Memory is Fragmented
Currently there are THREE separate "memory" systems:
- `sessionContext.ts` → `sessions` table (conversation_history)
- `autoResponder.ts` → `whatsapp_messages` table (fetchConversationHistory)
- `chatbotIntelligence.ts` → In-memory `conversationHistory` array

**Recommendation:** Unify into ONE source of truth. Use `sessions.conversation_history` everywhere.

### 3. Feature Handler Responses Not Logged
When `handleSetReminder` sends "⏰ Reminder set!", this message is NOT stored in any history table. So:
- AutoResponder can't see what Zara just said
- Intent classifier can't see the full conversation
- User asks "tu ne kya bola?" → Zara has amnesia

**Fix:** After every `sendWhatsAppMessage` in feature handlers, also call `addToHistory(userId, 'assistant', message)`.

### 4. Smart Follow-Up System Missing
Currently Zara never asks clarifying questions. If intent confidence < 0.6, she should ask:
```
"Main samajh nahi paya — kya aap reminder set kar rahe ho, ya task add kar rahe ho? 🤔"
```

### 5. Rate Limiting is Per-IP, Not Per-User
The `rateLimiter.ts` exists but isn't used in the webhook. A single user could spam 100 messages/second and overload the Groq API.

---

## 📊 Priority Implementation Order

| Priority | Bug ID | Impact | Effort |
|----------|--------|--------|--------|
| 🔴 P0 | BUG-06 | Reminders fire at wrong time | Small |
| 🔴 P0 | BUG-02 | 2 baje = 2 AM instead of PM | Small |
| 🔴 P0 | BUG-03 | Garbage reminder titles | Medium |
| 🔴 P0 | BUG-01 | No conversation context | Medium |
| 🔴 P0 | BUG-05 | "dikhao" hijacks all intents | Small |
| 🔴 P1 | BUG-08 | Snooze/Cancel not routed | Small |
| 🔴 P1 | BUG-04 | Multiple reminders not parsed | Large |
| 🟠 P1 | BUG-11 | Document labels stripped | Small |
| 🟠 P1 | BUG-13 | Hinglish = English detection | Small |
| 🟠 P2 | BUG-07 | "Save karna hai" = task | Medium |
| 🟠 P2 | BUG-14 | False duplicate detection | Small |
| 🟠 P2 | BUG-12 | Incomplete conversation history | Medium |

---

## ✅ Summary

Yash ke chat log mein jo problems dikhi, unke **root causes** ye hain:

1. **"Address save" galat add hua** → BUG-07 (intent doesn't understand "I want to" vs "do it now")
2. **"Maine kya bola tha" ka answer nahi** → BUG-01 (no conversation history in classifier)
3. **2 baje = 2 AM set hua** → BUG-02 (no smart AM/PM inference) + BUG-06 (double timezone offset)
4. **Pura sentence = reminder title** → BUG-03 (no title extraction/capping)
5. **3 reminders mein 1 hi set hua** → BUG-04 (no multi-reminder parsing)
6. **Wrong time display (3:30 AM)** → BUG-06 (double timezone subtraction)

**Agar BUG-06, BUG-02, BUG-03, BUG-01, BUG-05 fix ho jaayein — 80% problems solve ho jayengi.**

> Bata bhai — kya main ab code changes implement karna shuru karun? Sabse pehle P0 bugs fix karunga.
