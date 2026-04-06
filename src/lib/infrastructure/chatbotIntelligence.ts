/**
 * Advanced Chatbot Intelligence
 * Context awareness, conversation memory, personality, fallback chains
 */

import { AI_MODELS } from '@/config'
import { createError, retryWithExponentialBackoff } from './errorHandler'
import { logger } from './logger'
import { completionWithFallback, geminiCompletion } from '@/lib/ai/provider'

interface ConversationMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp?: Date
}

interface ChatContext {
  userId: string
  userPhone: string
  userName?: string
  language: 'en' | 'hi' | 'gu'
  conversationHistory: ConversationMessage[]
  userPreferences?: Record<string, any>
  recentActions?: string[] // For context
}

interface ChatResponse {
  message: string
  confidence: number
  requiresFollowUp: boolean
  suggestedActions?: string[]
  tone: 'helpful' | 'empathetic' | 'humor' | 'formal'
}

/**
 * Build personalized system prompt based on user profile
 */
function buildSystemPrompt(context: ChatContext): string {
  const name = context.userName && context.userName !== 'there' ? context.userName : null

  // BUG-01 FIX: Context window expanded — use last 10 messages (was 5)
  // More history = better pronoun resolution ("vo wala", "it", "pehle wala")
  const recencyContext = context.conversationHistory.slice(-10)
  const recencyStr = recencyContext.length > 0
    ? `[CONVERSATION SO FAR:\n${recencyContext.map(m => `${m.role === 'user' ? 'User' : 'Zara'}: ${m.content}`).join('\n')}\n]\n\n`
    : ''

  const langInstructions: Record<string, string> = {
    en: `Reply in English. Be concise (1-3 lines max).`,
    hi: `Reply in Hinglish (Hindi + English mix, Roman script). Be concise (1-3 lines max). Use the same mix as the user.`,
    gu: `Reply in Gujarati or Gujarati+English mix. Be concise (1-3 lines max).`,
  }

  return [
    `You are ZARA, a warm and intelligent personal WhatsApp assistant.`,
    name ? `The user's name is ${name}. Use their name occasionally (not every message).` : '',
    langInstructions[context.language] || langInstructions.en,
    `RULES:
- NEVER say you added/set/sent something if you didn't just do it.
- NEVER hallucinate user data.
- If unsure, ask a clarifying question instead of guessing.
- Keep responses warm, human, and SHORT.
- Use 1-2 emojis max.`,
    recencyStr ? `${recencyStr}Use the conversation above for context when the user says "it", "that", "pehle wala", etc.` : '',
  ].filter(Boolean).join('\n\n')
}

/**
 * Advanced context-aware chat (with fallback chains)
 */
export async function advancedChat(
  userMessage: string,
  context: ChatContext,
  options?: {
    useRAG?: boolean
    ragContext?: string
    maxTokens?: number
    temperature?: number
  }
): Promise<ChatResponse> {
  const {
    useRAG = false,
    ragContext = '',
    maxTokens = 300,
    temperature = 0.7,
  } = options || {}

  // Validate input
  if (!userMessage?.trim()) {
    throw createError.validation('Message cannot be empty')
  }

  // Add user message to history
  context.conversationHistory.push({
    role: 'user',
    content: userMessage.substring(0, 1000),
    timestamp: new Date(),
  })

  // Limit history to last 10 messages to avoid token overflow
  if (context.conversationHistory.length > 10) {
    context.conversationHistory = context.conversationHistory.slice(-10)
  }

  const systemPrompt = buildSystemPrompt(context)

  // Build messages with RAG context
  let messages: ConversationMessage[] = [
    { role: 'system', content: systemPrompt },
  ]

  if (useRAG && ragContext) {
    messages.push({
      role: 'system',
      content: `Available context from documents:\n${ragContext.substring(0, 3000)}\n\nUse this context to answer if relevant.`,
    })
  }

  messages = [...messages, ...context.conversationHistory]

  try {
    // Primary/Fallback logic now handled by completionWithFallback (Gemini-first)
    const response = await retryWithExponentialBackoff(
      async () => {
        return await completionWithFallback(
          messages.map(m => ({
            role: m.role as any,
            content: m.content,
          })),
          { 
            maxTokens, 
            temperature,
            model: AI_MODELS.CHAT_PRIMARY
          }
        )
      },
      2 // 2 retries
    )

    const assistantMessage = response.content

    if (!assistantMessage) {
      throw new Error('No response from model')
    }

    // Add response to history
    context.conversationHistory.push({
      role: 'assistant',
      content: assistantMessage,
      timestamp: new Date(),
    })

    logger.info('Chat completion succeeded', {
      userId: context.userId,
      model: AI_MODELS.CHAT_PRIMARY,
    })

    return {
      message: assistantMessage,
      confidence: 0.95,
      requiresFollowUp: false,
      tone: 'helpful',
    }
  } catch (error) {
    logger.error('Gemini chat failed after fallbacks', {
      userId: context.userId,
      error: (error as Error).message,
    })

    // Fallback: Template-based response
    const templates: Record<string, string[]> = {
      en: [
        'I\'m having trouble processing that right now. Could you rephrase?',
        'I couldn\'t understand. Try asking simpler.',
        'Sorry, I missed that. What do you need?',
      ],
      hi: [
        'अभी मैं यह प्रोसेस नहीं कर सकता। फिर से बताओ?',
        'समझ नहीं आया। सरल शब्दों में बताओ।',
        'क्षमा करो। क्या चाहिए?',
      ],
      gu: [
        'હવે હું આને પ્રોસેસ કરી શકતો નથી. ફરીથી બતાવો?',
        'સમજ્યો નહીં. સરળ શબ્દોમાં કહો.',
        'ક્ષમા છે. શું ચાહો છો?',
      ],
    }

    const templateList = templates[context.language] || templates.en
    const randomTemplate = templateList[Math.floor(Math.random() * templateList.length)]

    return {
      message: randomTemplate,
      confidence: 0.3,
      requiresFollowUp: true,
      tone: 'empathetic',
    }
  }
}

