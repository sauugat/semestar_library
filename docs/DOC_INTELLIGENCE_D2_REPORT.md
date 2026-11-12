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

## 4. Phase D2-R Real-World Hardening (Fixes D–I) (`VERIFIED`)

- **Fix D — `pdf-lib` Page Slicing (`lib/doc-vision-ocr.js`, `lib/doc-ingestion-worker.js`, `package.json`)**:
  - Added `pdf-lib` to `dependencies`.
  - Removed whole-PDF File API upload (`getFileUriIfNeeded`). Instead, `buildPdfSlice(srcPdfDoc, oneBasedPageNos)` constructs a small PDF containing **only** the target page (default `DOC_VISION_BATCH_PAGES=1`) or up to `3` consecutive vision pages (`resolveVisionBatchPages` clamps `1..3`).
  - Each slice is sent inline base64 via `extractPageSliceWithVision`; Gemini File API upload now triggers **only** when a single slice itself exceeds `DOC_INLINE_PDF_MAX_BYTES` (`4 MiB`).
  - Batched slice responses are mapped back to physical `page_no` by exact slice array position (`VISION_BATCH_COUNT_MISMATCH` triggers retry if lengths differ).
  - Verified by **Test 14** (`PDFDocument.load` on decoded `inlineData.data` confirms 1-page default slices, consecutive `[2, 2]`/`[3, 1]` slices, and single-slice File API fallback).
- **Fix E — Text-Layer vs Vision Drift Check (`lib/doc-ingestion-worker.js`)**:
  - Added `applyDriftCheck(classification, visionResult)` for pages routed to `vision` that already had `>= 50` clean chars in their PDF text layer (excluding legacy Nepali mojibake pages).
  - When `layerWords.size >= 5` and token overlap with the Vision output is `< 20%`, lowers `ocr_confidence` (`<= 0.35`) and records `PAGE_DRIFT_SUSPECTED: overlap ...` in `document_pages.error`.
  - Verified by **Test 15**.
- **Fix F — Self-Contained Worker & In-Process `knowledge_jobs` Drain (`lib/doc-ingestion-worker.js`, `scripts/doc-ingestion-worker.js`, `.github/workflows/doc-ingestion-worker.yml`, `.github/workflows/knowledge-reconciliation.yml`)**:
  - After `runIngestionWorkerLoop`, `scripts/doc-ingestion-worker.js` calls `drainKnowledgeJobs(db, { budgetMs })` (`processPendingJobs` from `lib/knowledge-worker.js` directly against Postgres) bounded by `DOC_KNOWLEDGE_BUDGET_MS` (default `8 * 60 * 1000` = 8 minutes).
  - Removed the Vercel HTTP `/api/internal/knowledge/worker` curl step from `.github/workflows/knowledge-reconciliation.yml` (while leaving `routes/internal-knowledge.js` gating untouched).
  - Verified by **Test 16**.
- **Fix G — Token & Call Cost Tracking (`migrations/20261112_doc_intelligence_d2.up.sql`, `.down.sql`, `lib/doc-vision-ocr.js`, `lib/doc-ingestion-worker.js`)**:
  - Added `vision_calls`, `vision_input_tokens`, and `vision_output_tokens` (`INTEGER NOT NULL DEFAULT 0`) to `ingestion_jobs` (and explicit `DROP COLUMN IF EXISTS` in `.down.sql`).
  - `extractUsageMetadata` extracts `promptTokenCount` and `candidatesTokenCount` from Gemini `usageMetadata`, persisting cumulative totals across slice calls, transient retries, and checkpoint resumes.
  - Verified by **Test 17**.
