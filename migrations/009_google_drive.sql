-- =========================================
-- Google Drive Integration Migration
-- Run in Supabase SQL Editor
-- =========================================

-- 1. Add Google OAuth token columns to users table
ALTER TABLE users
ADD COLUMN IF NOT EXISTS google_access_token TEXT,
ADD COLUMN IF NOT EXISTS google_refresh_token TEXT,
ADD COLUMN IF NOT EXISTS google_token_expiry TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS google_drive_folder_id TEXT;

-- 2. Add drive_file_id and storage_type to documents table
ALTER TABLE documents
ADD COLUMN IF NOT EXISTS drive_file_id TEXT,
ADD COLUMN IF NOT EXISTS storage_type TEXT DEFAULT 'supabase' CHECK (storage_type IN ('supabase', 'google_drive'));

-- 3. Make storage_path nullable (Drive users won't have it)
ALTER TABLE documents
ALTER COLUMN storage_path DROP NOT NULL;

-- =========================================
-- Verify:
-- SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name LIKE 'google%';
-- SELECT column_name FROM information_schema.columns WHERE table_name='documents' AND column_name IN ('drive_file_id','storage_type');
-- =========================================
