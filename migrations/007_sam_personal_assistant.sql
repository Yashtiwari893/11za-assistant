-- ========================================================
-- SAM Personal Assistant Integration
-- This migration adds tables for Reminders, Tasks, 
-- Document Vault, and Team Workspaces.
-- ========================================================

-- 1. USERS & WORKSPACES
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

CREATE TABLE IF NOT EXISTS workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workspace_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role TEXT DEFAULT 'member', 
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(workspace_id, user_id)
);

-- 2. REMINDERS
CREATE TYPE reminder_recurrence AS ENUM ('none', 'daily', 'weekly', 'monthly');
CREATE TYPE reminder_status AS ENUM ('pending', 'completed', 'snoozed', 'cancelled', 'sent');

CREATE TABLE IF NOT EXISTS reminders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    title TEXT NOT NULL, -- Renamed from content
    note TEXT,
    scheduled_at TIMESTAMPTZ NOT NULL,
    recurrence reminder_recurrence DEFAULT 'none',
    status reminder_status DEFAULT 'pending',
    snooze_count INT DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for due reminders
CREATE INDEX IF NOT EXISTS idx_reminders_due 
ON reminders (scheduled_at) 
WHERE status = 'pending' OR status = 'snoozed';

-- View for Cron
CREATE OR REPLACE VIEW due_reminders_view AS
SELECT r.id as reminder_id, r.title, r.note, r.scheduled_at, u.phone, u.language
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
    -- Handle recurrence logic here if needed
    UPDATE reminders 
    SET status = 'sent',
        updated_at = NOW()
    WHERE id = p_reminder_id;
END;
$$ LANGUAGE plpgsql;


-- 3. TASKS & LISTS
CREATE TABLE IF NOT EXISTS lists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, name)
);

CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    list_id UUID REFERENCES lists(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE, -- Useful for global queries
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
        INSERT INTO lists (user_id, name, workspace_id) VALUES (p_user_id, p_name, p_workspace_id) RETURNING id INTO v_list_id;
    END IF;
    RETURN v_list_id;
END;
$$ LANGUAGE plpgsql;


-- 4. DOCUMENT VAULT
CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    doc_type TEXT, -- pdf, image
    mime_type TEXT,
    file_size INT,
    ocr_text TEXT,
    uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Search RPC for documents
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


-- 5. BRIEFING LOGS & VIEWS
CREATE TABLE IF NOT EXISTS briefing_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    date DATE DEFAULT CURRENT_DATE,
    sent_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, date)
);

-- Helper View for Briefing Cron
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


-- 6. SECURITY & AUTOMATION
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

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
