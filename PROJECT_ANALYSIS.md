# ZARA Chatbot — Complete Project Analysis & Architecture Guide

## 📋 Executive Summary

**ZARA** is a **production-grade WhatsApp personal assistant** built with Next.js 16, Supabase, and AI providers (Groq, Mistral). It enables users to manage reminders, tasks, documents, and have context-aware conversations entirely through WhatsApp in multiple languages (English, Hindi, Gujarati).

**Project Type**: Full-stack web application  
**Frontend**: Next.js App Router with React 19  
**Backend**: Next.js API routes (20+ hardened endpoints)  
**Database**: Supabase PostgreSQL with RLS  
**AI/ML**: Groq Llama models + Mistral embeddings  
**External APIs**: WhatsApp (11za.in), Google Drive, Vercel  
**Testing**: Vitest with 100% core coverage goal  
**Deployment**: Vercel (Singapore region - `sin1`)

---

## 🏗️ Overall Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ZARA ARCHITECTURE                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                      PRESENTATION LAYER                      │  │
│  │  • Next.js Pages (Chat, Files, OCR)                         │  │
│  │  • Tailwind UI Components (Button, Card, Input, etc.)       │  │
│  │  • Responsive design for mobile-first                       │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                              ↓                                       │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                      API ORCHESTRATION LAYER                 │  │
│  │  • 20+ Route Handlers (API routes)                          │  │
│  │  • Webhook Processing (WhatsApp → Intent → Handler)        │  │
│  │  • Authentication & Authorization (Google OAuth)            │  │
│  │  • Cron Jobs (Morning Briefing, Reminders)                 │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                              ↓                                       │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    BUSINESS LOGIC LAYER                      │  │
│  │  ┌─────────────────────────────────────────────────────┐   │  │
│  │  │ Feature Modules                                     │   │  │
│  │  │ • Reminder (set, list, snooze, cancel, recurring) │   │  │
│  │  │ • Task (add, list, complete, delete)              │   │  │
│  │  │ • Document (save, find, delete)                   │   │  │
│  │  │ • Briefing (morning summary)                       │   │  │
│  │  │ • Onboarding (user setup & language detection)    │   │  │
│  │  └─────────────────────────────────────────────────────┘   │  │
│  │                                                               │  │
│  │  ┌─────────────────────────────────────────────────────┐   │  │
│  │  │ AI/ML Layer                                         │   │  │
│  │  │ • Intent Classification (Groq)                       │   │  │
│  │  │ • Language Detection (local + Groq)                 │   │  │
│  │  │ • Date/Time Parsing (LLM + regex)                   │   │  │
│  │  │ • Speech-to-Text (Whisper)                          │   │  │
│  │  │ • Auto-Response Generation (context-aware)          │   │  │
│  │  │ • Embeddings & Vector Search (Mistral)              │   │  │
│  │  └─────────────────────────────────────────────────────┘   │  │
│  │                                                               │  │
│  │  ┌─────────────────────────────────────────────────────┐   │  │
│  │  │ Infrastructure Utilities                            │   │  │
│  │  │ • Database Client (Singleton + Query Cache)         │   │  │
│  │  │ • Logger (Structured + Analytics)                   │   │  │
│  │  │ • Error Handler (Typed errors + Recovery)           │   │  │
│  │  │ • Input Validator (Sanitization + Type safety)      │   │  │
│  │  │ • Rate Limiter (Per-user, Per-IP)                   │   │  │
│  │  │ • Session Context (Pending actions + History)       │   │  │
│  │  └─────────────────────────────────────────────────────┘   │  │
│  │                                                               │  │
│  │  ┌─────────────────────────────────────────────────────┐   │  │
│  │  │ Integration Adapters                                │   │  │
│  │  │ • WhatsApp Client (11za API wrapper)                │   │  │
│  │  │ • Google Drive (OAuth + File Upload)                │   │  │
│  │  │ • Webhook Processor (Deduplication + Retry)         │   │  │
│  │  └─────────────────────────────────────────────────────┘   │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                              ↓                                       │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                       DATA ACCESS LAYER                      │  │
│  │  • Supabase Client (Admin Service Role)                     │  │
│  │  • Storage (Documents in Supabase + Google Drive)           │  │
│  │  • Query Builder (TypeScript-safe)                          │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                              ↓                                       │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                     EXTERNAL SERVICES                        │  │
│  │  • Supabase PostgreSQL (Primary Database)                   │  │
│  │  • Vercel Storage (Document Vault)                          │  │
│  │  • Google Drive Storage (Backup & Organizational)           │  │
│  │  • Groq API (LLM Inference)                                 │  │
│  │  • Mistral API (Embeddings)                                 │  │
│  │  • 11za WhatsApp API (Message Routing)                      │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 📁 Project Structure & File Organization

