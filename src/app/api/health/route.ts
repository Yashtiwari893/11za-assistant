// src/app/api/health/route.ts
import { NextResponse } from 'next/server'
import { getSupabaseClient } from '@/lib/infrastructure/database'

export async function GET() {
  const status = {
    uptime: process.uptime(),
    timestamp: Date.now(),
    database: 'down',
    ai: 'down',
    overall: 'degraded'
  }

  try {
    // 1. Check Database (Supabase)
    const supabase = getSupabaseClient()
    const { data, error } = await supabase.from('sessions').select('count').limit(1)
    if (!error) {
       status.database = 'up'
    } else {
       console.error('[Health] DB check failed:', error.message)
    }

    // 2. Check AI (Gemini)
    const { getGeminiClient } = await import('@/lib/ai/clients')
    const gemini = getGeminiClient()
    if (gemini) {
      status.ai = 'up'
    }

    // Overall status
    if (status.database === 'up' && status.ai === 'up') {
      status.overall = 'healthy'
    }

    const responseStatus = status.overall === 'healthy' ? 200 : 503
    return NextResponse.json(status, { status: responseStatus })

  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'Unknown health check error'
    console.error('[Health] Critical check error:', error)
    return NextResponse.json({ ...status, error }, { status: 500 })
  }
}
