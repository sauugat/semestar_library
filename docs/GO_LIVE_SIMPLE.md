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

## 2. Step 1: Run the Database Migration in Neon

Before running any background worker or deploying code, create the two required tables in Neon PostgreSQL.

### Where to go:
1. Log in to your [Neon Console](https://console.neon.tech).
2. Select the `semester-library` project.
3. Open the **SQL Editor** tab from the left sidebar.

### What to paste:
Open `migrations/20261112_doc_intelligence_d2.up.sql` (or copy the SQL below) and paste it into the editor:

```sql
BEGIN;

-- 1. Per-page extracted content, classification & OCR tracking
CREATE TABLE IF NOT EXISTS doc_pages (
  id BIGSERIAL PRIMARY KEY,
  file_id INTEGER NOT NULL,
  page_no INTEGER NOT NULL CHECK (page_no >= 1),
  text TEXT NOT NULL DEFAULT '',
  raw_text TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'text_layer' CHECK (source IN ('text_layer', 'vision', 'skipped')),
  ocr_confidence REAL,
  char_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'skipped', 'skipped_quota')),
  page_type TEXT NOT NULL DEFAULT 'text' CHECK (page_type IN ('text', 'scanned', 'math', 'figure', 'table', 'nepali_repair')),
  latex_present BOOLEAN NOT NULL DEFAULT FALSE,
  figure_description TEXT,
  page_image_path TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  parser_version TEXT NOT NULL DEFAULT 'd2-v1',
  tier SMALLINT NOT NULL DEFAULT 1 CHECK (tier IN (1, 2)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_dp_file_page ON doc_pages (file_id, page_no);
CREATE INDEX IF NOT EXISTS idx_dp_file_status ON doc_pages (file_id, status);
CREATE INDEX IF NOT EXISTS idx_dp_needs_vision ON doc_pages (file_id) WHERE source = 'vision' OR latex_present = TRUE;
CREATE INDEX IF NOT EXISTS idx_dp_tier_order ON doc_pages (file_id, tier, page_no);

-- 2. Asynchronous document ingestion jobs
CREATE TABLE IF NOT EXISTS ingestion_jobs (
  id BIGSERIAL PRIMARY KEY,
  file_id INTEGER NOT NULL,
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
  vision_calls INTEGER NOT NULL DEFAULT 0,
  vision_input_tokens INTEGER NOT NULL DEFAULT 0,
  vision_output_tokens INTEGER NOT NULL DEFAULT 0,
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
```

### What success looks like:
In the Neon SQL query results panel, you will see:
- `Query returned successfully in XX ms`
- Tables `doc_pages` and `ingestion_jobs` are listed under Tables.
- Note: It will **NOT** conflict with any existing tables (like `document_pages` or `files`) because it is completely self-contained.

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

### Step 4A: Dry-Run Reconcile (Check what files are unindexed)
1. Go to **Actions** tab on GitHub.
2. Select **Document Ingestion Worker (Phase D2)** from the left workflow list.
3. Click **Run workflow** dropdown on the right:
   - `max_jobs`: `20`
   - `backfill_dry_run`: check the checkbox (set to `true`)
   - `backfill_limit`: `0`
4. Click **Run workflow**.
5. Inspect the logs: it will scan the `files` table and print how many existing files have never been indexed, **without queuing anything**.

### Step 4B: Small Pilot Run (5 files)
1. In the **Run workflow** dropdown:
   - `max_jobs`: `5`
   - `backfill_dry_run`: uncheck (set to `false`)
   - `backfill_limit`: `5`
2. Click **Run workflow**.
3. It will enqueue the first 5 missing files and process their pages.
4. Check the workflow logs: see pages extracted via `text_layer` (zero tokens) or `vision` (for math/scanned), and verify completion.

### Step 4C: Full Hourly Operation
- The hourly cron (`0 * * * *`) automatically picks up any newly uploaded files.
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

## 8. Rollback Plan (If anything goes wrong)

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
