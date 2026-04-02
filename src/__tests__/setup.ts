// src/__tests__/setup.ts
// Test setup — mock environment variables before any module loads

// Mock all required env vars so config/index.ts doesn't throw
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test-project.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
process.env.GROQ_API_KEY = 'test-groq-api-key'
process.env.MISTRAL_API_KEY = 'test-mistral-api-key'
process.env.WHATSAPP_AUTH_TOKEN = 'test-whatsapp-token'
process.env.WHATSAPP_ORIGIN = 'https://test.example.com'
process.env.ELEVEN_ZA_API_KEY = 'test-11za-key'
process.env.WEBHOOK_VERIFY_TOKEN = 'test-webhook-token'
process.env.CRON_SECRET = 'test-cron-secret'
process.env.DEV_SECRET = 'test-dev-secret'
// NODE_ENV is set to 'test' automatically by Vitest

