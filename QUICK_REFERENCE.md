# ⚡ ZARA - QUICK REFERENCE GUIDE FOR DEVELOPERS

## 🎯 One-Minute Overview

ZARA is now production-ready with new infrastructure utilities. Use them in every API route:

```typescript
// 1. Imports
import { logger, setTraceId } from '@/lib/infrastructure/logger'
import { createError, createErrorResponse } from '@/lib/infrastructure/errorHandler'
import { validatePhone, validateString } from '@/lib/infrastructure/inputValidator'
import { getSupabaseClient } from '@/lib/infrastructure/database'

// 2. Setup
const traceId = uuid()
setTraceId(traceId)

// 3. Validate input
const phone = validatePhone(req.body.phone)

// 4. Log
logger.info('Processing', { phone }) 

// 5. Query
const supabase = getSupabaseClient()

// 6. Error handling
catch (err) {
  logger.error('Failed', {}, err)
  return createErrorResponse(err, traceId)
}
```

---

## 📦 Infrastructure Modules Layout

```
Input → Validation → Processing → Caching → Response
  ↓         ↓           ↓          ↓         ↓
Validate  Input      Supabase  Query    Safe
Enum      Validator  Logger    Cache    Error
String                Errors   Database Response
Phone
File+
Email
```

---

## 🚀 Common Patterns

### Pattern 1: Simple GET Route
```typescript
import { logger, setTraceId } from '@/lib/infrastructure/logger'
import { getSupabaseClient } from '@/lib/infrastructure/database'
import { createErrorResponse } from '@/lib/infrastructure/errorHandler'
import { v4 as uuid } from 'uuid'

export async function GET(req: NextRequest) {
  const traceId = uuid()
  setTraceId(traceId)

  try {
    const supabase = getSupabaseClient()
    const { data, error } = await supabase.from('users').select('*').limit(10)
    
    if (error) throw error
    logger.info('Users fetched', { count: data?.length })
    return NextResponse.json({ users: data })
  } catch (err) {
    return createErrorResponse(err, traceId)
  }
}
```

### Pattern 2: POST with Validation
```typescript
import { validateJSON, validatePhone, validateString } from '@/lib/infrastructure/inputValidator'
import { createError } from '@/lib/infrastructure/errorHandler'

export async function POST(req: NextRequest) {
  const traceId = uuid()
  setTraceId(traceId)

  try {
    // Validate all inputs upfront
    const body = validateJSON(await req.json(), ['phone', 'message'])
    const phone = validatePhone(body.phone)
    const message = validateString(body.message, 1, 10000)
    
    // ... process
  } catch (err) {
    return createErrorResponse(err, traceId)
  }
}
```

### Pattern 3: With Rate Limiting
```typescript
import { createRateLimiter, rateLimiterConfigs, getClientIp } from '@/lib/infrastructure/rateLimiter'

const limiter = createRateLimiter(rateLimiterConfigs.chat)

export async function POST(req: NextRequest) {
  const clientIp = getClientIp(req)
  if (await limiter.isLimited(clientIp)) {
    throw createError.rateLimited()
  }
  // ... proceed
}
```

### Pattern 4: Retry Logic
```typescript
import { retryWithExponentialBackoff } from '@/lib/infrastructure/errorHandler'

const result = await retryWithExponentialBackoff(
  async () => await someFlakeyOperation(),
  3  // max 3 retries
)
```

### Pattern 5: Database Caching
```typescript
import { queryCache, fetchUser } from '@/lib/infrastructure/database'

// Auto-cached with 5-min TTL
const user = await fetchUser(userId)

// Batch fetch (prevents N+1)
const users = await fetchUsers([id1, id2, id3])

// Manual cache access
queryCache.invalidate('user:')  // Clear pattern
```

### Pattern 6: Advanced Chat
```typescript
import { advancedChat, analyzeSentiment } from '@/lib/infrastructure/chatbotIntelligence'

const response = await advancedChat(
  userMessage,
  {
    userId,
    userPhone,
    userName: 'Raj',
    language: 'hi',
    conversationHistory,
  },
  { useRAG: true, ragContext }
)

// Returns: { message, confidence, requiresFollowUp, tone }
const { sentiment, emotion } = await analyzeSentiment(userMessage)
```

