// src/lib/ai/clients.ts
// Centralized AI client singletons — prevents multiple instantiations

import Groq from 'groq-sdk'
import { GROQ_API_KEY } from '@/config'

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