```
zara-complete/
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── api/                      # 20+ API endpoints
│   │   │   ├── auth/                 # Google OAuth flow
│   │   │   ├── chat/                 # RAG-based chat
│   │   │   ├── cron/                 # Scheduled jobs
│   │   │   ├── files/                # File management
│   │   │   ├── ocr/                  # Document OCR
│   │   │   ├── webhook/              # WhatsApp webhook
│   │   │   ├── phone-groups/         # Bot grouping
│   │   │   ├── health/               # Status endpoint
│   │   │   ├── process-file/         # Document processing
│   │   │   └── ...
│   │   ├── chat/                     # Chat page
│   │   ├── files/                    # File manager page
│   │   ├── ocr/                      # OCR interface
│   │   ├── page.tsx                  # Landing page (Hinglish)
│   │   ├── layout.tsx                # Root layout
│   │   └── globals.css
│   │
│   ├── lib/
│   │   ├── infrastructure/           # Core utilities
│   │   │   ├── database.ts           # Supabase singleton + query cache
│   │   │   ├── logger.ts             # Structured logging
│   │   │   ├── errorHandler.ts       # Typed errors
│   │   │   ├── inputValidator.ts     # Sanitization & validation
│   │   │   ├── rateLimiter.ts        # In-memory rate limiting
│   │   │   └── sessionContext.ts     # User state management
│   │   │
│   │   ├── ai/                       # AI/ML layer
│   │   │   ├── clients.ts            # Groq + Mistral singletons
│   │   │   ├── provider.ts           # Provider abstraction (with fallback)
│   │   │   ├── intent.ts             # Intent classification
│   │   │   ├── language.ts           # Language detection (local + API)
│   │   │   ├── dateParser.ts         # Natural language date parsing
│   │   │   └── stt.ts                # Speech-to-text
│   │   │
│   │   ├── features/                 # Business logic
│   │   │   ├── reminder.ts           # Set/list/snooze/cancel
│   │   │   ├── task.ts               # Tasks & lists CRUD
│   │   │   ├── document.ts           # Document vault
│   │   │   ├── briefing.ts           # Morning briefing
│   │   │   └── onboarding.ts         # User onboarding
│   │   │
│   │   ├── whatsapp/                 # WhatsApp integration
│   │   │   ├── client.ts             # Modern wrapper (11za)
│   │   │   ├── sender.ts             # Legacy sender
│   │   │   └── templates.ts          # Message templates (multi-language)
│   │   │
│   │   ├── autoResponder.ts          # AI chat fallback
│   │   ├── googleDrive.ts            # Google Drive OAuth + upload
│   │   └── utils.ts                  # Shared utilities
│   │
│   ├── components/                   # React components
│   │   └── ui/                       # Radix-based components
│   │       ├── button.tsx
│   │       ├── card.tsx
│   │       ├── input.tsx
│   │       ├── textarea.tsx
│   │       ├── switch.tsx
│   │       ├── tabs.tsx
│   │       ├── scroll-area.tsx
│   │       └── file-upload.tsx
│   │
│   ├── config/                       # Centralized config
│   │   └── index.ts                  # Env validation + constants
│   │
│   ├── types/                        # TypeScript definitions
│   │   └── index.ts                  # Unified type exports
│   │
│   └── __tests__/                    # Unit tests
│       ├── setup.ts
│       └── *.test.ts
│
├── migrations/
│   ├── MASTER_SCHEMA.sql            # Complete database schema
│   ├── 009_google_drive.sql         # Google Drive migrations
│   └── ...
│
├── public/                           # Static assets
├── docs/                             # Project documentation
├── package.json                      # Dependencies
├── tsconfig.json                     # TypeScript config
├── next.config.ts                    # Next.js config
├── vitest.config.ts                  # Testing config
├── vercel.json                       # Vercel deployment config
└── README.md
```

---

## 🔄 Request/Response Flows

### 1. **User Message Entry Point (WhatsApp Webhook)**

```
WhatsApp Message
      ↓
[POST /api/webhook/whatsapp]
      ↓
├─ Parse webhook payload (phone, message, media, etc.)
├─ Validate phone numbers
├─ Insert to whatsapp_messages (deduplication check)
├─ Check if duplicate (Unique violation = silent ignore)
│
├─ [IF NEW MESSAGE]
│   ├─ Get or create user
│   ├─ [IF AUDIO/VOICE]
│   │   └─ Speech-to-Text (Whisper)
│   │
│   ├─ [IF IMAGE/PDF]
│   │   ├─ handleSaveDocument
│   │   └─ Check session context for pending_action
│   │
│   ├─ [IF TEXT]
│   │   ├─ Load session context (pending actions, history)
│   │   ├─ Check for pending actions (e.g., awaiting_label)
│   │   │   └─ If awaiting_label → Update document + clear state
│   │   │
│   │   ├─ Classify intent
│   │   │   ├─ Local fast check (conversational cues)
│   │   │   └─ Groq intent classifier (JSON response)
│   │   │
│   │   ├─ Keyword-based safety overrides
│   │   │   ├─ "dikhao/show" → FIND_DOCUMENT
│   │   │   └─ "delete/hatao" → DELETE_DOCUMENT
│   │   │
│   │   ├─ Abuse/gali detection (prepend warning if found)
│   │   │
│   │   └─ Switch on intent:
│   │       ├─ SET_REMINDER → handleSetReminder()
│   │       ├─ LIST_REMINDERS → handleListReminders()
│   │       ├─ SNOOZE_REMINDER → handleSnoozeReminder()
│   │       ├─ ADD_TASK → handleAddTask()
│   │       ├─ LIST_TASKS → handleListTasks()
│   │       ├─ COMPLETE_TASK → handleCompleteTask()
│   │       ├─ FIND_DOCUMENT → handleFindDocument()
│   │       ├─ DELETE_DOCUMENT → handleDeleteDocument()
│   │       ├─ GET_BRIEFING → handleGetBriefing()
│   │       ├─ HELP → Send helpMessage()
│   │       └─ UNKNOWN → generateAutoResponse() (AI chat)
│   │
│   └─ Send WhatsApp reply via 11za API
│
└─ Return { ok: true } to webhook
```

### 2. **Reminder Creation Flow**

```
User: "Kal 6 bje doctor yaad dilana"
      ↓
handleSetReminder({userId, phone, language, message})
      ↓
├─ Parse datetime from message (Groq + regex)
│   ├─ Quick patterns first (X minutes baad, X ghante baad)
│   └─ Groq fallback for complex expressions
│
├─ Validate date (not past, not too close < 60s)
├─ Clean title (remove verbs, preambles)
├─ Check for duplicates (title similarity + time overlap)
├─ Validate title not too short
├─ Convert timezone (IST → UTC)
│
├─ Insert to reminders table
│   ├─ title: "doctor"
│   ├─ scheduled_at: "TOMORROW 18:00 UTC"
│   ├─ status: "pending"
│   ├─ recurrence: null (for one-time)
│   └─ metadata: {}
│
└─ Send confirmation: "⏰ डॉक्टर - कल 6:00 PM को याद दिलाऊंगा"
```

