-- Migration: Phase D6 Document Intelligence Pipeline Updates (DOWN)
-- File: migrations/20261114_doc_intelligence_d6.down.sql
-- Target DB: PostgreSQL 16 (Neon)

BEGIN;

-- Revert ingestion_jobs status check constraint to exclude 'skipped'
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
    'dedup_reused'
  )
);

COMMIT;
