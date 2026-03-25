-- =========================================
-- ZARA Migration 008 — Fix All Critical Bugs
-- Supabase SQL Editor mein run karo
-- =========================================

-- FIX 1: sessions table missing
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    context JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

-- FIX 2: recurrence_time column missing in reminders
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS recurrence_time TEXT;

-- FIX 3: scheduled_at NOT NULL breaks recurring reminders (code passes null)
ALTER TABLE reminders ALTER COLUMN scheduled_at DROP NOT NULL;
ALTER TABLE reminders ALTER COLUMN scheduled_at SET DEFAULT NOW();

-- FIX 4: recurrence ENUM 'none' vs NULL - code uses null, standardize
UPDATE reminders SET recurrence = NULL WHERE recurrence::text = 'none';
ALTER TABLE reminders ALTER COLUMN recurrence DROP DEFAULT;

-- FIX 5: due_reminders_view update - add recurrence fields needed by cron
CREATE OR REPLACE VIEW due_reminders_view AS
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

-- FIX 6: briefing_logs - add unique index for phone settings upsert
CREATE UNIQUE INDEX IF NOT EXISTS idx_pdm_phone_only
ON phone_document_mapping(phone_number)
WHERE file_id IS NULL;

-- FIX 7: Mistral API key column in env (just a note - add in Vercel dashboard)
-- MISTRAL_API_KEY - Mistral OCR ke liye

-- =========================================
-- Verify karo:
-- SELECT * FROM sessions LIMIT 1;
-- SELECT column_name FROM information_schema.columns WHERE table_name='reminders' AND column_name='recurrence_time';
-- SELECT * FROM due_reminders_view LIMIT 1;
-- =========================================
