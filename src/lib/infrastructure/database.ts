/**
 * Production-Grade Database Utilities
 * Singleton client, query caching, batch operations, soft deletes
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '@/config'
import { logger } from './logger'
import { retryWithExponentialBackoff } from './errorHandler'

// ─── Types ────────────────────────────────────────────────────

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

// ─── Singleton Supabase Admin Client ──────────────────────────
// All server-side code MUST use this. Never create a new client.

let supabaseInstance: SupabaseClient | null = null

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseInstance) {
    supabaseInstance = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
      db: { schema: 'public' },
    })
  }
  return supabaseInstance
}

// ─── Query Cache with TTL ─────────────────────────────────────

class QueryCache {
  private cache: Map<string, CacheEntry<unknown>> = new Map()
  private stats: Map<string, QueryStats> = new Map()

  get<T>(key: string): T | null {
    const entry = this.cache.get(key)
    if (!entry) return null
    if (entry.expiresAt < Date.now()) {
      this.cache.delete(key)
      return null
    }
    return entry.data as T
  }

  set<T>(key: string, data: T, ttlMs: number = 60_000): void {
    this.cache.set(key, { data, expiresAt: Date.now() + ttlMs })
  }

  invalidate(pattern: string): void {
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) this.cache.delete(key)
    }
  }

  invalidateAll(): void {
    this.cache.clear()
  }

  recordQuery(name: string, duration: number, rowsAffected = 0, cached = false): void {
    this.stats.set(name, { queryName: name, duration, rowsAffected, cached })
  }

  getStats(): Record<string, QueryStats> {
    return Object.fromEntries(this.stats.entries())
  }
}

export const queryCache = new QueryCache()

// ─── Optimized Queries ────────────────────────────────────────

export async function fetchUser(userId: string) {
  const cacheKey = `user:${userId}`
  const cached = queryCache.get<Record<string, unknown>>(cacheKey)
  if (cached) {
    logger.debug('User fetched from cache', { userId })
    return cached
  }

  const start = Date.now()
  const supabase = getSupabaseClient()

  const { data, error } = await supabase
    .from('users')
    .select('id, phone, name, language, onboarded, created_at')
    .eq('id', userId)
    .single()

  if (error) {
    logger.error('Failed to fetch user', { userId }, error as unknown as Error)
    throw error
  }

  if (data) {
    queryCache.set(cacheKey, data, 300_000) // 5 min cache
    logger.debug('User query executed', { userId, duration: Date.now() - start })
  }

  return data
}

export async function fetchUsers(userIds: string[]) {
  if (userIds.length === 0) return []

  const supabase = getSupabaseClient()
  const start = Date.now()

  const { data, error } = await supabase
    .from('users')
    .select('id, phone, name, language, onboarded, created_at')
    .in('id', userIds)

  if (error) {
    logger.error('Failed to batch fetch users', { userCount: userIds.length }, error as unknown as Error)
    throw error
  }

  logger.debug('Batch user fetch', { count: data?.length || 0, duration: Date.now() - start })

  data?.forEach((user: Record<string, unknown>) => {
    queryCache.set(`user:${user.id}`, user, 300_000)
  })

  return data || []
}

export async function fetchReminders(
  userId: string,
  statuses: string[] = ['pending'],
  limit: number = 20
) {
  const supabase = getSupabaseClient()
  const start = Date.now()

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

  if (error) {
    logger.error('Failed to fetch reminders', { userId }, error as unknown as Error)
    throw error
  }

  logger.debug('Reminders fetched', { userId, count, duration: Date.now() - start })
  return { data: data || [], totalCount: count || 0 }
}

// ─── Transaction Wrapper ──────────────────────────────────────

export async function transaction<T>(
  fn: (supabase: SupabaseClient) => Promise<T>
): Promise<T> {
  const supabase = getSupabaseClient()
  try {
    const result = await fn(supabase)
    logger.debug('Transaction completed successfully')
    return result
  } catch (error) {
    logger.error('Transaction failed', {}, error as Error)
    throw error
  }
}

// ─── Bulk Insert with Chunking ────────────────────────────────

export async function bulkInsert<T extends Record<string, unknown>>(
  tableName: string,
  records: T[],
  chunkSize: number = 1000
): Promise<void> {
  const supabase = getSupabaseClient()

  for (let i = 0; i < records.length; i += chunkSize) {
    const chunk = records.slice(i, i + chunkSize)

    await retryWithExponentialBackoff(async () => {
      const { error } = await supabase.from(tableName).insert(chunk)
      if (error) throw error
    })

    logger.debug('Bulk insert chunk', {
      table: tableName,
      chunkSize: chunk.length,
      totalProgress: `${Math.min(i + chunkSize, records.length)}/${records.length}`,
    })
  }

  queryCache.invalidate(tableName)
}

// ─── Soft Delete ──────────────────────────────────────────────

export async function softDelete(
  tableName: string,
  id: string,
  useSoftDelete: boolean = true
): Promise<void> {
  const supabase = getSupabaseClient()

  if (useSoftDelete) {
    const { error } = await supabase
      .from(tableName)
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
  } else {
    const { error } = await supabase.from(tableName).delete().eq('id', id)
    if (error) throw error
  }

  queryCache.invalidate(tableName)
  logger.debug('Record deleted', { table: tableName, id, soft: useSoftDelete })
}
