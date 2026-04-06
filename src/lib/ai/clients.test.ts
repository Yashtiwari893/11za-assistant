// src/lib/ai/clients.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getGroqClient } from './clients'
import * as config from '@/config'

// Mock the Groq SDK using a class
vi.mock('groq-sdk', () => {
  return {
    default: class MockGroq {
      apiKey: string;
      constructor(params: { apiKey: string }) {
        this.apiKey = params.apiKey;
      }
      chat = {
        completions: {
          create: vi.fn(),
        },
      };
    },
  };
})

describe('Groq Client Singleton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset singleton internal state between tests if possible
    // In this case, since it's a module-level variable, we might need a workaround 
    // but usually, first access creates it and subsequent reuse it.
  })

  it('should create only one instance of Groq', () => {
    const client1 = getGroqClient()
    const client2 = getGroqClient()

    expect(client1).toBe(client2)
  })

  it('should initialize with config API key', () => {
    // Ensuring it uses the correct config
    expect(config.GROQ_API_KEY).toBe('test-groq-api-key')
    const client = getGroqClient()
    expect(client).toBeDefined()
  })
})
