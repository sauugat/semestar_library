# PHASE D1: Document Page-Reading Pipeline — Inspection & Design Report

- **Branch:** `feature/kyana-rag-v2` (`55ae3b5`, matching `origin/main`) — **VERIFIED**
- **Mode:** Inspection & Architecture Design Only (zero source code edits, zero migrations, zero commits, zero production DB/env queries) — **VERIFIED**
- **Out of Scope:** Games Platform Worker (`routes/games.js`, `mobile/components/games/*`) — untouched — **VERIFIED**
- **Evidence Labels:**
  - **`VERIFIED`**: Directly inspected in repository files/git history on `feature/kyana-rag-v2` or executed cleanly in an isolated, offline Node scratch check (zero DB, zero `.env`, zero network).
  - **`ASSUMED`**: Logically inferred from configuration/constraints or runtime capacity math that cannot be proved without hitting live production Neon, Supabase, Vercel, or Gemini APIs.

---

## Context & Prior Audits Reused

1. **`docs/KYANA_3_AUDIT.md`** (`feature/kyana-rag-v2`, dated 2026-10-14): **VERIFIED** present on disk. Reused for V3 knowledge tables (`knowledge_resources`, `knowledge_chunks`, `knowledge_jobs`), hybrid FTS + vector architecture, Neon Pokhara-to-`us-east-1` ~900–950ms RTT baseline, and Vercel tier/Gemini model assumptions.
2. **`docs/STUDY_BUDDY_PHASE1_AUDIT.md`**: **VERIFIED** **not present on `feature/kyana-rag-v2`** (`origin/main`), **VERIFIED** present in git commit `dd44d2fd` (`hotfix/kyana-auth-routing`, auditing `feature/kyana-rag-v2@55ae3b5`). Reused without repeating full inventories for: syllabus-data structure, `files` schema/column mismatch vs `KYANA_3_NOTES_DESIGN.md`, split-brain migration setup, Vercel Hobby plan evidence, and existing access-control gaps.
3. **`docs/KYANA_RAG_AUDIT.md`** (`feature/kyana-rag-v2`, dated 2026-11-10): **VERIFIED** present on disk. Reused for empirical failure analysis on PDF File 26, `"extend, don't duplicate"` schema reconciliation table, and local `@electric-sql/pglite` + `@electric-sql/pglite-pgvector` HNSW verification.

---

## 1. Upload Flow, Storage & `files` Linking

Reusing `STUDY_BUDDY_PHASE1_AUDIT.md` §2 (`VERIFIED` in code on `feature/kyana-rag-v2`):

- **Upload Routes & Middleware:**
  1. **Multipart Upload (`POST /api/files/upload`):** `server.js:2987-3271` uses `requireLogin` -> `handleFileUpload` (`upload.any()`, `multer.diskStorage` to `UPLOAD_DIR`, `250 MB` limit per file at `server.js:130-133`), then enforces `isStudentAdmin(studentId) || academicCtx.role === 'teacher'` (`server.js:3011-3019`). Teachers require `subject` and pass `validateTeacherSubjectAuthorization` (`server.js:3021-3053`).
     - **Gap (`VERIFIED`):** `upload` (`server.js:130-133`) has **no `fileFilter`** (unlike `chatUpload` at `server.js:135-150` or `/authorize-upload`), relying only on filename extension at preview/extraction time.
     - **Client Path (`VERIFIED`):** Expo mobile (`mobile/services/library.ts:253-320`) uses **only** `POST /api/files/upload`. Under Vercel serverless functions, multipart bodies hit Vercel's **`4.5 MB`** payload ceiling (**ASSUMED** per Vercel Hobby/Pro platform limits).
  2. **Direct-to-Supabase Flow (`POST /api/files/authorize-upload` + `POST /api/files/record-upload`):** `server.js:3325-3599` (called by `public/files.html:1043` and `public/library.html:5954,6763`). Issues a 30-minute HMAC token (`createUploadToken`), checks `isAllowedUploadFile`, enforces size `1 B .. 250 MB`, verifies object existence/size/MIME/age (`<= 4h`) in Supabase Storage bucket `library_files` (`server.js:3454-3485`), inserts into `files`, and synchronously awaits `indexUploadedNote(...)` (`server.js:3510`).
- **Allowed Types (`VERIFIED`):** `ALLOWED_UPLOAD_EXTS` (`server.js:3273-3277`) permits `.pdf, .doc, .docx, .ppt, .pptx, .xls, .xlsx, .zip, .txt, .csv, .png, .jpg, .jpeg, .webp, .mp4, .c, .cpp, .py, .java`; `DANGEROUS_UPLOAD_EXTS` (`server.js:3279-3283`) rejects `.html, .svg, .js, executables, scripts`.
- **Storage Locations (`VERIFIED`):**
  - Ephemeral/local disk `UPLOAD_DIR` (`/tmp/uploads` if `process.env.VERCEL`, else `./uploads`, `server.js:91`).
  - Postgres `BYTEA` / SQLite `BLOB` fallback table `file_blobs(filename, mimeType, fileData, createdAt)` (`db.js:1321-1368`), written only by `POST /api/files/upload` (`server.js:3095`), **not** by `/record-upload`.
  - Supabase Storage bucket `library_files` (`lib/supabase.js`, `server.js:3456`). Cloudflare R2 is **not used (`VERIFIED`)**.
- **Server-Side Byte Reading (`VERIFIED`):** `lib/note-search.js:readFileBytes(db, file, suppliedBuffer)` (`lines 124-165`) caps reads at `MAX_FILE_BYTES = 20 * 1024 * 1024` (**20 MB**), resolving in order:
  1. `UPLOAD_DIR/<storedName>` (with `realpath` symlink confinement check),
  2. `db.getFileBlob(storedName)`,
  3. HTTPS `GET` to `${SUPABASE_URL}/storage/v1/object/public/library_files/<storedName>` with `20,000 ms` timeout (`approvedStorageUrl`, `downloadBuffer`, `redirect: 'error'`).
  - **Risk (`VERIFIED`):** Files allowed up to `250 MB` at upload time (`server.js:132, 3355`) immediately fail text extraction with `extractionStatus = 'too_large'` if `sizeBytes > 20 MB` (`lib/note-search.js:125`). Also, `approvedStorageUrl` constructs the **public** bucket path; if `library_files` is ever made private without signed URLs/service key download, server-side fetch will receive 403 (**ASSUMED**).
