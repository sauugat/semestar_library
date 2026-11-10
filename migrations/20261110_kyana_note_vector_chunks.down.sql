-- Migration: Roll back note vector metadata & scoping from knowledge_chunks (DOWN)
-- File: migrations/20261110_kyana_note_vector_chunks.down.sql

BEGIN;

DROP INDEX IF EXISTS idx_kc_content_hash;
DROP INDEX IF EXISTS idx_kc_file_version;
DROP INDEX IF EXISTS idx_kc_file_id;

ALTER TABLE knowledge_chunks
  DROP COLUMN IF EXISTS audience_scope,
  DROP COLUMN IF EXISTS semester_no,
  DROP COLUMN IF EXISTS cohort_id,
  DROP COLUMN IF EXISTS semester,
  DROP COLUMN IF EXISTS chapter,
  DROP COLUMN IF EXISTS subject,
  DROP COLUMN IF EXISTS file_version,
  DROP COLUMN IF EXISTS file_id,
  DROP COLUMN IF EXISTS content_hash,
  DROP COLUMN IF EXISTS section_heading,
  DROP COLUMN IF EXISTS end_page_number;

COMMIT;
