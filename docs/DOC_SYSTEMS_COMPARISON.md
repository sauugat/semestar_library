# COMPARATIVE ARCHITECTURE AUDIT: LINE A (`feat/kyana-scope-gate`) vs LINE B (`feature/doc-intelligence-d2`)
**Stage:** Phase D3-2 Read-Only Architecture Audit  
**Date:** 2026-11-13  
**Working Workspace:** `/Users/sauu_gat/.gemini/antigravity/worktrees/semester-library/tihar_lighting_engine_overhaul`  
**Audit Mode:** Strictly READ-ONLY (No commits, no merges, no pushes, no schema mutations, no live Gemini calls)

---

## EXECUTIVE SUMMARY & AUDIT CONTEXT

This document provides a code-level, read-only architectural comparison between two parallel branches in the Semester Library repository that independently implemented document intelligence and academic retrieval systems:

- **Line A (`feat/kyana-scope-gate`):**  
  Commit: `6cabe08eb37d562120260b530c84d13e095f3100` `[VERIFIED: git rev-parse feat/kyana-scope-gate]`  
  Commits ahead of merge base: **95 commits** `[VERIFIED: git rev-list --count]`  
  Focus: Comprehensive academic intelligence platform (KAIE — Kyana Academic Intelligence Engine), including Chapter Tutor split-screen engine, syllabus course maps, past exam question (PYQ) intelligence, parent-child semantic chunking, multi-modal extracted items, adaptive UI presentation, and student study partner sessions.
- **Line B (`feature/doc-intelligence-d2`):**  
  Commit: `7c02ccfbdeec643c77c56dd702a945b5c6d1f9af` `[VERIFIED: git rev-parse feature/doc-intelligence-d2]`  
  Commits ahead of merge base: **15 commits** `[VERIFIED: git rev-list --count]`  
  Focus: Robust, production-hardened document page-reading pipeline (Phase D2) featuring local PDF operator pre-classification, sub-document PDF slicing via `pdf-lib`, Gemini Vision OCR for scanned/math/figure pages, an asynchronous GitHub Actions background worker with DB lease locks and heartbeats, and a quota circuit breaker (`skipped_quota`).

### Common Ancestor & Merge Verification
- **Merge Base:** `347cefbe01764d2fa361a97617db6ca5dd14e282` `[VERIFIED: git merge-base feat/kyana-scope-gate feature/doc-intelligence-d2]`
- **Merge Tree Trial Result:**  
  Command: `git merge-tree --write-tree --name-only feature/doc-intelligence-d2 feat/kyana-scope-gate` `[VERIFIED]`  
  Exit Code: `1` (Merge Conflict)  
  Tree Hash: `265adea173b3ee386189c47246c1199969b21f84`  
  **Conflicting Files (Exactly 7):**
  1. `ai-assistant.js`
  2. `lib/chat-tools.js`
  3. `lib/knowledge-builder.js`
  4. `lib/knowledge-embeddings.js`
  5. `lib/knowledge-sync.js`
  6. `lib/note-search.js`
  7. `server.js`

---

## 1. LINE A DOCUMENT SYSTEM (END-TO-END)

Line A implemented a multi-stage academic intelligence system designed around the Gandaki University Bachelor of Information Technology (BIT) curriculum. It provides deep academic grounding across university syllabi, teacher lecture notes, and past examination papers.

### 1.1 Complete Database Table Inventory (18 Tables)
All 18 tables are registered in `lib/rag-schema.js` and created idempotently via `ensureRagSchema(db)`. In addition, core tables are defined in SQL migration files `migrations/20261110_kyana_rag_document_intelligence.sql` and `migrations/20261112_kyana_study_partner_and_pyq.sql` `[VERIFIED]`.

