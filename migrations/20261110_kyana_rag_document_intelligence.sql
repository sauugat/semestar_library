-- Migration: Kyana Enterprise Academic Document Intelligence & Hybrid RAG Engine
-- Compatible with PostgreSQL (Neon / PGlite) and SQLite (@libsql/client via rag-schema.js)

-- 1. Document Extraction & Processing Lifecycle Jobs
-- State machine: UPLOADED -> QUEUED -> PROCESSING -> EXTRACTED -> CHUNKED -> EMBEDDED -> INDEXED
-- Additional states: PARTIAL, FAILED, RETRYING
CREATE TABLE IF NOT EXISTS document_extraction_jobs (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'UPLOADED',
  stage TEXT NOT NULL DEFAULT 'UPLOADED',
  file_checksum TEXT,
  doc_version INTEGER NOT NULL DEFAULT 1,
  format TEXT,
  ocr_required INTEGER NOT NULL DEFAULT 0,
  ocr_applied INTEGER NOT NULL DEFAULT 0,
  pages_total INTEGER NOT NULL DEFAULT 0,
  pages_extracted INTEGER NOT NULL DEFAULT 0,
  chunks_total INTEGER NOT NULL DEFAULT 0,
  embeddings_total INTEGER NOT NULL DEFAULT 0,
  extraction_quality REAL DEFAULT 1.0,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  error_message TEXT,
  diagnostics_json TEXT,
  locked_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_doc_extraction_jobs_file_id ON document_extraction_jobs(file_id);
CREATE INDEX IF NOT EXISTS idx_doc_extraction_jobs_status ON document_extraction_jobs(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_doc_extraction_jobs_checksum ON document_extraction_jobs(file_checksum);

-- 2. Page-Level Extracted Document Content
CREATE TABLE IF NOT EXISTS document_pages (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  doc_version INTEGER NOT NULL DEFAULT 1,
  page_number INTEGER NOT NULL,
  raw_text TEXT NOT NULL DEFAULT '',
  cleaned_text TEXT NOT NULL DEFAULT '',
  char_count INTEGER NOT NULL DEFAULT 0,
  is_empty INTEGER NOT NULL DEFAULT 0,
  is_scanned INTEGER NOT NULL DEFAULT 0,
  ocr_applied INTEGER NOT NULL DEFAULT 0,
  extraction_confidence REAL NOT NULL DEFAULT 1.0,
  headings_json TEXT DEFAULT '[]',
  tables_json TEXT DEFAULT '[]',
  sections_json TEXT DEFAULT '[]',
  metadata_json TEXT DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(file_id, doc_version, page_number)
);

CREATE INDEX IF NOT EXISTS idx_document_pages_file_id ON document_pages(file_id, doc_version, page_number);

-- 3. Structure-Aware Parent-Child Semantic Chunks
CREATE TABLE IF NOT EXISTS document_chunks (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  doc_version INTEGER NOT NULL DEFAULT 1,
  chunk_index INTEGER NOT NULL,
  parent_chunk_id TEXT,
  chunk_level TEXT NOT NULL DEFAULT 'child',
  page_start INTEGER,
  page_end INTEGER,
  chapter TEXT,
  unit TEXT,
  section_heading TEXT,
  heading_path TEXT,
  content TEXT NOT NULL,
  clean_content TEXT NOT NULL,
  token_count INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT NOT NULL,
  subject TEXT,
  subject_code TEXT,
  semester_no INTEGER,
  cohort_id INTEGER,
  audience_scope TEXT DEFAULT 'general',
  visibility TEXT DEFAULT 'students',
  uploaded_by TEXT,
  topics_json TEXT DEFAULT '[]',
  terminology_json TEXT DEFAULT '[]',
  has_table INTEGER NOT NULL DEFAULT 0,
  has_definition INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_document_chunks_file_id ON document_chunks(file_id, doc_version);
CREATE INDEX IF NOT EXISTS idx_document_chunks_parent ON document_chunks(parent_chunk_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_subject_sem ON document_chunks(subject, semester_no);
CREATE INDEX IF NOT EXISTS idx_document_chunks_level ON document_chunks(chunk_level, file_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_hash ON document_chunks(content_hash);

-- 4. Configurable Semantic Chunk Embeddings
CREATE TABLE IF NOT EXISTS document_embeddings (
  chunk_id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  doc_version INTEGER NOT NULL DEFAULT 1,
  model_name TEXT NOT NULL,
  model_version TEXT NOT NULL DEFAULT '1',
  dimensions INTEGER NOT NULL DEFAULT 256,
  embedding_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_document_embeddings_file_id ON document_embeddings(file_id, doc_version);
CREATE INDEX IF NOT EXISTS idx_document_embeddings_model ON document_embeddings(model_name, model_version);
CREATE INDEX IF NOT EXISTS idx_document_embeddings_hash ON document_embeddings(content_hash, model_name);

-- 5. Academic Document Understanding & Topic Metadata
CREATE TABLE IF NOT EXISTS document_topic_metadata (
  file_id TEXT PRIMARY KEY,
  doc_version INTEGER NOT NULL DEFAULT 1,
  title TEXT,
  subject TEXT,
  subject_code TEXT,
  semester_no INTEGER,
  chapter TEXT,
  unit TEXT,
  section_headings_json TEXT DEFAULT '[]',
  main_topics_json TEXT DEFAULT '[]',
  subtopics_json TEXT DEFAULT '[]',
  terminology_json TEXT DEFAULT '[]',
  related_concepts_json TEXT DEFAULT '[]',
  summary TEXT DEFAULT '',
  learning_objectives_json TEXT DEFAULT '[]',
  confidence REAL NOT NULL DEFAULT 0.8,
  provenance TEXT NOT NULL DEFAULT 'hybrid',
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_doc_topic_metadata_subject ON document_topic_metadata(subject, semester_no);

-- 6. Lightweight Academic Knowledge Graph
-- SUBJECT -> UNIT -> CHAPTER -> TOPIC -> SUBTOPIC -> DOCUMENT SECTION
CREATE TABLE IF NOT EXISTS academic_knowledge_graph (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  subject_code TEXT,
  semester_no INTEGER,
  unit TEXT,
  chapter TEXT,
  topic TEXT NOT NULL,
  normalized_topic TEXT NOT NULL,
  subtopic TEXT,
  section_heading TEXT,
  file_id TEXT,
  chunk_id TEXT,
  page_number INTEGER,
  confidence REAL NOT NULL DEFAULT 0.8,
  provenance TEXT NOT NULL DEFAULT 'syllabus_and_document',
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_akg_normalized_topic ON academic_knowledge_graph(normalized_topic);
CREATE INDEX IF NOT EXISTS idx_akg_subject_sem ON academic_knowledge_graph(subject, semester_no);
CREATE INDEX IF NOT EXISTS idx_akg_file_id ON academic_knowledge_graph(file_id);

-- 7. Document Index Versions & Checksum History
CREATE TABLE IF NOT EXISTS document_index_versions (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  doc_version INTEGER NOT NULL,
  file_checksum TEXT NOT NULL,
  status TEXT NOT NULL,
  pages_count INTEGER NOT NULL DEFAULT 0,
  chunks_count INTEGER NOT NULL DEFAULT 0,
  embedding_model TEXT,
  indexed_at TEXT NOT NULL,
  UNIQUE(file_id, doc_version)
);

CREATE INDEX IF NOT EXISTS idx_doc_index_versions_file ON document_index_versions(file_id, doc_version DESC);
CREATE INDEX IF NOT EXISTS idx_doc_index_versions_checksum ON document_index_versions(file_checksum);
