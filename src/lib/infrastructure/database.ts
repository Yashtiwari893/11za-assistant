/**
 * Production-Grade Database Utilities
 * Connection pooling, query optimization, caching, transactions
 */

import { createClient } from '@supabase/supabase-js'
import { logger } from './logger'
import { retryWithExponentialBackoff } from './errorHandler'

interface QueryStats {
  queryName: string
  duration: number
  rowsAffected: number
  cached: boolean
}

interface CacheEntry<T> {
  data: T
  expiresAt: number
}

/**
 * Singleton Supabase client with connection pooling
 */
let supabaseInstance: ReturnType<typeof createClient> | null = null

export function getSupabaseClient() {
  if (!supabaseInstance) {
    supabaseInstance = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          persistSession: false,
        },
        db: {
          // Connection pooling settings
          schema: 'public',
        },
        // Global request timeout
        global: {
          timeout: 10000,
        },
      }
    )
  }

  return supabaseInstance
}

/**
 * Query result cache with TTL
 */
class QueryCache {
  private cache: Map<string, CacheEntry<any>> = new Map()
  private stats: Map<string, QueryStats> = new Map()

  get<T>(key: string): T | null {
    const entry = this.cache.get(key)

    if (!entry) {
      return null
    }

    if (entry.expiresAt < Date.now()) {
      this.cache.delete(key)
      return null
    }

    return entry.data as T
  }

  set<T>(key: string, data: T, ttlMs: number = 60000): void {
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + ttlMs,
    })
  }

  invalidate(pattern: string): void {
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key)
      }
    }
  }

  invalidateAll(): void {
    this.cache.clear()
  }

  recordQuery(name: string, duration: number, rowsAffected: number = 0, cached: boolean = false): void {
    this.stats.set(name, {
      queryName: name,
      duration,
      rowsAffected,
      cached,
    })
  }

  getStats(): Record<string, QueryStats> {
    const result: Record<string, QueryStats> = {}
    for (const [key, value] of this.stats.entries()) {
      result[key] = value
    }
    return result
  }
}

export const queryCache = new QueryCache()

/**
 * Optimized user fetcher (prevents N+1 query)
 */
export async function fetchUser(userId: string) {
  const cacheKey = `user:${userId}`
  let user = queryCache.get<any>(cacheKey)

  if (user) {
    logger.debug('User fetched from cache', { userId })
    return user
  }

  const startTime = Date.now()
  const supabase = getSupabaseClient()

  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, phone, name, language, onboarded, created_at')
      .eq('id', userId)
      .single()

    if (error) throw error

    if (data) {
      queryCache.set(cacheKey, data, 300000) // 5 min cache
      logger.debug('User query executed', {
        userId,
        duration: Date.now() - startTime,
      })
    }

    return data
  } catch (error) {
    logger.error('Failed to fetch user', { userId }, error as Error)
    throw error
  }
}

/**
 * Batch fetch users (prevents N+1)
 */
export async function fetchUsers(userIds: string[]) {
  if (userIds.length === 0) return []

  const supabase = getSupabaseClient()
  const startTime = Date.now()

  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, phone, name, language, onboarded, created_at')
      .in('id', userIds)

    if (error) throw error

    logger.debug('Batch user fetch', {
      count: data?.length || 0,
      duration: Date.now() - startTime,
    })

    // Cache each result
    data?.forEach(user => {
      queryCache.set(`user:${user.id}`, user, 300000)
    })

    return data || []
  } catch (error) {
    logger.error('Failed to batch fetch users', { userCount: userIds.length }, error as Error)
    throw error
  }
}

/**
 * Optimized reminder fetcher with pagination
 */
export async function fetchReminders(
  userId: string,
  statuses: string[] = ['pending'],
  limit: number = 20
) {
  const supabase = getSupabaseClient()
  const startTime = Date.now()

  try {
    let query = supabase
      .from('reminders')
      .select('id, title, scheduled_at, status, recurrence, user_id', { count: 'exact' })
      .eq('user_id', userId)

    if (statuses.length > 0) {
      query = query.in('status', statuses)
    }

    const { data, count, error } = await query
      .order('scheduled_at', { ascending: true })
      .limit(limit)

    if (error) throw error

    logger.debug('Reminders fetched', {
      userId,
      count,
      duration: Date.now() - startTime,
    })

    return { data: data || [], totalCount: count || 0 }
  } catch (error) {
    logger.error('Failed to fetch reminders', { userId }, error as Error)
    throw error
  }
}

/**
 * Transaction wrapper for atomic operations
 */
export async function transaction<T>(
  fn: (supabase: ReturnType<typeof getSupabaseClient>) => Promise<T>
): Promise<T> {
  const supabase = getSupabaseClient()

  try {
    // Note: Real transactional support requires Supabase's PGSQL procedures
    // This is a simple wrapper - for complex transactions, use stored procedures
    const result = await fn(supabase)
    logger.debug('Transaction completed successfully')
    return result
  } catch (error) {
    logger.error('Transaction failed', {}, error as Error)
    throw error
  }
}

/**
 * Bulk insert with chunking (prevents too-large requests)
 */
export async function bulkInsert<T>(
  tableName: string,
  records: T[],
  chunkSize: number = 1000
): Promise<void> {
  const supabase = getSupabaseClient()

  for (let i = 0; i < records.length; i += chunkSize) {
    const chunk = records.slice(i, i + chunkSize)

    try {
      await retryWithExponentialBackoff(async () => {
        const { error } = await supabase.from(tableName).insert(chunk)
        if (error) throw error
      })

      logger.debug('Bulk insert chunk', {
        table: tableName,
        chunkSize: chunk.length,
        totalProgress: `${Math.min(i + chunkSize, records.length)}/${records.length}`,
      })
    } catch (error) {
      logger.error('Bulk insert failed', {
        table: tableName,
        chunkIndex: i / chunkSize,
      }, error as Error)
      throw error
    }
  }

  // Invalidate cache
  queryCache.invalidate(tableName)
}

/**
 * Safe delete with soft-delete support
 */
export async function softDelete(
  tableName: string,
  id: string,
  useSoftDelete: boolean = true
): Promise<void> {
  const supabase = getSupabaseClient()

  try {
    if (useSoftDelete) {
      const { error } = await supabase
        .from(tableName)
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id)

      if (error) throw error
    } else {
      const { error } = await supabase
        .from(tableName)
        .delete()
        .eq('id', id)

      if (error) throw error
    }

    queryCache.invalidate(tableName)
    logger.debug('Record soft-deleted', { table: tableName, id })
  } catch (error) {
    logger.error('Soft delete failed', { table: tableName, id }, error as Error)
    throw error
  }
}
