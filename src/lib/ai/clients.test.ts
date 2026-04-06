// src/lib/ai/clients.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getGroqClient, getOpenAIClient } from './clients'
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
 
vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
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
  it('should create only one instance of Groq', () => {
    const client1 = getGroqClient()
    const client2 = getGroqClient()
    expect(client1).toBe(client2)
  })
})
 
describe('OpenAI Client Singleton', () => {
  it('should create only one instance of OpenAI', () => {
    const client1 = getOpenAIClient()
    const client2 = getOpenAIClient()
    expect(client1).toBe(client2)
  })
 
  it('should initialize with config OPENAI_API_KEY', () => {
    const client = getOpenAIClient()
    expect(client).toBeDefined()
  })
})
