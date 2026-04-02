# 🔧 ZARA - INFRASTRUCTURE MIGRATION GUIDE

## Overview

This guide explains the new infrastructure utilities and how to integrate them into all API routes. The new infrastructure provides production-grade reliability, security, and observability.

---

## 📦 New Infrastructure Modules

### 1. Logger (`lib/infrastructure/logger.ts`)

**Purpose**: Structured logging with trace IDs and severity levels

**Before**:
```typescript
console.log('User created:', userId)
console.error('Database error:', error)
```

**After**:
```typescript
import { logger, setTraceId } from '@/lib/infrastructure/logger'

setTraceId(uuid())  // Set at request start
logger.info('User created', { userId, timestamp: new Date() })
logger.error('Database error', { userId }, error)
```

**Usage in Routes**:
```typescript
import { logger, setTraceId } from '@/lib/infrastructure/logger'
import { v4 as uuid } from 'uuid'

export async function POST(req: NextRequest) {
  const traceId = uuid()
  setTraceId(traceId)
  
  try {
    logger.debug('Processing request', { endpoint: '/api/save-message' })
    // ... your code
    logger.info('Request processed', { status: 'success' })
  } catch (error) {
    logger.error('Request failed', {}, error as Error)
  }
}
```

---

### 2. Error Handler (`lib/infrastructure/errorHandler.ts`)

**Purpose**: Typed errors with automatic retry logic and safe responses

**Before**:
```typescript
if (!userId) {
  return NextResponse.json({ error: 'User not found' }, { status: 404 })
}
throw new Error('Database connection failed')
```

**After**:
```typescript
import { createError, createErrorResponse } from '@/lib/infrastructure/errorHandler'

if (!userId) {
  throw createError.notFound('User', { userId })
}

try {
  await dbOperation()
} catch (err) {
  return createErrorResponse(err, traceId)
}
```

**Available Error Factories**:
```typescript
createError.validation(msg)           // 400
createError.auth(msg)                 // 401
createError.notFound(resource)        // 404
createError.conflict(msg)             // 409
createError.rateLimited(retryAfter)   // 429
createError.internal(msg)             // 500
createError.serviceUnavailable(service) // 503
createError.timeout(operation)        // 504
```

**Retry Logic**:
```typescript
import { retryWithExponentialBackoff } from '@/lib/infrastructure/errorHandler'

const result = await retryWithExponentialBackoff(
  async () => {
    return await supabase.from('users').select('*').limit(1)
  },
  3,  // max retries
  100 // base delay ms
)
```

---

### 3. Input Validator (`lib/infrastructure/inputValidator.ts`)

**Purpose**: Comprehensive input validation and sanitization

**Before**:
```typescript
const phone = req.body.phone
const message = req.body.message
// Hope it's valid...
```

**After**:
```typescript
import { validatePhone, validateString, validateJSON } from '@/lib/infrastructure/inputValidator'

const body = validateJSON(req.body, ['phone', 'message'])
const phone = validatePhone(body.phone)
const message = validateString(body.message, 1, 10000, 'Message')
```

**Available Validators**:
```typescript
validatePhone(phone)                  // Normalize to digits
validateEmail(email)                  // RFC 5322
validateString(str, min, max)         // Length bounds
validatePlainText(text, maxLen)       // Remove XSS
validateEnum(val, [...values])        // Restrict to set
validateLanguage(lang)                // 'en' | 'hi' | 'gu'
validateInteger(num, min, max)        // Integer bounds
validateISODate(dateStr)              // Parse ISO date
validateUUID(id)                      // UUIDv4
validateUrl(url)                      // Valid URL
validateFileType(mime, allowed)       // File type allowlist
validateFileSize(size, maxBytes)      // Max file size
escapeLikePattern(str)                // SQL LIKE escaping
sanitizeObject(obj, maxDepth)         // Recursive sanitization
```

---

### 4. Rate Limiter (`lib/infrastructure/rateLimiter.ts`)

**Purpose**: Prevent abuse and DDoS attacks