- **DB Rows Created (`VERIFIED`):**
  - `files` (`db.js:528-540` + `lib/academic-context.js:102-120`): `id` (PK), `storedName`, `originalName`, `title`, `subject` (TEXT, nullable, no FK), `chapter` (TEXT, nullable, no FK), `semester` (TEXT, nullable), `previewName`, `uploadedBy` (FK `students.studentId`), `sizeBytes`, `uploadedAt`, `sort_order`, `cohort_id`, `semester_no`, `audience_scope`.
  - **Subject/Chapter Linking (`VERIFIED`):** Purely free-text strings (`files.subject`, `files.chapter`, `files.semester`) populated by UI/upload form; teachers are validated against `subjects` via `validateTeacherSubjectAuthorization`, while `chapter` accepts arbitrary strings (`"Unit 1: ..."`, `"PYQS"`, `"General"`, or custom chapters).

---

## 2. Existing Text Extraction & Libraries

- **`package.json` Parsing/OCR/Media Dependencies (`VERIFIED`, `package.json:25-48`):**
  - `pdfjs-dist` (`6.3.289`) — PDF text extraction
  - `node-pptx-parser` (`^1.0.1`) — PPTX slide XML extraction
  - `mammoth` (`^1.12.1`) — DOCX raw text/HTML extraction
  - `libreoffice-convert` (`^1.8.2`) — Office -> PDF conversion if `soffice` binary exists on host (`server.js:2945-2968`; not available on Vercel)
  - `@neondatabase/serverless`, `pg`, `@libsql/client`, `@supabase/supabase-js`, `@vercel/functions`, `multer`
  - DevDeps: `@electric-sql/pglite` (`^0.5.8`), `@electric-sql/pglite-pgvector` (`^0.0.17`), `playwright` (`^1.63.0`), `pptxgenjs`
  - **Absent (`VERIFIED`):** Zero OCR libraries (`tesseract.js`, `scribe.js`), zero PDF page rasterizers (`canvas`, `@napi-rs/canvas`, `sharp`, `pdf2pic`, `pdf-poppler`), zero PDF slicers (`pdf-lib`), zero Google AI SDKs (`@google/genai`, `@google/generative-ai`).
- **Exact Extraction Functions (`VERIFIED`):**
  - `server.js:36-53` — `indexUploadedNote(file)`: calls `noteSearch.indexNote(db, file)`, then `knowledgeSync.onNoteSaved(db, file)`, then invalidates AI cache.
  - `lib/note-search.js:124-165` — `readFileBytes(db, file, suppliedBuffer)`: enforces 20 MB cap and reads from disk/blob/Supabase.
  - `lib/note-search.js:168-187` — `checkDocxSize(buffer)`: inspects ZIP central directory before inflation (`MAX_DOCX_EXPANDED_BYTES = 60 MB`, rejects ZIP64).
  - `lib/note-search.js:189-240` — `extractText(buffer, originalName)`:
    - `.pdf`: loads `pdfjs-dist/legacy/build/pdf.mjs` with `{ isEvalSupported: false, useSystemFonts: false, verbosity: 0 }`, iterates pages `1..min(numPages, 500)`, joins `page.getTextContent().items.map(i => i.str || '').join(' ')` and separates pages with `\f`, under `Promise.race` with **`20,000 ms` timeout** (`INDEX_TIMEOUT_MS`) and `1,000,000` char cap (`MAX_TEXT_CHARS`).
    - `.pptx`: extracts slides via `node-pptx-parser` (temp dir), joins with `\f`.
    - `.docx`: calls `mammoth.extractRawText({ buffer })` (no page markers).
    - `.txt`, `.md`, `.csv`: UTF-8 string.
    - All other types: throws `extractionStatus = 'unsupported'`.
  - `lib/note-search.js:243-278` — `indexNote(db, file, { buffer })`: writes 1 row per file to `note_search_documents`, and if `db.isPostgres && isKnowledgeIndexingEnabled()`, enqueues `note:${file.id}` in `knowledge_jobs`.
  - `lib/knowledge-builder.js:270-452` — `chunkNotePage(header, pageText, pageNo)` & `buildNoteKnowledge(file)`: splits `note_search_documents.content` on `\f` into 1-based `pageNo` chunks (~`1,500` target, `2,000` max, `200` overlap) with regex heading detection (`isHeadingLine`).
- **Does It Work on Scanned PDFs? (`VERIFIED`):**
  - **No.** Scanned PDFs yield `""` from `getTextContent()`, causing `lib/note-search.js:259-262` to set `extraction_status = 'empty'` and `extraction_error = 'No readable text found; scanned PDFs require OCR.'`. Mixed PDFs (e.g., 15 scanned pages + 1 typed cover sheet) silently pass as `'indexed'` while losing all 15 scanned pages!

---

## 3. Syllabus Data & Stable IDs

Reusing `STUDY_BUDDY_PHASE1_AUDIT.md` §1 (`VERIFIED` on `feature/kyana-rag-v2`):

- **Three Unsynced Definitions (`VERIFIED`):**
  1. `syllabus-data.json` & `public/syllabus-data.json` (identical on `feature/kyana-rag-v2` per `diff -q`): 8 semesters, 45 core courses + electives (`ELE`), storing units and nested subtopics inside raw formatted multi-line prose (`course.contents`) with line-wrap hyphenation (`"pro-\ngramming"`).
  2. `mobile/constants/subjects.config.ts`: exports `SEMESTERS` with subject `code`/`title`/`credit` and **unit titles only** (`chapters[]` — `0` topics), plus virtual buckets `"PYQS"`, `"Books"`, `"General"`.
  3. `mobile/constants/syllabusPart1..4.ts` + `syllabusElectives.ts`: third manually structured copy of units/topics with wording drift vs `syllabus-data.json`.
- **Canonical / Stable IDs (`VERIFIED`):**
  - **Subjects:** 45 core courses have `subjects.id` (DB autoincrement/PK) seeded by `lib/teacher-service.js:364-445` and unique course codes (`CIT214`), **but** electives all collide on `"code": "ELE"`, admins can rename `subjects` at runtime (`POST /api/library/subjects/rename`), and `files.subject` stores mutable text instead of `subject_id`.
  - **Chapters/Units & Topics:** **Zero stable IDs exist** anywhere in DB or JSON (`files.chapter` is free-text, mutated ad hoc by `/api/library/chapters/rename|delete`).