| # | Table Name | Columns & Types | Primary Key | Key Indexes & Constraints | Created By | Runtime Trigger |
|---|------------|-----------------|-------------|---------------------------|------------|-----------------|
| 1 | `document_extraction_jobs` | `id TEXT`, `file_id TEXT`, `status TEXT`, `stage TEXT`, `kaie_stage TEXT`, `file_checksum TEXT`, `doc_version INT`, `format TEXT`, `ocr_required INT`, `ocr_applied INT`, `pages_total INT`, `pages_extracted INT`, `chunks_total INT`, `embeddings_total INT`, `extraction_quality REAL`, `attempts INT`, `max_attempts INT`, `error_message TEXT`, `diagnostics_json TEXT`, `locked_at TEXT`, `started_at TEXT`, `completed_at TEXT`, `created_at TEXT`, `updated_at TEXT` | `id` | `idx_doc_extraction_jobs_file_id`, `idx_doc_extraction_jobs_status`, `idx_doc_extraction_jobs_checksum`, `idx_doc_jobs_kaie_stage` | `lib/rag-schema.js` + `migrations/20261110_*.sql` | `ensureRagSchema(db)` on startup & upload |
| 2 | `document_pages` | `id TEXT`, `file_id TEXT`, `doc_version INT`, `page_number INT`, `raw_text TEXT`, `cleaned_text TEXT`, `char_count INT`, `is_empty INT`, `is_scanned INT`, `ocr_applied INT`, `extraction_confidence REAL`, `headings_json TEXT`, `tables_json TEXT`, `sections_json TEXT`, `diagrams_json TEXT`, `equations_json TEXT`, `metadata_json TEXT`, `created_at TEXT` | `id` | `UNIQUE(file_id, doc_version, page_number)`, `idx_document_pages_file_id` | `lib/rag-schema.js` + `migrations/20261110_*.sql` | `ensureRagSchema(db)` |
| 3 | `document_chunks` | `id TEXT`, `file_id TEXT`, `doc_version INT`, `chunk_index INT`, `parent_chunk_id TEXT`, `chunk_level TEXT`, `page_start INT`, `page_end INT`, `chapter TEXT`, `unit TEXT`, `section_heading TEXT`, `heading_path TEXT`, `content TEXT`, `clean_content TEXT`, `token_count INT`, `content_hash TEXT`, `subject TEXT`, `subject_code TEXT`, `semester_no INT`, `cohort_id INT`, `audience_scope TEXT`, `visibility TEXT`, `uploaded_by TEXT`, `topics_json TEXT`, `terminology_json TEXT`, `has_table INT`, `has_definition INT`, `metadata_json TEXT`, `created_at TEXT` | `id` | `idx_document_chunks_file_id`, `idx_document_chunks_parent`, `idx_document_chunks_subject_sem`, `idx_document_chunks_level`, `idx_document_chunks_hash`, `idx_document_chunks_fts` (GIN on Postgres) | `lib/rag-schema.js` + `migrations/20261110_*.sql` | `ensureRagSchema(db)` |
| 4 | `document_embeddings` | `chunk_id TEXT`, `file_id TEXT`, `doc_version INT`, `model_name TEXT`, `model_version TEXT`, `dimensions INT`, `embedding_json TEXT`, `embedding_vector vector(768)` (Postgres), `content_hash TEXT`, `created_at TEXT` | `chunk_id` | `idx_document_embeddings_file_id`, `idx_document_embeddings_model`, `idx_document_embeddings_hash` | `lib/rag-schema.js` + `migrations/20261110_*.sql` | `ensureRagSchema(db)` |
| 5 | `syllabus_topic_embeddings` | `topic_id TEXT`, `subject TEXT`, `semester_no INT`, `unit_number INT`, `topic_title TEXT`, `model_name TEXT`, `dimensions INT`, `embedding_json TEXT`, `content_hash TEXT`, `updated_at TEXT` | `topic_id` | `idx_syllabus_embeddings_sub` | `lib/rag-schema.js` | `ensureRagSchema(db)` |
| 6 | `document_topic_metadata` | `file_id TEXT`, `doc_version INT`, `title TEXT`, `subject TEXT`, `subject_code TEXT`, `semester_no INT`, `chapter TEXT`, `unit TEXT`, `section_headings_json TEXT`, `main_topics_json TEXT`, `subtopics_json TEXT`, `terminology_json TEXT`, `related_concepts_json TEXT`, `summary TEXT`, `learning_objectives_json TEXT`, `confidence REAL`, `provenance TEXT`, `updated_at TEXT` | `file_id` | `idx_doc_topic_metadata_subject` | `lib/rag-schema.js` + `migrations/20261110_*.sql` | `ensureRagSchema(db)` |
| 7 | `academic_knowledge_graph` | `id TEXT`, `subject TEXT`, `subject_code TEXT`, `semester_no INT`, `unit TEXT`, `chapter TEXT`, `topic TEXT`, `normalized_topic TEXT`, `subtopic TEXT`, `section_heading TEXT`, `file_id TEXT`, `chunk_id TEXT`, `page_number INT`, `confidence REAL`, `provenance TEXT`, `relation_type TEXT`, `page_start INT`, `page_end INT`, `review_status TEXT`, `updated_at TEXT` | `id` | `idx_akg_normalized_topic`, `idx_akg_subject_sem`, `idx_akg_file_id` | `lib/rag-schema.js` + `migrations/20261110_*.sql` | `ensureRagSchema(db)` |
| 8 | `document_index_versions` | `id TEXT`, `file_id TEXT`, `doc_version INT`, `file_checksum TEXT`, `status TEXT`, `pages_count INT`, `chunks_count INT`, `embedding_model TEXT`, `indexed_at TEXT` | `id` | `UNIQUE(file_id, doc_version)`, `idx_doc_index_versions_file`, `idx_doc_index_versions_checksum` | `lib/rag-schema.js` + `migrations/20261110_*.sql` | `ensureRagSchema(db)` |
| 9 | `pyq_papers` | `id TEXT`, `file_id INT`, `subject TEXT`, `subject_code TEXT`, `semester_no INT`, `exam_year TEXT`, `exam_type TEXT`, `university TEXT`, `title TEXT`, `total_marks INT`, `pass_marks INT`, `questions_count INT`, `extraction_status TEXT`, `paper_fingerprint TEXT`, `uploaded_by TEXT`, `created_at TEXT`, `updated_at TEXT` | `id` | `idx_pyq_papers_sub_sem`, `idx_pyq_papers_code`, `idx_pyq_papers_fp` | `lib/rag-schema.js` + `migrations/20261112_*.sql` | `ensureRagSchema(db)` |
| 10 | `pyq_questions` | `id TEXT`, `paper_id TEXT`, `file_id INT`, `subject TEXT`, `subject_code TEXT`, `semester_no INT`, `exam_year TEXT`, `exam_type TEXT`, `section_label TEXT`, `question_number TEXT`, `question_text TEXT`, `clean_question_text TEXT`, `marks INT`, `unit_number INT`, `chapter_title TEXT`, `primary_topic TEXT`, `normalized_topic TEXT`, `difficulty TEXT`, `question_category TEXT`, `model_answer_hint TEXT`, `page_number INT`, `page_end INT`, `page_provenance_status TEXT`, `mapping_confidence TEXT`, `mapping_status TEXT`, `semantic_score REAL`, `lexical_score REAL`, `content_fingerprint TEXT`, `subparts_json TEXT`, `created_at TEXT` | `id` | `idx_pyq_questions_sub_unit`, `idx_pyq_questions_norm_topic`, `idx_pyq_questions_paper` | `lib/rag-schema.js` + `migrations/20261112_*.sql` | `ensureRagSchema(db)` |
| 11 | `pyq_topic_links` | `id TEXT`, `question_id TEXT`, `subject TEXT`, `subject_code TEXT`, `semester_no INT`, `unit_number INT`, `topic TEXT`, `normalized_topic TEXT`, `note_file_id TEXT`, `note_chunk_id TEXT`, `note_page_number INT`, `relevance_score REAL`, `mapping_confidence TEXT`, `mapping_status TEXT`, `semantic_score REAL`, `lexical_score REAL`, `created_at TEXT` | `id` | `idx_pyq_links_question`, `idx_pyq_links_topic` | `lib/rag-schema.js` + `migrations/20261112_*.sql` | `ensureRagSchema(db)` |
| 12 | `study_partner_sessions` | `id TEXT`, `student_id TEXT`, `conversation_id TEXT`, `subject TEXT`, `subject_code TEXT`, `semester_no INT`, `unit_number INT`, `chapter_title TEXT`, `status TEXT`, `pedagogical_stage TEXT`, `current_step_index INT`, `total_steps INT`, `mastered_steps INT`, `reconciled_plan_json TEXT`, `source_files_json TEXT`, `pyq_summary_json TEXT`, `last_interaction_at TEXT`, `created_at TEXT`, `updated_at TEXT` | `id` | `idx_study_sessions_student`, `idx_study_sessions_conv` | `lib/rag-schema.js` + `migrations/20261112_*.sql` | `ensureRagSchema(db)` |
| 13 | `study_partner_topic_progress` | `id TEXT`, `session_id TEXT`, `student_id TEXT`, `step_index INT`, `topic_title TEXT`, `normalized_topic TEXT`, `source_origin TEXT`, `syllabus_ref TEXT`, `note_citations_json TEXT`, `pyq_matches_json TEXT`, `status TEXT`, `checkpoint_question TEXT`, `student_last_answer TEXT`, `attempts_count INT`, `mastered_at TEXT`, `updated_at TEXT` | `id` | `UNIQUE(session_id, step_index)`, `idx_study_topic_progress_session`, `idx_study_topic_progress_student` | `lib/rag-schema.js` + `migrations/20261112_*.sql` | `ensureRagSchema(db)` |
| 14 | `course_syllabus_units` | `id TEXT`, `subject TEXT`, `subject_code TEXT`, `semester_no INT`, `unit_number INT`, `unit_title TEXT`, `hours INT`, `weight_percentage REAL`, `raw_text TEXT`, `curriculum_version INT`, `updated_at TEXT` | `id` | `idx_csu_sub_sem`, `idx_csu_unit` | `lib/rag-schema.js` | `ensureRagSchema(db)` |
| 15 | `course_syllabus_topics` | `id TEXT`, `unit_id TEXT`, `subject TEXT`, `subject_code TEXT`, `semester_no INT`, `unit_number INT`, `topic_title TEXT`, `normalized_topic TEXT`, `subtopics_json TEXT`, `learning_outcomes_json TEXT`, `estimated_hours REAL`, `importance_weight REAL`, `origin_type TEXT`, `prerequisite_topic_ids_json TEXT`, `curriculum_version INT`, `is_locked_by_teacher INT`, `updated_at TEXT` | `id` | `idx_cst_norm_topic`, `idx_cst_sub_unit` | `lib/rag-schema.js` | `ensureRagSchema(db)` |
| 16 | `topic_source_mappings` | `id TEXT`, `topic_id TEXT`, `file_id TEXT`, `chunk_id TEXT`, `page_number INT`, `relevance_score REAL`, `mapping_type TEXT`, `cohort_id TEXT`, `extracted_item_id TEXT`, `review_status TEXT`, `conflict_status TEXT`, `curriculum_version INT`, `updated_at TEXT` | `id` | `idx_tsm_topic`, `idx_tsm_file` | `lib/rag-schema.js` | `ensureRagSchema(db)` |
| 17 | `academic_extracted_items` | `id TEXT`, `file_id TEXT`, `doc_version INT`, `item_type TEXT`, `title TEXT`, `course_code TEXT`, `chapter TEXT`, `topic TEXT`, `normalized_topic TEXT`, `concept_key TEXT`, `content_text TEXT`, `page_start INT`, `page_end INT`, `confidence REAL`, `provenance TEXT`, `metadata_json TEXT`, `created_at TEXT`, `updated_at TEXT` | `id` | `idx_aei_file_type`, `idx_aei_concept` | `lib/rag-schema.js` | `ensureRagSchema(db)` |
| 18 | `kaie_teacher_review_queue` | `id TEXT`, `item_type TEXT`, `subject TEXT`, `course_code TEXT`, `unit_number INT`, `topic_title TEXT`, `extracted_concept TEXT`, `primary_file_id TEXT`, `secondary_file_id TEXT`, `conflict_reason TEXT`, `payload_json TEXT`, `status TEXT`, `created_at TEXT`, `updated_at TEXT` | `id` | `idx_ktrq_sub_status` | `lib/rag-schema.js` | `ensureRagSchema(db)` |