- **Fix H — GitHub Actions Minutes Savings & Optional Immediate Dispatch (`lib/doc-ingestion-worker.js`, `scripts/doc-ingestion-worker.js`, `.github/workflows/doc-ingestion-worker.yml`, `server.js`)**:
  - Changed `.github/workflows/doc-ingestion-worker.yml` schedule from `*/15 * * * *` to hourly (`0 * * * *`), retaining `workflow_dispatch`.
  - Added `hasPendingWork(db)` early exit in `scripts/doc-ingestion-worker.js` (`executeWorkerRun` exits immediately with `mode: 'early_exit'` when neither `ingestion_jobs` nor `knowledge_jobs` has runnable work).
  - Added fire-and-forget `triggerDocIngestionWorkflowDispatch()` after persisted uploads in `server.js` (`/api/files/upload` and `/api/files/record-upload`) that sends `workflow_dispatch` **only** when `GITHUB_DISPATCH_TOKEN` and `GITHUB_DISPATCH_REPO`/`GITHUB_REPOSITORY` are set, with zero delay or failure impact when unset or failing.
  - Verified by **Test 18** (`GITHUB_DISPATCH_TOKEN` unset performs `0` `api.github.com` requests).
- **Fix I — Offline Local Real-File Harness (`scripts/doc-ingestion-local-test.js`, `.gitignore`)**:
  - Added `tmp/` to `.gitignore`.
  - Created `scripts/doc-ingestion-local-test.js`: refuses (`UNSAFE_ENV_SET`) if `DATABASE_URL`, `DIRECT_URL`, `POSTGRES_URL`, `PGHOST`, or any `SUPABASE_*` / `NEXT_PUBLIC_SUPABASE_*` env var is set; never loads `.env`; runs against in-memory PGlite; invokes real Gemini **only** when `GEMINI_API_KEY` and `DOC_VISION_MODEL` are passed in the shell (otherwise offline mock); writes `tmp/d2-local-out/<name>.md` and prints route/call/token/USD totals.
  - Verified offline safety and mock execution in **Test 19** (not executed against real API keys).

### Phase D2-R GitHub Environment Requirements & Missing-Flag Behavior (`VERIFIED`)

| Env Var / Secret | Required? | Effect When Missing |
| --- | --- | --- |
| `DATABASE_URL` (secret) | Yes | `.github/workflows/doc-ingestion-worker.yml` and `scripts/doc-ingestion-worker.js` exit `1` immediately. |
| `GEMINI_API_KEY` (secret) | Yes for Vision + embeddings | Vision OCR fails non-transiently with `VISION_API_KEY_MISSING` (pages route to `failed`); `embedText` throws `'Gemini embeddings are not configured'`, causing `knowledge-sync.js` to write keyword-only `embedding = NULL` chunks and re-enqueue `knowledge_jobs`. |
| `DOC_VISION_MODEL` (var/secret) | Yes for Vision OCR | `resolveVisionModel` throws non-transient `VISION_MODEL_UNCONFIGURED`; PDFs with only `text_layer` pages still complete without Vision. |
| `KYANA_KNOWLEDGE_V3` (var) & `KYANA_KNOWLEDGE_V3_USERS` (var) | Required for `knowledge_jobs` drain | Workflow defaults `KYANA_KNOWLEDGE_V3` to `'true'`, **but `isKnowledgeIndexingEnabled()` in `lib/knowledge-schema.js` requires BOTH `KYANA_KNOWLEDGE_V3 === 'true'` AND non-empty `KYANA_KNOWLEDGE_V3_USERS`**. If either is missing/empty, `drainKnowledgeJobs` skips draining with `{ skipped: true, reason: 'KYANA_KNOWLEDGE_V3 or KYANA_KNOWLEDGE_V3_USERS is not enabled' }` (ingestion jobs still complete cleanly). |
| `DOC_VISION_BATCH_PAGES` (var) | Optional (default `1`) | Defaults to `1` page/slice (clamped `1..3`). |
| `DOC_KNOWLEDGE_BUDGET_MS` (var) | Optional (default `480000`) | Defaults to 8 minutes (`480000` ms) wall-clock budget for in-process `knowledge_jobs` draining. |
| `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_URL` | Needed only for Supabase-stored blobs | Worker still reads local/Postgres `file_blobs`, but fails to download external Supabase Storage URLs if unconfigured. |
| `GITHUB_DISPATCH_TOKEN` + `GITHUB_DISPATCH_REPO` (Vercel app env, optional) | Optional | When unset on Vercel, uploads skip `workflow_dispatch` with 0 outbound calls and rely on the hourly cron or manual dispatch. |

### Phase D2-R Full Verification Output (`VERIFIED`)

