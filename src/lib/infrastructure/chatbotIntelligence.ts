/**
 * Advanced Chatbot Intelligence
 * Context awareness, conversation memory, personality, fallback chains
 */

import Groq from 'groq-sdk'
import { createError, retryWithExponentialBackoff } from './errorHandler'
import { logger } from './logger'

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

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! })

/**
 * Build personalized system prompt based on user profile
 */
function buildSystemPrompt(context: ChatContext): string {
  const personality: Record<string, string> = {
    en: 'You are a friendly, helpful personal assistant on WhatsApp. Be warm, human-like, and concise. Use emojis sparingly. If you don\'t know something, admit it.',
    hi: 'आप एक दोस्ताना, सहायक WhatsApp सहायक हैं। गर्मजोशी से बात करें, मानवीय रहें। संक्षिप्त रहें। अगर कुछ पता नहीं है तो स्वीकार करें।',
    gu: 'તમે એ મૈત્રીપૂર્ણ, સહાયક WhatsApp સહાયક છો। ગરમ અને અનુભવશીલ બનો। સંક્ષિપ્ત રહો।',
  }

  const recencyContext = context.conversationHistory.slice(-5) // Last 5 messages for context
  const recencyStr = recencyContext.length > 0
    ? `Recent conversation:\n${recencyContext.map(m => `${m.role}: ${m.content}`).join('\n')}\n\n`
    : ''

  let prompt = personality[context.language]

  if (context.userName) {
    prompt += ` Address the user as ${context.userName} when appropriate.`
  }

  prompt += `\n\n${recencyStr}Remember: User prefers ${context.language} responses.`

  return prompt
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
    // Primary: Fast model for quick response
    const response = await retryWithExponentialBackoff(
      async () => {
        return await groq.chat.completions.create({
          model: 'llama-3.1-8b-instant', // Fast
          messages: messages.map(m => ({
            role: m.role,
            content: m.content,
          })),
          max_tokens: maxTokens,
          temperature,
        })
      },
      2 // 2 retries
    )

    const assistantMessage = response.choices[0]?.message?.content

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
      model: 'llama-3.1-8b-instant',
      inputTokens: response.usage?.prompt_tokens,
      outputTokens: response.usage?.completion_tokens,
    })

    return {
      message: assistantMessage,
      confidence: 0.95,
      requiresFollowUp: false,
      tone: 'helpful',
    }
  } catch (error) {
    logger.warn('Primary chat model failed, trying fallback', {
      userId: context.userId,
      error: (error as Error).message,
    })

    // Fallback 1: Larger, slower model (better quality but slower)
    try {
      const fallbackResponse = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile', // More capable but slower
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
        max_tokens: Math.min(maxTokens, 150),
        temperature: Math.min(temperature, 0.5), // Lower temp for reliability
      })

      const assistantMessage = fallbackResponse.choices[0]?.message?.content

      if (assistantMessage) {
        context.conversationHistory.push({
          role: 'assistant',
          content: assistantMessage,
          timestamp: new Date(),
        })

        logger.info('Chat completion via fallback', {
          userId: context.userId,
          model: 'llama-3.3-70b-versatile',
        })

        return {
          message: assistantMessage,
          confidence: 0.85,
          requiresFollowUp: false,
          tone: 'helpful',
        }
      }
    } catch (fallbackError) {
      logger.error('Fallback model also failed', {
        userId: context.userId,
      }, fallbackError as Error)
    }

    // Fallback 2: Template-based response
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
    const response = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [
        {
          role: 'system',
          content: 'Analyze sentiment. Return ONLY JSON: {"sentiment": "positive|negative|neutral", "emotion": "string", "confidence": 0-1}',
        },
        {
          role: 'user',
          content: message.substring(0, 500),
        },
      ],
      max_tokens: 100,
      temperature: 0,
    })

    const content = response.choices[0]?.message?.content
    if (!content) throw new Error('No response')

    const parsed = JSON.parse(content)
    return parsed
  } catch (error) {
    logger.warn('Sentiment analysis failed', {}, error as Error)
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
  // Add personality
  let response = message

  // Add appropriate emojis based on language
  if (language === 'hi' && !response.includes('🎯')) {
    if (response.includes('पूरा') || response.includes('किया')) {
      response = `✅ ${response}`
    }
  }

  // Address user by name if available
  if (userName && !response.includes(userName)) {
    const opening: Record<string, string> = {
      en: `Hey ${userName}!`,
      hi: `${userName}!`,
      gu: `${userName}!`,
    }
    // Don't always add - keep natural
    if (Math.random() > 0.7) {
      response = response.substring(0, 1) + ` ${opening[language]} ` + response.substring(1)
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

    const response = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [
        {
          role: 'system',
          content: `Extract data matching this schema. Return ONLY valid JSON.\nSchema:\n${schemaDesc}`,
        },
        {
          role: 'user',
          content: message.substring(0, 500),
        },
      ],
      max_tokens: 200,
      temperature: 0,
    })

    const content = response.choices[0]?.message?.content
    if (!content) return {}

    return JSON.parse(content)
  } catch (error) {
    logger.debug('Structured data extraction skipped', {}, error as Error)
    return {}
  }
}