### 1.2 End-to-End Ingestion Flow
1. **Upload Trigger:**
   - In `server.js` (`/api/files/upload`, `/api/teacher/notes/upload`), upon file write, `dispatchKaieIngestionAsync(fileRecord)` is called `[VERIFIED: server.js:60]`.
   - `dispatchKaieIngestionAsync` enqueues a job into `document_extraction_jobs` via `enqueueDocumentIngestion()` (`lib/document-ingestion.js`).
   - It fires `processDocumentIngestionJobs(db, { limit: 3, fileId: fileRecord.id })` asynchronously wrapped in `@vercel/functions` `waitUntil()`.
   - **Flaw / Vulnerability:** The ingestion runs *inside* the Vercel serverless function container via `waitUntil()`. On Vercel free or Pro plans, background compute is strictly capped (10s to 60s execution timeout), risking ungraceful termination mid-extraction on large PDFs.
2. **Buffer Retrieval & Checksum Verification:**
   - `resolveDocumentBuffer()` loads the PDF bytes from filesystem `uploads/` or Supabase Storage bucket.
   - `computeFileChecksum(buffer)` computes an SHA-256 hash.
   - `document_index_versions` is queried. If an identical checksum has already been indexed, it idempotently short-circuits, updating metadata drift if necessary.
3. **Stage 1 — Multi-Page Document Extraction:**
   - Handled by `extractPdfDocument()` in `lib/document-ingestion.js`.
   - Uses PDF.js (`pdfjs-dist`) to extract text and reconstruct line/heading structures per page.
   - Computes page clean text length. If `cleanLen < 25`, it inspects PDF operator lists for image painting (`fnArray` checking OPS 82, 85, 86). If image ops are present, sets `is_scanned = 1` and `ocrRequired = true`.