- **Safest Way to Introduce Stable IDs (Proposed, Zero Breaking Change):**
  1. **Normalized Curriculum Registry Tables:** Populate `curriculum_subjects`, `curriculum_units`, and `curriculum_topics` in Postgres with **immutable deterministic slug IDs** (e.g., `subj:cit214` or `subj:sem7:ele:ai-slug` for electives) + `curriculum_aliases(alias_text, target_type, target_id)` preserving old/renamed strings (`"DSA"`, `"Data Structure and Algorithms"`).
  2. **Backward-Compatible Linking:** Keep `files.subject` and `files.chapter` intact for existing web/mobile UIs, while adding nullable `files.subject_id` and `files.unit_id` (populated on upload and via a one-time idempotent alias backfill). `document_pages` / chunk topic labels then reference canonical `unit_id` / `topic_id` without breaking when a chapter title is cosmetic-edited.

---

## 4. Database, `pgvector` & Existing RAG Tables

Reusing `KYANA_3_AUDIT.md` §1/§5 and `STUDY_BUDDY_PHASE1_AUDIT.md` §5/§6 (`VERIFIED` in code/migrations):

- **Existing Tables Inventory (`VERIFIED` in `db.js`, `lib/note-search.js`, `migrations/`):**
  - `files` (`db.js:528-540`), `file_blobs` (`db.js`), `cohorts`
  - `subjects`, `library_custom_chapters`, `library_chapter_overrides` (`lib/teacher-service.js`, `server.js:4601+`)
  - `note_search_documents` (`lib/note-search.js:46-54`): 1 row/file, whole concatenated `content` + `search_vector` (`english` TSVECTOR + GIN)
  - `knowledge_resources` (`migrations/20261014_kyana_v3_knowledge.up.sql:21-51`): unified index metadata + `content_hash` + `source_authority_tier` + cohort/semester scoping
  - `knowledge_chunks` (`migrations/20261014:68-85` + `migrations/20261110:7-22`): chunk text, `page_number`, `end_page_number`, `section_heading`, `content_hash`, `embedding_model` (`'gemini-embedding-001'`), `embedding vector(768)` + HNSW `idx_kc_vector` (`vector_cosine_ops`), generated `tsv_content` (`'english'` A + `'simple'` B) + GIN `idx_kc_tsv`
  - `knowledge_jobs` (`migrations/20261014:88-109`): async job queue (`pending | processing | completed | failed`, `revision`, `attempts`, `max_attempts`, `last_error`, `scheduled_at`, `locked_at`, `completed_at`)
  - **`document_pages` / `ingestion_jobs`: DO NOT EXIST YET** on `feature/kyana-rag-v2` (`VERIFIED`). *(Note: `lib/chapter-tutor-engine.js` does not exist on `feature/kyana-rag-v2`.)*
- **`pgvector` Verification Status:**
  - **Production Neon Live State:** **ASSUMED / UNVERIFIED** (hard rule prohibits connecting to `.env` or querying production Neon). `docs/KYANA_3_AUDIT.md:19` noted `vector` (`0.8.6`) in Neon `pg_available_extensions`, and `migrations/20261014:9` runs `CREATE EXTENSION IF NOT EXISTS vector;`, **but** `lib/knowledge-schema.js` only runs `20261014` when `KYANA_KNOWLEDGE_V3 === 'true'`, and **never** runs `20261110` (`VERIFIED` in `STUDY_BUDDY_PHASE1_AUDIT.md` §5).
  - **Isolated Local Test Verification (`VERIFIED`):** `docs/KYANA_RAG_AUDIT.md:218-264` and `tests/kyana-note-vector.test.js:7-8` verify `@electric-sql/pglite` + `@electric-sql/pglite-pgvector` execute `CREATE EXTENSION vector`, `vector(768)`, HNSW indexes, and `<=>` cosine distance purely in-memory without Docker or Neon.

---

## 5. Where Background Work Can Run

- **Current Runtime & Limits (`VERIFIED` + `ASSUMED`):**
  - `vercel.json:3,42-57`: all HTTP routes proxy to `api/index.js` -> `server.js` in `iad1` with **no `maxDuration`** set and only **2 daily crons** (`/api/internal/push/process`, `/api/internal/posts/cleanup-staging`), matching Vercel Hobby limits (**10s execution ceiling**, **4.5 MB** body limit, **max 2 daily crons** — **ASSUMED** Hobby plan limits inferred from `vercel.json`).
  - `server.js:3141, 3510`: calls `await indexUploadedNote(...)` **inline inside the HTTP upload request** (up to `20s` timeout in `note-search.js:10`), risking Vercel 504 timeouts on multi-page PDFs or multi-file uploads (`VERIFIED`).
  - `routes/internal-knowledge.js:33-88`: exposes `/api/internal/knowledge/worker` (`batchSize: 25`) and `/api/internal/knowledge/reconcile`.
  - `.github/workflows/knowledge-reconciliation.yml:6,32`: runs every 15 minutes (`*/15 * * * *`) calling **only** `/api/internal/knowledge/reconcile` (`--max-time 30`). **Nothing calls `/api/internal/knowledge/worker`** (`VERIFIED`).
- **Zero-Cost Background Execution Recommendation:**
  - **Decouple HTTP Upload from Reading/OCR:** Upload endpoints (`POST /api/files/upload` and `/record-upload`) save metadata + create an `ingestion_jobs` row (`status = 'queued'`) and return HTTP 201 in `< 1s` (running fast pure-JS text extraction inline *only* for small `< 10` page typed PDFs or skipping inline extraction entirely).
  - **Simplest Zero-Cost Worker Host:** **GitHub Actions Standalone Worker Script** (`node scripts/doc-ingestion-worker.js`) run on the existing free GitHub Actions scheduler (`*/15 * * * *`, plus optional `workflow_dispatch` / `repository_dispatch` triggered from the upload handler without waiting):
    - Runs in Ubuntu with **up to 6 hours/job max (use 10–15 min budget)** — completely immune to Vercel's 10s limit and 250 MB bundle cap.
    - Free on public repos (and 2,000 free Linux minutes/month on private repos — **ASSUMED** GitHub Free tier; check repo visibility/monthly minutes).
    - Can install/run `poppler-utils` (`pdftoppm`) or `@napi-rs/canvas` cleanly without bloating the Vercel serverless function.
    - Connects directly to Neon (`DIRECT_URL`) / Supabase using GitHub Actions secrets cleanly, checkpointing per page so interrupted runs resume idempotently.
  - **Zero-cost fallback if Actions minutes run low:** Vercel `/api/internal/knowledge/worker?budgetMs=7000` processing **1–2 pages per HTTP call** driven by a free external pinger (e.g. Cloudflare Worker Free / UptimeRobot) chained until queue empty — workable for text layer, too slow/fragmented for heavy OCR.

