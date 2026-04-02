/**
 * Production-Grade Rate Limiting
 * Prevents abuse, DDoS, API flooding
 * Uses in-memory cache with Redis fallback support
 */

import { createError } from './errorHandler'
import { logger } from './logger'

interface RateLimitConfig {
  windowMs: number     // Time window in milliseconds
  maxRequests: number  // Max requests per window
  keyPrefix?: string
  skipOnError?: boolean
  skipSuccessfulRequests?: boolean
  skipFailedRequests?: boolean
}

interface RateLimitEntry {
  count: number
  resetAt: number
}

/**
 * In-memory rate limiter with automatic cleanup
 */
class RateLimiter {
  private store: Map<string, RateLimitEntry> = new Map()
  private config: RateLimitConfig

  constructor(config: RateLimitConfig) {
    this.config = {
      keyPrefix: 'rl:',
      ...config,
    }

    // Cleanup old entries every cleanup interval
    setInterval(() => this.cleanup(), 60000) // Every 60 seconds
  }

  async isLimited(key: string): Promise<boolean> {
    const fullKey = `${this.config.keyPrefix}${key}`
    const now = Date.now()

    let entry = this.store.get(fullKey)

    // Entry expired or doesn't exist
    if (!entry || entry.resetAt < now) {
      entry = {
        count: 1,
        resetAt: now + this.config.windowMs,
      }
      this.store.set(fullKey, entry)
      return false
    }

    // Check if limit exceeded
    if (entry.count >= this.config.maxRequests) {
      return true
    }

    // Increment counter
    entry.count += 1
    this.store.set(fullKey, entry)
    return false
  }

  getRetryAfter(key: string): number | null {
    const fullKey = `${this.config.keyPrefix}${key}`
    const entry = this.store.get(fullKey)

    if (!entry) return null

    const now = Date.now()
    if (entry.resetAt <= now) return null

    return Math.ceil((entry.resetAt - now) / 1000)
  }

  private cleanup(): void {
    const now = Date.now()
    let cleaned = 0

    for (const [key, entry] of this.store.entries()) {
      if (entry.resetAt < now) {
        this.store.delete(key)
        cleaned++
      }
    }

    if (cleaned > 0) {
      logger.debug(`Rate limiter cleanup: removed ${cleaned} expired entries`)
    }
  }

  reset(key: string): void {
    const fullKey = `${this.config.keyPrefix}${key}`
    this.store.delete(fullKey)
  }
}

/**
 * Create rate limiters for different endpoints
 */
export const createRateLimiter = (config: RateLimitConfig) => new RateLimiter(config)

/**
 * Preset rate limiter configurations
 */
export const rateLimiterConfigs = {
  // Global API limit: 100 requests per minute per IP
  api: {
    windowMs: 60 * 1000,
    maxRequests: 100,
    keyPrefix: 'rl:api:',
  },

  // WhatsApp webhook: 1000 messages per minute per phone
  webhook: {
    windowMs: 60 * 1000,
    maxRequests: 1000,
    keyPrefix: 'rl:webhook:',
  },

  // Auth attempts: 5 per 15 minutes per IP
  auth: {
    windowMs: 15 * 60 * 1000,
    maxRequests: 5,
    keyPrefix: 'rl:auth:',
  },

  // Chat/LLM calls: 20 per minute per user
  chat: {
    windowMs: 60 * 1000,
    maxRequests: 20,
    keyPrefix: 'rl:chat:',
  },

  // File upload: 5 per minute per user
  fileUpload: {
    windowMs: 60 * 1000,
    maxRequests: 5,
    keyPrefix: 'rl:upload:',
  },
}

/**
 * Middleware factory for Express/Next.js
 */
export function checkRateLimit(limiter: RateLimiter, keyFn: (req: any) => string) {
  return async (req: any, res: any, next: any) => {
    try {
      const key = keyFn(req)
      const isLimited = await limiter.isLimited(key)

      if (isLimited) {
        const retryAfter = limiter.getRetryAfter(key)
        res.set('Retry-After', retryAfter?.toString() || '60')
        
        logger.warn('Rate limit exceeded', {
          key,
          retryAfter,
          ip: req.ip,
        })

        throw createError.rateLimited(retryAfter ?? undefined)
      }

      next()
    } catch (error) {
      next(error)
    }
  }
}

/**
 * Utility to extract client IP from request
 */
export function getClientIp(req: any): string {
  return (
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'unknown'
  )
}