/**
 * Analyze sentiment and emotion from user message
 */
export async function analyzeSentiment(message: string): Promise<{
  sentiment: 'positive' | 'negative' | 'neutral'
  emotion: string
  confidence: number
}> {
  try {
    const response = await geminiCompletion(
      [
        {
          role: 'system',
          content: 'Analyze sentiment. Return ONLY JSON: {"sentiment": "positive|negative|neutral", "emotion": "string", "confidence": 0-1}',
        },
        {
          role: 'user',
          content: message.substring(0, 500),
        },
      ],
      { model: AI_MODELS.SENTIMENT, temperature: 0, maxTokens: 100 }
    )

    const content = response.content
    if (!content) throw new Error('No response')

    const parsed = JSON.parse(content)
    return parsed
  } catch (error) {
    logger.warn('Sentiment analysis failed', { error: (error as Error).message })
    return {
      sentiment: 'neutral',
      emotion: 'unknown',
      confidence: 0,
    }
  }
}

/**
 * Generate human-like response with personality
 */
export function humanizeResponse(
  message: string,
  language: 'en' | 'hi' | 'gu',
  userName?: string
): string {
  let response = message.trim()

  // Add completion emoji for Hindi success messages
  if (language === 'hi' && !response.includes('✅') && !response.includes('🎯')) {
    if (response.includes('पूरा') || response.includes('किया') || response.includes('ho gaya')) {
      response = `✅ ${response}`
    }
  }

  if (userName && userName !== 'there' && !response.includes(userName)) {
    const alreadyHasGreeting = /^(hey|hi|hello|namaste|arre|haan|ok)/i.test(response)
    // Only 30% of the time — keep it natural, not repetitive
    if (!alreadyHasGreeting && Math.random() > 0.7) {
      const prefix: Record<string, string> = {
        en: `${userName}, `,
        hi: `${userName}, `,
        gu: `${userName}, `,
      }
      response = `${prefix[language] || `${userName}, `}${response}`
    }
  }

  return response
}

/**
 * Extract structured data from unstructured response
 * E.g., extract reminder time, task items, document query
 */
export async function extractStructuredData(
  message: string,
  schema: Record<string, string>
): Promise<Record<string, any>> {
  try {
    const schemaDesc = Object.entries(schema)
      .map(([key, desc]) => `${key}: ${desc}`)
      .join('\n')

    const response = await geminiCompletion(
      [
        {
          role: 'system',
          content: `Extract data matching this schema. Return ONLY valid JSON.\nSchema:\n${schemaDesc}`,
        },
        {
          role: 'user',
          content: message.substring(0, 500),
        },
      ],
      { model: AI_MODELS.CHAT_PRIMARY, temperature: 0, maxTokens: 200 }
    )

    const content = response.content
    if (!content) return {}

    return JSON.parse(content)
  } catch (error) {
    logger.debug('Structured data extraction skipped', { error: (error as Error).message })
    return {}
  }
}