---

## 6. AI Providers, Gemini Usage, Rate Limits & Cost Risks

- **Models & Invocation Method (`VERIFIED`):**
  - **No SDK used:** Zero `@google/*` packages in `package.json`. All calls use Node's native `fetch` directly against `https://generativelanguage.googleapis.com/v1beta/models/...`.
  - **Chat Models (`lib/chat-provider.js:236, 277-282`):** Default `gemini-3-flash-preview` (fallback chain on 404/503/429: `'gemini-3-flash-preview'`, `'gemini-3.1-flash-lite-preview'`, `'gemini-flash-latest'`; env overrides `GEMINI_MODEL`, `GEMINI_COMPLEX_MODEL`), `15,000 ms` timeout (clamped `[1000, 30000]`). `routes/code-lab/explain.js:52` also references `['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']`.
  - **Embedding Model (`lib/knowledge-embeddings.js:5-9, 74-82`):** `gemini-embedding-001` (`768` dims via `outputDimensionality`), `MAX_BATCH_SIZE = 100`, `DEFAULT_TIMEOUT_MS = 3,000 ms`, `MAX_RETRIES = 2` with exponential backoff + jitter on HTTP `429`/`503`.
  - **Gemini File API / Multimodal Input (`VERIFIED`):** `rg` confirms **zero** usage of Gemini File API (`upload/v1beta/files`), `fileData`, or `inlineData` anywhere in the codebase today.
- **Rate Limit & Cost Risks (500 Students Uploading Notes):**
  - **Authorization Context (`VERIFIED`):** Currently `POST /api/files/upload` and `/record-upload` restrict uploads to **admin & teacher roles only** (`server.js:3011, 3330`). If student uploads remain disabled, ingestion volume comes only from teachers/admins (low burst). **If D1+ opens note uploads to 500 students**, unthrottled uploads risk large burst costs and RPM/TPM 429s:
    - *(Example sizing — **ASSUMED** heuristic math)*: 500 students × 1 scanned 30-page PDF upload during exam week = 15,000 OCR page calls. Even with Flash-Lite vision pricing, unconstrained duplicate uploads (e.g. 50 students uploading the exact same class PDF) would multiply cost 50× without SHA-256 `content_hash` deduplication!
    - **Mitigations required before student uploads:** (1) SHA-256 `content_hash` dedup before OCR, (2) per-page selective OCR (never OCR clean typed pages), (3) worker concurrency cap (e.g. max 2–3 concurrent Gemini OCR calls + `429` `Retry-After` backoff), (4) per-user daily upload/OCR quota & max scanned pages per document.

---

## 7. Document & Format Risks

| Risk Category | Current Behavior (`VERIFIED`) | Failure Mode & Mitigation Needed (`ASSUMED` / Design) |
| :--- | :--- | :--- |
| **Large PDFs (200+ pages)** | Fails in multiple places: `MAX_FILE_BYTES = 20 MB`, `MAX_PDF_PAGES = 500`, `MAX_TEXT_CHARS = 1,000,000`, `INDEX_TIMEOUT_MS = 20,000 ms` (`note-search.js:6-10`), and Vercel `10s` HTTP limit. | Inline parsing times out or truncates cleanly past 1M chars / 20s. **Mitigation:** Worker extracts in page batches (e.g., 10 pages/checkpoint), skips `MAX_TEXT_CHARS` truncation at page-store layer, streams/chunks per page, and supports PDFs >20 MB in worker via streaming/range or raised worker limit (e.g. 50–100 MB). |
| **Password-Protected PDFs** | `pdfjs-dist` rejects `loadingTask.promise` with `PasswordException`; `indexNote` catches it and writes `status = 'error'` with generic message (`note-search.js:264-265`). | Retry loops waste 5 attempts (`knowledge_jobs.max_attempts = 5`). **Mitigation:** Classify `PasswordException` / encryption errors as **non-retryable terminal** (`status = 'failed_unreadable'`, error code `PASSWORD_PROTECTED`). |
| **Corrupted / Truncated Files** | Throws inside `pdfjs-dist` / `checkDocxSize` -> `status = 'error'`. Note: `multer` in `/upload` lacks magic-byte/MIME validation (`server.js:130`). | Distinguish bad XRef / truncated header (`CORRUPT_FILE`, terminal) vs transient Supabase download timeout (`RETRYABLE`). Verify PDF `%PDF-` magic header before parsing. |
| **Duplicate Uploads** | **No `content_hash` column on `files` (`VERIFIED`).** Identical PDFs re-uploaded get new `storedName` & `id`, consuming duplicate storage, extraction, OCR, and embeddings (`knowledge_chunks.content_hash` only skips re-embedding identical chunk text). | Compute SHA-256 `content_hash` of file bytes once downloaded/uploaded. If a `completed` `document_pages` set already exists for the same `content_hash` + `parser_version`, clone/reference extracted pages without re-running PDF parsing or Gemini Vision OCR. |
| **Handwritten Notes** | Zero text layer -> `status = 'empty'` (`note-search.js:260`). | Low typed char count (<50) + large image/stroke coverage -> route to Vision OCR with explicit instruction to transcribe equations cleanly in `$...$` and flag `[illegible]` segments instead of hallucinating. |
| **Nepali / Devanagari Text** | Two risks: (1) `note_search_documents.search_vector` uses `'english'` dictionary only (`note-search.js:53`); `knowledge_chunks.tsv_content` uses `'english'` + `'simple'` (`20261014:76-79`), while `KYANA_3_AUDIT.md:20` notes `'nepali'` `pg_ts_config` exists on Neon. (2) Legacy non-Unicode Nepali TTF fonts (e.g. Preeti/Kantipur used in older TU/GU notices) extract via `pdfjs` as garbled ASCII (`"k|yd"`, `"jif{"`) instead of Devanagari Unicode! | **Mitigation:** Detect high gibberish/low-dictionary ratio or legacy non-Unicode font encodings on text layer -> force Vision OCR on those pages; add Devanagari/`'simple'`-safe tokenization or Unicode normalization (`NFC`). |
| **Tables** | `page.getTextContent().items.map(i => i.str).join(' ')` (`note-search.js:204`) flattens multi-column cells horizontally/out of visual reading order into unreadable run-on text. | Reconstruct lines using `(x, y)` coordinates (`item.transform[4], item.transform[5]`), or route pages flagged `page_type = 'table'` to Vision/structured extraction producing Markdown `\| col \|` tables. |
| **Diagrams / Flowcharts / Figures** | Embedded bitmaps (`paintImageXObject`) and vector diagrams (`constructPath`/`stroke`) emit **zero text** in `getTextContent()`, or only disjointed 1-word labels (`"CPU"`, `"ALU"`). | Detect image/vector-heavy pages via `pdfjs` operator list; generate `figure_description` via multimodal VLM so diagrams become searchable & teachable. |
| **Code Blocks** | `.join(' ')` + `.replace(/[\t\r ]+/g, ' ')` (`note-search.js:204,238`) destroys Python/C indentation, braces alignment, and splits tokens (`<<`, `->`, `!=`). | Reconstruct indentation from `item.transform[4]` x-offsets per line before storing page `text`, preserving indentation and line breaks. |