4. **Stage 2 — OCR & Vision Processing (Formulas, Diagrams, Scanned Pages):**
   - If `ocrRequired = true` or `totalNativeChars < 40`, `kaieOcr.runBatchPdfOcrFallback()` / `callGeminiVision()` is invoked `[VERIFIED: lib/kaie-ocr.js:110]`.
   - The Gemini prompt requests JSON output:
     `{ text: "...", equations: [{ latex: "...", description: "..." }], diagrams: [{ title: "...", description: "...", labels: [...] }], confidence: 0.92 }`.
   - **Severe Architectural Flaw in Line A:** In `runBatchPdfOcrFallback()`, Line A passes `context.buffer` (the **entire, unsliced original PDF buffer**) in base64:
     `inlineData: { mimeType: 'application/pdf', data: buffer.toString('base64') }` `[VERIFIED: lib/kaie-ocr.js:127]`.
     If a student uploads a 10MB scanned lecture PDF, Line A encodes 13.3MB of base64 and repeatedly transmits it to Gemini for batches of 5 pages! This causes severe token waste, high latency, and risks HTTP 413 / payload timeouts.
5. **Stage 3 — Parent-Child Semantic Chunking:**
   - Handled by `buildSemanticChunks()` in `lib/semantic-chunker.js`.
   - Child chunks: ~650 characters (`DEFAULT_CHILD_CHUNK_CHARS = 650`), parent chunks: ~2000 characters.
   - Chunks preserve page numbers (`page_start`, `page_end`), headings (`section_heading`, `heading_path`), and syllabus topic taxonomy (`topics_json`, `terminology_json`).
6. **Stage 4 — Embeddings Generation:**
   - Handled by `persistChunksAndEmbeddings()` in `lib/semantic-chunker.js`.
   - By default uses `local_hash_v1` (256-dimensional deterministic hash embedding) requiring **0 API calls** and 0 cost.
   - If `ENABLE_LIVE_GEMINI_EMBEDDINGS=true` and `KYANA_EMBEDDING_PROVIDER='gemini'`, calls Gemini `text-embedding-004` (768-dimensional).
   - If running on PostgreSQL with `pgvector` enabled, stores vectors directly in `document_embeddings.embedding_vector`.
7. **Stage 5 — Academic Knowledge Graph & Extracted Items:**
   - Extracts structured academic artifacts (`worked_example`, `code_block`, `key_definition`, `formula_derivation`, `inline_question`) into `academic_extracted_items`.
   - Updates `academic_knowledge_graph` linking Subject → Unit → Chapter → Topic → Chunk.
8. **Stage 6 — PYQ Auto-Routing & Question Extraction:**
   - If the file is tagged as `model_questions` or past paper, `ingestPyqPaper()` (`lib/pyq-intelligence.js`) parses questions, marks, and exam years, inserting rows into `pyq_papers` and `pyq_questions`.
   - Computes semantic/lexical similarity between past questions and syllabus topics, populating `pyq_topic_links`.
9. **Stage 7 — Course Map Sync & Invalidation:**
   - `syncCourseMap()` in `lib/kaie-course-map.js` reconciles topic-to-file mappings and updates teacher review queues.
   - `invalidateAcademicCaches(db)` flushes memory caches.

---

## 2. SIDE-BY-SIDE FEATURE COMPARISON (LINE A vs LINE B)

| Feature / Dimension | Line A (`feat/kyana-scope-gate`) | Line B (`feature/doc-intelligence-d2`) | Stronger Line | Architectural Rationale & Evidence |
|:---|:---|:---|:---:|:---|
| **1. Page-by-page extraction** | Extracts pages via PDF.js into `document_pages` (`page_number`, `cleaned_text`, `raw_text`). | Extracts pages into `document_pages` (`page_no`, `text`, `raw_text`, `source`, `page_type`). | **Line B** | Line B tracks per-page status (`pending`, `completed`, `skipped_quota`), source (`text_layer` vs `vision`), and classification tier. Line A only tracks status at the job level. |
| **2. Scanned pages handling** | Detects scanned pages when text < 25 chars and image ops present. Sends whole unsliced PDF buffer to Gemini. | Local operator inspection (clean char count, image area, vector path density). Slices PDF into 1–3 page sub-documents via `pdf-lib`. | **Line B (Decisive)** | Line B extracts only target pages as isolated slices. Line A repeatedly transmits multi-megabyte whole PDF buffers in base64, risking payload overflows and massive token bills. |
| **3. Maths as LaTeX** | Requests `{ equations: [{ latex, description }] }` in Gemini prompt; stores in `equations_json` column. | Local pre-classifier checks baseline shifts; Gemini prompt enforces standard `$...$` and `$$...$$` with step-by-step preservation. | **Tie** | Line A extracts structured JSON arrays; Line B preserves inline/display LaTeX directly within clean flowable text. |
| **4. Tables handling** | Reconstructs column grids; stores in `tables_json` column. | Pre-classifier detects column grids; prompt enforces GitHub Flavored Markdown `\|...\|`. | **Tie** | Line A preserves structured table cells; Line B generates clean Markdown directly consumable by standard LLM contexts. |
| **5. Figures & diagrams** | Requests `{ diagrams: [{ title, description, labels }] }`; stores in `diagrams_json`. | Extracts `figure_description` and stores in dedicated `figure_description` column. | **Line A** | Line A extracts detailed diagram metadata including component labels and titles. |
| **6. Quota circuit breaker** | **None.** If Gemini returns 429, `callGeminiVision` returns `null` and marks extraction as unrecovered or failed. | **Full Production Breaker.** On 429 / `RESOURCE_EXHAUSTED`, marks page `skipped_quota`, pauses batch, applies jittered backoff, and sets `next_retry_at`. | **Line B (Decisive)** | Line B protects shared API quotas from exhaustion. Line A would crash or drop pages under heavy student traffic. |
| **7. Config-error stop** | Retries up to `max_attempts` regardless of error type. | Detects missing API keys, invalid credentials, or 401/403 and halts immediately with terminal failure state. | **Line B** | Prevents futile retry loops burning database connections on bad configuration. |
| **8. Timeouts handling** | Hard-coded `AbortController` timeout (25s) in `kaie-ocr.js`; serverless timeout risks on Vercel. | Dynamic timeout scaling based on slice page count and byte size; handles long Gemini responses gracefully. | **Line B** | Prevents zombie network hangs and adjusts dynamically to document complexity. |
| **9. Deduplication & versions** | Full SHA-256 checksum tracking in `document_index_versions`; detects exact duplicates and metadata drift. | Checksum deduplication in `ingestion_jobs` (`content_hash`, `dedup_reused`). | **Line A** | Line A has sophisticated version lineage (`doc_version`, `previousTopicMeta`, metadata drift reconciliation). |
| **10. Background worker** | Runs in-request on Vercel via `@vercel/functions` `waitUntil()`; subject to Vercel execution timeouts. | Dedicated asynchronous worker CLI (`scripts/doc-ingestion-worker.js`) + GitHub Actions cron (`doc-ingestion-worker.yml`) outside Vercel. | **Line B (Decisive)** | Line B guarantees reliable processing of 50+ page textbooks without dying to Vercel function timeouts. |
| **11. Cost tracking** | **None.** Does not track token consumption or API expenditure. | Tracks `vision_calls`, `vision_input_tokens`, and `vision_output_tokens` per job in `ingestion_jobs`. | **Line B** | Line B provides granular visibility into Gemini API spend. |
| **12. Automated test suite** | 70+ test suites covering end-to-end KAIE, Chapter Tutor, PYQ intelligence, syllabus maps, and security. | 3 dedicated test suites validating D2 worker leasing, classifier signals, and error states. | **Line A (Decisive)** | Line A provides comprehensive test coverage for university curriculum retrieval and academic grounding. |
| **13. Real-file evidence** | Evaluated on mock PDFs and synthesized fixtures in automated tests. | Empirically verified on real Gandaki University lecture slides and scanned exams in `docs/DOC_INTELLIGENCE_D2_REPORT.md`. | **Line B** | Line B documented empirical performance across real multi-page Nepali and English lecture files. |

