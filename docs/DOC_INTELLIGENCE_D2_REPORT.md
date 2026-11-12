# Document Intelligence — Phase D2 & D2-V Report

- **Branch:** `feature/doc-intelligence-d2` (branched from `feature/kyana-rag-v2` at `55ae3b5`) — `[VERIFIED]`
- **Base D2 Commit Verified:** `a3e7c85` — `[VERIFIED]`
- **Date:** 2026-11-12
- **Constraints honored:** Zero changes to chat code or Games Platform Worker; `.env` untouched and never loaded; no commands or migrations run against Neon/Supabase; no push, merge, or deploy (`VERIFIED`).

---

## 1. Phase D2-V Verification Checks (Checks 1–9)

### Check 1 — Commit & Working Tree Audit (`VERIFIED`)
- `git show --stat a3e7c85` showed only the 12 Phase D2 files (3,143 insertions, 38 deletions):
  - `.github/workflows/doc-ingestion-worker.yml`
  - `.github/workflows/knowledge-reconciliation.yml`
  - `docs/DOC_INTELLIGENCE_D2_REPORT.md`
  - `lib/doc-ingestion-worker.js`
  - `lib/doc-page-classifier.js`
  - `lib/doc-vision-ocr.js`
  - `lib/note-search.js`
  - `migrations/20261112_doc_intelligence_d2.down.sql`
  - `migrations/20261112_doc_intelligence_d2.up.sql`
  - `scripts/doc-ingestion-worker.js`
  - `server.js`
  - `tests/doc-intelligence-d2.test.js`
