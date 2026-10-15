-- Migration: KYANA AI 3.0 Unified Knowledge Index (UP)
-- File: migrations/20261014_kyana_v3_knowledge.up.sql
-- Requires: pgvector extension (PostgreSQL 16)
-- Target Model: gemini-embedding-001 (768 dimensions via MRL outputDimensionality)

BEGIN;

-- 1. Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Reuse the existing document extraction index; create it on fresh staging DBs.
CREATE TABLE IF NOT EXISTS note_search_documents (
  id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '', extraction_status TEXT NOT NULL,
  extraction_error TEXT, indexed_at TEXT NOT NULL, content_truncated INTEGER NOT NULL DEFAULT 0,
  search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
);
CREATE INDEX IF NOT EXISTS note_search_content_gin ON note_search_documents USING GIN(search_vector);

-- 2. Unified Knowledge Resources Registry
CREATE TABLE IF NOT EXISTS knowledge_resources (
  id TEXT PRIMARY KEY,
  resource_type TEXT NOT NULL CHECK (
    resource_type IN ('post', 'notice', 'assignment', 'note', 'routine', 'syllabus', 'gu_official')
  ),
  canonical_id INTEGER,
  canonical_code TEXT,
  title TEXT NOT NULL,
  source_authority_tier INTEGER NOT NULL CHECK (source_authority_tier BETWEEN 1 AND 5),

  -- Denormalized academic scoping & author fields
  author_id TEXT REFERENCES students(studentId) ON DELETE SET NULL,
  author_role TEXT NOT NULL DEFAULT 'student',
  cohort_id TEXT REFERENCES cohorts(id) ON DELETE CASCADE,
  semester_no INTEGER CHECK (semester_no BETWEEN 1 AND 8),
  audience_scope TEXT NOT NULL DEFAULT 'cohort' CHECK (audience_scope IN ('cohort', 'all_students')),
  target_all_semesters INTEGER NOT NULL DEFAULT 0,
  visibility TEXT NOT NULL DEFAULT 'everyone' CHECK (visibility IN ('everyone', 'students_only', 'teachers_only', 'cohort_only')),

  -- Pre-computed navigation metadata
  web_url TEXT NOT NULL,
  mobile_route TEXT NOT NULL,
  mobile_params JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Freshness, moderation & sync tracking
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ,
  hidden_at TIMESTAMPTZ,
  content_hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_kr_scope ON knowledge_resources (audience_scope, cohort_id, semester_no);
CREATE INDEX IF NOT EXISTS idx_kr_active ON knowledge_resources (resource_type, updated_at DESC) WHERE deleted_at IS NULL AND hidden_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_kr_canonical ON knowledge_resources (resource_type, canonical_id);

-- 3. Unified Knowledge Chunks (Vectors + Multi-lingual FTS)
CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES knowledge_resources(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL,
  page_number INTEGER,
  embedding_model TEXT NOT NULL DEFAULT 'gemini-embedding-001',
  embedding vector(768),
  tsv_content tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', content), 'A') || 
    setweight(to_tsvector('simple', content), 'B')
  ) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_kc_resource ON knowledge_chunks (resource_id);
CREATE INDEX IF NOT EXISTS idx_kc_tsv ON knowledge_chunks USING GIN (tsv_content);
CREATE INDEX IF NOT EXISTS idx_kc_vector ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);

-- 4. Knowledge Jobs for Asynchronous Retries & Serverless Safety
CREATE TABLE IF NOT EXISTS knowledge_jobs (
  id SERIAL PRIMARY KEY,
  resource_id TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('index', 'update', 'delete', 'sync')),
  revision INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  last_error TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE knowledge_jobs ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_kj_status ON knowledge_jobs (status, scheduled_at ASC);
CREATE INDEX IF NOT EXISTS idx_kj_resource ON knowledge_jobs (resource_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_kj_pending_resource_op ON knowledge_jobs (resource_id, operation) WHERE status IN ('pending', 'processing');

COMMIT;
