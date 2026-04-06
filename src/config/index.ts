// src/config/index.ts
// Centralized configuration — all constants, validated env vars, and defaults

// ─── Environment Validation ──────────────────────────────────

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

function optionalEnv(name: string, fallback: string = ''): string {
  return process.env[name] || fallback
}

// ─── Supabase ─────────────────────────────────────────────────

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

// ─── AI Providers ─────────────────────────────────────────────

export const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''
export const GROQ_API_KEY = process.env.GROQ_API_KEY || ''
export const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || ''

// ─── WhatsApp / 11za ──────────────────────────────────────────

export const WHATSAPP_AUTH_TOKEN = optionalEnv('WHATSAPP_AUTH_TOKEN')
export const WHATSAPP_ORIGIN = optionalEnv('WHATSAPP_ORIGIN')
export const ELEVEN_ZA_API_KEY = optionalEnv('ELEVEN_ZA_API_KEY')

export const WHATSAPP_API = {
  BASE_URL: 'https://api.11za.in/apis',
  SEND_MESSAGE: 'https://api.11za.in/apis/sendMessage/sendMessages',
  SEND_MEDIA: 'https://api.11za.in/apis/sendMessage/sendMedia',
  SEND_TEMPLATE: 'https://api.11za.in/apis/template/sendTemplate',
  REQUEST_TIMEOUT_MS: 10_000,
  MAX_MESSAGE_LENGTH: 4000,
} as const

// ─── Google OAuth ─────────────────────────────────────────────

export const GOOGLE = {
  CLIENT_ID: optionalEnv('GOOGLE_CLIENT_ID'),
  CLIENT_SECRET: optionalEnv('GOOGLE_CLIENT_SECRET'),
  REDIRECT_URI: optionalEnv('GOOGLE_REDIRECT_URI'),
  TOKEN_URL: 'https://oauth2.googleapis.com/token',
  DRIVE_UPLOAD_URL: 'https://www.googleapis.com/upload/drive/v3/files',
  DRIVE_FILES_URL: 'https://www.googleapis.com/drive/v3/files',
} as const

// ─── Security ─────────────────────────────────────────────────

export const CRON_SECRET = optionalEnv('CRON_SECRET')
export const DEV_SECRET = optionalEnv('DEV_SECRET')
export const WEBHOOK_VERIFY_TOKEN = optionalEnv('WEBHOOK_VERIFY_TOKEN')

// ─── AI Model Configuration ──────────────────────────────────

export const AI_MODELS = {
  INTENT_CLASSIFIER: 'gpt-4o-mini',
  DATE_PARSER: 'gpt-4o-mini',
  AUTO_RESPONDER: 'gpt-4o-mini',
  CHAT_PRIMARY: 'gpt-4o-mini',
  CHAT_FALLBACK: 'gpt-4o-mini',
  LANGUAGE_DETECT: 'gpt-4o-mini',
  SYSTEM_PROMPT_GEN: 'gpt-4o-mini',
  SENTIMENT: 'gpt-4o-mini',
  STT: 'whisper-1',
} as const

// ─── Application Constants ────────────────────────────────────

export const APP = {
  NAME: 'ZARA',
  BOT_SENDER_NAME: '11za Assistant',
  DEFAULT_TIMEZONE: 'Asia/Kolkata',
  DEFAULT_LANGUAGE: 'en' as const,
  MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024,       // 10 MB
  MAX_STT_FILE_SIZE_BYTES: 25 * 1024 * 1024,   // 25 MB
  CONVERSATION_HISTORY_LIMIT: 10,
  MAX_REPLY_TOKENS: 300,
  MAX_MESSAGE_LENGTH: 4000,
  MAX_PER_MESSAGE_LENGTH: 500,
  RECENT_OUTGOING_WINDOW_MS: 10_000,
  MIN_PHONE_LENGTH: 10,
  MAX_PHONE_LENGTH: 15,
  MIN_REMINDER_LEAD_TIME_MS: 60_000,  // 1 minute
} as const

// ─── Supported MIME Types ─────────────────────────────────────

export const SUPPORTED_IMAGE_TYPES = [
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic',
] as const

export const SUPPORTED_DOCUMENT_TYPES = [
  'application/pdf',
] as const

export const SUPPORTED_MEDIA_TYPES = [
  ...SUPPORTED_IMAGE_TYPES,
  ...SUPPORTED_DOCUMENT_TYPES,
] as const

export const SUPPORTED_AUDIO_FORMATS = [
  'ogg', 'mp3', 'mp4', 'wav', 'webm', 'm4a', 'flac',
] as const
