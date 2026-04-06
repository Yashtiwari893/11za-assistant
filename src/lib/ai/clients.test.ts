// src/lib/ai/clients.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getGroqClient, getClaudeClient } from './clients'
import * as config from '@/config'

// Mock SDKs
vi.mock('groq-sdk', () => {
  return {
    default: class MockGroq {
      apiKey: string;
      constructor(params: { apiKey: string }) { this.apiKey = params.apiKey; }
    },
  };
})

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockClaude {
      apiKey: string;
      constructor(params: { apiKey: string }) { this.apiKey = params.apiKey; }
      messages = { create: vi.fn() };
    },
  };
})

describe('AI Client Singletons', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Groq Client', () => {
    it('should create only one instance of Groq', () => {
      const client1 = getGroqClient()
      const client2 = getGroqClient()
      expect(client1).toBe(client2)
    })
  })

  describe('Claude Client', () => {
    it('should create only one instance of Claude', () => {
      const client1 = getClaudeClient()
      const client2 = getClaudeClient()
      expect(client1).toBe(client2)
    })

    it('should initialize with config API key', () => {
      const client = getClaudeClient()
      expect(client).toBeDefined()
      // @ts-ignore
      expect(client.apiKey).toBe(config.ANTHROPIC_API_KEY)
    })
  })
})
