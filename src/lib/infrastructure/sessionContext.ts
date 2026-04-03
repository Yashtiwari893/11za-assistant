import { getSupabaseClient } from './database'

export interface SessionContext {
  last_intent?: string
  last_document_query?: string
  last_list_name?: string
  pending_action?: string
  document_path?: string
  document_id?: string
  drive_file_id?: string
  doc_type?: string
  last_referenced_id?: string
  conversation_history?: Array<{role: string, content: string, ts: number}>
}

const MAX_HISTORY = 12 // Keep last 12 turns (6 user + 6 assistant)

// ─── GET CONTEXT ──────────────────────────────────────────────
export async function getContext(userId: string): Promise<SessionContext> {
  const supabase = getSupabaseClient()
  const { data } = await supabase
    .from('sessions')
    .select('context')
    .eq('user_id', userId)
    .single()
  return (data?.context as SessionContext) || {}
}

// ─── UPDATE CONTEXT (BUG-09 FIX: Atomic upsert, no separate read) ──────────
// Uses Supabase upsert with merge strategy to avoid race conditions
export async function updateContext(userId: string, updates: Partial<SessionContext>) {
  const supabase = getSupabaseClient()

  // Get existing context — needed to merge history
  const existing = await getContext(userId)

  // BUG-09 FIX: Preserve existing history, only update metadata fields
  // Do NOT overwrite history via updateContext — use addToHistory for that
  const { conversation_history, ...metadataUpdates } = updates as SessionContext & { conversation_history?: any }

  const mergedContext: SessionContext = {
    ...existing,
    ...metadataUpdates,
    // Preserve existing history (don't let metadata updates wipe history)
    conversation_history: existing.conversation_history || [],
  }

  await supabase
    .from('sessions')
    .upsert({
      user_id: userId,
      context: mergedContext
    }, { onConflict: 'user_id' })
}

// ─── ADD TO HISTORY (Unified memory — BUG-12/BUG-17 fix) ────────────────────
// ONE function for all history writes — feature handlers + autoResponder both use this
export async function addToHistory(userId: string, role: 'user' | 'assistant', content: string) {
  if (!content?.trim()) return // Don't log empty messages

  const supabase = getSupabaseClient()
  const existing = await getContext(userId)
  const history = existing.conversation_history || []

  // Deduplicate: Don't add same message twice back-to-back
  const lastEntry = history[history.length - 1]
  if (lastEntry?.role === role && lastEntry?.content === content.trim()) return

  const truncatedContent = content.substring(0, 500) // Cap each message at 500 chars
  const updated = [...history, { role, content: truncatedContent, ts: Date.now() }]
    .slice(-MAX_HISTORY) // Keep only last MAX_HISTORY entries

  await supabase
    .from('sessions')
    .upsert({
      user_id: userId,
      context: {
        ...existing,
        conversation_history: updated,
      }
    }, { onConflict: 'user_id' })
}

// ─── CLEAR CONTEXT (for pending actions) ────────────────────────────────────
export async function clearPendingAction(userId: string) {
  const supabase = getSupabaseClient()
  const existing = await getContext(userId)

  await supabase
    .from('sessions')
    .upsert({
      user_id: userId,
      context: {
        ...existing,
        pending_action: undefined,
        document_id: undefined,
        document_path: undefined,
        drive_file_id: undefined,
        doc_type: undefined,
      }
    }, { onConflict: 'user_id' })
}
