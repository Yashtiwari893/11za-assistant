import { NextResponse } from 'next/server'
import { sendMorningBriefingToAll } from '@/lib/features/briefing'

export async function GET(req: Request) {
  const authHeader = (req as any).headers?.get?.('authorization')
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    console.log('[cron/briefing] Starting morning briefing...')
    const result = await sendMorningBriefingToAll()
    console.log(`[cron/briefing] Done — Sent: ${result.sent}, Failed: ${result.failed}`)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[cron/briefing] Error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