### 3. **Task Management Flow**

```
User: "Grocery mein milk add karo"
      ↓
handleAddTask({userId, phone, listName: "grocery", taskContent: "milk"})
      ├─ Clean task content (remove filler words)
      ├─ Normalize list name ("groceries" → "grocery", "kirana" → "grocery")
      │
      ├─ Check for duplicates (same list + similar content)
      │
      ├─ Get or create list (RPC: get_or_create_list)
      │   └─ If list exists, use its ID
      │   └─ If not, create and return ID
      │
      ├─ Insert task (list_id, user_id, content, completed: false)
      │
      └─ Send: "✅ Milk को grocery list में जोड़ दिया!"
```

### 4. **Document Save Flow**

```
User sends Image/PDF with caption "Aadhar"
      ↓
handleSaveDocument({userId, phone, mediaUrl, mediaType, caption})
      ├─ Validate MIME type (image/*, application/pdf)
      ├─ Download media from WhatsApp (with 11za auth)
      ├─ Validate file size (< 10MB)
      ├─ Check for duplicates (by caption)
      │
      ├─ Determine storage:
      │   ├─ IF Google Drive connected:
      │   │   └─ uploadToDrive() → driveFileId
      │   └─ ELSE:
      │       └─ Upload to Supabase Storage
      │
      ├─ Insert to documents table:
      │   ├─ label: "aadhar"
      │   ├─ drive_file_id or storage_path
      │   ├─ storage_type: "google_drive" | "supabase"
      │   ├─ doc_type: "pdf" | "image"
      │   └─ file_size
      │
      └─ If no caption:
          └─ Save to session (pending_action: "awaiting_label")
          └─ Request: "इसे क्या नाम दूं?"
```

### 5. **Document Retrieval Flow**

```
User: "Aadhar dikhao"
      ↓
handleFindDocument({userId, phone, query: "aadhar"})
      ├─ Clean query (lowercase, remove articles)
      ├─ Search documents table (fuzzy match on label)
      │
      ├─ IF FOUND:
      │   ├─ IF storage_type == "google_drive":
      │   │   └─ Generate shareable link
      │   └─ IF storage_type == "supabase":
      │       └─ Generate signed download URL
      │
      │   └─ Send document link via WhatsApp
      │
      └─ IF NOT FOUND:
          └─ Send: "🔍 aadhar के लिए कोई डॉक्यूमेंट नहीं मिला"
```

### 6. **Morning Briefing Flow (Cron)**

```
[GET /api/cron/briefing at 9 AM IST]
      ↓
├─ Verify CRON_SECRET header
├─ Query users_due_for_briefing view
│   └─ Selects users with pending tasks & today's reminders
│
├─ For each user:
│   ├─ Check if already sent today (briefing_logs table)
│   ├─ Fetch today's reminders (scheduled_at BETWEEN today start/end)
│   ├─ Fetch pending tasks (top 5)
│   ├─ Build localized message (en/hi/gu)
│   ├─ Send via WhatsApp
│   └─ Log to briefing_logs
│
└─ Return { sent: N, failed: M }
```

### 7. **Auto-Response Flow (Fallback)**

```
Message classified as UNKNOWN
      ↓
generateAutoResponse({userId, phone, message, botPhoneNumber})
      ├─ Check if already responded (is_responded flag)
      ├─ Check for recent outgoing (avoid loops)
      │
      ├─ Fetch phone config (system_prompt, auth_token, origin)
      ├─ Fetch conversation history (last 10 messages)
      │
      ├─ Build system prompt:
      │   ├─ Merge phone-specific + base ZARA rules
      │   ├─ Inject abuse handling rules
      │   └─ Enforce user message length to prevent hallucination
      │
      ├─ Call Groq with context
      │   ├─ Temperature: 0.3 (deterministic)
      │   ├─ Max tokens: 300
      │   └─ System prompt + conversation history
      │
      ├─ Strip forbidden phrases (e.g., "I'm an AI language model")
      ├─ Truncate if too long
      │
      ├─ Send reply via 11za API
      ├─ Persist bot message to whatsapp_messages
      └─ Mark original as is_responded = true
```

---

## 🔌 Integration Points

### **WhatsApp (11za.in) API**

| Operation | Endpoint | Purpose |
|-----------|----------|---------|
| Send Text | `POST /apis/sendMessage/sendMessages` | Primary message routing |
| Send Media | `POST /apis/sendMessage/sendMedia` | Image/PDF delivery |
| Send Template | `POST /apis/template/sendTemplate` | Pre-approved message templates |
| Webhook | Configured in 11za dashboard | Incoming message notification |

**Authentication**: OAuth token per phone number (stored in `phone_document_mapping.auth_token`)

**Error Handling**:
- Media fails → Fallback to text with TinyURL shortened link
- Retry with exponential backoff for transient errors

---

### **Google Drive API**

**Flows**:
1. **OAuth Approval**: User clicks link → Google consent screen → Redirect back with auth code
2. **Token Management**: Store `access_token`, `refresh_token`, `expiry` in users table
3. **Auto-Refresh**: 5 minutes before expiry, automatically refresh
4. **Upload**: Multipart upload to "ZARA Vault" folder
5. **Sync**: On connection, offer to sync old Supabase documents

**Error Handling**: If Drive fails, fallback to Supabase storage (user notified)

---

### **Groq API (Language Models)**

| Model | Use Case | Max Tokens |
|-------|----------|------------|
| llama-3.3-70b-versatile | Intent classification, auto-response | 500-8192 |
| llama-3.1-8b-instant | Date parsing, language detection | 200-1000 |
| whisper-large-v3 | Speech-to-text | - |

**Features**:
- Provider abstraction with fallback (`completionWithFallback`)
- JSON response format for structured outputs
- Temperature tuning per use case (0.05 for date parsing, 0.3 for chat)
- Error logging with retry mechanism

---

### **Mistral API (Embeddings)**