```bash
NODE_ENV=test node --test --test-concurrency=1 \
  tests/doc-intelligence-d2.test.js \
  tests/note-search.test.js \
  tests/kyana-note-vector.test.js \
  tests/library-assignments-auth.test.js \
  tests/teacher-dashboard-materials.test.js \
  tests/backend-security-and-reliability.test.js
```
Result after final edit: **`tests 103, suites 0, pass 103, fail 0, cancelled 0, skipped 0, duration_ms 64756.262791`** (`19/19` passing in `tests/doc-intelligence-d2.test.js`).

---

## 5. Phase D2-S Hardening (`VERIFIED`)

- **Workflow Schedules & Monthly Run Estimates (`VERIFIED`):**
  - `.github/workflows/doc-ingestion-worker.yml`: `0 * * * *` (hourly at `:00` + `workflow_dispatch`) -> ~`720` scheduled runs/month (exits early when queue is empty).
  - `.github/workflows/knowledge-reconciliation.yml`: updated from `*/15 * * * *` (~`2,880`/month) to `30 * * * *` (hourly at `:30` + `workflow_dispatch`, staggered away from `:00`) -> ~`720` scheduled runs/month.
  - `.github/workflows/staging-cleanup-worker.yml`: `0 * * * *` (hourly at `:00` + `workflow_dispatch`) -> ~`720` scheduled runs/month.
  - `.github/workflows/push-outbox-worker.yml`: `*/5 * * * *` (every 5 minutes + `workflow_dispatch`) -> ~`8,640` scheduled runs/month.
- **PDF Slicing Robustness (`lib/doc-vision-ocr.js`, `lib/doc-ingestion-worker.js`) (`VERIFIED`):**
  - Source PDF is loaded **once per job** via `getSrcPdfDoc` -> `loadPdfForSlicing` and reused across every page slice.
  - `loadPdfForSlicing` / `buildPdfSlice` classify errors as terminal (`PASSWORD_PROTECTED`, `CORRUPT_FILE`, `PDF_SLICE_FAILED`, `transient: false`) with `0` Vision retry loops.
  - If a multi-page slice throws `PDF_SLICE_FAILED`, `processVisionSubBatch` splits the batch to single pages so one bad page fails in isolation (`partial_success`) without failing healthy neighbor pages.
  - **150-page benchmark (Test 21):** `totalElapsedMs=291.4 totalSlicingMs=73.5 earlyAvgMs=0.597 midAvgMs=0.485 lateAvgMs=0.424 peakRssMb=1897.8 peakHeapMb=153.3` — per-page slice time stays flat across all 150 pages.
- **Drift Check Calibration (`lib/doc-ingestion-worker.js`) (`VERIFIED`):**
  - Added `resolveDriftMinOverlap` reading `DOC_DRIFT_MIN_OVERLAP` (default `0.2`).
  - `extractComparisonWords` strips LaTeX `\commands`, numbers, and symbols so only alphabetic words (`[a-z\u0900-\u097f]{3,}`) are compared; `applyDriftCheck` skips pages with `< 8` alphabetic words or `broken_math_glyphs` / legacy Nepali mojibake (`Test 22`).
- **Local Harness Upgrades & Preflight (`scripts/doc-ingestion-local-test.js`, `scripts/doc-ingestion-preflight.js`) (`VERIFIED`):**
  - Accepts a single PDF or directory of PDFs, `--pages N` / `--pages A-B`, `--max-vision-pages N`, `--compare-text-layer` (side-by-side `raw_text_layer` vs `vision_or_final_text`), per-page `time_ms`, summary metrics table (`drift-flagged pages`, `failed pages`, `total time (ms)`), and optional `DOC_PRICE_INPUT_PER_M` / `DOC_PRICE_OUTPUT_PER_M` (prints `tokens only` without inventing prices when unset) (`Test 23`).
  - Added `scripts/doc-ingestion-preflight.js` inspecting `process.env` only (never loads `.env`, connects to DB, or hits network; never prints secret values) (`Test 24`).
- **Pre-existing Test Fix (`90ae637`) (`VERIFIED`):**
  - Fixed `tests/upload-material-atomic.test.js` in its own commit (`90ae637`) by seeding `teachers`, `subjects`, and `teacher_subjects` in test setup (`6/6` passing, zero production code changes).

