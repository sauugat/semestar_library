-- Migration: Phase D2 Document Page-Reading Pipeline (UP)
-- File: migrations/20261112_doc_intelligence_d2.up.sql
-- Target DB: PostgreSQL 16 (Neon)
-- Creates: document_pages, ingestion_jobs

BEGIN;

-- 1. Per-page extracted content, classification & OCR tracking
CREATE TABLE IF NOT EXISTS document_pages (
  id BIGSERIAL PRIMARY KEY,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  page_no INTEGER NOT NULL CHECK (page_no >= 1),
  text TEXT NOT NULL DEFAULT '',
  raw_text TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'text_layer' CHECK (source IN ('text_layer', 'vision', 'skipped')),
  ocr_confidence REAL,
  char_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'skipped', 'skipped_quota')),
  page_type TEXT NOT NULL DEFAULT 'text' CHECK (page_type IN ('text', 'scanned', 'math', 'figure', 'table')),
  latex_present BOOLEAN NOT NULL DEFAULT FALSE,
  figure_description TEXT,
  page_image_path TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  parser_version TEXT NOT NULL DEFAULT 'd2-v1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_dp_file_page ON document_pages (file_id, page_no);
CREATE INDEX IF NOT EXISTS idx_dp_file_status ON document_pages (file_id, status);
CREATE INDEX IF NOT EXISTS idx_dp_needs_vision ON document_pages (file_id) WHERE source = 'vision' OR latex_present = TRUE;

-- 2. Asynchronous document ingestion jobs (state machine, lease, checkpoint & dedup)
CREATE TABLE IF NOT EXISTS ingestion_jobs (
  id BIGSERIAL PRIMARY KEY,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL DEFAULT '',
  file_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (
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
  ),
  total_pages INTEGER NOT NULL DEFAULT 0,
  processed_pages INTEGER NOT NULL DEFAULT 0,
  ocr_pages_count INTEGER NOT NULL DEFAULT 0,
  last_completed_page INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  error TEXT,
  worker_id TEXT,
  locked_at TIMESTAMPTZ,
  heartbeat_at TIMESTAMPTZ,
  next_retry_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_inj_active_file
  ON ingestion_jobs (file_id)
  WHERE status IN ('queued', 'extracting_text', 'ocr_running', 'failed_retryable');

CREATE INDEX IF NOT EXISTS idx_inj_claim ON ingestion_jobs (status, next_retry_at ASC);
CREATE INDEX IF NOT EXISTS idx_inj_content_hash ON ingestion_jobs (content_hash, status);
CREATE INDEX IF NOT EXISTS idx_inj_file_id ON ingestion_jobs (file_id);

COMMIT;

