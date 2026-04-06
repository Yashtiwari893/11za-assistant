// src/lib/ai/clients.ts
// Centralized AI client singletons — prevents multiple instantiations

import Groq from 'groq-sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { GROQ_API_KEY, GEMINI_API_KEY } from '@/config'

// ─── Groq Client (Singleton) ─────────────────────────────────

let groqInstance: Groq | null = null

export function getGroqClient(): Groq {
  if (!groqInstance) {
    if (!GROQ_API_KEY) {
      throw new Error('GROQ_API_KEY is not configured')
    }
    groqInstance = new Groq({ apiKey: GROQ_API_KEY })
  }
  return groqInstance
}

// ─── Gemini Client (Singleton) ───────────────────────────────

let geminiInstance: GoogleGenerativeAI | null = null

export function getGeminiClient(): GoogleGenerativeAI {
  if (!geminiInstance) {
    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not configured')
    }
    geminiInstance = new GoogleGenerativeAI(GEMINI_API_KEY)
  }
  return geminiInstance
}