| Model | Use Case | Dimension |
|-------|----------|-----------|
| mistral-embed | Document chunks | 1024 |

**Vector Search**: IVFFlat index on `rag_chunks.embedding` for fast similarity search

---

## 🗄️ Database Schema (Key Tables)

### **users**
```sql
id UUID PRIMARY KEY
phone TEXT UNIQUE NOT NULL          -- WhatsApp phone
name TEXT                          -- User's display name
onboarded BOOLEAN (default: false) -- Onboarding completion flag
language TEXT (en/hi/gu)          -- Detected/preferred language
timezone TEXT (default: Asia/Kolkata)
google_access_token TEXT?          -- OAuth token (encrypted in production)
google_refresh_token TEXT?
google_token_expiry TIMESTAMPTZ?
google_drive_folder_id TEXT?       -- ZARA Vault folder ID
created_at, updated_at
```

### **reminders**
```sql
id UUID PRIMARY KEY
user_id UUID → users
title TEXT NOT NULL                -- "doctor", "call mom"
note TEXT?
scheduled_at TIMESTAMPTZ          -- NULL for recurring
recurrence ENUM (daily/weekly/monthly)?
recurrence_time TEXT (HH:MM)      -- For recurring: "09:00"
status ENUM (pending/completed/snoozed/cancelled/sent)
snooze_count INT
metadata JSONB                     -- Custom fields
created_at, updated_at

CREATE INDEX idx_reminders_due ON reminders (scheduled_at)
  WHERE status IN ('pending', 'snoozed');
```

### **tasks**
```sql
id UUID PRIMARY KEY
user_id UUID → users
list_id UUID → lists
content TEXT NOT NULL              -- "milk", "buy groceries"
completed BOOLEAN (default: false)
completed_at TIMESTAMPTZ?
priority INT
created_at, updated_at
```

### **lists**
```sql
id UUID PRIMARY KEY
user_id UUID → users
name TEXT NOT NULL                 -- "grocery", "office", "shopping"
color TEXT?
created_at
UNIQUE(user_id, name)
```

### **documents**
```sql
id UUID PRIMARY KEY
user_id UUID → users
label TEXT NOT NULL                -- "aadhar", "passport"
storage_path TEXT?                 -- supabase://documents/userId/...
drive_file_id TEXT?                -- Google Drive file ID
storage_type ENUM (supabase/google_drive)
doc_type ENUM (pdf/image)
mime_type TEXT                     -- "application/pdf", "image/jpeg"
file_size INT?
ocr_text TEXT?                     -- Future: OCR extracted text
uploaded_at TIMESTAMPTZ
```

### **sessions**
```sql
id UUID PRIMARY KEY
user_id UUID → users (UNIQUE)
context JSONB = {
  last_intent: string?
  pending_action: string?            -- "awaiting_label"
  document_id: UUID?
  document_path: string?
  drive_file_id: string?
  conversation_history: Message[]
}
created_at, updated_at
```

### **whatsapp_messages**
```sql
id BIGSERIAL PRIMARY KEY
message_id TEXT UNIQUE NOT NULL    -- Webhook deduplication key
channel TEXT = "whatsapp"
from_number TEXT                   -- User's phone
to_number TEXT                     -- Bot's phone
received_at TIMESTAMPTZ
content_type TEXT?                 -- "text", "image", "document", "audio"
content_text TEXT?
sender_name TEXT?
event_type TEXT (MoMessage/MtMessage)
is_in_24_window BOOLEAN            -- WhatsApp 24hr window
is_responded BOOLEAN               -- Has response been sent?
auto_respond_sent BOOLEAN
response_message_id TEXT?
response_sent_at TIMESTAMPTZ?
raw_payload JSONB                  -- Full webhook payload
trace_id UUID                      -- For tracing
created_at, updated_at

CREATE INDEX idx_whatsapp_messages_message_id (message_id);
CREATE INDEX idx_whatsapp_messages_from_number (from_number);
CREATE INDEX idx_whatsapp_messages_received_at (received_at DESC);
```

### **RAG Ecosystem** (for document-based chat)
- `rag_files`: Indexed PDFs/images
- `rag_chunks`: Text chunks with embeddings (vector search via IVFFlat)
- `phone_document_mapping`: Associates bot phone → RAG file for context

---

## 🎯 Core Features Detailed

### **1. Reminders**

**Supported Patterns**:
- One-time: "kal 6 bje" (tomorrow at 6 PM)
- Recurring: "har din 9 AM" (every day at 9 AM)
- Relative: "2 ghante baad" (in 2 hours)
- Days: "har Friday shaam 5 bje" (every Friday at 5 PM)
- Natural language dates: "parso subah" (day-after-tomorrow morning)

**Guardrails**:
- Minimum lead time: 60 seconds
- Past/invalid times rejected
- Duplicate detection (same title + nearby time)
- Auto-cleanup of completed/cancelled reminders

**Recurring Logic**:
- Stored with `recurrence` enum + `recurrence_time` (HH:MM format)
- Cron job processes each day before 9 AM IST
- Creates new reminder instance for next occurrence

---

### **2. Tasks & Lists**

**Multi-Item Addition**:
```
"Add milk, bread, eggs to grocery" 
→ Parsed on \n,،\- delimiters
→ 3 tasks created in parallel
```

**List Normalization**:
- "shopping" → "grocery"
- "kirana" → "grocery"
- "office tasks" → "office"
- "to-do" → "general"

**Smart Defaults**:
- List name defaults to "general" if not specified
- Completed tasks show with strikethrough
- Generic search ("tasks", "all list") shows all lists

---

### **3. Document Management**

**Dual Storage**:
- **Primary**: Google Drive (if connected) — shareable, organized, backed up
- **Fallback**: Supabase Storage — fallback if Drive connection fails or unavailable

**Auto-Labeling**:
- User can provide caption immediately: "Mera aadhar" → saved with label "aadhar"
- Or send first, then provide label via session state (`pending_action: "awaiting_label"`)

