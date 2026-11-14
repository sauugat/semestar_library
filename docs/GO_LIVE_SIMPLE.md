# Kyana Document Intelligence — Go-Live Guide (Simple & Safe)

This guide walks through deploying the Phase D2/D5 document reading pipeline to production on Gandaki University's Semester Library platform.

It is written in simple, step-by-step language so any student or contributor can follow it safely without breaking existing features.

---

## 1. What This System Does

When a student or teacher uploads a PDF notes file:
1. **Normal typed text pages** are read instantly without calling Gemini (costs \$0, preserves exact university notes).
2. **Scanned pages, mathematical derivations (LaTeX), markdown tables, and circuit diagrams/figures** are read using Gemini Vision.
3. Every page is saved into our isolated table `doc_pages` with its page number, source, page type, and LaTeX flags.
4. All pages are rolled up into `note_search_documents` separated by page breaks (`\f`), so the existing **Ask Kyana** and notes search can immediately find formulas, diagrams, and scanned text.
5. It works safely alongside any existing tables in Neon without touching student accounts, login sessions, or other branch data.

---

## 2. Step 1: Run the Database Migrations in Neon

Before running any background worker or deploying code, ensure the required tables and constraints exist in Neon PostgreSQL.

### Where to go:
1. Log in to your [Neon Console](https://console.neon.tech).
2. Select the `semester-library` project.
3. Open the **SQL Editor** tab from the left sidebar.

### Part A: Initial Schema (Already run in production)
If your Neon database has not yet run `migrations/20261112_doc_intelligence_d2.up.sql`, apply it first. (Production Neon already has this applied in its original `a856ae6` format).

### Part B: Phase D6 Updates Migration (`20261114_doc_intelligence_d6.up.sql`)
Copy and run the following idempotent migration statements in Neon SQL Editor:

```sql
BEGIN;

-- 1. Ensure doc_pages tier column exists (idempotent)
ALTER TABLE doc_pages ADD COLUMN IF NOT EXISTS tier SMALLINT NOT NULL DEFAULT 1;

-- 2. Ensure ingestion_jobs cost tracking columns exist (idempotent)
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
```

### What success looks like:
In the Neon SQL query results panel, you will see:
- `Query returned successfully in XX ms`
- The `ingestion_jobs_status_check` constraint now allows `'skipped'`.
- Columns `tier`, `vision_calls`, `vision_input_tokens`, and `vision_output_tokens` exist.

---

## 3. Step 2: Configure GitHub Repository Secrets & Variables

The background worker runs via GitHub Actions to process uploaded files without slowing down the website.

Go to: **GitHub Repo → Settings → Secrets and variables → Actions**

### Secrets (Repository secrets — click "New repository secret")
| Name | Description | Example / Note |
|---|---|---|
| `DATABASE_URL` | Neon pooled connection string | `postgres://user:pass@ep-xyz-pooler.region.neon.tech/neondb?sslmode=require` |
| `DIRECT_URL` | Neon direct connection string (optional fallback) | Same as DATABASE_URL but unpooled if configured |
| `GEMINI_API_KEY` | Google AI Studio Gemini API Key | Used only for scanned/math/figure pages |

### Variables (Repository variables — click "Variables" tab → "New repository variable")
| Name | Default Value | Purpose |
|---|---|---|
| `DOC_VISION_MODEL` | `gemini-2.5-flash` | Multimodal vision model (fast, accurate for formulas & diagrams) |
| `DOC_VISION_DAILY_REQUEST_CAP` | `100` | Safety limit to prevent quota overuse (worker halts cleanly when reached) |
| `DOC_READ_IMAGES` | `false` | Image OCR opt-in (disabled by default; when true, only processes images with a subject) |
| `DOC_MAX_VISION_PAGES` | `60` | Maximum vision pages processed per file before saving partial checkpoint |
| `DOC_PAGE_TIMEOUT_MS` | `25000` | Per-page timeout in milliseconds (25 seconds) |

---

## 4. Step 3: Open & Merge the Pull Request

1. Push your branch `feature/doc-intelligence-d2` to GitHub:
   ```bash
   git push origin feature/doc-intelligence-d2
   ```
2. Verify that the branch merges cleanly into `main`:
   ```bash
   git merge-base origin/main feature/doc-intelligence-d2
   # Merges cleanly with 0 conflicts
   ```
3. Open a Pull Request from `feature/doc-intelligence-d2` to `main` with title:
   `feat(doc-intelligence): Phase D2/D5 safe PDF reader with doc_pages table and GitHub Actions worker`
4. Confirm all CI checks pass.
5. Merge the Pull Request (Create a merge commit or squash and merge).

---

## 5. Step 4: Run the GitHub Actions Worker

Once the PR is merged, test the background ingestion pipeline on production files using the manual workflow dispatch.

### Workflow Inputs Available:
| Input | Type | Default | Purpose |
|---|---|---|---|
| `max_jobs` | string | `20` | Maximum ingestion jobs to process in this run |
| `max_vision_pages` | string | `60` | Maximum vision pages to OCR across all jobs in this run |
| `retry_failed` | boolean | `false` | When true, resets failed/partial jobs and pages to queued/pending for retry |
| `backfill_dry_run` | boolean | `false` | Dry-run backfill (count and print missing unindexed files without enqueuing) |
| `backfill_limit` | string | `0` | Number of unindexed files to backfill/enqueue (0 = do not backfill) |

### Step 4A: Dry-Run Reconcile (Check what files are unindexed)
1. Go to **Actions** tab on GitHub.
2. Select **Document Ingestion Worker (Phase D2)** from the left workflow list.
3. Click **Run workflow** dropdown on the right:
   - `max_jobs`: `20`
   - `max_vision_pages`: `60`
   - `retry_failed`: `false`
   - `backfill_dry_run`: check the checkbox (set to `true`)
   - `backfill_limit`: `0`
4. Click **Run workflow**.
5. Inspect the logs: it will scan the `files` table and print how many existing files have never been indexed, **without queuing anything**.

### Step 4B: Small Pilot Run (5 files)
1. In the **Run workflow** dropdown:
   - `max_jobs`: `5`
   - `max_vision_pages`: `60`
   - `retry_failed`: `false`
   - `backfill_dry_run`: uncheck (set to `false`)
   - `backfill_limit`: `5`
2. Click **Run workflow**.
3. It will enqueue the first 5 missing files and process their pages in two passes:
   - **Pass 1**: Rapid text-layer extraction for all 5 files + immediate `note_search_documents` rollup (all 5 files become searchable immediately).
   - **Pass 2**: Vision OCR for any scanned, math, or table pages in priority order.
4. Check the workflow logs: see pages extracted via `text_layer` (zero tokens) or `vision` (for math/scanned), and verify completion.

### Step 4C: Full Hourly Operation & Long Runs
- The hourly cron (`0 * * * *`) automatically picks up any newly uploaded files.
- The default worker budget is **45 minutes** (`DOC_RUN_BUDGET_MS=2700000`) with a **50-minute** workflow timeout. The worker keeps processing until the queue is completely drained or time expires.
- If you have more historical files to process, run the workflow with `backfill_limit: 20` or `50` as needed until all files are ingested.

---

## 6. Step 5: Verification SQL Queries

Run these queries in the Neon SQL Editor to verify the pipeline health:

### 1. Check Ingestion Job Statuses
```sql
SELECT status, COUNT(*) AS job_count,
       SUM(vision_calls) AS total_vision_calls,
       SUM(vision_input_tokens) AS total_input_tokens,
       SUM(vision_output_tokens) AS total_output_tokens
FROM ingestion_jobs
GROUP BY status;
```
*Expected: Most completed jobs will have status `completed` or `dedup_reused`.*

### 2. Check Extracted Pages by Type and Source
```sql
SELECT page_type, source, COUNT(*) AS pages_count,
       COUNT(*) FILTER (WHERE latex_present = TRUE) AS math_latex_pages,
       COUNT(*) FILTER (WHERE figure_description IS NOT NULL) AS figure_pages
FROM doc_pages
GROUP BY page_type, source
ORDER BY pages_count DESC;
```
*Expected: Clean text pages will show `source = 'text_layer'`; math/diagram pages will show `source = 'vision'` with `latex_present = TRUE`.*

### 3. Verify Note Search Rollup
```sql
SELECT file_id, length(content) AS content_length,
       updated_at
FROM note_search_documents
ORDER BY updated_at DESC
LIMIT 5;
```
*Expected: Content length matches the combined text of all pages joined by `\f`.*

---

## 7. Step 6: Website Verification

1. Go to the Semester Library website: [https://semestar-library.vercel.app](https://semestar-library.vercel.app)
2. Log in as a student or teacher.
3. Open a subject with uploaded PDF notes (e.g. Discrete Mathematics, Digital Logic, or Mathematics II).
4. In the Search bar or **Ask Kyana** input, search for a formula, derivation, or circuit term that was previously invisible because it was inside a scanned or diagram page (e.g. `Karnaugh map`, `Boolean expression`, or `truth table`).
5. Verify that Kyana returns the exact note reference with the matched snippet!

---

## 8. What to Do When the Gemini Quota Runs Out

Free-tier Google AI Studio API keys have daily quota limits (typically 20-50 requests per day for vision models). When high-volume batch backfills hit this ceiling, **the system is designed to handle it gracefully and safely without losing any work**.

### 1. How the Pipeline Protects Searchability
- **Two-Pass Decoupling**: In every run, the worker runs **Pass 1 (Text Layer)** across all queued files first. This extracts and indexes all typed text into `note_search_documents` at **$0 cost** with **zero Gemini calls**.
- As a result, students can search notes and ask Kyana about their curriculum immediately, even if Vision OCR is paused.
- In **Pass 2 (Vision Pass)**, pages are processed in strict priority order:
  `scanned` → `math` → `nepali_repair` → `table` → `figure`.

### 2. Automatic Quota Circuit Breaker & Next Retry
- When Gemini returns HTTP 429 (`RESOURCE_EXHAUSTED` / `Quota exceeded`), the worker captures the exact `retryDelay` or reset timestamp reported by Google (e.g. `Please retry in 1h30m0s`).
- The job is set to `status = 'failed_retryable'` and `next_retry_at = CURRENT_TIMESTAMP + <retryDelay>`.
- Any remaining vision pages for the job are marked `status = 'skipped_quota'`.
- All other queued jobs with pending vision pages also have their vision pages marked `skipped_quota` and their `next_retry_at` set to the reset timestamp, with **zero wasted HTTP calls**.
- **Runs before `next_retry_at` make 0 vision calls**, preventing quota spam, while newly uploaded notes can still have their text layer extracted.

### 3. Automatic Recovery
- Once the reset time passes, the next scheduled or manual run automatically detects that `next_retry_at <= CURRENT_TIMESTAMP`.
- It claims only those jobs and **resumes only the `skipped_quota` pages**.
- Text-layer pages (which have `status = 'completed'`) are skipped instantly without re-reading.

### 4. How to Manually Force Retry After Adding a New Key or Quota Reset
If you updated `GEMINI_API_KEY` or want to re-run all failed/partial jobs immediately:
1. Open the GitHub Actions tab.
2. Select **Document Ingestion Worker (Phase D2)**.
3. Click **Run workflow**:
   - Check `retry_failed: true`
4. Click **Run workflow**.
   The worker will automatically reset all `failed` pages back to `pending` and all `failed_retryable`, `failed_terminal`, or `partial_success` jobs back to `queued`, then re-process them.

---

## 9. Rollback Plan (If anything goes wrong)

If you ever need to roll back the tables:
1. Open Neon SQL Editor.
2. Run `migrations/20261112_doc_intelligence_d2.down.sql`:
   ```sql
   BEGIN;

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
   ```
3. This cleanly drops `doc_pages` and `ingestion_jobs`. It leaves all other tables, users, uploads, and sessions 100% intact.

