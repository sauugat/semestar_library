-- Migration: Phase D6 Document Intelligence Pipeline Updates (UP)
-- File: migrations/20261114_doc_intelligence_d6.up.sql
-- Target DB: PostgreSQL 16 (Neon)

BEGIN;

-- 1. Ensure doc_pages columns exist (idempotent)
ALTER TABLE doc_pages ADD COLUMN IF NOT EXISTS tier SMALLINT NOT NULL DEFAULT 1;

-- 2. Ensure ingestion_jobs columns exist (idempotent)
ALTER TABLE ingestion_jobs ADD COLUMN IF NOT EXISTS vision_calls INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ingestion_jobs ADD COLUMN IF NOT EXISTS vision_input_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ingestion_jobs ADD COLUMN IF NOT EXISTS vision_output_tokens INTEGER NOT NULL DEFAULT 0;

-- 3. Update ingestion_jobs status check constraint to include 'skipped'
ALTER TABLE ingestion_jobs DROP CONSTRAINT IF EXISTS ingestion_jobs_status_check;

ALTER TABLE ingestion_jobs ADD CONSTRAINT ingestion_jobs_status_check CHECK (
  status IN (
    'queued',
    'extracting_text',
    'ocr_running',
    'completed',
    'partial_success',
    'failed_retryable',
    'failed_terminal',
    'dedup_reused',
    'skipped'
  )
);

COMMIT;