**Retrieval**:
- Fuzzy search on labels (case-insensitive)
- Generates public Google Drive link or Supabase signed URL
- One-step retrieval: "aadhar dikhao" → document delivered

**Edge Cases**:
- Document with same name → version suffix ('aadhar 2')
- File too large (>10MB) → rejected with guidance
- Unsupported mime type → rejected

---

### **4. Language Support**

**Detection Hierarchy**:
1. **Script-based** (fastest, free): Devanagari → Hindi, Gujarati Script → Gujarati
2. **Word patterns** (free regex): Common words like "hai", "karo", "gu chhe"
3. **Groq fallback** (API call): For ambiguous or mixed text

**Response Generation**:
- User language is stored in `users.language`
- All templates are multi-language (en/hi/gu)
- Auto-responder inherits user language from session

**Hinglish Support**: Native handling of Hindi+English mixing

---

### **5. Intent Classification**

**Input**: Message in any language  
**Output**: JSON with intent, confidence, extractedData

**Intent Categories**:
```
Action Intents:
- SET_REMINDER
- LIST_REMINDERS
- SNOOZE_REMINDER
- CANCEL_REMINDER
- ADD_TASK
- LIST_TASKS
- COMPLETE_TASK
- DELETE_TASK
- DELETE_LIST

Query Intents:
- FIND_DOCUMENT
- LIST_DOCUMENTS
- DELETE_DOCUMENT

Utility:
- GET_BRIEFING
- HELP
- UNKNOWN (→ AI Chat)
```

**Confidence Thresholds**:
- ≥ 0.8: Execute handler
- < 0.8: Keyword-based override (safety net)
- If still unclear: UNKNOWN → Auto-response

**Context Awareness**:
- Resolves "it", "that", "this" via `last_referenced_id` in session
- Remembers last list name, last intent for follow-ups

---

### **6. Morning Briefing**

**Trigger**: Daily at 9 AM IST (via Vercel Cron)

**Content**:
- Greeting with name & emoji
- Count of pending tasks
- Count of today's reminders
- Top 5 today's reminders (with times)
- Top 3 pending tasks (with list names)

**Deduplication**: One briefing per user per calendar day (UTC-based)

**Multi-language**: Adapts to user's language setting

---

### **7. Auto-Response (Fallback AI Chat)**

**When Triggered**:
- Intent classified as UNKNOWN
- All feature handlers exhausted

**Context Integration**:
1. Conversation history (last 10 messages from both user & bot)
2. Phone-specific system prompt (from `phone_document_mapping.system_prompt`)
3. User message (truncated to prevent injection)

**Safety Guardrails**:
- Abuse detection: Prepends warning before response
- Loop prevention: Checks for recent outgoing messages
- Hallucination prevention: Strips AI self-reference phrases
- Rate limiting: 20 requests/minute per user

**Tone**:
- Professional executive assistant
- Mix of English/Hindi (Hinglish)
- Short replies (1-2 lines max)
- Never claims to have performed actions it didn't

---

## 🔐 Security & Production Hardening

### **Authentication & Authorization**

| Area | Pattern | Implementation |
|------|---------|-----------------|
| **Database** | Service-role pattern | Admin client for backend, bypasses RLS |
| **API Routes** | Secret-based | `CRON_SECRET`, `DEV_SECRET`, `WEBHOOK_VERIFY_TOKEN` |
| **WhatsApp** | OAuth token per phone | `WHATSAPP_AUTH_TOKEN` in phone_document_mapping |
| **Google Drive** | OAuth 2.0 | Refresh token flow with auto-renewal |

### **Input Validation**

- **Phone**: 10-15 digits, normalized
- **Email**: RFC 5322 simplified regex, max 254 chars
- **Text**: Length bounds, control character removal
- **Enum**: Strict whitelist matching
- **ISO Date**: Timezone-aware parsing

### **Data Sanitization**

- HTML tag stripping
- Script block removal
- Event handler removal
- Whitespace collapse
- Unicode control character removal

### **Error Handling**

- **Typed errors**: AppError class with code, httpStatus, userMessage, isRetryable
- **Safe responses**: Production hides internal details, development exposes traces
- **Retry logic**: Exponential backoff with jitter for transient failures
- **Circuit breaker**: Optional integration with external services

### **Rate Limiting**

```typescript
rateLimiterConfigs = {
  api: 100 req/min/IP
  webhook: 1000 msg/min/phone
  auth: 5 attempts/15min/IP
  chat: 20 req/min/user
  fileUpload: 5 uploads/min/user
}
```

### **Logging & Monitoring**

- **Structured logs**: Context-rich, JSON-friendly
- **Trace IDs**: Every request gets UUID for end-to-end debugging
- **Log levels**: debug, info, warn, error, fatal
- **Analytics**: Hooks for external logging services (Datadog, New Relic, etc.)

### **Deduplication & Idempotency**

- **Webhook**: Unique constraint on `message_id` (insert-fail = already processed)
- **Reminders**: Duplicate detection by title + time proximity
- **Documents**: Label uniqueness per user

---

## 🚀 Performance Optimizations

### **Query Caching**

- **TTL-based cache** in `queryCache`
- **Cache keys**: `user:{userId}`, `tasks:{listId}`, etc.
- **Invalidation patterns**: Per-table invalidation on writes
- **Hit rate**: 5-minute TTL for user profiles

### **Database Indexes**

```sql
-- Reminders (most queried)
idx_reminders_due ON (scheduled_at) WHERE status IN (pending, snoozed)

-- WhatsApp messages (audit trail)
idx_whatsapp_messages_message_id (message_id) UNIQUE
idx_whatsapp_messages_from_number (from_number)

-- RAG vectors (document search)
rag_chunks_embedding_ivfflat_idx ON (embedding) USING ivfflat
```

### **Batch Operations**

- **Bulk inserts**: Chunked into 1000-row batches
- **Parallel Promise.allSettled**: Morning briefing sent to users in parallel

