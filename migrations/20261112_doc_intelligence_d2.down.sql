-- Migration: Phase D2 Document Page-Reading Pipeline (DOWN)
-- File: migrations/20261112_doc_intelligence_d2.down.sql

BEGIN;

ALTER TABLE IF EXISTS ingestion_jobs
  DROP COLUMN IF EXISTS vision_output_tokens,
  DROP COLUMN IF EXISTS vision_input_tokens,
  DROP COLUMN IF EXISTS vision_calls;

DROP INDEX IF EXISTS idx_inj_file_id;
DROP INDEX IF EXISTS idx_inj_content_hash;
DROP INDEX IF EXISTS idx_inj_claim;
DROP INDEX IF EXISTS uq_inj_active_file;
DROP TABLE IF EXISTS ingestion_jobs;

DROP INDEX IF EXISTS idx_dp_tier_order;
DROP INDEX IF EXISTS idx_dp_needs_vision;
DROP INDEX IF EXISTS idx_dp_file_status;
DROP INDEX IF EXISTS uq_dp_file_page;
DROP TABLE IF EXISTS doc_pages;

COMMIT;