---

## 8–11. Additional Inspection: Maths, Images, Tables & Rendering

### 8. Detecting Pages with Formulas, Images/Diagrams, or Tables

- **Verified PDF Inspection Capability (`VERIFIED` via offline Node test with installed `pdfjs-dist@6.3.289`):**
  - Calling `page.getTextContent()` (returns `{ items: [{ str, transform, width, height, fontName }] }` + `styles[fontName]`) and `page.getOperatorList()` (returns `{ fnArray, argsArray }`) works **purely in Node.js without any native canvas dependency** (`OPS` keys verified: `paintImageXObject`, `paintInlineImageXObject`, `paintImageMaskXObject`, `paintImageXObjectRepeat`, `constructPath`, `stroke`, `fill`, `eoFill`, etc.).
- **Proposed Heuristic Classification Rules (`ASSUMED` thresholds — calibrate on real sample corpus):**
  Inspect each page before deciding `page_type` (`text | scanned | math | figure | table`) and whether Vision enrichment is needed:
  1. **Clean Text Baseline:** Normalize extracted text; count `cleanAlnumChars` (Unicode letters + digits, excluding isolated 1-char bullets/page footers like `"Page 3"`).
  2. **`scanned`:** `cleanAlnumChars < 50` **AND** (`imageOps >= 1` OR `totalChars === 0`). (Needs full-page OCR.)
  3. **`figure` (Diagram/Chart/Slide Graphic):**
     - `imageOps >= 1` (`paintImageXObject` / `paintInlineImageXObject`) with substantial coverage OR heavy vector drawing (`constructPath` / `stroke` / `fill` count `>= 30` excluding simple page borders/underlines) **AND** `cleanAlnumChars < 350` (sparse labels around a diagram).
     - Note: Even if `cleanAlnumChars >= 350` (textbook page with an inline diagram), flag `has_figure = true` (`imageOps >= 1` or dense vector diagram cluster) so `figure_description` can still be extracted if needed.
  4. **`math` (`latex_present = true`):**
     - **Unicode / font math density:** Count math operators & Greek/calculus symbols (`[∑∏∫∮∂∇√∞≈≠≤≥≡∈∉⊂⊆∪∩∀∃⇒⇔±×÷^]|\\[a-zA-Z]+|[\u0370-\u03FF\u2200-\u22FF]`). Trigger `math` if count `>= 4` per page OR symbol ratio `>= 2%` of non-space chars OR PDF uses math font families (`CMMI`, `CMSY`, `CMEX`, `MT Extra`, `Symbol`, `CambriaMath`) in `content.styles` — important because `pdfjs` frequently drops fraction bars, limits, superscripts (`x^2` -> `x 2`), and roots (`√`).
     - **Garbled/fragmented formula signal:** High proportion (`>= 30%`) of 1–2 char isolated tokens with mixed baseline `y` jumps (`transform[5]`).
  5. **`table`:**
     - Group text items into horizontal rows by rounded `transform[5]` (`±2–3pt` tolerance).
     - Trigger `table` if `>= 4` rows share `>= 3` aligned x-column buckets (gaps `> 1.5×` average space width between tokens on the same line) **OR** grid/box ruling lines (`constructPath` vertical + horizontal line segments `>= 8` bounding text clusters).

### 9. PDF Page-Image Rendering & Frontend KaTeX/LaTeX Support

- **Server-Side PDF Page Rendering (`VERIFIED`):**
  - **Current Gap:** Zero PDF-to-image rasterization library exists in `package.json`. Running `page.render({ viewport })` in `pdfjs-dist@6.3.289` on Node without a canvas context **throws `TypeError: Cannot read properties of undefined (reading 'canvas')`** (`VERIFIED` via offline Node run). `libreoffice-convert` only converts Office docs -> PDF (`server.js:2959-2967`), not PDF pages -> PNG.
  - **Vercel vs Worker Reality:**
    - **Vercel Serverless:** **NOT viable** for `pdfjs` rasterization (`canvas` / `@napi-rs/canvas` / `puppeteer` / `poppler`). Reasons: (1) Vercel Hobby **10s timeout** (`ASSUMED`), (2) native Cairo/Skia or Chromium binaries blow or destabilize the **250 MB unzipped serverless bundle cap** (`ASSUMED` Vercel platform limit), and (3) zero `soffice`/`pdftoppm` OS packages on Vercel runtime.
    - **Separate Worker / GitHub Actions:** **Viable at \$0 cost**. Either install `poppler-utils` (`pdftoppm -png -r 150` — fast C++ binary) in the Ubuntu GitHub Actions runner, or add `@napi-rs/canvas` (prebuilt N-API Skia) / `playwright` (`playwright` is already in `devDependencies` at `package.json:46`!) cleanly on the worker.
    - **Important Simplification for Gemini OCR:** If the worker extracts single-page or small-batch PDF slices (e.g., via `pdf-lib`, pure JS, tiny footprint) OR uploads the PDF via Gemini File API (`application/pdf`), **Gemini accepts native PDF bytes directly without converting every page to PNG first** (`ASSUMED` Gemini multimodal PDF capability). PNG rendering is strictly needed only when persisting `page_image_path` thumbnails/crops for UI preview or non-PDF OCR engines.
