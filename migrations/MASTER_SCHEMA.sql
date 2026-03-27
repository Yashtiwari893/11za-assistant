-- =========================================
-- ZARA WhatsApp Assistant — MASTER SCHEMA
-- Run this ONCE on a fresh Supabase project
-- Last updated: 2026-03-27
-- =========================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS vector;

-- =========================================
-- 1. USERS
-- =========================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone TEXT UNIQUE NOT NULL,
    name TEXT,
    onboarded BOOLEAN DEFAULT false,
    language TEXT DEFAULT 'hi',
    timezone TEXT DEFAULT 'Asia/Kolkata',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================
-- 2. SESSIONS (for pending actions like document labelling)
-- =========================================
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    context JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

-- =========================================
-- 3. REMINDERS
-- =========================================
DO $$ BEGIN
    CREATE TYPE reminder_recurrence AS ENUM ('daily', 'weekly', 'monthly');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE reminder_status AS ENUM ('pending', 'completed', 'snoozed', 'cancelled', 'sent');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS reminders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    note TEXT,
    scheduled_at TIMESTAMPTZ DEFAULT NOW(),  -- nullable for recurring
    recurrence reminder_recurrence,          -- NULL = one-time
    recurrence_time TEXT,                    -- e.g. "09:00" for daily
    status reminder_status DEFAULT 'pending',
    snooze_count INT DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reminders_due
ON reminders (scheduled_at)
WHERE status = 'pending' OR status = 'snoozed';

-- View for cron job — due reminders
DROP VIEW IF EXISTS due_reminders_view;
CREATE VIEW due_reminders_view AS
SELECT
    r.id as reminder_id,
    r.user_id,
    r.title,
    r.note,
    r.scheduled_at,
    r.recurrence,
    r.recurrence_time,
    u.phone,
    u.language
FROM reminders r
JOIN users u ON r.user_id = u.id
WHERE r.scheduled_at <= NOW()
  AND (r.status = 'pending' OR r.status = 'snoozed');

-- RPC: Snooze Reminder
CREATE OR REPLACE FUNCTION snooze_reminder(p_reminder_id UUID, p_new_time TIMESTAMPTZ)
RETURNS VOID AS $$
BEGIN
    UPDATE reminders
    SET scheduled_at = p_new_time,
        status = 'snoozed',
        snooze_count = snooze_count + 1
    WHERE id = p_reminder_id;
END;
$$ LANGUAGE plpgsql;

-- RPC: Mark Reminder Sent
CREATE OR REPLACE FUNCTION mark_reminder_sent(p_reminder_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE reminders
    SET status = 'sent',
        updated_at = NOW()
    WHERE id = p_reminder_id;
END;
$$ LANGUAGE plpgsql;

-- =========================================
-- 4. TASKS & LISTS
-- =========================================
CREATE TABLE IF NOT EXISTS lists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, name)
);

CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    list_id UUID REFERENCES lists(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    completed BOOLEAN DEFAULT false,
    completed_at TIMESTAMPTZ,
    priority INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RPC: Get or Create List
CREATE OR REPLACE FUNCTION get_or_create_list(p_user_id UUID, p_name TEXT, p_workspace_id UUID DEFAULT NULL)
RETURNS UUID AS $$
DECLARE
    v_list_id UUID;
BEGIN
    SELECT id INTO v_list_id FROM lists WHERE user_id = p_user_id AND LOWER(name) = LOWER(p_name);
    IF v_list_id IS NULL THEN
        INSERT INTO lists (user_id, name) VALUES (p_user_id, p_name) RETURNING id INTO v_list_id;
    END IF;
    RETURN v_list_id;
END;
$$ LANGUAGE plpgsql;

-- =========================================
-- 5. DOCUMENT VAULT (WhatsApp se image/pdf save)
-- =========================================
CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    doc_type TEXT,       -- 'pdf' or 'image'
    mime_type TEXT,
    file_size INT,
    ocr_text TEXT,
    uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Search RPC
CREATE OR REPLACE FUNCTION search_documents(p_user_id UUID, p_query TEXT)
RETURNS TABLE (id UUID, label TEXT, storage_path TEXT, doc_type TEXT) AS $$
BEGIN
    RETURN QUERY
    SELECT d.id, d.label, d.storage_path, d.doc_type
    FROM documents d
    WHERE d.user_id = p_user_id
      AND (d.label ILIKE '%' || p_query || '%' OR d.ocr_text ILIKE '%' || p_query || '%')
    ORDER BY d.uploaded_at DESC;
END;
$$ LANGUAGE plpgsql;

-- =========================================
-- 6. BRIEFING LOGS
-- =========================================
CREATE TABLE IF NOT EXISTS briefing_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    date DATE DEFAULT CURRENT_DATE,
    sent_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, date)
);

-- View for briefing cron
CREATE OR REPLACE VIEW users_due_for_briefing AS
SELECT
    u.id as user_id,
    u.phone,
    u.name,
    u.language,
    (SELECT count(*) FROM tasks t WHERE t.user_id = u.id AND t.completed = false) as pending_tasks,
    (SELECT count(*) FROM reminders r WHERE r.user_id = u.id AND r.status = 'pending' AND r.scheduled_at::date = CURRENT_DATE) as todays_reminders
