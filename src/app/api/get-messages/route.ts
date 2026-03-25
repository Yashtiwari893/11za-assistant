// src/app/api/messages/route.ts
// Chat Messages Fetch — Bulletproof version with guardrails

import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabaseClient'

// Max messages per fetch — WhatsApp context ke liye 50 kaafi hai
const MAX_MESSAGES = 50

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url)
        const session_id = searchParams.get('session_id')
        const limitParam = searchParams.get('limit')

        // ── GUARDRAIL 1: session_id required ──────────────────────
        if (!session_id || session_id.trim() === '') {
            return NextResponse.json(
                { error: 'session_id is required' },
                { status: 400 }
            )
        }

        // ── GUARDRAIL 2: session_id format check ──────────────────
        // UUID format ya phone number — kuch bhi weird nahi hona chahiye
        const uuidPattern = /^[0-9a-f-]{36}$/i
        const phonePattern = /^\+?\d{10,15}$/
        const alphanumPattern = /^[a-zA-Z0-9_\-+]{5,50}$/

        if (!uuidPattern.test(session_id) && !phonePattern.test(session_id) && !alphanumPattern.test(session_id)) {
            return NextResponse.json(
                { error: 'Invalid session_id format' },
                { status: 400 }
            )
        }

        // ── GUARDRAIL 3: Limit validate ────────────────────────────
        let limit = MAX_MESSAGES
        if (limitParam) {
            const parsed = parseInt(limitParam, 10)
            if (isNaN(parsed) || parsed < 1) {
                return NextResponse.json(
                    { error: 'Invalid limit — must be a positive number' },
                    { status: 400 }
                )
            }
            limit = Math.min(parsed, MAX_MESSAGES) // Max se zyada nahi
        }

        // ── Fetch messages ─────────────────────────────────────────
        const { data, error } = await supabase
            .from('messages')
            .select('role, content, created_at')
            .eq('session_id', session_id.trim())
            .order('created_at', { ascending: true })
            .limit(limit)

        // ── GUARDRAIL 4: DB error ──────────────────────────────────
        if (error) {
            console.error('[messages] Supabase error:', error)
            return NextResponse.json(
                { error: 'Failed to fetch messages' },
                { status: 500 }
            )
        }

        // ── GUARDRAIL 5: Empty session ─────────────────────────────
        if (!data || data.length === 0) {
            return NextResponse.json(
                { messages: [], total: 0 },
                { status: 200 }
            )
        }

        // ── GUARDRAIL 6: Role filter — sirf valid roles ────────────
        const validRoles = ['user', 'assistant', 'system']
        const formatted = data
            .filter(item => validRoles.includes(item.role))
            .map(item => ({
                role: item.role,
                content: item.content ?? '',
            }))

        return NextResponse.json({
            messages: formatted,
            total: formatted.length,
            session_id,
        })

    } catch (err) {
        console.error('[messages] Unexpected error:', err)
        return NextResponse.json(
            { error: 'Something went wrong' },
            { status: 500 }
        )
    }
}