**Preset Configurations**:
```typescript
const configs = {
  api: { windowMs: 60 * 1000, maxRequests: 100 },  // 100/min
  webhook: { windowMs: 60 * 1000, maxRequests: 1000 }, // 1000/min
  auth: { windowMs: 15 * 60 * 1000, maxRequests: 5 }, // 5/15min
  chat: { windowMs: 60 * 1000, maxRequests: 20 },  // 20/min
  fileUpload: { windowMs: 60 * 1000, maxRequests: 5 }, // 5/min
}
```

**In Your Routes**:
```typescript
import { createRateLimiter, rateLimiterConfigs, getClientIp } from '@/lib/infrastructure/rateLimiter'
import { createError } from '@/lib/infrastructure/errorHandler'

const limiter = createRateLimiter(rateLimiterConfigs.chat)

export async function POST(req: NextRequest) {
  const clientIp = getClientIp(req)
  const isLimited = await limiter.isLimited(clientIp)
  
  if (isLimited) {
    throw createError.rateLimited()
  }
  
  // ... process request
}
```

---

### 5. Database Utilities (`lib/infrastructure/database.ts`)

**Purpose**: Connection pooling, query caching, N+1 prevention

**Usage**:
```typescript
import { getSupabaseClient, fetchUser, queryCache } from '@/lib/infrastructure/database'

// Use singleton client
const supabase = getSupabaseClient()

// Fetch with automatic caching (5 min TTL)
const user = await fetchUser(userId)

// Batch fetch prevents N+1
const users = await fetchUsers([id1, id2, id3])

// Access cache directly when needed
const cached = queryCache.get(`user:${userId}`)
```

**Cache Operations**:
```typescript
// Get from cache or null
const user = queryCache.get<User>(`user:${userId}`)

// Set with 10-minute TTL
queryCache.set(`user:${userId}`, userData, 600000)

// Invalidate pattern
queryCache.invalidate('user:')

// Get stats
const stats = queryCache.getStats()
```

---

### 6. Chatbot Intelligence (`lib/infrastructure/chatbotIntelligence.ts`)

**Purpose**: Context-aware, human-like responses with fallback chains

**Usage**:
```typescript
import { advancedChat, analyzeSentiment, humanizeResponse } from '@/lib/infrastructure/chatbotIntelligence'

const response = await advancedChat(
  userMessage,
  {
    userId,
    userPhone,
    userName: 'Raj',
    language: 'hi',
    conversationHistory: previousMessages,
  },
  {
    useRAG: true,
    ragContext: documentChunks,
    maxTokens: 300,
    temperature: 0.7,
  }
)

// Returns: { message, confidence, requiresFollowUp, tone }

// Analyze emotion
const { sentiment, emotion } = await analyzeSentiment(userMessage)

// Humanize response with personality
const humanized = humanizeResponse(response.message, 'hi', 'Raj')
```

---

## 🔄 Migration Checklist

### Phase 1: Core Routes
- [ ] `/api/webhook/whatsapp` - DONE
- [ ] `/api/chat` - Add error handling + logging
- [ ] `/api/save-message` - Add validation + rate limiting
- [ ] `/api/process-file` - Add file validation

### Phase 2: Feature Routes  
- [ ] `/api/generate-system-prompt` - Add logging
- [ ] `/api/get-messages` - Add caching
- [ ] `/api/cron/briefing` - Add error recovery
- [ ] `/api/cron/reminders` - Add logging

### Phase 3: Admin Routes
- [ ] `/api/phone-mappings` - Add validation + auth
- [ ] `/api/phone-groups` - Add validation
- [ ] `/api/dev/reset-all` - Add auth + logging

---

## 📝 Example: Migrating `/api/save-message`

**Before**:
```typescript
import { supabase } from "@/lib/supabaseClient"
import { NextResponse } from "next/server"

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { session_id, role, content } = body

    const { error } = await supabase
      .from("messages")
      .insert([{ session_id, role, content }])

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error"
    console.error("SUPABASE_SAVE_ERROR:", message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
```