**Verdict Summary:**
- **Line B is far superior in ingestion mechanics:** local page classification, sub-document slicing via `pdf-lib`, quota circuit breaking, out-of-process GitHub Actions worker, and token tracking.
- **Line A is far superior in academic domain retrieval:** syllabus knowledge graphs, parent-child chunking, Chapter Tutor split-screen engine, PYQ intelligence, and curriculum alignment.

---

## 3. DATABASE & MIGRATION COLLISIONS

### 3.1 The Severe `document_pages` Schema Collision
Both branches define a table named `document_pages`, but their column names, data types, constraints, and indexes are fundamentally incompatible `[VERIFIED]`.

```
Line A (`migrations/20261110_*.sql` & `lib/rag-schema.js`)          Line B (`migrations/20261112_doc_intelligence_d2.up.sql`)
-----------------------------------------------------------          ---------------------------------------------------------
id                     TEXT PRIMARY KEY                              id                 BIGSERIAL PRIMARY KEY
file_id                TEXT NOT NULL                                 file_id            INTEGER NOT NULL REFERENCES files(id)
doc_version            INTEGER NOT NULL DEFAULT 1                    [none]
page_number            INTEGER NOT NULL                              page_no            INTEGER NOT NULL CHECK (page_no >= 1)
raw_text               TEXT NOT NULL DEFAULT ''                      raw_text           TEXT NOT NULL DEFAULT ''
cleaned_text           TEXT NOT NULL DEFAULT ''                      text               TEXT NOT NULL DEFAULT ''
char_count             INTEGER NOT NULL DEFAULT 0                    char_count         INTEGER NOT NULL DEFAULT 0
is_empty               INTEGER NOT NULL DEFAULT 0                    [none]
is_scanned             INTEGER NOT NULL DEFAULT 0                    [none]
ocr_applied            INTEGER NOT NULL DEFAULT 0                    [none]
extraction_confidence  REAL NOT NULL DEFAULT 1.0                     ocr_confidence     REAL
[none]                                                               source             TEXT NOT NULL DEFAULT 'text_layer'
[none]                                                               status             TEXT NOT NULL DEFAULT 'pending'
[none]                                                               page_type          TEXT NOT NULL DEFAULT 'text'
[none]                                                               latex_present      BOOLEAN NOT NULL DEFAULT FALSE
[none]                                                               figure_description TEXT
[none]                                                               page_image_path    TEXT
[none]                                                               attempts           INTEGER NOT NULL DEFAULT 0
[none]                                                               error              TEXT
[none]                                                               parser_version     TEXT NOT NULL DEFAULT 'd2-v1'
[none]                                                               tier               SMALLINT NOT NULL DEFAULT 1
headings_json          TEXT DEFAULT '[]'                             [none]
tables_json            TEXT DEFAULT '[]'                             [none]
sections_json          TEXT DEFAULT '[]'                             [none]
diagrams_json          TEXT DEFAULT '[]'                             [none]
equations_json         TEXT DEFAULT '[]'                             [none]
metadata_json          TEXT DEFAULT '{}'                             [none]
created_at             TEXT NOT NULL                                 created_at         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
[none]                                                               updated_at         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
CONSTRAINT: UNIQUE(file_id, doc_version, page_number)               CONSTRAINT: UNIQUE(file_id, page_no)
```

### 3.2 Proof: Why D2's Migration Breaks on a Line A Database
If Line B's migration `migrations/20261112_doc_intelligence_d2.up.sql` is executed on a PostgreSQL database that already contains Line A's tables:

1. **Statement 1:** `CREATE TABLE IF NOT EXISTS document_pages (...)`
   - Because `document_pages` already exists, PostgreSQL's `IF NOT EXISTS` clause causes this statement to be a **no-op**. The table structure is not altered.
2. **Statement 2:** `CREATE UNIQUE INDEX IF NOT EXISTS uq_dp_file_page ON document_pages (file_id, page_no);`
   - **CRASH:** PostgreSQL aborts with:
     ```
     ERROR: column "page_no" does not exist
     LINE: CREATE UNIQUE INDEX ... ON document_pages (file_id, page_no);
     ```
   - In Line A, the column is named `page_number`, NOT `page_no`.
3. **Statement 3:** `CREATE INDEX IF NOT EXISTS idx_dp_file_status ON document_pages (file_id, status);`
   - **CRASH:** In Line A, `status` does not exist on `document_pages` (it exists on `document_extraction_jobs`). Fails with `ERROR: column "status" does not exist`.
4. **Statement 4:** `CREATE INDEX IF NOT EXISTS idx_dp_needs_vision ON document_pages (file_id) WHERE source = 'vision' OR latex_present = TRUE;`
   - **CRASH:** Fails with `ERROR: column "source" does not exist`.
5. **Statement 5:** `CREATE INDEX IF NOT EXISTS idx_dp_tier_order ON document_pages (file_id, tier, page_no);`
   - **CRASH:** Fails with `ERROR: column "tier" does not exist`.

