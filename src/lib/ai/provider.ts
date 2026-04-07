// src/lib/ai/provider.ts
// AI Provider Abstraction — unified interface for Groq, Mistral, and future models
// Switch providers without changing business logic

import { getGroqClient } from './clients'
import { AI_MODELS, MISTRAL_API_KEY } from '@/config'
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

// ─── Groq Provider ────────────────────────────────────────────

export async function groqCompletion(
  messages: ChatMessage[],
  options: CompletionOptions = {}
): Promise<CompletionResult> {
  const model = options.model || AI_MODELS.CHAT_PRIMARY
  const groq = getGroqClient()

  const response = await groq.chat.completions.create({
    model,
    messages,
    temperature: options.temperature ?? 0.3,
    max_tokens: options.maxTokens ?? 500,
    ...(options.responseFormat === 'json' ? { response_format: { type: 'json_object' as const } } : {}),
  })

  const content = response.choices?.[0]?.message?.content || ''

  return {
    content,
    model,
    usage: response.usage ? {
      promptTokens: response.usage.prompt_tokens,
      completionTokens: response.usage.completion_tokens,
      totalTokens: response.usage.total_tokens,
    } : undefined,
  }
}

// ─── Mistral Provider (Embeddings) ────────────────────────────

export async function mistralEmbedding(
  text: string,
  model: string = 'mistral-embed'
): Promise<EmbeddingResult> {
  if (!MISTRAL_API_KEY) {
    throw new Error('MISTRAL_API_KEY not configured')
  }

  const { Mistral } = await import('@mistralai/mistralai')
  const client = new Mistral({ apiKey: MISTRAL_API_KEY })

  const response = await client.embeddings.create({
    model,
    inputs: [text],
  })

  const embedding = response.data?.[0]?.embedding
  if (!embedding || !Array.isArray(embedding)) {
    throw new Error('Mistral returned no embedding data')
  }

  return { embedding, model }
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
    return await groqCompletion(messages, { ...options, model: primaryModel })
  } catch (primaryErr: unknown) {
    const error = primaryErr instanceof Error ? primaryErr : new Error('Unknown error')
    logger.warn('Primary model failed, trying fallback', {
      primaryModel,
      fallbackModel,
      error: error.message,
    })

    try {
      return await groqCompletion(messages, { ...options, model: fallbackModel })
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
