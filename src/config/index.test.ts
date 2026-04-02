// src/config/index.test.ts
// Tests for centralized configuration module

import { describe, it, expect } from 'vitest'
import {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  GROQ_API_KEY,
  AI_MODELS,
  APP,
  WHATSAPP_API,
  GOOGLE,
  SUPPORTED_AUDIO_FORMATS,
  SUPPORTED_IMAGE_TYPES,
  SUPPORTED_DOCUMENT_TYPES,
} from '@/config'

describe('Configuration Module', () => {
  describe('Environment Variables', () => {
    it('should load Supabase URL from env', () => {
      expect(SUPABASE_URL).toBe('https://test-project.supabase.co')
    })

    it('should load Supabase service role key from env', () => {
      expect(SUPABASE_SERVICE_ROLE_KEY).toBe('test-service-role-key')
    })

    it('should load Groq API key from env', () => {
      expect(GROQ_API_KEY).toBe('test-groq-api-key')
    })
  })

  describe('AI Models', () => {
    it('should have all required model definitions', () => {
      expect(AI_MODELS.INTENT_CLASSIFIER).toBeDefined()
      expect(AI_MODELS.DATE_PARSER).toBeDefined()
      expect(AI_MODELS.AUTO_RESPONDER).toBeDefined()
      expect(AI_MODELS.CHAT_PRIMARY).toBeDefined()
      expect(AI_MODELS.CHAT_FALLBACK).toBeDefined()
      expect(AI_MODELS.LANGUAGE_DETECT).toBeDefined()
      expect(AI_MODELS.SYSTEM_PROMPT_GEN).toBeDefined()
      expect(AI_MODELS.SENTIMENT).toBeDefined()
      expect(AI_MODELS.STT).toBeDefined()
    })

    it('should use fast model for primary chat', () => {
      expect(AI_MODELS.CHAT_PRIMARY).toContain('instant')
    })

    it('should use versatile model for fallback', () => {
      expect(AI_MODELS.CHAT_FALLBACK).toContain('versatile')
    })

    it('should use whisper for STT', () => {
      expect(AI_MODELS.STT).toContain('whisper')
    })
  })

  describe('APP Constants', () => {
    it('should have app name', () => {
      expect(APP.NAME).toBe('ZARA')
    })

    it('should have valid timezone', () => {
      expect(APP.DEFAULT_TIMEZONE).toBe('Asia/Kolkata')
    })

    it('should have reasonable max file size (10MB)', () => {
      expect(APP.MAX_FILE_SIZE_BYTES).toBe(10 * 1024 * 1024)
    })

    it('should have reasonable message length limit', () => {
      expect(APP.MAX_MESSAGE_LENGTH).toBeLessThanOrEqual(4096) // WhatsApp limit
      expect(APP.MAX_MESSAGE_LENGTH).toBeGreaterThan(0)
    })

    it('should have conversation history limit', () => {
      expect(APP.CONVERSATION_HISTORY_LIMIT).toBeGreaterThan(0)
      expect(APP.CONVERSATION_HISTORY_LIMIT).toBeLessThanOrEqual(50)
    })

    it('should have valid phone length range', () => {
      expect(APP.MIN_PHONE_LENGTH).toBe(10)
      expect(APP.MAX_PHONE_LENGTH).toBe(15)
      expect(APP.MIN_PHONE_LENGTH).toBeLessThan(APP.MAX_PHONE_LENGTH)
    })
  })

  describe('WhatsApp API Config', () => {
    it('should have all API endpoints', () => {
      expect(WHATSAPP_API.SEND_MESSAGE).toContain('sendMessage')
      expect(WHATSAPP_API.SEND_MEDIA).toContain('sendMedia')
      expect(WHATSAPP_API.SEND_TEMPLATE).toContain('sendTemplate')
    })

    it('should have reasonable timeout', () => {
      expect(WHATSAPP_API.REQUEST_TIMEOUT_MS).toBeGreaterThanOrEqual(5000)
      expect(WHATSAPP_API.REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(30000)
    })

    it('should use 11za.in API base', () => {
      expect(WHATSAPP_API.BASE_URL).toContain('11za.in')
    })
  })

  describe('Google OAuth Config', () => {
    it('should have token URL', () => {
      expect(GOOGLE.TOKEN_URL).toContain('googleapis.com/token')
    })

    it('should have Drive API URLs', () => {
      expect(GOOGLE.DRIVE_UPLOAD_URL).toContain('googleapis.com')
      expect(GOOGLE.DRIVE_FILES_URL).toContain('googleapis.com')
    })
  })

  describe('Supported Formats', () => {
    it('should support common audio formats', () => {
      expect(SUPPORTED_AUDIO_FORMATS).toContain('ogg')
      expect(SUPPORTED_AUDIO_FORMATS).toContain('mp3')
      expect(SUPPORTED_AUDIO_FORMATS).toContain('wav')
    })

    it('should support common image types', () => {
      expect(SUPPORTED_IMAGE_TYPES).toContain('image/jpeg')
      expect(SUPPORTED_IMAGE_TYPES).toContain('image/png')
      expect(SUPPORTED_IMAGE_TYPES).toContain('image/webp')
    })

    it('should support PDF documents', () => {
      expect(SUPPORTED_DOCUMENT_TYPES).toContain('application/pdf')
    })
  })
})