**Conclusion:** The migration transaction aborts completely. D2 worker code (`lib/doc-ingestion-worker.js`) queries `page_no, text, status, source` and fails with Postgres error `42703 (undefined_column)`. Simultaneously, Line A's Chapter Tutor queries `page_number, cleaned_text, diagrams_json` and crashes on D2's schema.

### 3.3 Migration Numbering & Tracking Collision
- **Line A:**
  - `migrations/20261110_kyana_rag_document_intelligence.sql`
  - `migrations/20261112_kyana_study_partner_and_pyq.sql`
- **Line B:**
  - `migrations/20261110_kyana_note_vector_chunks.up.sql`
  - `migrations/20261112_doc_intelligence_d2.up.sql`

Both lines independently selected timestamps `20261110` and `20261112`. Any automated sequential migration runner sorting by timestamp will encounter conflicting migrations targeting the exact same sequence slot.

---

## 4. CONFLICT ANALYSIS: THE 7 CONFLICTING MERGE FILES

Running `git merge-tree --write-tree --name-only feature/doc-intelligence-d2 feat/kyana-scope-gate` identified exactly 7 conflicting files:

### 4.1 `ai-assistant.js`
- **Line A Changes:** +2,283 lines, -139 lines. Added `answerWithChapterContext()` split-screen interceptor, curriculum grounding, academic conflict detector, adaptive presentation formats, and study partner state management.
- **Line B Changes:** +23 lines, -17 lines. Refined note search handling and added a fallback to note metadata search when vector chunks return 0 passages.
- **Why They Conflict:** Both lines modified the core chat dispatch pipeline and the note retrieval hook.
- **Resolution Strategy:** Accept Line A's Chapter Tutor interceptor and presentation pipelines as the base, and port Line B's metadata-fallback logic into `ai-assistant.js`.
- **Effort Estimate:** **Medium to Large** (2–3 hours).

### 4.2 `lib/chat-tools.js`
- **Line A Changes:** +4,871 lines, -283 lines. Added academic tools: syllabus lookup, course map exploration, PYQ retrieval, topic extraction, and cohort permission filters.
- **Line B Changes:** +13 lines, -7 lines. Added parameter validation and sanitized search filters in the `searchNotes` tool.
- **Why They Conflict:** Both lines edited the arguments and execution block of the `searchNotes` tool.
- **Resolution Strategy:** Line A is an academic superset. Apply Line B's input parameter sanitization directly to Line A's `searchNotes` tool.
- **Effort Estimate:** **Small** (30 minutes).

### 4.3 `lib/knowledge-builder.js`
- **Line A Changes:** +96 lines, -17 lines. Added folder path normalization, structured assignment questions, and chapter/unit metadata tagging.
- **Line B Changes:** +210 lines, -13 lines. Implemented heading preservation, page number tracking, hash generation for note chunks, and metadata extraction for `knowledge_chunks`.
- **Why They Conflict:** Both modified `buildChunks` and `extractDocumentStructure` to attach page/chapter/semester metadata.
- **Resolution Strategy:** Merge chunking logic. Line B's clean heading and page tracking can be combined with Line A's chapter/unit taxonomy.
- **Effort Estimate:** **Medium** (1–2 hours).

### 4.4 `lib/knowledge-embeddings.js`
- **Line A Changes:** +123 lines, -8 lines. Added local feature hashing (256-d) fallback, configurable dimensions, and batching for KAIE syllabus embeddings.
- **Line B Changes:** +29 lines, -13 lines. Added Gemini embedding timeout handling, exponential retry backoff, and error categorization.
- **Why They Conflict:** Both modified `generateEmbedding()` and batch embedding retry logic.
- **Resolution Strategy:** Clean union: wrap Line A's embedding generation with Line B's timeout, backoff, and retry handling.
- **Effort Estimate:** **Small** (30 minutes).

### 4.5 `lib/knowledge-sync.js`
- **Line A Changes:** +186 lines, -19 lines. Added invalidation hooks for chapter tutor caches, syllabus course maps, and teacher review queues on note update/delete.
- **Line B Changes:** +118 lines, -30 lines. Implemented asynchronous event dispatch, file version increments, and debounced background worker sync.
- **Why They Conflict:** Both modified `onNoteSaved` and `onNoteDeleted` lifecycle handlers.
- **Resolution Strategy:** Call Line B's background job enqueueing AND Line A's course map / cache invalidation in sequence.
- **Effort Estimate:** **Small to Medium** (1 hour).

### 4.6 `lib/note-search.js`
- **Line A Changes:** +1,024 lines, -114 lines. Integrated `ensureRagSchema`, hybrid search across `document_chunks` and `files`, cross-semester access filtering, and academic topic scoring.
- **Line B Changes:** +509 lines, -69 lines. Implemented `seedMetadataIndex` (instant zero-cost searchable row on upload), metadata search fallback, and D2 ingestion status checks.
- **Why They Conflict:** Both lines substantially overhauled `indexNote()`, `searchNotes()`, and note querying.
- **Resolution Strategy:** Retain Line A's academic scoping and hybrid retrieval while incorporating Line B's `seedMetadataIndex` so notes are immediately searchable on upload before background OCR completes.
- **Effort Estimate:** **Large** (3–4 hours).

### 4.7 `server.js`
- **Line A Changes:** +1,479 lines, -748 lines. Registered KAIE API routes (Chapter Tutor, Study Partner, PYQ intelligence, teacher review queue, course maps) and added `dispatchKaieIngestionAsync()`.
- **Line B Changes:** +85 lines, -19 lines. Replaced fragile in-request indexing with `enqueueUploadedNoteIngestion` (Fix A) and added metadata search fallback (Fix C).
- **Why They Conflict:** Both modified upload endpoints (`/api/files/upload`, `/api/teacher/notes/upload`) and server initialization hooks.
- **Resolution Strategy:** Keep Line A's API route registrations, but replace Line A's in-request `waitUntil(processDocumentIngestionJobs)` with Line B's asynchronous background queue enqueueing.
- **Effort Estimate:** **Medium** (2 hours).

---

## 5. CHAPTER TUTOR EVIDENCE RETRIEVAL CONTRACT