**After**:
```typescript
import { NextRequest, NextResponse } from "next/server"
import { getSupabaseClient } from "@/lib/infrastructure/database"
import { logger, setTraceId } from "@/lib/infrastructure/logger"
import { createErrorResponse, createError, retryWithExponentialBackoff } from "@/lib/infrastructure/errorHandler"
import { validateJSON, validateString, validateUUID } from "@/lib/infrastructure/inputValidator"
import { createRateLimiter, rateLimiterConfigs, getClientIp } from "@/lib/infrastructure/rateLimiter"
import { v4 as uuid } from "uuid"

const supabase = getSupabaseClient()
const limiter = createRateLimiter(rateLimiterConfigs.api)

export async function POST(req: NextRequest) {
  const traceId = uuid()
  setTraceId(traceId)

  try {
    // Rate limiting
    const clientIp = getClientIp(req)
    if (await limiter.isLimited(clientIp)) {
      throw createError.rateLimited()
    }

    // Input validation
    const body = validateJSON(await req.json(), ["session_id", "role", "content"])
    const sessionId = validateUUID(body.session_id)
    const role = validateString(body.role, 1, 50)
    const content = validateString(body.content, 1, 10000)

    logger.debug('Saving message', { sessionId, role })

    // Save with retry
    await retryWithExponentialBackoff(async () => {
      const { error } = await supabase
        .from("messages")
        .insert([{
          session_id: sessionId,
          role,
          content,
        }])

      if (error) throw error
    }, 3)

    logger.info('Message saved', { sessionId, traceId })
    return NextResponse.json({ success: true, traceId })

  } catch (err) {
    logger.error('Save message failed', {}, err as Error)
    return createErrorResponse(err, traceId)
  }
}
```

---

## 🧪 Testing Infrastructure

### Unit Test Example

```typescript
import { describe, it, expect } from 'vitest'
import { createError, retryWithExponentialBackoff } from '@/lib/infrastructure/errorHandler'
import { validatePhone } from '@/lib/infrastructure/inputValidator'

describe('Infrastructure', () => {
  it('validates phone numbers correctly', () => {
    const valid = validatePhone('9876543210')
    expect(valid).toBe('9876543210')
    
    expect(() => validatePhone('123')).toThrow()
  })

  it('retries transient failures', async () => {
    let attempts = 0
    const result = await retryWithExponentialBackoff(async () => {
      attempts++
      if (attempts < 2) throw new Error('Transient')
      return 'success'
    })
    expect(result).toBe('success')
    expect(attempts).toBe(2)
  })
})
```

---

## 🚀 Deployment Verification

After deploying infrastructure changes:

```bash
# 1. Verify builds
npm run build

# 2. Type check
npx tsc --noEmit

# 3. Lint
npm run lint

# 4. Test in staging
vercel deploy --prebuilt

# 5. Monitor logs
vercel logs --follow

# 6. Run smoke tests
curl https://staging.zara.dev/api/health

# 7. Gradual rollout
```

---

## ⚠️ Common Migration Issues

### Issue: "Cannot find module '@/lib/infrastructure/*'"
**Solution**: Path aliases not working. Check `tsconfig.json` has correct paths.

### Issue: "Rate limiter not limiting"
**Solution**: Verify `getClientIp()` correctly reads X-Forwarded-For from proxy.

### Issue: "Log entries missing in production"
**Solution**: Set `LOG_ENDPOINT` environment variable pointing to logging service.

### Issue: "Cache hit rate too low"
**Solution**: Increase TTL for less-frequently-changing data.

---

## 📞 Support

For infrastructure questions:
- Check existing route implementations in `/api/webhook/whatsapp/route.ts`
- Review infrastructure tests in `__tests__/infrastructure/`
- Contact: infrastructure@zara.dev

---

**Migration Status**: 🟢 20% Complete (Webhook refactored)
**Target Completion**: 100% (All routes)
**Timeline**: Week 1-2