FROM users u
WHERE u.onboarded = true
  AND NOT EXISTS (
      SELECT 1 FROM briefing_logs bl
      WHERE bl.user_id = u.id
        AND bl.date = CURRENT_DATE
  );

-- =========================================
-- 7. WHATSAPP MESSAGES (webhook log)
-- =========================================
CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id BIGSERIAL PRIMARY KEY,
    message_id TEXT UNIQUE NOT NULL,
    channel TEXT NOT NULL,
    from_number TEXT NOT NULL,
    to_number TEXT NOT NULL,
    received_at TIMESTAMPTZ NOT NULL,
    content_type TEXT,
    content_text TEXT,
    sender_name TEXT,
    event_type TEXT,
    is_in_24_window BOOLEAN DEFAULT false,
    is_responded BOOLEAN DEFAULT false,
    auto_respond_sent BOOLEAN DEFAULT false,
    response_message_id TEXT,
    response_sent_at TIMESTAMPTZ,
    raw_payload JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_message_id ON whatsapp_messages(message_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_from_number ON whatsapp_messages(from_number);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_received_at ON whatsapp_messages(received_at DESC);

-- =========================================
-- 8. RAG FILES (dashboard-uploaded PDFs/Images)
-- =========================================
CREATE TABLE IF NOT EXISTS rag_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    file_type TEXT DEFAULT 'pdf' CHECK (file_type IN ('pdf', 'image')),
    chunk_count INT DEFAULT 0,
    source TEXT DEFAULT 'dashboard_upload',
    processing_mode TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================
-- 9. RAG CHUNKS (text chunks with embeddings)
-- =========================================
CREATE TABLE IF NOT EXISTS rag_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id UUID REFERENCES rag_files(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    index INT DEFAULT 0,
    embedding VECTOR(1024),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Vector similarity index
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'rag_chunks_embedding_ivfflat_idx'
  ) THEN
    CREATE INDEX rag_chunks_embedding_ivfflat_idx
      ON rag_chunks USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100);
  END IF;
END $$;

-- Vector search function
CREATE OR REPLACE FUNCTION match_documents (
  query_embedding VECTOR(1024),
  match_count INT DEFAULT 5,
  target_file UUID DEFAULT NULL
)
RETURNS TABLE (id UUID, chunk TEXT, similarity FLOAT)
LANGUAGE sql STABLE AS $$
  SELECT
    rag_chunks.id,
    rag_chunks.content AS chunk,
    1 - (rag_chunks.embedding <=> query_embedding) AS similarity
  FROM rag_chunks
  WHERE target_file IS NULL OR rag_chunks.file_id = target_file
  ORDER BY rag_chunks.embedding <-> query_embedding
  LIMIT match_count;
$$;

-- =========================================
-- 10. PHONE → DOCUMENT MAPPING (bot config per number)
-- =========================================
CREATE TABLE IF NOT EXISTS phone_document_mapping (
    id BIGSERIAL PRIMARY KEY,
    phone_number TEXT NOT NULL,
    file_id UUID REFERENCES rag_files(id) ON DELETE CASCADE,  -- nullable
    auth_token TEXT,       -- 11za API token for this number
    origin TEXT,           -- origin domain for this number
    intent TEXT,           -- chatbot purpose description
    system_prompt TEXT,    -- AI-generated system prompt
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_phone_file UNIQUE (phone_number, file_id)
);

CREATE INDEX IF NOT EXISTS idx_phone_document_mapping_phone ON phone_document_mapping(phone_number);

-- Partial unique index: only one config row per phone with NULL file_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_pdm_phone_only
ON phone_document_mapping(phone_number)
WHERE file_id IS NULL;

-- Updated view
DROP VIEW IF EXISTS phone_document_view;
CREATE VIEW phone_document_view AS
SELECT
    pdm.id,
    pdm.phone_number,
    pdm.file_id,
    rf.name AS file_name,
    rf.file_type,
    pdm.intent,
    pdm.system_prompt,
    pdm.created_at,
    pdm.updated_at
FROM phone_document_mapping pdm
LEFT JOIN rag_files rf ON pdm.file_id = rf.id
ORDER BY pdm.phone_number, pdm.created_at DESC;

-- =========================================
-- 11. MESSAGES (web chat history)
-- =========================================
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id TEXT NOT NULL,
    file_id UUID REFERENCES rag_files(id) ON DELETE SET NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS messages_session_id_idx ON messages (session_id, created_at);

-- =========================================
-- 12. TRIGGERS (auto-update timestamps)
-- =========================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_modtime BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_reminders_modtime BEFORE UPDATE ON reminders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_tasks_modtime BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trigger_update_whatsapp_messages_updated_at BEFORE UPDATE ON whatsapp_messages FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trigger_update_phone_document_mapping_updated_at BEFORE UPDATE ON phone_document_mapping FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================
-- 13. ROW LEVEL SECURITY (for Supabase)
-- Service Role key bypasses RLS automatically.
-- =========================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

-- =========================================
-- DONE! Tables created:
--   users, sessions, reminders, lists, tasks,
--   documents, briefing_logs, whatsapp_messages,
--   rag_files, rag_chunks, phone_document_mapping, messages
-- =========================================