The Chapter Tutor split-screen engine (`lib/chapter-tutor-engine.js`) is the central feature of Line A. Understanding its exact data contract is vital for choosing an integration strategy.

### 5.1 Tables & SQL Queries Executed
When a student opens "Ask Kyana" on a specific chapter:
1. **`getChapterReaderBundle(db, options)`** executes:
   ```sql
   -- 1. Fetch file rows
   SELECT * FROM files WHERE id IN (...)
   -- 2. Fetch pages for each file
   SELECT page_number, cleaned_text, raw_text, diagrams_json, equations_json, tables_json, metadata_json
   FROM document_pages
   WHERE CAST(file_id AS TEXT) = ?
   ORDER BY page_number ASC;
   -- 3. Fetch structured extracted items
   SELECT id, item_type, title, topic, concept_key, content_text, page_start, page_end
   FROM academic_extracted_items
   WHERE CAST(file_id AS TEXT) = ?
   ORDER BY page_start ASC, id ASC;
   -- 4. Fetch child semantic chunks
   SELECT id, chunk_index, page_start, page_end, section_heading, clean_content
   FROM document_chunks
   WHERE CAST(file_id AS TEXT) = ? AND COALESCE(chunk_level, 'child') = 'child'
   ORDER BY page_start ASC, chunk_index ASC;
   ```
2. **`retrieveChapterEvidence(db, bundle, reasoning, options)`** executes a 3-tier retrieval hierarchy:
   - **Level 1 (Active Chapter Notes):** Queries `document_chunks` joined with `files` filtered by `file_id IN (chapterFileIds)`. Computes token overlap, syllabus topic match, and vector similarity via `retrieveAcademicEvidence()`.
   - **Level 2 (Same-Subject Prerequisites):** If query concepts are not answered in the current chapter, queries `document_chunks` for preceding units in the same subject (e.g. Unit 1 prerequisites for Unit 4).
   - **Level 3 (PYQ Past Exam Intelligence):** Calls `getTopicPyqAnalytics()` and `searchPyqQuestions()`, querying `pyq_questions`, `pyq_papers`, and `pyq_topic_links` for historical exam questions matching the active chapter's topics.

### 5.2 Expected Text & Formatting Contract
The Chapter Tutor LLM prompt and frontend split-screen reader expect:
- **LaTeX Math:** Both inline (`$...$`) and display blocks (`$$...$$`). In `document_pages`, it checks `equations_json` or expects LaTeX within `cleaned_text`.
- **Markdown Tables:** GitHub Flavored Markdown table syntax (`| Header | ... |`). Checked in `tables_json` or within `cleaned_text`.
- **Figures & Diagrams:** Expects diagram titles and descriptions in `diagrams_json` or `figure_description`. The frontend renders figure preview badges linking directly to the slide/page.
- **Page Numbers:** **1-indexed integers** (`page_number`, `page_start`, `page_end`). Never 0-indexed. Used to generate clickable citation chips `[Page X]` that navigate the split-screen PDF viewer.

---

## 6. PRODUCTION STATE & OWNER VERIFICATION QUESTIONS

### 6.1 Flags & Environment Variables in Code
Inspection of Line A code reveals the following configuration controls:

| Environment Variable | Default Value | File & Purpose |
|:---|:---|:---|
| `GEMINI_API_KEY` / `GOOGLE_API_KEY` | None | API keys for Gemini Vision OCR and embeddings. |
| `KAIE_OCR_MODEL` | `gemini-2.5-flash` | `lib/kaie-ocr.js`: Target model for vision OCR. |
| `KYANA_RAG_CONCURRENCY` | `2` | `lib/document-ingestion.js`: Max concurrent ingestion jobs. |
| `KYANA_RAG_JOB_TIMEOUT_MS` | `180000` (3 min) | `lib/document-ingestion.js`: Stale lock timeout. |
| `KYANA_RAG_MIN_RELEVANCE` | `0.26` | `lib/hybrid-rag-engine.js`: Minimum vector cosine threshold. |
| `KYANA_EMBEDDING_PROVIDER` | `local_hash` | `lib/semantic-chunker.js`: `local_hash` (256-d MurmurHash) vs `gemini` (768-d). |
| `KYANA_EMBEDDING_DIMENSIONS` | `256` | `lib/semantic-chunker.js`: Vector dimension count. |
| `ENABLE_LIVE_GEMINI_EMBEDDINGS` | `false` | When false, forces fast local hashing even if API keys exist. |

> [!IMPORTANT]
> **No Master Feature Toggle:** In Line A, `ensureRagSchema(db)` runs **unconditionally on server startup** (`server.js:62`) and note search initialization. There is no `ENABLE_KAIE=false` flag to suppress table creation.

### 6.2 Critical Questions to Ask the Repository Owner
Before executing any merge or migration, the owner must answer:
1. **Neon Production Schema Status:** Have either `migrations/20261110_kyana_rag_document_intelligence.sql` or `migrations/20261112_kyana_study_partner_and_pyq.sql` been run manually or automatically against the production Neon PostgreSQL database?
2. **Table Existence in Neon:** Has `ensureRagSchema(db)` ever executed against production Neon (e.g. from an earlier preview deployment)? Are the 18 KAIE tables present in production?
3. **Existing Data:** If Line A tables exist in Neon, do they contain production data (e.g. parsed notes or PYQ questions)?
4. **Line B Status:** Has Line B's migration `20261112_doc_intelligence_d2.up.sql` been executed against Neon or staging?
5. **Target Architecture:** Do you prefer running document ingestion via GitHub Actions cron (Line B approach) or inside Vercel compute (Line A approach)?

---

## 7. ARCHITECTURAL RECOMMENDATIONS & TRADE-OFF OPTIONS

### 7.1 Option Comparison