### **Connection Pooling**

- **Singleton pattern**: One Supabase client per runtime
- **Persistent session**: `persistSession: false` to avoid token storage overhead

### **API Optimization**

- **Compression**: Vercel automatic gzip
- **Caching headers**: Browser caching for static pages
- **CDN**: Vercel edge network (Singapore region)

---

## 🧪 Testing Strategy

### **Framework**: Vitest

### **Test Coverage Goals**:
- 100% core logic (AI, features, validators)
- 80%+ infrastructure
- 60%+ API routes

### **Test Categories**:
1. **Unit Tests** (`*.test.ts`):
   - Intent classification accuracy
   - Date parser edge cases
   - Input validation sanitization
   - Type safety
   
2. **Integration Tests** (TODO):
   - Webhook → Feature handler → DB
   - Google Drive OAuth flow
   - WhatsApp message delivery
   
3. **End-to-End Tests** (TODO):
   - Full user journeys (from webhook to delivery)
   - Concurrency scenarios
   - Recovery from failures

### **Test Files**:
- `config/index.test.ts`: Environment validation
- `lib/infrastructure/inputValidator.test.ts`: Sanitization
- `lib/ai/clients.test.ts`: Client creation
- `lib/ai/provider.test.ts`: Provider fallback

---

## 🔄 Conditions, Validations, & Edge Cases

### **Reminder Creation**

| Scenario | Action | Guard |
|----------|--------|-------|
| Time parse fails | Reject with guidance | Groq + regex quality check |
| Time in past | Adjust to tomorrow | Compare with current time |
| Time < 60s away | Reject as too close | MIN_LEAD_TIME_MS |
| Duplicate title + time | Reject with existing time shown | Fuzzy title match + time range |
| Title too short | Reject as too vague | Length > 2 chars |
| Timezone mismatch | Auto-convert IST → UTC | App.DEFAULT_TIMEZONE |

### **Task Management**

| Scenario | Action |
|----------|--------|
| Multi-item input (comma/newline separated) | Parse & batch create |
| List not found | Use "general" as default |
| Duplicate task in same list | Reject with notification |
| Task content too short | Reject with example |
| List name variations | Normalize aliases ("kirana" → "grocery") |

### **Document Upload**

| Scenario | Action |
|----------|--------|
| Unsupported mime type | Reject with supported list |
| File > 10MB | Reject with size guidance |
| Empty file | Reject silently |
| Duplicate label | Version with suffix ("aadhar 2") |
| Drive upload fails | Fallback to Supabase |
| Both storages fail | User notified, retry suggested |
| No caption provided | Await label via session state |

### **Language Detection**

| Scenario | Detection |
|-----------|-----------|
| Pure English | "ENGLISH_ONLY" regex |
| Devanagari script | Hindi |
| Gujarati script | Gujarati |
| Mixed (Hinglish) | Word patterns or Groq |
| Very short text (< 3 chars) | Default English |
| Groq rate-limited | Safe fallback to English |

### **WhatsApp Integration**

| Scenario | Handling |
|----------|----------|
| Webhook duplicate (same message_id) | Insert fails → silent ignore |
| Message outside 24hr window | Log but may not respond |
| Media download fails | Skip, process text only |
| 11za API timeout | Retry with exponential backoff |
| Bot response too long (>4000 chars) | Truncate or split into parts |

### **Rate Limiting**

| Scenario | Response |
|----------|----------|
| User exceeds quota | 429 Too Many Requests |
| Rate limit reset coming | Suggest retry-after header |
| Per-endpoint limits differ | Chat: 20/min, Upload: 5/min, etc. |

---

## 🛠️ Development & Deployment

### **Local Development**

```bash
# Environment
cp .env.example .env.local
# Configure: SUPABASE_*, GROQ_API_KEY, MISTRAL_API_KEY, WHATSAPP_*, GOOGLE_*

# Install & Run
npm install
npm run dev  # http://localhost:3000

# Testing
npm test            # Run all
npm run test:watch  # Watch mode
npm run test:coverage  # Coverage report

# Linting
npm run lint
```

### **Database Migrations**

```bash
# Apply schema (first time)
# Run migrations/MASTER_SCHEMA.sql in Supabase SQL Editor

# Optional: Google Drive integration
# Run migrations/009_google_drive.sql
```

### **Production Deployment**

```bash
# Build
npm run build

# Deploy to Vercel
vercel deploy --prod

# Cron jobs auto-enabled via vercel.json
# Specified: GET /api/cron/briefing at 9 AM IST
```

### **Vercel Configuration** (`vercel.json`)

```json
{
  "framework": "nextjs",
  "buildCommand": "npm run build",
  "regions": ["sin1"],  // Singapore
  "headers": [
    {
      "source": "/api/(.*)",
      "headers": [
        { "key": "Access-Control-Allow-Origin", "value": "*" },
        { "key": "Access-Control-Allow-Methods", "value": "GET,POST,PUT,DELETE,OPTIONS" }
      ]
    }
  ]
}
```

### **Monitoring & Health**

**Health Check Endpoint**: `GET /api/health`
- Verifies Supabase connectivity
- Verifies AI provider connectivity
- Returns operational status

**Traces & Logs**:
- All requests get UUID trace ID
- Logs are context-rich (userId, intent, duration)
- In production, logs can stream to Datadog/New Relic

---

## 📊 Workflow Examples

### **Example 1: User Sets Reminder in Hindi**

