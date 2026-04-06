// src/lib/ai/provider.ts
// AI Provider Abstraction — unified interface for Groq, Mistral, and future models
// Switch providers without changing business logic

import { getClaudeClient } from './clients'
import { AI_MODELS, ANTHROPIC_API_KEY } from '@/config'
import { logger } from '@/lib/infrastructure/logger'

// ─── Types ────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface CompletionOptions {
  model?: string
  temperature?: number
  maxTokens?: number
  stream?: boolean
  responseFormat?: 'text' | 'json'
}

export interface CompletionResult {
  content: string
  model: string
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

export interface EmbeddingResult {
  embedding: number[]
  model: string
}

// ─── Claude Provider ──────────────────────────────────────────

export async function claudeCompletion(
  messages: ChatMessage[],
  options: CompletionOptions = {}
): Promise<CompletionResult> {
  const model = options.model || AI_MODELS.CHAT_PRIMARY
  const claude = getClaudeClient()

  // Separate system message for Claude
  const systemMsg = messages.find(m => m.role === 'system')?.content
  const userHistory = messages.filter(m => m.role !== 'system')

  // BUG FIX: Claude requires strictly alternating user/assistant roles
  const sanitizedMessages: any[] = []
  let lastRole: string | null = null

  for (const m of userHistory) {
    const role = (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant'
    if (role === lastRole) {
      if (sanitizedMessages.length > 0) {
        sanitizedMessages[sanitizedMessages.length - 1].content += `\n${m.content}`
      }
      continue
    }
    sanitizedMessages.push({ role, content: m.content })
    lastRole = role
  }

  // Claude requires a user message if no history provided
  if (sanitizedMessages.length === 0) {
    sanitizedMessages.push({ role: 'user', content: 'Hello' })
  }

  const response = await claude.messages.create({
    model,
    system: systemMsg,
    messages: sanitizedMessages as any,
    temperature: options.temperature ?? 0.3,
    max_tokens: options.maxTokens ?? 1024,
  })

  const content = response.content[0].type === 'text' ? response.content[0].text : ''

  return {
    content,
    model,
    usage: {
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
      totalTokens: response.usage.input_tokens + response.usage.output_tokens,
    },
  }
}

// ─── Smart Completion with Fallback ───────────────────────────
// Tries primary model, falls back to a larger model on failure

export async function completionWithFallback(
  messages: ChatMessage[],
  options: CompletionOptions = {}
): Promise<CompletionResult> {
  const primaryModel = options.model || AI_MODELS.CHAT_PRIMARY
  const fallbackModel = AI_MODELS.CHAT_FALLBACK

  try {
    return await claudeCompletion(messages, { ...options, model: primaryModel })
  } catch (primaryErr: unknown) {
    const error = primaryErr instanceof Error ? primaryErr : new Error('Unknown error')
    logger.warn('Primary model failed, trying fallback', {
      primaryModel,
      fallbackModel,
      error: error.message,
    })

    try {
      return await claudeCompletion(messages, { ...options, model: fallbackModel })
    } catch (fallbackErr: unknown) {
      const fbError = fallbackErr instanceof Error ? fallbackErr : new Error('Unknown error')
      logger.error('Both primary and fallback models failed', {
        primaryModel,
        fallbackModel,
        error: fbError.message,
      }, fbError)

      throw new Error(`AI completion failed: ${fbError.message}`)
    }
  }
}

// ─── Utility: Extract JSON from LLM response ─────────────────

export function extractJSON<T = Record<string, unknown>>(text: string): T | null {
  try {
    // First try direct parse
    return JSON.parse(text) as T
  } catch {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
    if (jsonMatch?.[1]) {
      try {
        return JSON.parse(jsonMatch[1]) as T
      } catch {
        return null
      }
    }

    // Try to find any JSON object in the text
    const objectMatch = text.match(/\{[\s\S]*\}/)
    if (objectMatch?.[0]) {
      try {
        return JSON.parse(objectMatch[0]) as T
      } catch {
        return null
      }
    }

    return null
  }
}

// ─── Utility: Get error message safely ────────────────────────

export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return 'An unknown error occurred'
}