```
Option A: Keep Line A Tables + Port Line B Ingestion Worker
┌─────────────────────────────────────────────────────────────┐
│ DB: Line A 18 Tables (document_pages with page_number)      │
│ Ingestion: Line B GitHub Actions Worker adapted for Line A  │
│ Retrieval: Line A Chapter Tutor, Study Partner, PYQs        │
└─────────────────────────────────────────────────────────────┘
  Effort: Medium (3-4 days) | Risk: Low-Medium | Data Impact: Low

Option B: Keep Line B document_pages + Adapt Line A Chapter Tutor
┌─────────────────────────────────────────────────────────────┐
│ DB: Line B 2 Tables (document_pages with page_no)           │
│ Ingestion: Line B Worker runs as-is                         │
│ Retrieval: Rewrite Chapter Tutor to query page_no / text    │
└─────────────────────────────────────────────────────────────┘
  Effort: High (5-7 days) | Risk: High | Data Impact: High (Strips KAIE features)

Option C: Unified Hybrid Bridge (RECOMMENDED)
┌─────────────────────────────────────────────────────────────┐
│ DB: Reconciled Schema (Superset columns + generated aliases) │
│ Ingestion: Line B Worker (Slices + Vision + Quota Breaker)  │
│ Post-Processing: Line A Semantic Chunker + PYQ Auto-Route   │
│ Retrieval: Line A Chapter Tutor + Line B Metadata Fallback  │
└─────────────────────────────────────────────────────────────┘
  Effort: Medium (3-5 days) | Risk: Low | Data Impact: Zero-loss
```

#### Detailed Evaluation of Options:

#### Option A: Keep Line A's Tables and Port Line B's Worker
- **How it works:** Retain Line A's 18 tables. Modify Line B's `doc-ingestion-worker.js` to insert into Line A's `document_pages` (`page_number`, `cleaned_text`, etc.) and `document_extraction_jobs`. Trigger Line A's chunker after worker finishes.
- **Effort:** Medium (~3–4 engineering days).
- **Risk:** Low to Medium. All existing Chapter Tutor and PYQ retrieval code continues working without code changes.
- **Data Migration Impact:** Low. Existing Line A schema remains the standard.

#### Option B: Keep Line B's Tables and Adapt Line A's Chapter Tutor
- **How it works:** Retain Line B's `document_pages` (`page_no`, `text`, etc.). Rewrite `lib/chapter-tutor-engine.js` and `lib/hybrid-rag-engine.js` to query `page_no` instead of `page_number`, and retrieve raw page text instead of `document_chunks`.
- **Effort:** High (~5–7 engineering days).
- **Risk:** High. Strips away parent-child semantic chunking, extracted academic items (`academic_extracted_items`), and structured PYQ question linking. Chapter Tutor responses would degrade to whole-page text dumps without granular chunk citations.
- **Data Migration Impact:** High. Requires dropping or abandoning 16 of Line A's academic tables.

#### Option C: Unified Hybrid Bridge (RECOMMENDED)
- **How it works:**
  1. **Reconciled `document_pages` Schema:** Create a non-breaking, superset table definition containing BOTH Line B's operational tracking (`status`, `source`, `page_type`, `latex_present`, `tier`) and Line A's rich structures (`diagrams_json`, `equations_json`, `tables_json`). Include generated column or dual-column support for `page_number` / `page_no` and `cleaned_text` / `text`.
  2. **Pipeline Division of Labor:**
     - **Phase 1 (Ingestion):** Line B's GitHub Actions worker handles downloading, local pre-classification (`doc-page-classifier.js`), PDF slicing via `pdf-lib`, Gemini Vision OCR with quota circuit breaking, and writes pages to `document_pages`.
     - **Phase 2 (Academic Indexing):** Upon completing a file, the worker invokes Line A's `buildSemanticChunks()` and `persistChunksAndEmbeddings()`, populating `document_chunks`, `academic_extracted_items`, and `pyq_questions`.
     - **Phase 3 (Retrieval):** Line A's Chapter Tutor split-screen engine answers student queries using the indexed chunks and pages, with Line B's metadata search providing instant fallback for freshly uploaded files.
- **Effort:** Medium (~3–5 engineering days).
- **Risk:** **Lowest.** Eliminates Vercel timeout crashes via Line B's out-of-process worker, prevents Gemini quota burn via circuit breaking, and retains 100% of Line A's rich academic features.
- **Data Migration Impact:** Clean forward migration using `ALTER TABLE ADD COLUMN IF NOT EXISTS`.

---

### 7.2 File-by-File Disposition of Line B Assets

| Line B File | Action | Disposition & Changes Needed |
|:---|:---:|:---|
| `lib/doc-page-classifier.js` | **KEEP AS-IS** | 100% reusable. Pure local PDF operator and character inspector. Zero DB dependencies. |
| `lib/doc-vision-ocr.js` | **KEEP AS-IS** | 100% reusable. Performs sub-document PDF slicing via `pdf-lib` and structured Gemini Vision extraction. |
| `.github/workflows/doc-ingestion-worker.yml` | **KEEP AS-IS** | 100% reusable. Clean CI/CD background runner for Neon PostgreSQL. |
| `scripts/doc-ingestion-worker.js` | **KEEP AS-IS** | 100% reusable. CLI entry point for batch processing. |
| `lib/doc-ingestion-worker.js` | **TOUCH / MODIFY** | Adapt to write reconciled `document_pages` columns (`page_number`, `diagrams_json`, `equations_json`). Add hook to call `buildSemanticChunks()` after all pages complete. |
| `migrations/20261112_doc_intelligence_d2.up.sql` | **TOUCH / MODIFY** | Rename timestamp to avoid collision with Line A's `20261112_kyana_study_partner_and_pyq.sql`. Use reconciled column definitions. |
| `server.js` | **TOUCH / MODIFY** | Retain Line B's `enqueueUploadedNoteIngestion` (Fix A) and metadata search fallback (Fix C), while keeping Line A's Chapter Tutor / PYQ routes. |

---

## 8. CONCLUSION & NEXT STEPS

This audit confirms that Line A and Line B are highly complementary rather than redundant:
- Line A built the **academic brain** (curriculum knowledge graph, Chapter Tutor, PYQ intelligence, parent-child chunking).
- Line B built the **hardened extraction engine** (PDF slicing, operator classification, quota circuit breaker, out-of-process GitHub Actions worker).

Attempting a direct git merge will result in severe schema breakage on `document_pages` and 7 file conflicts. Implementing **Option C (Unified Hybrid Bridge)** will deliver a production-grade, quota-safe, curriculum-grounded academic partner for Gandaki University students.

**Status:** Awaiting owner review and decision on Options A, B, and C.