```
User WhatsApp: "Kal 5 bje doctor jaana yaad dilana"
        ↓
[Webhook receives message]
  ├─ Parse: phone="919876543210", message="Kal 5 bje..."
  ├─ Deduplicate: Insert to whatsapp_messages (or skip if duplicate)
  ├─ Onboarded? YES (skip onboarding flow)
  │
  ├─ Content type? TEXT
  │   ├─ Session context: No pending actions
  │   ├─ Intent classify:
  │   │   └─ Groq response: { intent: "SET_REMINDER", extractedData: { dateTimeText: "kal 5 bje" } }
  │   │
  │   ├─ [Route to handleSetReminder]
  │   │   ├─ Parse datetime: "kal 5 bje" → Tomorrow 5 PM IST
  │   │   ├─ Convert to UTC: Tomorrow 11:30 AM UTC
  │   │   ├─ Clean title: "doctor jaana" → "doctor"
  │   │   ├─ Check duplicates: No existing "doctor" at that time
  │   │   ├─ Insert to reminders: { user_id, title: "doctor", scheduled_at: "2026-04-03T11:30:00Z", status: "pending" }
  │   │   └─ Send WhatsApp: "⏰ डॉक्टर - कल 5:00 PM को याद दिलाऊंगा"
  │   │
  │   └─ Return { ok: true }
```

**Next Morning at 9 AM IST**:
```
Cron trigger: GET /api/cron/briefing
  ├─ Check: Is reminder.scheduled_at <= NOW()?
  │   └─ YES: Tomorrow 5 PM IST is 8 hours in future → Not yet
  │
  ├─ At actual time (5 PM IST):
  │   └─ (Manual trigger or separate cron) Mark reminder.status = "sent"
  │   └─ Send WhatsApp: "⏰ डॉक्टर"
```

---

### **Example 2: Add Multiple Items to Task List**

```
User: "Add milk, bread, eggs to grocery"
        ↓
[Intent classified as ADD_TASK]
  ├─ extractedData: { listName: "grocery", taskContent: "milk, bread, eggs" }
  │
  ├─ [handleAddTask]
  │   ├─ Parse items: ["milk", "bread", "eggs"] (split on `,`)
  │   ├─ Multi-item detected (count > 1)
  │   │
  │   ├─ get_or_create_list("grocery"):
  │   │   ├─ Query: SELECT id FROM lists WHERE user_id=X AND name="grocery"
  │   │   ├─ Result: list_id = "abc-123"
  │   │
  │   ├─ Batch insert 3 tasks:
  │   │   ├─ { list_id: "abc-123", content: "milk", completed: false }
  │   │   ├─ { list_id: "abc-123", content: "bread", completed: false }
  │   │   ├─ { list_id: "abc-123", content: "eggs", completed: false }
  │   │
  │   └─ Send WhatsApp: "✅ grocery list में 3 items add हो गए! • milk • bread • eggs"
```

---

### **Example 3: Save Aadhar Document**

```
User sends image + caption "Mera aadhar"
        ↓
[Webhook receives image with caption]
  ├─ Content type: "image"
  │
  ├─ [handleSaveDocument]
  │   ├─ Validate MIME: "image/jpeg" ✓
  │   ├─ Download from WhatsApp
  │   ├─ Check size: 2MB < 10MB ✓
  │   │
  │   ├─ Check Google Drive connected?
  │   │   └─ YES: getGoogleTokens() found refresh_token
  │   │   ├─ uploadToDrive("aadhar.jpg") → driveFileId: "xyzabc123"
  │   │   └─ storage_type: "google_drive"
  │   │
  │   ├─ Insert to documents:
  │   │   { label: "aadhar", drive_file_id: "xyzabc123", storage_type: "google_drive" }
  │   │
  │   └─ Send WhatsApp: "📁 'aadhar' के नाम से save हो गया! 'aadhar dikhao' बोलकर कभी भी वापस पा सकते हो।"
```

**Later, User Retrieves**:
```
User: "Aadhar dikhao"
        ↓
[Intent: FIND_DOCUMENT]
  ├─ [handleFindDocument]
  │   ├─ Query: SELECT * FROM documents WHERE user_id=X AND label ILIKE "%aadhar%"
  │   ├─ Found: { drive_file_id: "xyzabc123", storage_type: "google_drive" }
  │   ├─ Generate Google Drive link
  │   └─ Send WhatsApp: "[Google Drive link to aadhar.jpg]"
```

---

## 💡 Common Patterns & Best Practices

### **Guardrail Pattern**

Every feature handler follows:
```typescript
export async function handleFeature(params) {
  // GUARDRAIL 1: Validate input
  if (!params.foo) throw createError.validation("foo is required")
  
  // GUARDRAIL 2: Business logic check
  if (duplicateCheck fails) {
    await sendWhatsAppMessage({ to, message: "Already exists" })
    return
  }
  
  // GUARDRAIL 3: DB operation
  const { error } = await supabase.from('table').insert(...)
  if (error) {
    await sendWhatsAppMessage({ to, message: errorMessage(language) })
    return
  }
  
  // GUARDRAIL 4: Success confirmation
  await sendWhatsAppMessage({ to, message: successMessage })
}
```

### **Multi-Language Pattern**

```typescript
const messages: Record<Language, string> = {
  en: "English message",
  hi: "हिंदी संदेश",
  gu: "ગુજરાતી સંદેશ"
}

await sendWhatsAppMessage({ to: phone, message: messages[lang] })
```

### **Retry Pattern**

```typescript
await retryWithExponentialBackoff(
  () => risky_operation(),
  3,  // max retries
  100 // base delay ms
)
```

---

## 🎓 Key Learnings & Edge Cases to Watch

### **Learned Best Practices**

