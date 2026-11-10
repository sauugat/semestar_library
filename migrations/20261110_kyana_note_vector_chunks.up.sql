-- Migration: Extend knowledge_chunks with note vector metadata & scoping (UP)
-- File: migrations/20261110_kyana_note_vector_chunks.up.sql
-- Adds page-range, heading, content-hash, file reference and access-scoping columns to knowledge_chunks

BEGIN;

ALTER TABLE knowledge_chunks
  ADD COLUMN IF NOT EXISTS end_page_number INTEGER,
  ADD COLUMN IF NOT EXISTS section_heading TEXT,
  ADD COLUMN IF NOT EXISTS content_hash TEXT,
  ADD COLUMN IF NOT EXISTS file_id INTEGER,
  ADD COLUMN IF NOT EXISTS file_version INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS subject TEXT,
  ADD COLUMN IF NOT EXISTS chapter TEXT,
  ADD COLUMN IF NOT EXISTS semester TEXT,
  ADD COLUMN IF NOT EXISTS cohort_id TEXT,
  ADD COLUMN IF NOT EXISTS semester_no INTEGER,
  ADD COLUMN IF NOT EXISTS audience_scope TEXT DEFAULT 'cohort';

CREATE INDEX IF NOT EXISTS idx_kc_file_id ON knowledge_chunks (file_id);
CREATE INDEX IF NOT EXISTS idx_kc_file_version ON knowledge_chunks (file_id, file_version);
CREATE INDEX IF NOT EXISTS idx_kc_content_hash ON knowledge_chunks (content_hash);

COMMIT;