- `git status` after `a3e7c85` showed `docs/DOC_INTELLIGENCE_D1_AUDIT.md` untracked (retained uncommitted from D1's no-commit rule) plus a trailing newline change in `docs/DOC_INTELLIGENCE_D2_REPORT.md` before D2-V updates.

### Check 2 — D2 + Regression Re-Run on `a3e7c85` (`VERIFIED`)
- Re-running the 6-suite command on `a3e7c85` exited `0`: `tests 95, pass 95, fail 0, cancelled 0, skipped 0` (`duration_ms 55991.811167`).

### Check 3 — Base Commit `55ae3b5` Verification for `tests/upload-material-atomic.test.js` (`VERIFIED`)
- In a clean temporary detached worktree of `feature/kyana-rag-v2` (`55ae3b5`), running `NODE_ENV=test node --test tests/upload-material-atomic.test.js` failed with the **exact same 4 failures** (`tests 6, pass 2, fail 4`; subtests 2, 3, and 5 failed with HTTP `403` vs expected `200`/`207`) because the test inserts a `teacher` row without seeding `teacher_subjects`. Pre-existing on base branch `55ae3b5`.

### Check 4 — How PDF Pages Reach Gemini (`VERIFIED`)
- `lib/doc-vision-ocr.js` sends **no PNGs and no cropped single-page PDFs**. Instead, it sends the **source PDF** plus a prompt targeting `ONLY Page ${pageNo} of ${totalPages}`:
  - **≤ 4 MiB (`DEFAULT_INLINE_PDF_MAX_BYTES`)**: Base64 `inlineData` (`mimeType: 'application/pdf'`) in `POST .../v1beta/models/${model}:generateContent` (`lib/doc-vision-ocr.js` lines 182–214).
  - **> 4 MiB**: Uploaded once per job via `uploadPdfToGeminiFileApi` (`POST https://generativelanguage.googleapis.com/upload/v1beta/files`, lines 117–153), then referenced as `{ fileData: { mimeType: 'application/pdf', fileUri } }` (`lib/doc-ingestion-worker.js` lines 521–533).
- **Tools/libraries**: Node 22 built-in `fetch` + `Buffer` + `AbortSignal` (no external SDK or image-rendering binary). `pdfjs-dist@6.3.289` (in `package.json` `dependencies`) is installed via `npm ci --omit=dev` in [doc-ingestion-worker.yml](file:///Users/sauu_gat/.gemini/antigravity/worktrees/semester-library/tihar_lighting_engine_overhaul/.github/workflows/doc-ingestion-worker.yml) (lines 29–36) for local signal extraction (`extractPdfPageSignals`).

### Check 5 — Upload → Enqueue Failure & Transaction Behavior (`VERIFIED`)
- **Transaction scope**: `INSERT INTO files ...` commits first (`server.js` lines 3154–3158 and 3519–3523), then `enqueueUploadedNoteIngestion(...)` runs outside that transaction (`server.js` lines 3159–3166 and 3527–3534).
- **Missing `ingestion_jobs` table**: `enqueueDocumentIngestionJob` (`lib/doc-ingestion-worker.js` lines 77–81) catches `42P01` / missing relation and returns `{ status: 'queued_schema_pending' }` cleanly.
- **Insert/DB errors**: `enqueueUploadedNoteIngestion` (`server.js` lines 38–64) wraps metadata search seeding, `enqueueDocumentIngestionJob`, and cache invalidation in independent `try/catch` blocks so enqueue failure logs `[Note ingestion enqueue failed]` and returns `{ status: 'enqueue_failed' }` without rolling back the `files` row or failing the HTTP `200` upload response (**hardened in Fix A**).

### Check 6 — Existing / Unqueued Files Prior to Fix B (`VERIFIED`)
- On `a3e7c85`, nothing enqueued `ingestion_jobs` for pre-existing files or files whose enqueue had failed. **Resolved by Fix B** (`reconcileMissingIngestionJobs` + `--reconcile --limit --dry-run`).

### Check 7 — Worker File Storage Sources (`VERIFIED`)
- Via `readFileBytesWithBlobFallback` (`lib/doc-ingestion-worker.js` lines 383–406) → `noteSearch.readFileBytes` (`lib/note-search.js` lines 124–165), the worker reads all three locations in order:
  1. **Local disk** (`uploads/<storedName>` or `/tmp/uploads/<storedName>` on Vercel) — `lib/note-search.js` lines 141–154.
  2. **Postgres `file_blobs` table** (`db.getFileBlob` in `db.js` lines 1344–1357, or SQL fallback `SELECT mimeType, fileData FROM file_blobs WHERE filename = $1 LIMIT 1` in `lib/doc-ingestion-worker.js` lines 389–404).
  3. **Approved Supabase Storage URL** (`approvedStorageUrl(storedName)` → `downloadBuffer`) — `lib/note-search.js` lines 133–137 and 162–163.

### Check 8 — `/api/internal/knowledge/worker` Gating & Time Budget (`VERIFIED`)
- **Auth gate**: `requireCronSecret` (`routes/internal-knowledge.js` lines 12–26) requires `INTERNAL_CRON_SECRET` or `CRON_SECRET` (`503` if unconfigured, `403` on header mismatch).
- **Feature gate**: `handleWorker` (line 34) calls `isKnowledgeIndexingEnabled()` (`lib/knowledge-schema.js` lines 18–20), which requires **both** `KYANA_KNOWLEDGE_V3 === 'true'` **and** non-empty `KYANA_KNOWLEDGE_V3_USERS`.
- **Time budget vs Vercel limit**: `handleWorker` runs `processPendingJobs(db, { batchSize: 25 })` with no explicit internal wall-clock budget, while `vercel.json` / `api/index.js` configure no `maxDuration` (`ASSUMED` 10s default on Vercel Hobby, up to 60s with Fluid Compute). `knowledge-reconciliation.yml` also enforces `--max-time 30` on curl. Large batches of 25 embedding jobs could exceed 10s–30s (`VERIFIED` risk; stale locks recover after `5 minutes` per `lib/knowledge-worker.js` line 50).

### Check 9 — Behavior If Migration Has NOT Been Applied (`VERIFIED`)
- **Uploads**: Succeed (`files` and `file_blobs` rows are saved; `enqueueDocumentIngestionJob` returns `queued_schema_pending`). Before Fix C, `note_search_documents` received no row at all on upload.
- **Note Search**: Existing indexed notes keep working via `note_search_documents`. Newly uploaded notes would lack a `note_search_documents` row (so Postgres FTS `to_tsquery` content search and `readNoteFileContent` `extraction_status` would miss them until Fix C added `seedMetadataIndex`).
- **Kyana**: New uploads do not receive full extracted text in `note_search_documents` or `knowledge_chunks` until the migration is applied and the worker runs; metadata-level discovery stays alive via Fix C (`pending` placeholder in `note_search_documents`).
- **Worker CLI**: `scripts/doc-ingestion-worker.js` fails on `claimNextIngestionJob` with Postgres `42P01` until `migrations/20261112_doc_intelligence_d2.up.sql` is applied.

---

## 2. Phase D2-V Fixes Implemented (Fixes A, B, C)

- **Fix A — Upload Enqueue Fault Isolation** ([`server.js`](file:///Users/sauu_gat/.gemini/antigravity/worktrees/semester-library/tihar_lighting_engine_overhaul/server.js)):
  - Updated `enqueueUploadedNoteIngestion` to use `docWorker.enqueueDocumentIngestionJob` inside its own `try/catch` (logging failures without throwing) and isolated `ai-assistant.invalidateCache` and `noteSearch.seedMetadataIndex` into independent `try/catch` blocks so upload persistence never rolls back or fails.
  - Verified by **Test 12** in [`tests/doc-intelligence-d2.test.js`](file:///Users/sauu_gat/.gemini/antigravity/worktrees/semester-library/tihar_lighting_engine_overhaul/tests/doc-intelligence-d2.test.js) via live HTTP `POST /api/files/upload` with an injected enqueue exception (`HTTP 200`, error logged, `files` row preserved).
- **Fix B — Missing-Job Backfill / Reconciliation** ([`lib/doc-ingestion-worker.js`](file:///Users/sauu_gat/.gemini/antigravity/worktrees/semester-library/tihar_lighting_engine_overhaul/lib/doc-ingestion-worker.js), [`scripts/doc-ingestion-worker.js`](file:///Users/sauu_gat/.gemini/antigravity/worktrees/semester-library/tihar_lighting_engine_overhaul/scripts/doc-ingestion-worker.js)):
  - Added `reconcileMissingIngestionJobs(db, { limit = 500, dryRun = false, includePartial = false, includeFailedTerminal = false })` and CLI flags `--reconcile` (or `--backfill`), `--limit <N>`, `--dry-run`, `--include-partial` (**not executed against production**).
  - Verified by **Test 13** on PGlite (counts missing files under `dryRun`, enforces `limit`, skips `completed`/`dedup_reused`/`failed_terminal`, and verifies CLI flag parsing).
- **Fix C — Cheap Metadata Fallback Search Row on Upload** ([`lib/note-search.js`](file:///Users/sauu_gat/.gemini/antigravity/worktrees/semester-library/tihar_lighting_engine_overhaul/lib/note-search.js), [`server.js`](file:///Users/sauu_gat/.gemini/antigravity/worktrees/semester-library/tihar_lighting_engine_overhaul/server.js)):
  - Added `noteSearch.seedMetadataIndex(db, file)` which writes a lightweight `extraction_status = 'pending'` row into `note_search_documents` containing `title — cleanFilename — subject — chapter` with `ON CONFLICT (id) DO NOTHING`.
  - Verified by **Test 12** (immediately after upload and before any worker run, `searchNotes` finds the file by filename and by title, and `seedMetadataIndex` does not overwrite already-indexed rows).

---

## 3. Final Verification Output (`VERIFIED`)

Command executed after all D2-V edits:
```bash
NODE_ENV=test node --test --test-concurrency=1 \
  tests/doc-intelligence-d2.test.js \
  tests/note-search.test.js \
  tests/kyana-note-vector.test.js \
  tests/library-assignments-auth.test.js \
  tests/teacher-dashboard-materials.test.js \
  tests/backend-security-and-reliability.test.js
```
Result: **`tests 97, pass 97, fail 0, cancelled 0, skipped 0`** (`13/13` passing in [`tests/doc-intelligence-d2.test.js`](file:///Users/sauu_gat/.gemini/antigravity/worktrees/semester-library/tihar_lighting_engine_overhaul/tests/doc-intelligence-d2.test.js)).

---

## 4. Remaining Risks & Owner Manual Steps

- **Batch size on `/api/internal/knowledge/worker`**: Consider lowering `batchSize` below `25` or adding a wall-clock stop budget inside `/api/internal/knowledge/worker` for D3 if Vercel Hobby times out during heavy embedding runs (`ASSUMED` on Vercel Hobby).
- **Owner Manual Steps Before Live Use**:
  1. Apply [`migrations/20261112_doc_intelligence_d2.up.sql`](file:///Users/sauu_gat/.gemini/antigravity/worktrees/semester-library/tihar_lighting_engine_overhaul/migrations/20261112_doc_intelligence_d2.up.sql) to Neon Postgres.
  2. Set GitHub Actions secrets/variables (`DATABASE_URL`, `GEMINI_API_KEY`, `DOC_VISION_MODEL`, `INTERNAL_CRON_SECRET`, `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_URL`, optional `DOC_MAX_VISION_PAGES=60`) and Vercel `KYANA_KNOWLEDGE_V3=true` + `KYANA_KNOWLEDGE_V3_USERS`.
  3. Optionally preview and run backfill against existing notes:
     ```bash
     node scripts/doc-ingestion-worker.js --reconcile --dry-run --limit 500
     node scripts/doc-ingestion-worker.js --reconcile --limit 100
     ```