1. **Singleton Database Client**: Prevents connection pool exhaustion
2. **Webhook Deduplication**: Insert-fail strategy safer than SELECT-then-INSERT
3. **Conversation History Trimming**: Keep only last N messages to avoid context explosion
4. **Language Detection Hierarchy**: Local → API for cost efficiency
5. **Abuse Handling**: Prepend warning but still process (don't silently drop)
6. **Error Retry Strategy**: Exponential backoff with jitter prevents thundering herd

### **Production Pitfalls Avoided**

- ❌ **Creating new Supabase client per request** → Use singleton
- ❌ **Groq timeout on large requests** → Truncate input to 300 tokens max
- ❌ **Google Drive rate limits** → Implement auto-refresh with headroom
- ❌ **WhatsApp 4000-char limit** → Split long messages or return links
- ❌ **Race conditions on onboarding** → Check `is_onboarded` twice
- ❌ **Loop detection (auto-responder)** → Check for recent outgoing message

### **Edge Cases to Test**

1. **Timezone Boundaries**: Set reminder at midnight IST (convert to UTC correctly)
2. **Daylight Saving** (if supporting non-IST zones): JWT token refresh
3. **Very Long Reminders**: Title > 500 chars (truncate gracefully)
4. **Emoji Support**: Phone numbers with `+`, parentheses (normalize thoroughly)
5. **Concurrent Document Uploads**: Same label, rapid succession (version suffix handling)
6. **Session Cleanup**: Old session records after 30 days (add archival job)

---

## 📈 Scaling Considerations

### **Current Bottlenecks**

1. **In-memory rate limiter**: Doesn't scale across multiple Vercel instances → Use Redis
2. **Query cache**: Per-instance → Use Redis cache layer
3. **No database read replicas**: High-load reads on primary → Add read replicas
4. **Single Groq/Mistral call**: Sequential → Batch inference API

### **Scaling Path**

```
Phase 1: Current
├─ Single Vercel instance
├─ In-memory caching
└─ Single DB (reads + writes)

Phase 2: ~10K users
├─ Multiple Vercel instances
├─ Redis for distributed cache + rate limiting
└─ Read replicas for analytics

Phase 3: ~100K users
├─ DB sharding by phone_hash
├─ Message queue (Bull) for async jobs
├─ Vector DB (Pinecone) for RAG at scale
└─ Separate inference service
```

### **Optimizations for Scale**

- **Batch processing**: Group morning briefing sends
- **Async queues**: Use Bull or AWS SQS for webhook processing
- **Search optimization**: Elasticsearch for document search
- **CDN**: Vercel Edge Middleware for request routing
- **Horizontal scaling**: Stateless API design (already done!)

---

## 🔍 Testing Checklist

### **Core Flows to Verify**

- [ ] Set one-time reminder (parse various formats)
- [ ] Set recurring reminder (daily/weekly/monthly)
- [ ] Snooze/cancel reminder
- [ ] Add single task
- [ ] Add batch tasks (comma/newline separated)
- [ ] Save document without caption → await label
- [ ] Save document with caption
- [ ] Find document (exact + fuzzy match)
- [ ] OnBoarding flow (new user)
- [ ] Morning briefing (cron trigger)
- [ ] Auto-response to UNKNOWN intent
- [ ] Language detection (script + words + Groq fallback)
- [ ] Abuse/gali detection + warning
- [ ] WhatsApp webhook deduplication
- [ ] Google Drive fallback on error
- [ ] Rate limiting (reject > quota)

### **Security Tests**

- [ ] SQL injection prevention (input validators)
- [ ] XSS prevention (HTML tag stripping)
- [ ] CSRF token validation (if applicable)
- [ ] Rate limit bypass attempts
- [ ] Unauthorized user data access (RLS)
- [ ] Webhook secret validation

### **Performance Tests**

- [ ] Webhook response time (< 200ms)
- [ ] Intent classification latency (< 500ms)
- [ ] Database query performance under load
- [ ] Cache hit rates

---

## 📚 Documentation Links & References

- **[Supabase Docs](https://supabase.com/docs)**
- **[Groq Docs](https://console.groq.com/docs)**
- **[Mistral Docs](https://docs.mistral.ai/)**
- **[Next.js App Router](https://nextjs.org/docs/app)**
- **[Vercel Cron](https://vercel.com/docs/cron-jobs)**

---

## 🚨 Production Checklist

- [ ] SUPABASE_SERVICE_ROLE_KEY secured (+ never exposed in frontend)
- [ ] GROQ_API_KEY, MISTRAL_API_KEY, WHATSAPP_AUTH_TOKEN secured
- [ ] Google OAuth credentials configured
- [ ] Vercel environment variables set correctly
- [ ] Database RLS policies enabled
- [ ] Rate limiter configured per endpoint
- [ ] Health check endpoint responding
- [ ] Logging service integrated (Datadog/New Relic)
- [ ] Error tracking enabled (Sentry optional)
- [ ] Backup strategy (Supabase automated backups)
- [ ] Monitors/alerts set up

---

## 🤝 Contributing Guidelines

### **Before Committing**

```bash
npm run lint      # Fix style issues
npm test           # Verify tests pass
npm run build      # Verify production build
```

### **Code Style**

- TypeScript strict mode enabled
- Prefer `const` over `let` over `var`
- Use JSDoc for public functions
- Keep functions < 50 lines (break into smaller)
- Use meaningful variable names
- Comment "WHY", not "WHAT"

### **Testing Standards**

- New features need ≥80% test coverage
- All error paths should be tested
- Edge cases documented as test cases

---

## 📞 Support & Troubleshooting

### **Common Issues**

| Issue | Solution |
|-------|----------|
| "GROQ_API_KEY not configured" | Check .env.local, ensure API key is valid |
| "Webhook not receiving messages" | Verify 11za webhook URL in settings |
| "Google Drive upload fails" | Check token expiry, try re-auth |
| "Reminders not firing" | Check cron job status in Vercel logs |
| "Rate limit errors" | Check user quota, reset if needed |

---

## 📝 Final Notes

**ZARA** is built with **production-grade practices** from the ground up:

✅ Security-first (validation, sanitization, RLS)  
✅ Error resilience (retry logic, fallbacks, typed errors)  
✅ Performance optimized (caching, indexing, batching)  
✅ Multi-language support (Hinglish + 3 languages)  
✅ User experience focused (guardrails, guidance, confirmation)  
✅ Observability ready (structured logging, trace IDs)  
✅ Scalable architecture (stateless, horizontal scaling ready)  

The codebase is ready for **10K+ concurrent users** with minor optimizations (Redis, read replicas).

**Enjoy building! 🚀**
