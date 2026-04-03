// src/types/index.ts
// Shared type definitions for the entire application

// ─── Language ─────────────────────────────────────────────────
export type Language = 'en' | 'hi' | 'gu'

// ─── Database Row Types ───────────────────────────────────────

export interface UserRow {
  id: string
  phone: string
  name: string | null
  onboarded: boolean
  language: Language
  timezone: string
  google_access_token?: string | null
  google_refresh_token?: string | null
  google_token_expiry?: string | null
  google_drive_folder_id?: string | null
  created_at: string
  updated_at: string
}

export interface ReminderRow {
  id: string
  user_id: string
  title: string
  note: string | null
  scheduled_at: string
  recurrence: 'daily' | 'weekly' | 'monthly' | null
  recurrence_time: string | null
  status: 'pending' | 'completed' | 'snoozed' | 'cancelled' | 'sent'
  snooze_count: number
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface ListRow {
  id: string
  user_id: string
  name: string
  color: string | null
  created_at: string
}

export interface TaskRow {
  id: string
  list_id: string
  user_id: string
  content: string
  completed: boolean
  completed_at: string | null
  priority: number
  created_at: string
  updated_at: string
}

export interface DocumentRow {
  id: string
  user_id: string
  label: string
  storage_path: string | null
  drive_file_id: string | null
  storage_type: 'supabase' | 'google_drive'
  doc_type: 'pdf' | 'image'
  mime_type: string
  file_size: number | null
  ocr_text: string | null
  uploaded_at: string
}

export interface WhatsAppMessageRow {
  id: number
  message_id: string
  channel: string
  from_number: string
  to_number: string
  received_at: string
  content_type: string | null
  content_text: string | null
  sender_name: string | null
  event_type: string | null
  is_in_24_window: boolean
  is_responded: boolean
  auto_respond_sent: boolean
  response_message_id: string | null
  response_sent_at: string | null
  raw_payload: Record<string, unknown>
  trace_id?: string
  created_at: string
  updated_at: string
}

export interface SessionRow {
  id: string
  user_id: string
  context: SessionContext
  created_at: string
  updated_at: string
}

export interface SessionContext {
  last_intent?: string
  last_document_query?: string
  last_list_name?: string
  pending_action?: string
  document_path?: string
  document_id?: string
  drive_file_id?: string
  doc_type?: string
  last_referenced_id?: string
  conversation_history?: Array<{ role: string; content: string; ts: number }>
}

export interface PhoneDocumentMappingRow {
  id: number
  phone_number: string
  file_id: string | null
  auth_token: string | null
  origin: string | null
  intent: string | null
  system_prompt: string | null
  created_at: string
  updated_at: string
}

export interface DueReminderRow {
  reminder_id: string
  user_id: string
  title: string
  note: string | null
  scheduled_at?: string
  recurrence?: string | null
  recurrence_time?: string | null
  phone: string
  language: string | null
}

// ─── AI Types ─────────────────────────────────────────────────

export type Intent =
  | 'SET_REMINDER'
  | 'SNOOZE_REMINDER'
  | 'LIST_REMINDERS'
  | 'CANCEL_REMINDER'
  | 'ADD_TASK'
  | 'LIST_TASKS'
  | 'COMPLETE_TASK'
  | 'DELETE_TASK'
  | 'DELETE_LIST'
  | 'FIND_DOCUMENT'
  | 'LIST_DOCUMENTS'
  | 'DELETE_DOCUMENT'
  | 'DELETE_ALL_DOCUMENTS'
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
    isGenericSearch?: boolean       // If user says "tasks" or "all"
    lastReferencedId?: string       // From context
    // Multi-reminder support (BUG-04)
    isMultiReminder?: boolean
    reminderItems?: Array<{ title: string; dateTimeText: string }>
    // Snooze support (BUG-08)
    snoozeMinutes?: number
  }
}

export interface ParsedDateTime {
  date: Date | null
  isRecurring: boolean
  recurrence: 'daily' | 'weekly' | 'monthly' | null
  recurrenceTime: string | null
  confidence: number
  humanReadable: string
}

// ─── WhatsApp Types ───────────────────────────────────────────

export interface SendMessageResult {
  success: boolean
  error?: string
  response?: unknown
  status?: number
}

export type MediaType = 'image' | 'document' | 'audio' | 'video'

export interface WhatsAppButton {
  id: string
  title: string
}

export interface SendMessageOptions {
  to: string
  message: string
  from?: string
  buttons?: WhatsAppButton[]
  mediaUrl?: string
  mediaType?: 'image' | 'document' | 'audio'
  authToken?: string // Explicit override
  origin?: string    // Explicit override
}

// ─── Auto-Responder Types ─────────────────────────────────────

export interface AutoResponseResult {
  success: boolean
  response?: string
  sent?: boolean
  error?: string
  noDocuments?: boolean
  processed_by?: string
}

// ─── STT Types ────────────────────────────────────────────────

export interface STTResult {
  text: string
  language: string
  durationEstimate?: string
}
