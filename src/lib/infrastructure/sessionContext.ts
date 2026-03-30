import { getSupabaseClient } from './database'

export interface SessionContext {
  last_intent?: string
  last_document_query?: string
  last_list_name?: string
  pending_action?: string
  document_path?: string
  conversation_history?: Array<{role: string, content: string, ts: number}>
}

export async function getContext(userId: string): Promise<SessionContext> {
  const supabase = getSupabaseClient()
  const { data } = await supabase
    .from('sessions')
    .select('context')
    .eq('user_id', userId)
    .single()
  return (data?.context as SessionContext) || {}
}

export async function updateContext(userId: string, updates: Partial<SessionContext>) {
  const supabase = getSupabaseClient()
  const existing = await getContext(userId)
  
  // Clean history to keep only last 10 turns
  const history = (existing.conversation_history || []).slice(-10)
  
  await supabase
    .from('sessions')
    .upsert({ 
      user_id: userId, 
      context: { ...existing, ...updates, conversation_history: history }
    }, { onConflict: 'user_id' })
}

export async function addToHistory(userId: string, role: 'user' | 'assistant', content: string) {
  const supabase = getSupabaseClient()
  const existing = await getContext(userId)
  const history = existing.conversation_history || []
  
  const updated = [...history, { role, content, ts: Date.now() }].slice(-10)
  
  await supabase
    .from('sessions')
    .upsert({ 
      user_id: userId, 
      context: { ...existing, conversation_history: updated }
    }, { onConflict: 'user_id' })
}