- **Frontend KaTeX / LaTeX Rendering (`VERIFIED`):**
  - **Web (`public/chatbot.html` + `public/chatbot.js`):**
    - `public/chatbot.html:51-54` + `public/chatbot.js:432-439, 534-570` **already load `katex@0.16.11`** (+ `auto-render.min.js`) from jsDelivr CDN, normalize `\[...\]` / `\(...\)` -> `$$...$$` / `$...$` via `normalizeLatexDelimiters`, and render math after Markdown parsing (`marked` + `DOMPurify`) once streaming completes.
    - **Caveat (`VERIFIED`):** KaTeX ONLY runs inside full-page mode (`chatbot.html` or `document.body.classList.contains('sla-fullpage-mode')` at `chatbot.js:415-416`). Other pages (`library.html`, `posts` feed) do not load KaTeX stylesheets (`VERIFIED`). Note streaming frames skip `renderMathInElement` (`if (streaming) return;` at `chatbot.js:553`), rendering final LaTeX only once the full response finishes.
  - **Expo Mobile App (`mobile/`):**
    - **Does NOT render LaTeX today (`VERIFIED`).** `mobile/app/kyana.tsx:29, 557, 774` renders Kyana responses exclusively with `mobile/components/PostMarkdown.tsx`, a pure React Native `<Text>` tokenizer supporting bold, italic, underline, strikethrough, code blocks, Markdown tables, and links — **zero KaTeX, MathJax, or math parsing** exists anywhere in `mobile/`. Raw `$x^2$` / `$$...$$` shows as literal dollar-sign LaTeX code on iOS/Android.
    - **Upgrade Path:** `react-native-webview` (`14.0.1`) is **already installed** (`mobile/package.json:49`) and used in `FullScreenFilePreview.tsx` (`VERIFIED`), so math blocks (`$$...$$` / inline expressions) can be rendered locally in an auto-sized lightweight WebView + bundled KaTeX or a dedicated native RN math renderer in a later phase.

### 10. Proposed Design (`document_pages` & `ingestion_jobs`)

> **Architectural Note (`VERIFIED` vs `KYANA_RAG_AUDIT.md`):** On `feature/kyana-rag-v2`, `knowledge_jobs` already exists (`migrations/20261014:88-109`) for resource-level async jobs (`resource_id`, `resource_type`, `operation`, `attempts`, `max_attempts`, `last_error`, `status`, `locked_at`), and `note_search_documents` stores whole-file text (`1 row/file`). You can **either** create dedicated `document_pages` + `ingestion_jobs` tables tailored to page-level OCR & progress tracking (recommended for clean per-page state, retry isolation, and multimodal columns below, syncing finished text upward into `note_search_documents` + `knowledge_chunks`), **or** fold `ingestion_jobs` columns onto `knowledge_jobs`. Below is the proposed dedicated relational design.

#### A. Proposed `document_pages` Table

| Column | Type & Constraints | Purpose |
| :--- | :--- | :--- |
| `id` | `BIGSERIAL PRIMARY KEY` | Surrogate key |
| `file_id` | `INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE` | Owning file |
| `page_no` | `INTEGER NOT NULL CHECK (page_no >= 1)` | 1-based physical page / slide number |
| `text` | `TEXT NOT NULL DEFAULT ''` | Final authoritative page text (`text_layer` or `ocr`, plus appended `figure_description` for search if desired) |
| `raw_text` | `TEXT NOT NULL DEFAULT ''` | Original `pdfjs` / parser text layer preserved even when OCR overrides `text` |
| `source` | `TEXT NOT NULL CHECK (source IN ('text_layer', 'ocr', 'hybrid', 'skipped'))` | Extraction provenance (`hybrid` = text layer + VLM formula/figure enrichment) |
| `ocr_confidence` | `REAL` | Nullable `0.0..1.0` confidence/quality score from OCR/heuristic (null when `text_layer` only) |
| `char_count` | `INTEGER NOT NULL DEFAULT 0` | Clean non-whitespace / alphanumeric character count of `text` |
| `status` | `TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'skipped'))` | Per-page processing state |
| `page_type` | `TEXT NOT NULL DEFAULT 'text' CHECK (page_type IN ('text', 'scanned', 'math', 'figure', 'table'))` | Detected primary content classification |
| `latex_present` | `BOOLEAN NOT NULL DEFAULT FALSE` | `true` if mathematical notation or `$$`/`$` LaTeX output is present |
| `figure_description` | `TEXT` | VLM textual description of diagrams, flowcharts, circuits, or charts on the page |
| `page_image_path` | `TEXT` | Storage object key (e.g. `doc_pages/{content_hash}/p005.webp`) if rendered & saved for figure/OCR pages; null otherwise |
| `attempts` | `INTEGER NOT NULL DEFAULT 0` | Per-page OCR/extraction retry counter |
| `error` | `TEXT` | Last per-page failure code/message (e.g., `GEMINI_429`, `TIMEOUT`, `RENDER_FAIL`) |
| `parser_version` | `TEXT NOT NULL DEFAULT 'd1-v1'` | Allows selective re-extraction when rules/models improve |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP` | Row creation time |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP` | Last update time |

- **Indexes:**
  - `UNIQUE (file_id, page_no)` — idempotent upsert per page (`ON CONFLICT (file_id, page_no) DO UPDATE`).
  - `INDEX idx_dp_file_status ON document_pages (file_id, status)` — fast resumability (`WHERE status IN ('pending', 'failed')`).
  - `INDEX idx_dp_needs_ocr ON document_pages (file_id) WHERE source = 'ocr' OR latex_present = TRUE`.

#### B. Proposed `ingestion_jobs` Table & State Machine

| Column | Type & Constraints | Purpose |
| :--- | :--- | :--- |
| `id` | `BIGSERIAL PRIMARY KEY` | Job ID |
| `file_id` | `INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE` | Target library file |
| `content_hash` | `TEXT NOT NULL` | SHA-256 hex digest of raw uploaded bytes (idempotency & dedup key) |
| `file_version` | `INTEGER NOT NULL DEFAULT 1` | Increments if file metadata/bytes change |
| `status` | `TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'extracting_text', 'ocr_running', 'completed', 'partial_success', 'failed_retryable', 'failed_terminal', 'dedup_reused'))` | Explicit job state machine |
| `total_pages` | `INTEGER DEFAULT 0` | Discovered page count (`pdf.numPages` or slide count) |
| `processed_pages` | `INTEGER NOT NULL DEFAULT 0` | Count of pages in `completed | skipped | failed` |
| `ocr_pages_count` | `INTEGER NOT NULL DEFAULT 0` | Pages routed to Vision OCR |
| `last_completed_page` | `INTEGER NOT NULL DEFAULT 0` | Checkpoint cursor for worker resume |
| `attempts` | `INTEGER NOT NULL DEFAULT 0` | Job-level attempt count |
| `max_attempts` | `INTEGER NOT NULL DEFAULT 5` | Max retries for transient infrastructure errors |
| `error` | `TEXT` | Structured error summary or terminal reason (`PASSWORD_PROTECTED`, `CORRUPT_FILE`, `TOO_LARGE`, `FILE_MISSING`) |
| `worker_id` | `TEXT` | Claiming runner ID (e.g. `gha-run-<id>`) |
| `locked_at` | `TIMESTAMPTZ` | Lease acquisition timestamp (reclaimed if `heartbeat_at < NOW() - 3 min`) |
| `heartbeat_at` | `TIMESTAMPTZ` | Updated every 5–10 pages while worker runs |
| `next_retry_at` | `TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP` | Backoff schedule for `failed_retryable` |
| `started_at` | `TIMESTAMPTZ` | First execution start |
| `completed_at` | `TIMESTAMPTZ` | Terminal completion time |
| `created_at` / `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP` | Lifecycle timestamps |