---

## 🔍 Error Handling Quick Ref

```typescript
// Creation
throw createError.validation('Invalid input')         // 400
throw createError.auth()                             // 401
throw createError.notFound('User')                   // 404
throw createError.conflict('Already exists')        // 409
throw createError.rateLimited(60)                    // 429
throw createError.internal('DB error')               // 500
throw createError.serviceUnavailable('Groq')         // 503
throw createError.timeout('API call')                // 504

// Response
return createErrorResponse(error, traceId)  // Auto-safe response
```

---

## 🔐 Validation Quick Ref

```typescript
validatePhone('9876543210')           // → '9876543210'
validateEmail('user@example.com')     // → 'user@example.com'
validateString(str, 1, 1000)         // → trimmed string
validatePlainText(str, 10000)        // → sanitized (XSS removed)
validateEnum(val, ['a','b','c'])     // → 'a' or throw
validateLanguage('hi')                // → 'hi'
validateInteger(val, 0, 100)         // → number
validateISODate('2026-03-25')        // → string
validateUUID(id)                      // → UUID string
validateUrl('https://...')           // → URL string
validateFileType(mime, [...])        // → normalized mime
validateFileSize(bytes, max)         // → bytes or throw
escapeLikePattern(str)                // → escaped for SQL
```

---

## 📊 Logging Quick Ref

```typescript
// Setup once per request
const traceId = uuid()
setTraceId(traceId)

// Usage
logger.debug('msg', { key: value })   // Verbose
logger.info('msg', { key: value })    // Normal
logger.warn('msg', { key: value })    // Warning
logger.error('msg', { key: value }, error)  // Error + stack

// Gets: timestamp, level, message, context, traceId
// Sends to: console (dev) or external service (prod)
```

---

## 🛡️ Rate Limiting Quick Ref

```typescript
// Presets
rateLimiterConfigs.api          // 100/min per IP
rateLimiterConfigs.webhook      // 1000/min per phone
rateLimiterConfigs.auth         // 5/15min per IP
rateLimiterConfigs.chat         // 20/min per user
rateLimiterConfigs.fileUpload   // 5/min per user

// Usage
const limiter = createRateLimiter(rateLimiterConfigs.api)
const isLimited = await limiter.isLimited('user-key')
const retryAfter = limiter.getRetryAfter('user-key')
limiter.reset('user-key')  // Clear limit
```

---

## 🗄️ Database Quick Ref

```typescript
// Singleton client
const supabase = getSupabaseClient()

// Cached fetch (5-min TTL, auto-cached)
const user = await fetchUser(userId)

// Batch query (prevents N+1)
const users = await fetchUsers([id1, id2, id3])

// Cache management
queryCache.get('key')              // Get from cache
queryCache.set('key', data, 600000)  // Set with 10-min TTL
queryCache.invalidate('pattern:')  // Clear by pattern
queryCache.invalidateAll()         // Clear all

// Bulk operations
await bulkInsert('table_name', records, 1000)  // Chunk size 1000
await softDelete('table_name', id, true)       // Soft delete
```

---

## 💬 Chatbot Quick Ref

```typescript
// Context structure
const context: ChatContext = {
  userId,
  userPhone,
  userName: 'Raj',
  language: 'hi',          // 'en' | 'hi' | 'gu'
  conversationHistory: messages,
  userPreferences: {},
}

// Advanced chat with fallback chain
const response = await advancedChat(
  userMessage,
  context,
  { useRAG: true, ragContext, maxTokens: 300, temperature: 0.7 }
)
// Auto-fallback: Model1 → Model2 → Template

// Sentiment analysis
const { sentiment, emotion, confidence } = await analyzeSentiment(message)
// Returns: 'positive' | 'negative' | 'neutral'

// Humanize response
const humanized = humanizeResponse(message, 'hi', 'Raj')
// Adds personality + name usage

// Extract structured data
const data = await extractStructuredData(message, {
  'field1': 'description',
  'field2': 'description'
})
// Returns: { field1: value, field2: value }
```