---

## 6. Settings for GitHub and Vercel (`VERIFIED`)

| Variable | Where It Must Be Set | What Happens If Missing |
| --- | --- | --- |
| `DATABASE_URL` | GitHub Secrets & Vercel Env | Worker CLI and app DB fail immediately (`exit 1` in workflow/worker). |
| `DIRECT_URL` | GitHub Secrets (if migration/pooler split) | Direct Postgres connections fall back to `DATABASE_URL` if configured; otherwise fails if pooler rejects direct ops. |
| `GEMINI_API_KEY` | GitHub Secrets & Vercel Env | Vision OCR fails non-transiently (`VISION_API_KEY_MISSING`); `embedText` throws `'Gemini embeddings are not configured'`, writing keyword-only `embedding = NULL` chunks and re-enqueueing `knowledge_jobs`. |
| `DOC_VISION_MODEL` | GitHub Vars/Secrets | Vision pages fail non-transiently (`VISION_MODEL_UNCONFIGURED`); pure `text_layer` PDFs still complete. |
| `KYANA_KNOWLEDGE_V3` | GitHub Vars (`'true'`) & Vercel Env | When not `'true'`, `isKnowledgeIndexingEnabled()` returns `false` and `drainKnowledgeJobs` skips `knowledge_jobs` draining (`routes/internal-knowledge.js` returns skipped/disabled). |
| `KYANA_KNOWLEDGE_V3_USERS` | GitHub Vars (non-empty CSV/`*`) & Vercel Env | `isKnowledgeIndexingEnabled()` requires **both** `KYANA_KNOWLEDGE_V3 === 'true'` and non-empty `KYANA_KNOWLEDGE_V3_USERS`; if empty, `drainKnowledgeJobs` skips draining. |
| `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` | GitHub Secrets & Vercel Env | Worker still reads local disk & Postgres `file_blobs`, but fails to download files stored only in Supabase Storage URLs. |
| `INTERNAL_CRON_SECRET` | GitHub Secrets & Vercel Env | `/api/internal/knowledge/reconcile` (and other internal cron routes) reject/503 scheduled requests. |
| `GITHUB_DISPATCH_TOKEN` | Vercel Env (optional) | App skips immediate `workflow_dispatch` with `0` GitHub API calls; uploads succeed and wait for the hourly cron or manual dispatch. |
| `GITHUB_DISPATCH_REPO` | Vercel Env (optional if `GITHUB_REPOSITORY` set) | Immediate upload dispatch is skipped cleanly (`0` API calls) unless repo `owner/repo` is supplied. |
| `DOC_VISION_BATCH_PAGES` | GitHub Vars (optional, default `1`) | Defaults to `1` page per Vision slice (clamped `1..3`). |
| `DOC_DRIFT_MIN_OVERLAP` | GitHub Vars (optional, default `0.2`) | Defaults to `0.2` (`20%` minimum alphabetic word overlap for drift detection). |
| `DOC_MAX_VISION_PAGES` | GitHub Vars (optional, default `60`) | Defaults to `60` Vision pages per file (extra pages pause as `skipped_quota`, resumable). |
| `DOC_KNOWLEDGE_BUDGET_MS` | GitHub Vars (optional, default `480000`) | Defaults to `8` minutes wall-clock budget for in-process `knowledge_jobs` draining. |
| `DOC_PRICE_INPUT_PER_M` / `DOC_PRICE_OUTPUT_PER_M` | Local shell only (optional, local harness) | Local test harness prints token counts only (`tokens only`) and does not invent USD pricing. |

---

## 7. Owner's Manual Real-File Test Steps

Run these **without** `DATABASE_URL`, `PGHOST`, or `SUPABASE_*` set in your shell (and do not source `.env`):

1. **Check preflight status in a clean shell:**
   ```bash
   node scripts/doc-ingestion-preflight.js
   ```
