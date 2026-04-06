// src/lib/ai/provider.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { extractJSON, getErrorMessage, claudeCompletion, completionWithFallback } from './provider'
import { getClaudeClient } from './clients'

// Mock the Claude client
vi.mock('./clients', () => ({
  getClaudeClient: vi.fn(),
}))

describe('AI Provider Abstraction', () => {
  describe('extractJSON', () => {
    it('should parse valid JSON directly', () => {
      const input = '{"key": "value"}'
      expect(extractJSON(input)).toEqual({ key: 'value' })
    })

    it('should extract JSON from markdown code blocks', () => {
      const input = 'Here is the data:\n```json\n{"status": "ok", "id": 123}\n```'
      expect(extractJSON(input)).toEqual({ status: 'ok', id: 123 })
    })

    it('should extract JSON from untagged code blocks', () => {
      const input = 'Result:\n```\n{"result": true}\n```'
      expect(extractJSON(input)).toEqual({ result: true })
    })

    it('should find a JSON object within plain text', () => {
      const input = 'The response is { "code": 200 } which is good.'
      expect(extractJSON(input)).toEqual({ code: 200 })
    })

    it('should return null for invalid JSON string', () => {
      const input = 'This is not JSON at all.'
      expect(extractJSON(input)).toBeNull()
    })
  })

  describe('getErrorMessage', () => {
    it('should extract message from Error object', () => {
      const err = new Error('Test error')
      expect(getErrorMessage(err)).toBe('Test error')
    })

    it('should return string as is', () => {
      expect(getErrorMessage('String error')).toBe('String error')
    })

    it('should return default message for unknown types', () => {
      expect(getErrorMessage(null)).toBe('An unknown error occurred')
      expect(getErrorMessage(undefined)).toBe('An unknown error occurred')
      expect(getErrorMessage(123)).toBe('An unknown error occurred')
    })
  })

  describe('claudeCompletion', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('should call Claude SDK with correct parameters', async () => {
      const mockClaude = {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [{ type: 'text', text: 'Hello!' }],
            usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
          }),
        },
      }
      vi.mocked(getClaudeClient).mockReturnValue(mockClaude as any)

      const result = await claudeCompletion([{ role: 'user', content: 'Hi' }])

      expect(result.content).toBe('Hello!')
      expect(mockClaude.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ role: 'user', content: 'Hi' }],
        })
      )
    })
  })

  describe('completionWithFallback', () => {
    it('should use primary model on first attempt', async () => {
      const mockClaude = {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [{ type: 'text', text: 'Primary response' }],
            usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
          }),
        },
      }
      vi.mocked(getClaudeClient).mockReturnValue(mockClaude as any)

      const result = await completionWithFallback([{ role: 'user', content: 'Hi' }])

      expect(result.content).toBe('Primary response')
      expect(mockClaude.messages.create).toHaveBeenCalledTimes(1)
    })

    it('should try fallback when primary fails', async () => {
      const mockClaude = {
        messages: {
          create: vi.fn()
            .mockRejectedValueOnce(new Error('Rate limit'))
            .mockResolvedValueOnce({
              content: [{ type: 'text', text: 'Fallback response' }],
              usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 },
            }),
        },
      }
      vi.mocked(getClaudeClient).mockReturnValue(mockClaude as any)

      const result = await completionWithFallback([{ role: 'user', content: 'Hi' }])

      expect(result.content).toBe('Fallback response')
      expect(mockClaude.messages.create).toHaveBeenCalledTimes(2)
    })
  })
})