---

## 📝 Route Template (Copy-Paste Ready)

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuid } from 'uuid'
import { logger, setTraceId } from '@/lib/infrastructure/logger'
import { createErrorResponse, createError } from '@/lib/infrastructure/errorHandler'
import { validateJSON } from '@/lib/infrastructure/inputValidator'
import { getSupabaseClient } from '@/lib/infrastructure/database'

export async function POST(req: NextRequest) {
  const traceId = uuid()
  setTraceId(traceId)

  try {
    // Parse & validate
    const body = validateJSON(await req.json(), ['requiredField'])
    
    logger.info('Processing request', { endpoint: '/api/your-route' })

    // Your logic here
    const supabase = getSupabaseClient()
    
    logger.info('Request completed', { status: 'success' })
    return NextResponse.json({ success: true, traceId })

  } catch (err) {
    logger.error('Request failed', {}, err as Error)
    return createErrorResponse(err, traceId)
  }
}
```

---

## ⚠️ Common Mistakes to Avoid

```typescript
// ❌ DON'T: console.log
console.log('User created:', userId)

// ✅ DO: logger
logger.info('User created', { userId, traceId })

// ❌ DON'T: Generic errors
throw new Error('Something went wrong')

// ✅ DO: Typed errors
throw createError.validation('Invalid email', { email })

// ❌ DON'T: Trust user input
const userId = req.body.userId

// ✅ DO: Validate input
const userId = validateUUID(req.body.userId)

// ❌ DON'T: One-off Supabase clients
const supabase = createClient(url, key)

// ✅ DO: Use singleton
const supabase = getSupabaseClient()

// ❌ DON'T: Expose error details
throw error

// ✅ DO: Safe responses
return createErrorResponse(error, traceId)

// ❌ DON'T: No retry logic
await someFlakeyAPI()

// ✅ DO: Retry transients
await retryWithExponentialBackoff(() => someFlakeyAPI())
```

---

## 🧪 Testing Infrastructure

```typescript
import { describe, it, expect } from 'vitest'
import { validatePhone } from '@/lib/infrastructure/inputValidator'

describe('Infrastructure', () => {
  it('validates phone', () => {
    expect(validatePhone('9876543210')).toBe('9876543210')
    expect(() => validatePhone('123')).toThrow()
  })
})
```

---

## 📞 Debugging Tips

### Check Trace ID
```typescript
// Every log has trace ID
logger.info('Event', { data })
// ✓ Included: traceId, timestamp, userId, env

// Find in logs
grep "traceId:550e8400" logs.json
```

### Check Cache Hit Rate
```typescript
const stats = queryCache.getStats()
console.log(stats)
// Shows: queryName, duration, rowsAffected, cached
```

### Debug Rate Limiter
```typescript
const limiter = createRateLimiter(config)
await limiter.isLimited('key')
const retryAfter = limiter.getRetryAfter('key')  // Seconds until reset
```

### Inspect Error
```typescript
try {
  await operation()
} catch (err) {
  if (err instanceof AppErrorImpl) {
    console.log(err.code)           // 'VALIDATION_ERROR'
    console.log(err.statusCode)     // 400
    console.log(err.isRetryable)    // false
  }
}
```

---

## 🚀 Deployment Checklist

Before deploying a new route:

- [ ] Uses `logger` and trace ID
- [ ] Validates all inputs
- [ ] Has rate limiting if needed
- [ ] Uses singleton `getSupabaseClient()`
- [ ] Proper error handling with `createErrorResponse()`
- [ ] Retry logic for transient failures
- [ ] Tests pass locally
- [ ] No `console.log()` anywhere
- [ ] No hardcoded secrets
- [ ] Documentation added

---

## 📚 Full Documentation

- **Deep Dive**: `INFRASTRUCTURE_MIGRATION_GUIDE.md`
- **Deployment**: `PRODUCTION_DEPLOYMENT_GUIDE.md`
- **Audit**: `AUDIT_SUMMARY.md`

---

**Last Updated**: March 25, 2026  
**Quick Reference Version**: 1.0