2. **Test a small page window first using a real sample PDF (or folder of PDFs) and review side-by-side output:**
   ```bash
   GEMINI_API_KEY="your-key" DOC_VISION_MODEL="your-gemini-model" \
     node scripts/doc-ingestion-local-test.js /path/to/sample.pdf \
     --pages 1-5 --max-vision-pages 3 --compare-text-layer
   ```
   Optional cost calculation (supply your model's current pricing in USD per 1M tokens):
   ```bash
   DOC_PRICE_INPUT_PER_M=0.10 DOC_PRICE_OUTPUT_PER_M=0.40 \
   GEMINI_API_KEY="your-key" DOC_VISION_MODEL="your-gemini-model" \
     node scripts/doc-ingestion-local-test.js /path/to/sample-folder \
     --pages 1-10 --max-vision-pages 5 --compare-text-layer
   ```
3. **Inspect the generated Markdown report(s) under `tmp/d2-local-out/<name>.md`:**
   - Verify `source` (`text_layer` vs `vision` vs `skipped`), per-page `time_ms`, side-by-side `raw_text_layer` vs `vision_or_final_text`, LaTeX/Markdown table formatting, and `drift-flagged pages` / `failed pages` totals.

---

## 8. Deployment Order

1. **Apply the D2 migration to Neon Postgres (manually):**
   - Run `migrations/20261112_doc_intelligence_d2.up.sql` against target Postgres (creates `document_pages` and `ingestion_jobs` including `vision_calls`, `vision_input_tokens`, `vision_output_tokens`, plus indexes).
2. **Configure secrets & variables in GitHub Actions and Vercel** (per Section 6 above).
3. **Deploy application & merge workflow code:**
   - Deploy app (`server.js` + `lib/*`) and merge `.github/workflows/doc-ingestion-worker.yml` + `knowledge-reconciliation.yml` to `main`.
4. **Backfill dry-run (count only):**
   ```bash
   node scripts/doc-ingestion-worker.js --reconcile --dry-run --limit 500
   ```
5. **Backfill a small pilot batch (`--limit 3`):**
   ```bash
   node scripts/doc-ingestion-worker.js --reconcile --limit 3
   node scripts/doc-ingestion-worker.js --max-jobs 3
   ```
6. **Review pilot rows in Postgres:**
   - Inspect `ingestion_jobs` (`status`, `vision_calls`, `vision_input_tokens`, `vision_output_tokens`, `error`) and `document_pages` (`source`, `page_type`, `ocr_confidence`, `error` for any `PAGE_DRIFT_SUSPECTED` or `skipped_quota`).
7. **Scale up to larger batches:**
   ```bash
   node scripts/doc-ingestion-worker.js --reconcile --limit 50
   node scripts/doc-ingestion-worker.js --max-jobs 50
   ```

---

## 9. D2-T findings and D2-U fixes

Real-file testing (`D2-T`, in-memory PGlite only) surfaced four production hardening gaps that are fixed in `D2-U`:

### 9.1 D2-T Root Causes Observed
1. **Free-tier 429 (`RESOURCE_EXHAUSTED`, daily quota) caused ~150+ doomed retries and `failed_terminal`:** A daily request limit (`generativelanguage.googleapis.com/generate_content_free_tier_requests`, retry delay `> 20h`) was treated identically to a short transient error, retrying 3x per page and leaving 0-usable-page jobs as `failed_terminal`.
2. **Classifier over-routed clean typed pages to Vision:**
   - Lecture slides with a small header/footer logo image (`imageOps >= 1`, tiny area ratio) and rich text (`>= 150` chars) routed to `vision`.
   - Textbook TOC pages with rule lines (`vectorOps` ~21–28) and dense clean text (`507–3223` chars) routed to `vision` (`vectorOps >= 20`).
   - Blank-boilerplate separator pages (`"This page intentionally left blank."`) with template vector rules routed to `scanned` (`vision`).
   - Set-theory / discrete math pages with clean UTF-8 Unicode operators (`∈`, `∪`, `∩`, `⊆`, `∅`) routed to `vision` due to raw symbol count/density.
   - `pdfjs-dist` `content.styles` only exposed CSS `fontFamily` (`sans-serif`), hiding real PDF `/BaseFont` names on `page.commonObjs`.
3. **PUA bullets and broken UTF-8 Devanagari clusters:**
   - Wingdings/Symbol private-use bullets (`\uF040` in `U+F000..U+F0FF`) triggered `BROKEN_GLYPH_RE` and misclassified Nepali text pages as `math`.
   - Broken Devanagari UTF-8 extraction (split halant clusters like `व् यिस् था` / `अर् थ`, isolated matras, and misordered short-i `िंसवधान`) was not flagged for Vision repair.
4. **Harness visibility gap:** The local test harness (`scripts/doc-ingestion-local-test.js`) did not render `figure_description` in generated Markdown tables and lacked a `--classify-only` dry-run mode.

### 9.2 D2-U Fixes Implemented
1. **Quota circuit breaker (`lib/doc-vision-ocr.js`, `lib/doc-ingestion-worker.js`):**
   - `parseGemini429Details` + `parseDurationToMs` inspect 429 response bodies and `Retry-After` headers. Per-day `RESOURCE_EXHAUSTED` metrics or retry delays `> 60s` raise non-retryable `QUOTA_EXHAUSTED` carrying `retryAfterMs`; short per-minute 429s keep exponential backoff and honor `Retry-After`.
   - Worker run-level & job-level `quotaState` immediately halts remaining Vision calls across remaining pages and queued jobs in the run, marks uncompleted Vision pages `status = 'skipped_quota'` (`attempts = 0`, preserving fallback `raw_text`), continues local `text_layer` extraction and search/knowledge rollup, and saves the job as `status = 'failed_retryable'` with `next_retry_at` in the future (decrementing `attempts` so quota pauses never trip `failed_terminal` and cleanly resume skipped pages later).
   - Optional `DOC_VISION_DAILY_REQUEST_CAP` queries 24h `vision_calls` and trips the circuit breaker before exceeding the daily cap.
2. **Classifier calibration & Devanagari repair (`lib/doc-page-classifier.js`, `migrations/20261112_doc_intelligence_d2.up.sql`):**
   - Added env-configurable `resolveClassifierThresholds` (`DOC_CLASSIFIER_*`), `page.commonObjs` font enrichment, CTM image area ratio tracking (`maxImageAreaRatio`, `>= 15%` or `< 150` clean chars for image routing), raised vector thresholds (`60` sparse / `100` dense), blank-boilerplate stripping -> `skip`, clean Unicode math allowed on `text_layer` (routing only broken glyphs, math fonts with math notation, vertical shifts, or stacked fractions), line-start `U+F000..U+F0FF` bullet stripping before broken-glyph checks, and `detectDevanagariCorruption` routing broken Nepali clusters to `vision` with `page_type = 'nepali_repair'`.
3. **Local harness improvements (`scripts/doc-ingestion-local-test.js`):**
   - Added `--classify-only` (pure classification table + per-route totals, zero PGlite / Gemini calls) and included `[Figure: ...]` (`figure_description`) in generated Markdown output.

---

## 10. D2-V2 Real-File Classifier Check and Quota Resume Verification

### 10.1 Real-File Offline Classification (`~/doc-tests`, zero key, zero cost)

Command executed:
```bash
unset DATABASE_URL DIRECT_URL POSTGRES_URL PGHOST SUPABASE_URL GEMINI_API_KEY
node scripts/doc-ingestion-local-test.js ~/doc-tests --classify-only
```

#### Overall Classification Totals Across All 6 Files (877 Pages Total)
- `text_layer`: **160** pages (18.2%)
- `vision`: **708** pages (80.7%)
- `skip`: **9** pages (1.0%, all intentionally blank pages)

#### Per-File Route Breakdown & Vision Page Details

| File | Total Pages | `text_layer` | `vision` | `skip` | Vision Pages Detail (`page:page_type(reason)`) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **05. Inheritance, Package and Interface 1.0.pdf** | 41 | 23 | 18 | 0 | `1:figure(embedded_image)`, `8:figure(embedded_image)`, `9:table(table_layout)`, `11:figure(embedded_image)`, `12:figure(vector_diagram)`, `14:figure(vector_diagram)`, `15:figure(embedded_image)`, `16:figure(embedded_image)`, `17:figure(embedded_image)`, `18:figure(embedded_image)`, `19:figure(embedded_image)`, `25:table(table_layout)`, `28:figure(embedded_image)`, `29:table(table_layout)`, `36:table(table_layout)`, `39:figure(embedded_image)`, `40:figure(embedded_image)`, `41:figure(embedded_image)` |
| **Convergence of Infinite Series.pdf** | 10 | 2 | 8 | 0 | `2:math(math_font)`, `3:math(math_font)`, `4:math(math_font)`, `5:math(math_font)`, `6:math(math_font)`, `7:math(math_font)`, `8:math(math_font)`, `9:math(math_font)` (p1 title and p10 clean problems stay `text_layer`) |
| **Discrete Mathematics.pdf** | 773 | 135 | 629 | 9 | `math:math_font` (283), `math:vertical_math_shifts` (176), `table:table_layout` (120), `math:stacked_fractions` (44), `figure:vector_diagram` (4), `scanned:low_clean_chars` (2). All 9 intentionally-blank pages skipped cleanly. |
| **Electrical_circuits.pdf** | 23 | 0 | 23 | 0 | All 23 pages: `scanned(low_clean_chars)` (0 clean chars, 1 image XObject per page) |
| **M. Induction.pdf** | 7 | 0 | 7 | 0 | All 7 pages: `scanned(low_clean_chars)` (0 clean chars, embedded handwritten scanned slices) |
| **संविधान र शासन व्यवस्था - QUICK LOKSEWA** | 23 | 0 | 23 | 0 | All 23 pages: `nepali_repair(nepali_repair)` (pervasive broken Unicode cluster extraction detected on every page) |

---

### 10.2 Honest Analysis & Evaluation of Routing Decisions

1. **Typed Java Slides (`05. Inheritance...pdf`):**
   - **Result:** 23 pages `text_layer`, 18 pages `vision`.
   - **Why:** In D2-T, all 10 tested slides routed to vision due to a small top corner logo. In D2-U, 23/41 pages (56%) stay on `text_layer` directly! The 18 vision pages break down into:
     - 6 slides with actual large architecture/class hierarchy diagrams (image area `>= 15%`, e.g. p8, 11, 15, 16, 28, 39).
     - 4 sparse text slides (`< 150` clean chars) with graphics (p1 title slide, p17, 18, 19, 40, 41).
     - 4 slides classified as `table_layout` (p9, 25, 29, 36) due to vector lines / side-by-side code columns (e.g. p36 is a genuine 2-column table: "Similarities of interface with Class / Dissimilarities of Interface with Class").
     - 2 slides classified as `vector_diagram` (p12, 14) due to vector box outlines (`vectorOps = 122 >= 100`) around Java code listings.
2. **Discrete Mathematics (First 30 pages and sampled later pages):**
   - **Intentionally blank pages:** All 9 blank pages (`p3, 11, 13, 21, 755, 769`, etc.) routed to `skip` (`blank_page`) with 0 chars and 0 vision calls.
   - **Clean symbol pages on `text_layer`:** `p4, 10, 12, 14–20, 22, 37, 41, 44, 45, 650, 756` (135 pages total) stayed on `text_layer`! For example, p37 has 8 math symbols and p41 has 2,779 characters of logic exercises with clean Unicode symbols; neither was forced into vision.
   - **Math routing:** Formula pages with vertical superscripts/subscripts, fractions, or math fonts (`p23–30`, `p740–754`) routed to `vision` (`math`), preserving LaTeX formatting.
3. **Nepali Loksewa (`संविधान र शासन व्यवस्था`):**
   - **Classifier decision:** All 23 pages routed to `vision` as `nepali_repair`.
   - **Does the heuristic fire on pages with broken clusters?** Yes. Every single page in this PDF has pervasive Unicode cluster corruption (33 to 186 anomalies per page) caused by standard PDF.js text extraction splitting halants and misplacing matras.
   - **Sample raw text-layer lines from flagged page (Page 1):**
     ```text
     ४ । संविधान र शासन व् यिस् था (१० अङ्क)
     ४.१। कानूनको अर् थ ,  स्रोत र महत्त्व
     ४.२। नेपालको िंवैधासनक सवकािक्र म
     ```
     *(Notice: `व् यिस् था` has halant+space splitting 'व्यवस्था', `अर् थ` has halant+space splitting 'अर्थ', `िंवैधासनक` has short-i matra placed before the anusvara)*
   - **Sample raw text-layer lines from non-flagged healthy Nepali text (e.g. Test 5 / Test 27 / Test 28):**
     ```text
     नेपालको संविधान २०७२ को प्रस्तावना र नागरिकका मौलिक हकहरूको विस्तृत व्याख्या यहाँ प्रस्तुत गरिएको छ।
     प्रत्येक नागरिकलाई समानता र स्वतन्त्रताको हक हुने व्यवस्था संविधानले सुनिश्चित गरेको छ।
     लोकतान्त्रिक शासन प्रणाली र विधिको शासनलाई राज्यले अंगीकार गरेको छ।
     ```
     *(Zero anomalies detected; routed cleanly to `text_layer`)*
4. **Scans (`Electrical_circuits.pdf`, `M. Induction.pdf`):**
   - Both files routed 100% to `vision` as `scanned` (`low_clean_chars`), 0 clean chars on all pages, exactly as expected.

#### Pages Identified as Candidates for Tuning & Suggested Thresholds
1. **Java code listings with vector boxes (Java slides p9, 12, 14, 25, 29):**
   - *Reason:* Slides with syntax-highlighted code inside rectangular vector frames trigger `vectorOps >= 100` (`vector_diagram`) or line-number columns trigger `table_layout`.
   - *Suggested Threshold:* When `charCount >= 200` and `imageOps <= 1` with `maxImageAreaRatio < 0.05`, ignore rectangular border paths (`ops.constructPath` / `re S`) if code keywords (`class`, `void`, `public`, `import`, `{`, `}`) represent `> 5%` of tokens.
2. **Book frontmatter copyright & index pages (Discrete Mathematics p5, p757–768):**
   - *Reason:* Page 5 (copyright page, 3,223 chars) includes `CMSY9` font in publisher credits. Index pages (p757–768) are 3-column alphabetical term indexes which trigger `table_layout` or `stacked_fractions`.
   - *Suggested Threshold:* For dense pages (`charCount > 1000`), require `symbolCount >= 3` or `verticalMathShifts >= 2` before `math_font` alone routes to `vision`. For multi-column detection, ignore text columns where each entry matches `^[A-Za-z\s]+,\s*\d+(?:,\s*\d+)*$` (index pattern).

---

### 10.3 Quota Resume Verification (Test 30 Added)

A comprehensive multi-phase test (`Test 30`) was added to `tests/doc-intelligence-d2.test.js` validating the full end-to-end quota recovery cycle:
1. **Day 1 (Quota exhaustion):**
   - Page 1 succeeds with Gemini 200.
   - Page 2 returns daily-quota 429 (`RESOURCE_EXHAUSTED` with 20h retry delay).
   - Circuit breaker halts calls immediately: Page 3 is skipped without calling Gemini (2 total calls on Day 1).
   - `document_pages` records Page 1 as `completed`, Pages 2 and 3 as `skipped_quota` with raw fallback text preserved.
   - `note_search_documents` is seeded with Page 1 OCR text + Pages 2 & 3 raw fallback.
   - `knowledge_jobs` is drained on Day 1: chunks are created reflecting the initial state.
2. **Day 2 (Quota available again):**
   - Next retry timestamp is reached (`next_retry_at <= CURRENT_TIMESTAMP`).
   - Worker runs again: **ONLY skipped pages (Pages 2 and 3) call Gemini** (Page 1 is skipped with 0 calls).
   - Job completes with `status = 'completed'`.
   - `document_pages` has final vision text across all pages.
   - `note_search_documents.content` is rebuilt with final vision text (raw fallback removed).
   - In `lib/knowledge-builder.js`, `buildNoteKnowledge` includes `raw_content_hash: computeContentHash(rawContent)` in `resource.content_hash`, ensuring that any update from fallback to final text busts the resource hash.
   - `knowledge_jobs` is drained on Day 2: `knowledge_chunks` are completely rebuilt from the final vision text with zero duplicate chunks.