- **Idempotency & Deduplication Flow (`content_hash`):**
  - Partial unique active lock: `CREATE UNIQUE INDEX uq_inj_active_file ON ingestion_jobs (file_id, content_hash) WHERE status IN ('queued', 'extracting_text', 'ocr_running', 'failed_retryable')`.
  - When a job starts, look up any prior `completed` / `partial_success` job with the **same `content_hash`** (and `parser_version`). If found, copy its `document_pages` rows to the new `file_id` in one SQL `INSERT INTO document_pages ... SELECT` and mark job `dedup_reused` in `< 100ms` — saving 100% of OCR cost on re-uploaded PDFs.

- **State Machine Transitions:**
  - `queued` -> `extracting_text` (or `dedup_reused` if matching `content_hash` already parsed)
  - `extracting_text` -> `completed` (if zero pages trigger OCR/figure enrichment) **or** `ocr_running` (if `>= 1` page queued for OCR/VLM) **or** `failed_terminal` (`PASSWORD_PROTECTED`, `CORRUPT_FILE`, unsupported binary) **or** `failed_retryable` (Supabase download/DB error)
  - `ocr_running` -> `completed` (all pages succeeded/skipped) **or** `partial_success` (`>= 1` usable pages + `>= 1` poison page `failed`) **or** `failed_retryable` (budget/timeout/global 429) **or** `failed_terminal` (0 pages usable after `max_attempts`)

#### C. OCR Decision Rule & Storage Behavior

1. **Pass 1 (Fast Pure-JS Text & Layout Pass via `pdfjs-dist`):**
   - For every PDF page `1..N`, inspect `getTextContent()` + `getOperatorList()` (fast, zero LLM cost, ~2–5ms/page in Node).
   - Compute `cleanChars` (alphanumeric chars excluding repeating header/footer noise) and classify `page_type` (`text | scanned | math | figure | table`), `latex_present`, and `legacyFontSuspected`.
2. **Routing Rule for OCR / Multimodal Enrichment:**
   - **No OCR (`source = 'text_layer'`, `status = 'completed'`):** `cleanChars >= 50` AND `!legacyFontSuspected` AND `!isTableWithGarbledColumns` AND `page_type !== 'figure'` AND `!hasBrokenMathGlyphs`. Store `text = raw_text = cleanText`.
   - **Full-Page OCR (`source = 'ocr'`):** `cleanChars < 50` (scanned or handwritten page) OR `legacyFontSuspected === true` (mojibake Preeti/Kantipur PDF).
   - **Targeted Multimodal Enrichment (`source = 'hybrid'`):** `cleanChars >= 50` **AND** (`page_type === 'figure'` OR `hasBrokenMathGlyphs === true` OR complex multi-column `table`). Send page to Vision model specifically to return clean LaTeX (`$...$` / `$$...$$`), Markdown table rows, and `figure_description`, keeping `raw_text` preserved and combining structured text into `text`.
3. **Storage & Rollup:**
   - Store per-page rows in `document_pages` immediately as each batch finishes.
   - Once `document_pages` reaches terminal state (`completed` / `partial_success`), rebuild `note_search_documents.content` by joining `document_pages.text` (plus `figure_description`) ordered by `page_no` with `\f`, setting `extraction_status = 'indexed'` (or `'partial'`), and enqueue downstream chunking/embedding into `knowledge_jobs` so existing search (`lib/note-search.js`) and V3 (`knowledge_chunks`) automatically work.

#### D. Per-Page Retry, Timeout & Failure Isolation

1. **Per-Page Execution Envelope:** Each OCR/VLM call runs with a strict per-page timeout (e.g. `25,000 ms` `AbortSignal.timeout`) inside a `try/catch` for **that page only** — never letting one corrupted XObject or Gemini safety/JSON error abort the document loop.
2. **Per-Page Retry Policy:** Each page allows up to `MAX_PAGE_ATTEMPTS = 3`:
   - *Transient errors* (`HTTP 429`, `500`, `502`, `503`, `TimeoutError`, network reset): increment `document_pages.attempts`; retry with exponential backoff + jitter (respecting `Retry-After`); if still failing in current worker run, leave `status = 'failed'` or `'pending'` to be picked up on next job resume.
   - *Permanent page-level errors* (corrupt single-page stream, empty model response after 2 attempts, safety block): mark `document_pages.status = 'failed'`, record `error`, **continue immediately to `page_no + 1`**.
3. **Document-Level Rollup:** A 200-page PDF where Page 47 is corrupted finishes as `ingestion_jobs.status = 'partial_success'` (`199/200` pages indexed and searchable), with Page 47 inspectable and selectively re-runnable (`WHERE file_id = $1 AND status = 'failed'`).
4. **Lease & Checkpoint:** Worker updates `ingestion_jobs.heartbeat_at` and `last_completed_page` every 5 pages; if the GitHub Actions job hits its wall-clock cap at page 120 of 220, it yields cleanly in `ocr_running` (re-queued immediately or picked up on next tick) and **skips pages 1..120** (`status = 'completed'`) on resume.

---

## 11. Isolated Test Plan (Zero Production Data / Zero `.env`)

All tests must run purely offline against local in-memory **PGlite (`@electric-sql/pglite` + `@electric-sql/pglite-pgvector`)** (matching `tests/kyana-note-vector.test.js`) or disposable SQLite, local temp files (`fs.mkdtemp`), and **mocked Gemini `fetchImpl`** (plus optional opt-in offline real-PDF smoke tests behind an explicit manual flag, never hitting production Neon or Supabase).

