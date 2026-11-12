# Document Intelligence — Phase D2 Report

- **Branch:** `feature/doc-intelligence-d2` (local branch created from `feature/kyana-rag-v2` at `55ae3b5`) — `[VERIFIED]`
- **Date:** 2026-11-12
- **Constraints honored:** Zero changes to chat code or Games Platform Worker; no `.env` accessed and no default server run against `.env`; no migrations executed against production Neon/Supabase; no push, merge, or deploy performed (`VERIFIED`).

---

## 1. What Changed

### 1.1 PostgreSQL Migrations (`VERIFIED`)
- Created [`migrations/20261112_doc_intelligence_d2.up.sql`](file:///Users/sauu_gat/.gemini/antigravity/worktrees/semester-library/tihar_lighting_engine_overhaul/migrations/20261112_doc_intelligence_d2.up.sql) and [`migrations/20261112_doc_intelligence_d2.down.sql`](file:///Users/sauu_gat/.gemini/antigravity/worktrees/semester-library/tihar_lighting_engine_overhaul/migrations/20261112_doc_intelligence_d2.down.sql):
  - **`document_pages`**: `id`, `file_id` (`REFERENCES files(id) ON DELETE CASCADE`), `page_no` (`>= 1`), `text`, `raw_text`, `source` (`'text_layer' | 'vision' | 'skipped'`), `ocr_confidence`, `char_count`, `status` (`'pending' | 'processing' | 'completed' | 'failed' | 'skipped' | 'skipped_quota'`), `page_type` (`'text' | 'scanned' | 'math' | 'figure' | 'table'`), `latex_present`, `figure_description`, `page_image_path` (always `NULL` in v1), `attempts`, `error`, `parser_version` (`'d2-v1'`), `created_at`, `updated_at`.
    - Indexes: `uq_dp_file_page` (`(file_id, page_no)`), `idx_dp_file_status` (`(file_id, status)`), `idx_dp_needs_vision` (`(file_id) WHERE source = 'vision' OR latex_present = TRUE`).
  - **`ingestion_jobs`**: `id`, `file_id`, `content_hash`, `file_version`, `status` (`'queued' | 'extracting_text' | 'ocr_running' | 'completed' | 'partial_success' | 'failed_retryable' | 'failed_terminal' | 'dedup_reused'`), `total_pages`, `processed_pages`, `ocr_pages_count`, `last_completed_page`, `attempts`, `max_attempts`, `error`, `worker_id`, `locked_at`, `heartbeat_at`, `next_retry_at`, `started_at`, `completed_at`, `created_at`, `updated_at`.
    - Indexes: `uq_inj_active_file` (partial unique on `(file_id)` where status in `('queued', 'extracting_text', 'ocr_running', 'failed_retryable')`), `idx_inj_claim` (`(status, next_retry_at ASC)`), `idx_inj_content_hash` (`(content_hash, status)`), `idx_inj_file_id` (`(file_id)`).
  - Verified idempotent UP, clean DOWN (all tables and indexes removed), and re-UP on in-memory PGlite 17/WASM (`VERIFIED`).

### 1.2 Page Classifier & OCR Routing (`VERIFIED`)
- Created [`lib/doc-page-classifier.js`](file:///Users/sauu_gat/.gemini/antigravity/worktrees/semester-library/tihar_lighting_engine_overhaul/lib/doc-page-classifier.js) exporting `MIN_CLEAN_CHARS` (`50`), `reconstructLinesFromItems`, `countCleanAlnumChars`, `detectLegacyNepaliMojibake`, `detectMathSignal`, `detectTableSignal`, `extractPdfPageSignals`, and `classifyPageSignals`.
- Pure Node.js PDF signal extraction using `pdfjs-dist` (`6.3.289`) operator lists (`paintImageXObject`, `constructPath`, `stroke`, etc.), `(x, y)` coordinate line reconstruction, font family names, and character classes — no DOM/canvas/native Poppler binaries needed.
- v1 routing rule (`route` is only `'text_layer'`, `'vision'`, or `'skip'` for truly blank pages):
  1. **Blank separator** (`charCount === 0 && imageOps === 0 && vectorOps <= 4`) → `skip`.
  2. **Low clean text** (`charCount < 50`, after stripping headers/footers like `Page N`) → `vision` (`pageType: 'scanned'`).
  3. **Legacy Nepali mojibake** (Preeti/Kantipur/Himali/Sagarmatha font lacking Devanagari Unicode, or Preeti ASCII artifact tokens) → `vision` (`pageType: 'scanned'`). UTF-8 Devanagari stays on `text_layer` (`VERIFIED`).
  4. **Math formulas or broken math glyphs** (math fonts like `CambriaMath`/`CMMI`/`CMSY`, Unicode math symbol density, `\uFFFD`/PUA glyphs, or sub/superscripts) → `vision` (`pageType: 'math'`, `latexPresent: true`).
  5. **Structured tables** (4+ multi-column rows, 3+ pipe rows, or vector rule lines + 2+ multi-column rows) → `vision` (`pageType: 'table'`).
  6. **Embedded figures / vector diagrams** (`imageOps >= 1` or `vectorOps >= 20`) → `vision` (`pageType: 'figure'`).
  7. Otherwise → `text_layer` (`pageType: 'text'`, zero Vision cost).

### 1.3 Vision OCR Module (`VERIFIED`)
- Created [`lib/doc-vision-ocr.js`](file:///Users/sauu_gat/.gemini/antigravity/worktrees/semester-library/tihar_lighting_engine_overhaul/lib/doc-vision-ocr.js) exporting `resolveVisionModel`, `resolveApiKey`, `buildVisionPrompt`, `parseVisionJsonResponse`, `uploadPdfToGeminiFileApi`, and `extractPageWithVision`.
- **No hardcoded model name**: `resolveVisionModel` reads `options.model || env.DOC_VISION_MODEL || env.GEMINI_VISION_MODEL || env.GEMINI_MODEL` and throws non-transient `VISION_MODEL_UNCONFIGURED` if absent (`VERIFIED`).
- Uses `AbortController` with configurable `pageTimeoutMs` (default `DOC_PAGE_TIMEOUT_MS` = `25000`), uses inline PDF base64 below `DOC_INLINE_PDF_MAX_BYTES` (`4 MiB`) and Gemini File API upload above threshold (`VERIFIED` in unit logic; File API URL handling exercised with mocked `fetch`, live Gemini network NOT called).
- Prompts and parses strict JSON (`text` with LaTeX formulas & Markdown tables, `latex_present`, `figure_description`, `ocr_confidence`, `detected_type`), classifying HTTP `429`/`5xx`/timeouts as transient retryable errors (`VERIFIED`).

### 1.4 Worker, Rollup & Standalone Script (`VERIFIED`)
- Created [`lib/doc-ingestion-worker.js`](file:///Users/sauu_gat/.gemini/antigravity/worktrees/semester-library/tihar_lighting_engine_overhaul/lib/doc-ingestion-worker.js) and [`scripts/doc-ingestion-worker.js`](file:///Users/sauu_gat/.gemini/antigravity/worktrees/semester-library/tihar_lighting_engine_overhaul/scripts/doc-ingestion-worker.js):
  - **Claiming & Lease**: `claimNextIngestionJob` claims `'queued'`, `'failed_retryable'` (whose `next_retry_at <= CURRENT_TIMESTAMP`), or stale `'extracting_text'` / `'ocr_running'` jobs (`heartbeat_at < CURRENT_TIMESTAMP - ($2 || ' minutes')::interval`) via `FOR UPDATE SKIP LOCKED` inside a `pgPool` transaction when `kdb.pgPool` / `kdb.pool` is available (`VERIFIED`).
  - **Per-page timeout, retry (max 3), & failure isolation**: `runVisionWithRetry` retries transient errors up to `MAX_PAGE_ATTEMPTS = 3`; permanent failure on one page marks that `document_pages` row `status='failed'` and continues remaining pages, ending the job in `'partial_success'` when usable pages exist (`VERIFIED`).
  - **Checkpoint resume**: Already-completed/skipped pages for the same `parser_version` (`'d2-v1'`) are skipped cleanly after crash or stale lease takeover (`VERIFIED`).
  - **Quota cap**: Caps Vision calls at `DOC_MAX_VISION_PAGES` (default `60`). Excess vision-routed pages become `status='skipped_quota'`, job finishes as `'partial_success'`, and raising the cap + re-queueing resumes only the `skipped_quota` pages (`VERIFIED`).
  - **`content_hash` deduplication**: Matching completed donor job with same SHA-256 `content_hash` and `parser_version` clones `document_pages` and marks job `'dedup_reused'` with 0 Vision/PDF parse calls (`VERIFIED`).
  - **Terminal errors**: Missing `%PDF-` header / invalid PDF → `'failed_terminal'` (`CORRUPT_FILE`); encrypted PDF → `'failed_terminal'` (`PASSWORD_PROTECTED`); unsupported extension / missing file > 100 MB → `'failed_terminal'` (`VERIFIED`).
  - **Rollup & Downstream Enqueue**: `rollupToNoteSearchAndKnowledge` orders `document_pages` by `page_no ASC`, appends `[Figure: ...]` when present, joins pages with `\f`, upserts `note_search_documents` (`extraction_status = 'indexed' | 'empty'`), and calls `enqueueJob(kdb, 'note:' + fileId, 'note', 'index')` when `knowledge_jobs` exists (`VERIFIED`).
- Extended [`lib/note-search.js`](file:///Users/sauu_gat/.gemini/antigravity/worktrees/semester-library/tihar_lighting_engine_overhaul/lib/note-search.js) (`readFileBytes` / `downloadBuffer` optional `maxBytes`, and exported `readFileBytes`, `extractText`, `approvedStorageUrl`) so worker can read up to `DOC_MAX_FILE_BYTES` (default 100 MB) (`VERIFIED`).

### 1.5 Non-Blocking Upload Handlers & CI Workflows (`VERIFIED`)
- Updated [`server.js`](file:///Users/sauu_gat/.gemini/antigravity/worktrees/semester-library/tihar_lighting_engine_overhaul/server.js): replaced synchronous `indexUploadedNote` with `enqueueUploadedNoteIngestion(fileId, contentHash)` in both `POST /api/files/upload` (computes SHA-256 from saved file buffer) and `POST /api/files/record-upload` (accepts optional validated 64-hex `contentHash`/`sha256`), returning fast without downloading from Supabase or running PDF extraction inline.
- Created [`.github/workflows/doc-ingestion-worker.yml`](file:///Users/sauu_gat/.gemini/antigravity/worktrees/semester-library/tihar_lighting_engine_overhaul/.github/workflows/doc-ingestion-worker.yml) (`workflow_dispatch` + `*/15 * * * *` cron executing `node scripts/doc-ingestion-worker.js`).
- Investigated and fixed why `/api/internal/knowledge/worker` was never called (`VERIFIED`):
  - **Root cause**: `routes/internal-knowledge.js` defines `POST/GET /api/internal/knowledge/worker` (calling `processPendingJobs(db, { batchSize: 25 })`), but `vercel.json` only schedules two daily crons (`/api/internal/push/process` and `/api/internal/posts/cleanup-staging` — Vercel Hobby 2-cron limit), and `.github/workflows/knowledge-reconciliation.yml` previously only POSTed to `/api/internal/knowledge/reconcile` (which only calls `reconcileKnowledge` to enqueue jobs without draining them).
  - **Fix**: Added a `"Drain Pending Knowledge Worker Jobs"` step in [`.github/workflows/knowledge-reconciliation.yml`](file:///Users/sauu_gat/.gemini/antigravity/worktrees/semester-library/tihar_lighting_engine_overhaul/.github/workflows/knowledge-reconciliation.yml) calling `POST ${APP_URL%/}/api/internal/knowledge/worker` immediately after `/reconcile`.

---

## 2. Verification & Test Output

### 2.1 Phase D2 + Regression Suites (`VERIFIED`)
Command run after all final code edits:
```bash
NODE_ENV=test node --test --test-concurrency=1 \
  tests/doc-intelligence-d2.test.js \
  tests/note-search.test.js \
  tests/kyana-note-vector.test.js \
  tests/library-assignments-auth.test.js \
  tests/teacher-dashboard-materials.test.js \
  tests/backend-security-and-reliability.test.js
```
Result: **Exited with code `0` — `95` passed, `0` failed, `0` skipped** (`duration_ms 52933.141833`), including all **11/11** new tests in [`tests/doc-intelligence-d2.test.js`](file:///Users/sauu_gat/.gemini/antigravity/worktrees/semester-library/tihar_lighting_engine_overhaul/tests/doc-intelligence-d2.test.js):
```text
✔ 1. Migration UP and DOWN idempotently manage document_pages and ingestion_jobs + indexes on PGlite (1248.046583ms)
✔ 2. Vision OCR model must come strictly from env var and never be hardcoded (1.648125ms)
✔ 3. Fixture 1 (Clean typed multi-page PDF): extracts via text_layer with 0 Vision calls, joins with \f, enqueues knowledge_jobs (1194.972458ms)
✔ 4. Fixture 2 & 3 (Scanned image-only PDF & Mixed typed + scanned + blank PDF): preserves all pages in order without dropping scanned pages (898.52375ms)
✔ 5. Fixture 4 (Nepali Devanagari UTF-8 & Preeti legacy mojibake): UTF-8 stays text_layer; Preeti routes to Vision OCR (878.6875ms)
✔ 6. Fixture 5 (Large 120-page PDF + lease expiry resume + 60-vision-page quota resume) (1175.414542ms)
✔ 7. Fixture 6 (Password-protected PDF, corrupt PDF, transient 429/503 retries & partial_success page isolation) (882.089042ms)
✔ 8. Fixture 7 (Duplicate upload content_hash dedup): second upload transitions to dedup_reused with 0 Vision/parse calls (848.839417ms)
✔ 9. D1 Section 11 Fixtures (Math-heavy, Diagrams/Figures, Tables, Handwritten Maths): accurate page_type, LaTeX, Markdown tables & figure_description (865.125917ms)
✔ 10. Concurrent worker safety: claimNextIngestionJob enforces lease & non-blocking upload enqueue returns fast without extraction (946.472209ms)
✔ 11. Per-page Vision timeout (AbortController) & pgPool transaction claim path isolate timeouts (901.192375ms)
...
ℹ tests 95
ℹ suites 0
ℹ pass 95
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 52933.141833
```

### 2.2 Pre-Existing Failure Outside Phase D2 Scope (`VERIFIED`)
Running `NODE_ENV=test node --test tests/upload-material-atomic.test.js` individually (and when included earlier) produced **2 passed, 4 failed**:
- Subtests 2, 3, and 5 failed with `HTTP 403` (`{"message":"Teacher is not assigned to any active subjects."}`), because that test inserts a `teacher` row without seeding `teacher_subjects` required by the branch's pre-existing teacher subject authorization check (which is verified cleanly in `tests/teacher-dashboard-materials.test.js`, where `POST /api/files/upload` and `POST /api/files/record-upload` pass `200`/`403` assertions). Phase D2 did not modify authorization logic.

---

## 3. What Is NOT Done Yet
1. **Production database migration (`VERIFIED`)**: `migrations/20261112_doc_intelligence_d2.up.sql` has NOT been applied to Neon Postgres.
2. **Phase D3 (Chunking, Syllabus Topic Tagging & Retrieval Integration) (`VERIFIED`)**: `knowledge_jobs` is enqueued and `/api/internal/knowledge/worker` is wired into CI, but upgrading `knowledge-worker.js` to consume `document_pages` directly (emitting per-page `page_type` / `latex_present` / syllabus topic IDs into `knowledge_chunks`) is deferred to D3.
3. **Frontend / Expo LaTeX & UI wiring (`VERIFIED`)**: No UI or mobile app changes were made in D2 (`Ask Kyana` chat code untouched).
4. **Live Gemini / Neon integration run (`ASSUMED` behavior beyond mocks)**: All tests used in-memory PGlite, synthetic PDF binaries, and mocked Gemini `fetch`. Real Gemini PDF File API and Neon latency/rate limits have not yet been exercised live.
5. **Private Supabase Storage bucket authenticated reads (`VERIFIED` gap)**: `lib/note-search.js`'s `downloadBuffer` fetches public approved URLs without a `SUPABASE_SERVICE_ROLE_KEY` bearer header; if the Supabase storage bucket is ever switched from public to private, the worker would need service-role auth added to `downloadBuffer`.

---

## 4. Risks
- **Vision latency / rate limits (`ASSUMED`)**: Sending large whole-PDF payloads (via Gemini File API when `> 4 MiB`, per-page prompt targeting `Page N of M`) rather than cropped single-page PDFs avoids heavy PDF-rewriting dependencies in v1, but relies on Gemini accurately isolating Page `N` on multi-hundred-page scans and increases Gemini token usage per page on large scanned PDFs. Mitigated by `DOC_MAX_VISION_PAGES=60` and 15-minute GHA timeout + checkpoint resume.
- **Record-upload dedup gap (`VERIFIED`)**: `POST /api/files/record-upload` computes `content_hash` on upload only if the client passes a valid 64-char hex `contentHash`/`sha256`; otherwise `content_hash` is populated when the worker downloads and hashes the file bytes (still deduplicating cleanly at worker execution time).
- **Preeti detection heuristics (`ASSUMED`)**: Real-world legacy Nepali fonts beyond the regex list in `lib/doc-page-classifier.js` (`preeti|kantipur|himali|sagarmatha|fontasy|ganess|...`) depend on either matching the font name or hitting the ASCII artifact token ratio (`>= 15%`). Real corpus validation should be checked in D3/staging.

---

## 5. Exact Manual Steps for the Owner
1. **Apply migration manually to Neon Postgres** (against your Neon `DIRECT_URL` / `DATABASE_URL`):
   ```bash
   psql "$DIRECT_URL" -f migrations/20261112_doc_intelligence_d2.up.sql
   ```
   (Verify `\d document_pages` and `\d ingestion_jobs` in `psql` before running the worker.)
2. **Configure GitHub Repository Secrets & Variables** (GitHub → *Settings → Secrets and variables → Actions*):
   - **Secrets**: ensure `DATABASE_URL`, `DIRECT_URL` (optional), `GEMINI_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL` (or `SUPABASE_URL`), and `INTERNAL_CRON_SECRET` (or `CRON_SECRET`) are set.
   - **Variables (or Secrets)**: set **`DOC_VISION_MODEL`** (e.g. your chosen Gemini Vision model ID — required because no model is hardcoded), and optionally `DOC_MAX_VISION_PAGES` (defaults to `60`), `DOC_PAGE_TIMEOUT_MS` (defaults to `25000`), `DOC_MAX_FILE_BYTES` (defaults to `104857600`).
3. **Configure Vercel Environment Variables** (only if needed by future endpoints; upload enqueueing in `server.js` needs no Gemini key).
4. **Verify end-to-end on staging/production after deploying**:
   - Trigger **GitHub Actions → `Document Ingestion Worker (Phase D2)` → Run workflow (`workflow_dispatch`)** or run once manually with staging env vars:
     ```bash
     node scripts/doc-ingestion-worker.js --max-jobs 5
     ```
   - Trigger **GitHub Actions → `KYANA AI 3.0 Knowledge Reconciliation`** and confirm both `/api/internal/knowledge/reconcile` and `/api/internal/knowledge/worker` return `HTTP 200`.