### Required Synthetic / Sample Test Corpus

| # | Sample Fixture Needed | Key Assertions |
| :--- | :--- | :--- |
| 1 | **Clean Typed PDF** (e.g., 10 pages, headings + normal prose) | `source = 'text_layer'`, `page_type = 'text'`, zero OCR calls triggered (`mockFetch.calls === 0`), 10 `document_pages` rows with exact `1..10` order and `char_count`. |
| 2 | **Scanned Image-Only PDF** (5 pages of raster scans, 0 text layer) | Pass 1 yields `< 50` chars + `imageOps >= 1` -> `page_type = 'scanned'`, routed to mocked Vision OCR -> `source = 'ocr'`, `ocr_confidence` populated, `note_search_documents` upgraded from `'empty'` to `'indexed'`. |
| 3 | **Mixed PDF** (15 pages: typed cover + typed chapters + 3 scanned embedded pages + 1 blank page) | Typed pages stay `'text_layer'` (0 OCR calls), 3 scanned pages invoke OCR (`source = 'ocr'`), blank separator page marked `'skipped'` (`0` chars, no wasted OCR). |
| 4 | **Nepali / Devanagari PDF** (1 Unicode Devanagari page + 1 mocked legacy Preeti/mojibake ASCII page) | Unicode UTF-8/NFC preserved intact without FTS corruption; legacy mojibake detector flags Preeti page for OCR fallback. |
| 5 | **Large PDF (120–220 pages)** (multi-page generated PDF, e.g. via `pdf-lib` / Playwright print) | Worker processes in checkpoints (`heartbeat_at`, `last_completed_page`), simulated mid-run worker abort at page 60 resumes cleanly at page 61 without re-OCRing pages 1..60, no `1,000,000`-char page loss before `document_pages`. |
| 6 | **Password-Protected & Corrupted PDFs** (1 encrypted PDF, 1 truncated/bad-header PDF, 1 PDF with 1 intentionally corrupted single page) | Encrypted -> `failed_terminal` (`PASSWORD_PROTECTED`, `attempts = 1`, no retries); Truncated -> `failed_terminal` (`CORRUPT_FILE`); Single bad page #3 out of 10 -> pages `1,2,4..10` succeed (`partial_success`), job does not crash. |
| 7 | **Duplicate Upload (`content_hash`)** (same PDF bytes uploaded twice under different `file_id`s) | Second upload matches `content_hash` -> `status = 'dedup_reused'`, clones `document_pages`, `0` OCR/embedding API calls made. |
| 8 | **Maths-Heavy PDF** (calculus/discrete math typed equations, Greek symbols, subscripts/fractions) | Trigger `math` heuristic (`latex_present = true`), verify LaTeX `$...$` / `$$...$$` preserved unstripped in `document_pages.text` and sanitized properly by web KaTeX delimiter test (`public/chatbot.js` helper). |
| 9 | **Diagrams / Figures PDF** (ER diagram / flowchart / circuit diagram via vector paths + embedded PNG) | `getOperatorList()` detects `paintImageXObject` or dense `constructPath`/`stroke` -> `page_type = 'figure'`, populates `figure_description`, makes diagram concepts queryable via FTS/vector. |
| 10 | **Tables PDF** (multi-column syllabus marks/comparison grid PDF) | Spatial `(x, y)` column alignment heuristic detects `page_type = 'table'`; table rows stay row-aligned / Markdown-structured instead of flat column-jumbled text. |
| 11 | **Handwritten Maths Page** (photo or scanned PDF of handwritten derivation) | `< 50` text chars -> `scanned` -> OCR mock returns equation in LaTeX -> stored with `latex_present = true` and readable `figure_description` / `[illegible]` handling. |

---

## 12. Open Questions for the Owner

1. **Schema Strategy (`extend` vs `new tables`):** `docs/KYANA_RAG_AUDIT.md` proposed storing `pages JSONB` inside `note_search_documents` and extending `knowledge_jobs`, whereas Phase D1 asks for `document_pages` + `ingestion_jobs`. Keeping `document_pages` as a real relational table is strongly cleaner for per-page retries, `page_type`, `figure_description`, and large 200+ page PDFs — should `ingestion_jobs` be a **new dedicated table** or should we **extend the existing `knowledge_jobs` table** (adding `content_hash`, `last_completed_page`, `heartbeat_at`, `stage`, and expanded statuses)?
2. **Vercel Plan & Worker Host:** Can you confirm whether production Vercel is **Hobby (10s limit)** or **Pro (60s limit)**, and approve **GitHub Actions (`*/15 * * * *` + optional `workflow_dispatch`)** running a Node worker script as our free background compute host? *(Note: also confirm whether the GitHub repo is public or within the 2,000 min/month free Actions quota.)*
3. **Scanned Page Limit & Cost Guardrail:** Earlier `KYANA_RAG_AUDIT.md` suggested a **30-page OCR cap** per document. For 200-page scanned textbooks/handwritten bundles, what max OCR pages/file (or soft quota) and which Gemini OCR model (`gemini-2.5-flash-lite` / `gemini-3.1-flash-lite-preview` / `gemini-3-flash-preview`) should be the default?
4. **Page Image Storage (`page_image_path`):** If we extract/render page snapshots for `figure` / `scanned` pages, should they live in a **new/existing Supabase Storage bucket** (e.g. `library_files/derived_pages/...` or a dedicated bucket) — or do we prefer sending split 1-page PDFs directly to Gemini for OCR/captioning and setting `page_image_path = NULL` for Phase D1 unless UI page-preview cards need PNGs?
5. **Upload Permissions Scope:** Today uploads are restricted to **teachers & admins only** (`server.js:3011, 3330`), while Risk #6 mentions **500 students uploading**. Are student uploads planned soon (e.g. pending-approval student notes), or only admin/teacher uploads in the near term?
6. **Expo & Web Math Rendering Timing:** `mobile/components/PostMarkdown.tsx` currently has zero LaTeX rendering, and `public/chatbot.js` skips KaTeX outside full-page mode (`chatbot.html`). Should Expo LaTeX support (`WebView`/KaTeX) be scoped right after D1/D2 alongside tutor responses, or deferred to UI polish?
7. **Live Neon Verification:** When you run D2 migrations manually against Neon, please confirm (`SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';`) whether `pgvector` and `20261110_kyana_note_vector_chunks.up.sql` are already applied in production.

