# KYANA AI STUDY BUDDY — PHASE 1 ARCHITECTURE AUDIT (READ-ONLY)

**Document Path:** `docs/STUDY_BUDDY_PHASE1_AUDIT.md`  
**Audit Date:** 2026-11-11  
**Workspace / Git Revision:** Branch `feature/kyana-rag-v2` at commit `55ae3b5` (matching `origin/main`)  
**Scope:** Semester Library Web (`public/`), Expo Mobile App (`mobile/`), Backend API (`server.js`, `db.js`, `lib/`, `routes/`), Migrations (`migrations/`), CI/Hosting (`.github/workflows/`, `vercel.json`), and Kyana AI  
**Out of Scope:** Games Platform Worker (untouched)  
**Confirmation:** **No code, config, database or deployment changes were made.**

> **Evidence Legend:** Every claim below is tagged:
> - `VERIFIED IN CODE (file:line)` — Directly inspected in repository files on disk.
> - `INFERRED` — Derived logically from verified code/config/platform facts.
> - `UNKNOWN` — Cannot be confirmed statically without live production Neon/Vercel access or running the app against production `.env` (prohibited by audit rules). Missing artifacts are marked `not found`.

---

## Executive Summary

Building a curriculum-driven Study Buddy (*"teach me chapter 2 of DSA"*) cannot rely on Kyana's current RAG path alone. While text extraction, RRF hybrid search, page-level BM25 passage extraction, and `gemini-embedding-001` (`768`-dim `vector(768)`) chunking code were recently landed up to commit `55ae3b5`, several structural blockers remain:

1. **Zero Canonical Topic Hierarchy or Topic IDs:** `syllabus-data.json` stores unit/topic outlines as raw formatted text (`contents`), `mobile/constants/subjects.config.ts` stores only unit titles + special folders (`PYQS`, `Books`, `General`) with zero topics, and `mobile/constants/syllabusPart1..4.ts` maintains a third, manually rewritten topic array with wording drift and no IDs (`VERIFIED IN CODE`).
2. **File Metadata Is Stringly-Typed and Unversioned:** `files` links to `semester`, `subject`, and `chapter` via nullable free-text strings; there is no `document_kind` (`note` vs `pyq` vs `book`), no `file_version`, and `PATCH`/`PUT /api/files/:id` mutates `subject`/`chapter`/`title` without re-indexing (`VERIFIED IN CODE`).
3. **Current Kyana Strips Tools & Drops Coverage on "Teach Me":** `routeQuery` maps `"teach me chapter 2 of DSA"` to `route.kind = 'direct'` (`isExplanation`), which causes `ai-assistant.js:677` to pass `tools: []` (disabling `get_syllabus`, `search_notes`, and `read_note_file`) while pre-retrieval calls `searchNotes` without resolving `"DSA"` -> `"Data Structure and Algorithms"`, leaving `"teach"` and `"chapter"` as required/rarest tokens and capping output at 2 files × 2,000 chars (`VERIFIED IN CODE`).
4. **No Background Queue Execution & No OCR:** `/api/internal/knowledge/worker` has **no scheduled cron caller** (`.github/workflows/knowledge-reconciliation.yml` calls only `/reconcile`, which enqueues jobs without draining `knowledge_jobs`), and scanned PDFs / image PYQs yield zero extracted text (`VERIFIED IN CODE`).
5. **Unauthenticated Endpoints & Cohort Access Leaks:** `POST /api/ai/chat` and `GET /api/library/files*` lack `requireLogin`, `lib/chat-ratelimit.js` is unused (`// Unlimited AI Chat`), and Path A `resourceFilter` omits `cohort_id` in SQL for notes/assignments before passing chunk text to the LLM (`VERIFIED IN CODE`).

---

## 1. Syllabus Data

### 1.1 Exact Structure of `syllabus-data.json` vs `subjects.config.ts` vs `syllabusPart*.ts`

| Source | Root Structure & Fields | Topic Granularity | Stable IDs |
| :--- | :--- | :--- | :--- |
| `syllabus-data.json` (identical to `public/syllabus-data.json` per `diff -q`) | `VERIFIED IN CODE (syllabus-data.json:1-40, 682-688)`: `{ semesters: [{ year, semester, courses: [{ title, code, credit, nature, objectives, description, contents, lab }] }], clusters: [{ name, courses[] }], programSummary: { years: 4, semesters: 8, totalCourses: 47, totalCredits: 138 } }` | **Topics inside raw multi-line text (`contents`)**: Unit headings (`1. Introduction   5hrs`) and indented topics (`1.1 ...`, `a. ...`, bullets `•`) are formatted prose with line-wrap hyphens (`pro-\ngramming`), not JSON arrays (`VERIFIED IN CODE (syllabus-data.json:150)`). | Course `code` (`CIT214`) for 45 core subjects; all electives share `"code": "ELE"` (`VERIFIED IN CODE (syllabus-data.json:518-555+)`). **Zero unit IDs or topic IDs (`not found`).** |
| `mobile/constants/subjects.config.ts` | `VERIFIED IN CODE (mobile/constants/subjects.config.ts:4-35)`: `SEMESTERS: SemesterItem[]` (`id`, `semester`, `label`, `shortLabel`, `year`, `subjects: SubjectItem[]` (`code`, `title`, `credit`, `chapters: ChapterItem[]` (`id`, `title`, `unitNumber`, `shortTitle`, `isSpecial`))). | **Unit titles only (`chapters[]`), zero topics.** Appends 3 virtual buckets per subject: `PYQS`, `Books`, `General` (`VERIFIED IN CODE (mobile/constants/subjects.config.ts:748-812)`). | String `chapters[].id` equals display title (e.g. `"Unit 2: Linked Lists"` or `"PYQS"`). **Zero topic IDs (`not found`).** |
| `mobile/constants/syllabusPart1..4.ts`, `syllabusElectives.ts`, `syllabusData.ts` | `VERIFIED IN CODE (mobile/constants/syllabusTypes.ts:1-80, mobile/constants/syllabusData.ts:1-84)`: Typed `SyllabusSemester[]` -> `SyllabusCourse` (`code`, `title`, `credit`, `creditDisplay`, `nature`, `totalHours`, `year`, `semester`, `objectives[]`, `description`, `outcomes[]`, `units: SyllabusUnit[]`, `labs[]`, `textbooks[]`, `references[]`). | `SyllabusUnit` has `{ unitNumber, title, hours, topics?: string[] }` (`VERIFIED IN CODE (mobile/constants/syllabusPart2.ts:502-540)`). Topics are numbered strings, often bundling multiple sub-concepts in one string (e.g. item `3.6`). | All 15 entries in `mobile/constants/syllabusElectives.ts` share `code: 'ELE'` (`VERIFIED IN CODE`). **Zero DB-backed topic IDs (`not found`).** |

### 1.2 Concrete Example: Data Structure and Algorithms (`CIT214`, Semester III)

- **`syllabus-data.json:144-151` (`VERIFIED IN CODE`):**
  ```text
  title: "Data Structure and Algorithms", code: "CIT214", credit: "3", nature: "TH + PR"
  contents (single multiline string):
  "1. Introduction  5hrs
     1.1 Overview of Data Structure and Algorithms, Object-Oriented Pro-
         gramming, Software Engineering,
     1.2 Abstract Data Types (ADT), Review of Array, Structure, Pointer.
     1.3 Algorithm Complexity(Time and Space Complexity), Asymptotic
         Notations, Time-Space Tradeoff
   2. Linked Lists  5hrs
     2.1 Linked List as an ADT
     2.2 Singly Linked Lists: Insertion, Deletion, Search
     2.3 Two Way Lists: Insertion, Deletion, Search
     2.4 Circular Linked List
   3. Stacks, Queue and Recursion  10hrs ... [3.1 to 3.6]
   4. Trees  7hrs ... [4.1 to 4.8]
   5. Sorting  6hrs ... [5.1 to 5.4]
   6. Searching and Hashing  4hrs ... [6.1 to 6.2]
   7. Graph  6hrs ... [7.1 to 7.4]
   8. Case Studies In Algorithms  2hrs ... [8.1]"
  ```
- **`mobile/constants/syllabusPart2.ts:485-536` (`VERIFIED IN CODE`):**
  ```ts
  { unitNumber: 2, title: 'Linked Lists', hours: '5 hrs', topics: [
    '2.1 Linked List as an ADT',
    '2.2 Singly Linked Lists: Insertion, Deletion, Search',
    '2.3 Doubly (Two-Way) Linked Lists: Insertion, Deletion, Search', // Reworded vs JSON
    '2.4 Circular Linked List',
  ]}
  ```
- **`mobile/constants/subjects.config.ts:746-812` (`VERIFIED IN CODE`):**
  - Lists 8 chapter objects (`"Unit 1: Introduction"` through `"Unit 8: Case Studies In Algorithms"`) plus `"PYQS"`, `"Books"`, `"General"`. Contains **0 topic entries**.

### 1.3 Where Used & Drift Risk

- **Web & Backend (`VERIFIED IN CODE`):**
  - `public/syllabus-helper.js:11-46`, `public/files.html:812,944`, `public/library.html:3690,4701,6577`, `public/syllabus.html:121`, `public/code-lab/subjects.html:3227`, and `public/code-lab/create.html:757` load `/syllabus-data.json` and parse `contents` on the fly with regex (`parseCourseUnits`). Note `diff -q` shows `files/syllabus-data.json` and `public/files/syllabus-data.json` **differ** from root/`public/syllabus-data.json` (`VERIFIED IN CODE`).
  - `lib/chat-tools.js:1` imports `public/syllabus-data.json`; `lib/teacher-service.js:364-445` imports root `syllabus-data.json` and **strictly seeds only the 45 core courses** (`Expected exactly 45 canonical courses`, excluding electives) into Postgres/SQLite table `subjects`.
- **Mobile (`VERIFIED IN CODE`):**
  - `mobile/app/syllabus.tsx:25` imports `mobile/constants/syllabusData.ts` (`syllabusPart1..4.ts` + `syllabusElectives.ts`).
  - `mobile/app/(tabs)/library.tsx:41` and `mobile/components/UploadNoteModal.tsx:29` import `mobile/constants/subjects.config.ts`.
- **Runtime DB Divergence (`VERIFIED IN CODE`):**
  - `POST /api/library/subjects/rename` (`server.js:4557-4600`) and `POST /api/library/chapters/create|rename|delete` (`server.js:4601-4880`) mutate DB tables (`subjects`, `library_custom_chapters`, `library_chapter_overrides`, `files`) without updating `syllabus-data.json` or mobile TS configs. Thus web, mobile UI, mobile syllabus viewer, backend Kyana `chat-tools.js`, and Postgres `files.chapter` can all drift independently (`VERIFIED IN CODE`).

### 1.4 Stable ID Summary

- **Subjects:** Core courses have `subjects.id` in DB (`teacher-service.js:197`) and course `code` (`CIT214`), but electives collide on `ELE`, subjects can be renamed in DB, and `files.subject` references free-text names rather than subject IDs (`VERIFIED IN CODE`).
- **Units / Chapters:** **Not found** as canonical DB keys (`subjects.config.ts` uses title strings as `id`, web uses `"Unit N: Title"` strings, DB stores `files.chapter` TEXT).
- **Topics:** **Not found** anywhere in DB, JSON, or backend (`VERIFIED IN CODE`).

---

## 2. Notes and Files

### 2.1 `files` Table Schema & Linking

- **Actual Database Columns (`VERIFIED IN CODE`):**
  - Base Postgres DDL (`db.js:528-540`) and SQLite DDL (`db.js:759-772`):
    `id`, `storedName`, `originalName`, `title`, `subject`, `chapter`, `semester`, `previewName`, `uploadedBy` (FK `students.studentId`), `sizeBytes`, `uploadedAt`.
  - Appended via runtime migrations: `sort_order` (`db.js:1126` / `teacher-service` indexes), plus `cohort_id`, `semester_no`, `audience_scope` (`lib/academic-context.js:102-120`).
  - Binary fallback table: `file_blobs(filename, mimeType, fileData, createdAt)` (`db.js:1321-1368`).
  - *Doc Discrepancy:* `docs/KYANA_3_NOTES_DESIGN.md:25-43` inaccurately documents snake_case columns (`original_name`, `stored_name`, `file_size`, `uploaded_by`, `uploader_role`, `approved`, `created_at`) that **do not exist** in `db.js`; `server.js:4949-4986` queries camelCase columns (`files.originalName`, `files.sizeBytes`, `files.uploadedAt`, `files.uploadedBy`) and joins `students.role AS uploaderRole` (`VERIFIED IN CODE`).
- **How Linked to Semester, Subject, and Chapter/Unit (`VERIFIED IN CODE`):**
  - `files.semester` (`TEXT`), `files.subject` (`TEXT`), and `files.chapter` (`TEXT`) are **all nullable free-text columns** with **no foreign keys** to `subjects` or any curriculum table (`db.js:532-535`).
  - `files.semester_no` (`INTEGER`) and `files.cohort_id` (`TEXT`) are populated server-side by `resolvePublishScope` (`lib/academic-context.js:1200-1285`).
  - **Teacher vs Admin upload rules (`VERIFIED IN CODE`):** All library upload endpoints restrict callers to `admin` or `teacher` (`server.js:3011-3018`). Teachers MUST pass `validateTeacherSubjectAuthorization` (`server.js:3031-3033, 3337-3339, 3399-3401`), making `subject` mandatory and deriving `semester` authoritatively from DB `subjects`; admins bypass teacher subject checks and can leave `chapter` generic (`General`) or custom.

### 2.2 Upload Paths, File Types, Storage & Server-Side Reading

- **Upload Endpoints (`VERIFIED IN CODE`):**
  1. Multipart upload `POST /api/files/upload` (`server.js:130-133, 2987-3271`): `multer` `diskStorage` writing to `UPLOAD_DIR` (`/tmp/uploads` on Vercel, else `./uploads`, `server.js:91`), multer cap `250 MB` (`server.js:132`), saves DB row + `saveFileBlob` + calls `indexUploadedNote` (`server.js:3141`). **Mobile (`mobile/services/library.ts:253-320`) uses only this path**, which hits Vercel's `4.5 MB` serverless body limit (`INFERRED`).
  2. Direct-to-Supabase `POST /api/files/authorize-upload` + `POST /api/files/record-upload` (`server.js:3325-3599`): used by web (`public/files.html`, `public/library.html`), verifies object in Supabase bucket `library_files` (`server.js:3456`), inserts `files` row, calls `indexUploadedNote` (`server.js:3510`).
- **Allowed Extensions (`VERIFIED IN CODE (server.js:3273-3287)`):**
  `ALLOWED_UPLOAD_EXTS`: `.pdf, .doc, .docx, .ppt, .pptx, .xls, .xlsx, .zip, .txt, .csv, .png, .jpg, .jpeg, .webp, .mp4, .c, .cpp, .py, .java` (`DANGEROUS_UPLOAD_EXTS` blocked).
- **Storage Location (`VERIFIED IN CODE`):**
  - Cloudflare R2: **Not found**.
  - Uses **Supabase Storage** (`library_files` bucket, `server.js:3456, 3807, 4081, 4234`, `lib/note-search.js:95`), Postgres **`file_blobs`** (`db.js:1321-1368`), and ephemeral/local **`UPLOAD_DIR`** (`server.js:91`).
- **Server-Side File Reading (`VERIFIED IN CODE (lib/note-search.js:124-165)`):**
  `readFileBytes(db, file)` enforces `MAX_FILE_BYTES = 20 MB`, then checks in order: (1) local `UPLOAD_DIR/storedName` -> (2) `db.getFileBlob(storedName)` -> (3) HTTPS `fetch` from `approvedStorageUrl` (`${SUPABASE_URL}/storage/v1/object/public/library_files/...` with `INDEX_TIMEOUT_MS = 20,000ms`).

### 2.3 Versioning, Official Flag, and Conflicting Notes

- **Versioning:** **Not found** on `files` (`VERIFIED IN CODE (db.js:528-540)`). `knowledge_chunks.file_version` exists in `migrations/20261110_kyana_note_vector_chunks.up.sql:12`, hardcoded `DEFAULT 1`; `knowledge_resources.content_hash` detects content changes (`lib/knowledge-builder.js`). **Bug:** `PATCH`/`PUT /api/files/:id` (`server.js:3960-4059`) updates `files.title`, `subject`, `chapter` in SQL **without** calling `indexUploadedNote` or `knowledgeSync.onNoteSaved` (`VERIFIED IN CODE`), leaving search/vector metadata stale after edits (whereas `DELETE /api/files/:id` at `server.js:3816` calls `onNoteDeleted`).
- **Official Flag:** **Not stored** on `files` (`VERIFIED IN CODE`). `GET /api/library/files` (`server.js:4986`) and file detail routes compute `isOfficial: f.uploaderRole === 'admin'` dynamically—meaning teacher uploads have `isOfficial: false`! (`knowledge_resources.source_authority_tier` exists `1..5`, but is not used to distinguish competing teacher notes.)
- **Conflicting Notes for the Same Unit:** No edition, primary-source flag, or teacher-preference ordering exists beyond `files.sort_order`, `uploadedBy`, and `uploadedAt` (`VERIFIED IN CODE`).

### 2.4 File Counts by Semester and Subject

- **`UNKNOWN`** in this read-only audit (production Neon queries are prohibited). See **Section 8, Query 1 & 2** for copy-paste read-only SQL.

---

## 3. PYQs (Previous Year Questions)

- **Storage Today (`VERIFIED IN CODE`):** **No dedicated `pyq` table, parser, question bank, or `document_kind` column exists.** PYQs are uploaded as normal rows in the `files` table (`VERIFIED IN CODE`).
- **How Identified (`VERIFIED IN CODE`):** Fragmented across clients:
  - **Mobile UI (`mobile/constants/subjects.config.ts:798-801`, `mobile/app/(tabs)/library.tsx:865`):** Every subject defines a special chapter `{ id: "PYQS", title: "Previous Year Questions (PYQs)", isSpecial: true }`. Selecting this in `UploadNoteModal.tsx` writes `files.chapter = 'PYQS'`. However, `mobile/components/SearchOverlay.tsx:90-95` (`id: 'pyq'`, `"Question Papers"`) searches using a naive literal `query: 'Question'`.
  - **Web UI (`public/library.html:6585-6615`):** The upload chapter selector exposes `General`, `Syllabus Units`, existing custom chapters, `Lab / Practical`, and `+ Custom Unit`—it **omits a standard `"PYQS"` bucket**. Thus web uploads put PYQs under `General`, ad-hoc custom chapters, or arbitrary unit names.
  - **Kyana Tools (`lib/chat-tools.js:191`):** `explicitNotesWord` only matches `\bpyqs?\b` to set `notesIntent`, searching `files` identically to regular lecture notes.
- **Format & Subjects Having PYQs:** **`UNKNOWN`** without querying production Neon/Supabase (allowed file types permit `.pdf`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.docx`; university question papers are commonly scanned PDFs or photos, which receive `extraction_status = 'empty'` or `'unsupported'` because zero OCR exists). See **Section 8, Query 3**.

---

## 4. Kyana Current Architecture

### 4.1 Entry Points, Request Flow, Providers, Tools & Prompts

- **HTTP Entry Points (`VERIFIED IN CODE (server.js:6775-6875)`):**
  - `POST /api/ai/chat` (`server.js:6776`, handler `lib/chat-http.js:5-135`) — **no `requireLogin` middleware**, explicit comment `// Unlimited AI Chat: Users can chat with Kyana without message caps or rate limits`.
  - `GET /api/ai/preview` (unauthenticated inbox preview), `GET /api/ai/resources/:type/:id/open` (`requireLogin`), `GET/POST/DELETE /api/ai/conversations*` (`requireLogin`), `GET /api/ai/suggestions`.
- **End-to-End Request Flow (`VERIFIED IN CODE (lib/chat-http.js:5-135, ai-assistant.js:261-712)`):**
  1. `createChatHandler` extracts `studentId` if logged in; loads up to `12` DB messages via `aiChatService.getMessages`; saves user message via `@vercel/functions` `waitUntil(...)`; opens SSE stream (`event: delta|result|error`, 15s keepalive heartbeat).
  2. `handleChat` resolves `academicContext = getAcademicContext(db, studentInfo)`, compacts history `> 12` turns (`slice(-8)` + up to 3 older topic snippets), executes deterministic `routeQuery(message, cleanHistory)` (`lib/chat-tools.js:175-222`), and checks an in-memory `WeakMap`/`Map` response cache only for unauthenticated/history-less non-knowledge general queries (`ai-assistant.js:325`).
  3. **Feature-Gated Branching (`isKnowledgeV3Enabled`, `lib/knowledge-schema.js:19-27` — requires BOTH `KYANA_KNOWLEDGE_V3 === 'true'` AND non-empty `KYANA_KNOWLEDGE_V3_USERS`, OFF by default):**
     - **Path A (V3 Knowledge Engine, `ai-assistant.js:372-601`):** Triggered if `v3Enabled && isKnowledgeQuery(...)`. Calls `searchKnowledge` (`lib/knowledge-search.js:15-186`) -> retrieves up to **6** chunks across `post, notice, assignment, note, routine, comment, gu_official` -> wraps in `<untrusted_campus_record>` blocks (`ai-assistant.js:473-489`) -> makes **one buffered LLM call** with `tools: []` and `onDelta: () => {}` (streaming text only after completion at line 571!) -> filters `resourceCards` via `<referenced_records>` + `revalidateCards`. If zero records found, falls back to ungrounded general-knowledge LLM response (`ai-assistant.js:431-448`).
     - **Path B (Default Today when `v3Enabled === false`, `ai-assistant.js:603-705`):**
       - Direct deterministic bypass (`directTool`, `ai-assistant.js:616-625`): `{syllabus: get_syllabus, routine: get_routine, notices: search_notices, posts: search_posts, assignments: search_assignments, web: web_search}` -> formatted via `styleLookupReply` with **0 LLM calls**. (Notice `search_notes` was removed from `directTool`!)
       - Non-direct path (`ai-assistant.js:627-688`): runs `noteSearch.searchNotes(db, { query: message, academicContext, limit: 3 })` whenever `!isSmalltalk && !isCode && !nonNoteRoutes.has(route.kind)`, injects up to **2** notes (`slice(0, 2)`) with extracted passages into `systemPrompt`, and calls `generateReply` with `tools: route.kind === 'direct' ? [] : TOOLS`.
- **AI Providers & Models (`VERIFIED IN CODE (lib/chat-provider.js:183-520)`):**
  - Priority chain (`defaultChain`): `['gemini', 'groq', 'openrouter', 'openai', 'deepseek']` (override via `CHAT_PROVIDER`), falls forward only if a provider fails before streaming visible text.
  - Gemini (`geminiTurn`, lines 236, 256-301): default `gemini-3-flash-preview` (env `GEMINI_MODEL` / `GEMINI_COMPLEX_MODEL`), per-turn candidate fallback `['gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview', 'gemini-flash-latest']` on `404|503|429`. `maxOutputTokens: complex ? 5000 : 3000`. `requestTimeout()` defaults to **`15,000 ms`**, clamped `[1000, 30000]` via `CHAT_TIMEOUT_MS` (`line 184`).
  - OpenAI-compatible fallbacks (`line 234-240`): DeepSeek `deepseek-chat`, Groq `llama-3.3-70b-versatile`, OpenAI `gpt-4o-mini`/`gpt-4o`, OpenRouter `google/gemini-3.1-flash-lite`/`google/gemini-3.1-pro-preview`.
  - Live Web Search (`geminiWebSearch`, lines 499-515): `gemini-3.1-flash-lite` + `googleSearch` tool.
  - Multi-turn Tool Loop (`chat-provider.js`): Max `2` rounds (`allowTools = round === 0`) and max `4` tool calls (`MAX_TOOL_CALLS = 4`).
- **Tools & Prompts (`VERIFIED IN CODE`):**
  - `TOOLS` (`lib/chat-tools.js:224-233`): `search_notes`, `read_note_file`, `get_syllabus`, `get_routine`, `search_posts`, `search_notices`, `search_assignments`, `web_search`.
  - Prompts: `SYSTEM_PROMPT` (`ai-assistant.js:182-193`), `PERSONALITY_PROMPT` / `toneInstructions` (`lib/chat-personality.js`), `knowledgePrompt` (`ai-assistant.js:491-509`).

### 4.2 How Kyana Currently "Searches Notes" & Root Cause of Failure on File Reading

Tracing both legacy symptoms and current code on `feature/kyana-rag-v2` reveals **5 concrete root causes (`VERIFIED IN CODE`)**:

1. **`"teach me chapter 2 of DSA"` strips all tools (`lib/chat-tools.js:208-215`, `ai-assistant.js:677`):** `routeQuery` matches `"teach"` against `isExplanation` -> assigns `route.kind = 'direct'`. In `ai-assistant.js:677`, `tools: route.kind === 'direct' ? [] : TOOLS` passes an **empty tool array** `[]`, so Kyana cannot call `get_syllabus`, `search_notes`, or `read_note_file` iteratively.
2. **Pre-retrieval drops subject resolution and requires `"teach"` / `"chapter"` tokens (`ai-assistant.js:635-640`, `lib/note-search.js:15-18, 544-553, 780-802`):** `ai-assistant.js:635` passes raw `message` (`"teach me chapter 2 of DSA"`) to `searchNotes` **without** `route.query` and **without** `subject: subjectAliases(route.filters.subject)`. `lib/note-search.js:15-18` `STOP_WORDS` does NOT stop `"teach"` or `"chapter"`, leaving tokens `['teach', 'chapter', '2', 'dsa']`. Because `filters.subjects` stays empty, `"DSA"` is never resolved to `"Data Structure and Algorithms"` and notes whose text does not literally say `"teach"` and `"dsa"` fail the rarest-term / `50%` coverage gate (`note-search.js:786-802`).
3. **Unextracted/Scanned Files Still Emit Cards Without Text (`ai-assistant.js:642-668`):**
   `const topNotes = (contentNotes.length > 0 ? contentNotes : matchingNotes).slice(0, 2);` pushes `noteEvidenceCards` even when `contentNotes.length === 0` (e.g., scanned PDFs or images whose title matched metadata), returning clickable file cards while injecting **zero file text** to the LLM.
4. **Hard Snippet Caps & Unwired Vector/V3 Pipeline (`lib/note-search.js:615, 807, 820`, `lib/chat-tools.js:341, 354`):**
   `searchNotes` returns max 3 files (`ai-assistant.js:643` keeps max 2), extracting at most 3 pages / **2,000 chars** (`extractRelevantPassage`) per file (`read_note_file` caps at 3,500 chars)—impossible to cover all topics across an entire multi-page chapter PDF. Moreover, `KYANA_NOTE_VECTOR_SEARCH` defaults to OFF (`not set` in `.env.example`/`vercel.json`), and Path A `searchKnowledge` requires `KYANA_KNOWLEDGE_V3` (also default OFF) + an active worker to populate `knowledge_chunks`.
5. **Tool Fallback Drops `academicContext` (`lib/chat-tools.js:338`):** When `search_notes` falls back to `predictSubjects(query)`, it calls `searchNotes(db, { query: '', semester: inferredSemester, subject: subjectAliases(inferredSubject) })` **without** passing `academicContext`.

### 4.3 Conversation & Session Storage

- **Tables (`VERIFIED IN CODE (lib/ai-chat-service.js:22-43)`):**
  - `ai_conversations(id, student_id, title, last_message, last_message_at, created_at, updated_at)`
  - `ai_messages(id, conversation_id, student_id, sender, text, metadata, created_at)` — `metadata` JSON stores `resourceCards`, `evidenceReferences`, `accessContext`. `getMessages` revalidates persisted `resourceCards` on read.
- **Retention & Context Window (`VERIFIED IN CODE`):** `ai-assistant.js:295-306` loads 12 messages and compacts `> 12` into last 8 messages + 3 older user topic snippets. **No TTL, archival, or DB pruning job exists** (`DELETE` runs only when a user clears/deletes a conversation, `lib/ai-chat-service.js:382-421`).

### 4.4 Web & Mobile UI Streaming and Request Latency

- **Web (`VERIFIED IN CODE (public/chatbot.js:357-395, 1564-1595)`):** Reads `POST /api/ai/chat` with `Accept: text/event-stream` via `fetch` + `ReadableStream` (`readChatResponse`), **`90,000 ms`** `AbortController` timeout.
- **Mobile (`VERIFIED IN CODE (mobile/services/kyana.ts:172-308, mobile/app/kyana.tsx:256-341)`):** Uses `XMLHttpRequest` `onprogress` incremental SSE parser (`stream: true`) with **`60,000 ms`** timeout, rendering `resourceCards` via `POST/GET /api/ai/resources/:type/:id/open`.
- **Typical Request Duration:**
  - **Code timeouts/measurements:** Neon pokhara-to-`us-east-1` sequential RTT documented as `900–950 ms` per query (`docs/KYANA_3_AUDIT.md:24`); `chat-provider.js` timeouts are `15,000 ms` per turn (`max 30,000 ms`); `note-search.js` vector embedding timeout is `2,000 ms`.
  - **Live production p50/p95 after commit `55ae3b5`:** **`UNKNOWN`** (not executed in this read-only audit; `/api/internal/knowledge/timings` stores only ephemeral per-instance memory arrays of last 50 requests). Note that Path A (`ai-assistant.js:517, 571`) buffers the full LLM reply (`onDelta: () => {}`) rather than streaming tokens, risking client/Vercel timeouts on long Study Buddy lessons (`VERIFIED IN CODE`).

### 4.5 Reconciliation vs `docs/KYANA_3_AUDIT.md`, `docs/KYANA_3_NOTES_DESIGN.md`, `docs/KYANA_RAG_AUDIT.md`, and `docs/KYANA_RAG_SPEC.md`

| Artifact / Doc Item | Status in Current Repo (`feature/kyana-rag-v2` @ `55ae3b5`) | Evidence |
| :--- | :--- | :--- |
| **`docs/KYANA_RAG_SPEC.md`** | **`not found`** in repository (`docs/KYANA_RAG_AUDIT.md:45` also noted it was absent). | `ls docs/` / workspace search |
| Unified `knowledge_resources`, `knowledge_chunks`, `knowledge_jobs`, `20261014` & `20261110` migrations (`KYANA_3_AUDIT.md`) | **Implemented on disk** (`lib/knowledge-*.js`, `migrations/20261014*`, `migrations/20261110*`). **Default OFF** via `KYANA_KNOWLEDGE_V3` + `KYANA_KNOWLEDGE_V3_USERS`. | `VERIFIED IN CODE (lib/knowledge-schema.js:19-27, migrations/)` |
| Page/heading-aware note chunking, RRF fusion, BM25 page ranking, vector search (`KYANA_3_NOTES_DESIGN.md` / `KYANA_RAG_AUDIT.md`) | **Implemented in code** (`buildNoteKnowledge` / `chunkNotePage` + `note-search.js` RRF + pgvector). Vector search in `note-search.js` **gated OFF by default** (`KYANA_NOTE_VECTOR_SEARCH`). `lib/knowledge-schema.js` **does not run `20261110` automatically**. | `VERIFIED IN CODE (lib/knowledge-builder.js, lib/note-search.js:615, lib/knowledge-sync.js:262-276)` |
| Scheduled worker draining `knowledge_jobs` (`KYANA_RAG_AUDIT.md:184-185`) | **Discrepancy / Partial:** Doc claims GitHub Actions invokes `/worker` & `/reconcile`. In code, `.github/workflows/knowledge-reconciliation.yml:32` calls **only** `/api/internal/knowledge/reconcile` (which enqueues jobs). **Nothing invokes `/api/internal/knowledge/worker`.** | `VERIFIED IN CODE (.github/workflows/knowledge-reconciliation.yml:32, routes/internal-knowledge.js:56-88, lib/knowledge-worker.js:378-402)` |
| Gemini Vision OCR (`<50 chars/page`, 30-page cap, `KYANA_RAG_AUDIT.md:17`) | **Paper only (`not found` in code).** Scanned PDFs still mark `extraction_status = 'empty'`. | `VERIFIED IN CODE (lib/note-search.js:259-262)` |
| Comment indexing & GU notices (`KYANA_3_AUDIT.md`) | **Implemented in code** (`lib/knowledge-builder.js`, `lib/university-sync.js`, `lib/knowledge-worker.js:337-377`). | `VERIFIED IN CODE` |
| Cohort fix in `lib/kyana-access.js` (`KYANA_RAG_AUDIT.md`) | **Fixed only in `note-search.js` (`buildAcademicContentFilter`), NOT in `resourceFilter` (`lib/kyana-access.js:57-63`).** | `VERIFIED IN CODE (lib/kyana-access.js:57-63, lib/note-search.js:531-536)` |

---

## 5. Text Extraction and Embeddings

- **Extraction Libraries (`VERIFIED IN CODE (package.json:30-42, lib/note-search.js:189-240)`):**
  - `pdfjs-dist` (`6.3.289`) — iterates up to `MAX_PDF_PAGES = 500`, joins pages with `\f` (`line 204`).
  - `node-pptx-parser` (`^1.0.1`) — checks expanded ZIP `<= 60 MB`, extracts up to `500` slides joined by `\f` (`lines 216-227`).
  - `mammoth` (`^1.12.1`) — extracts raw text via `mammoth.extractRawText` (**no `\f` page numbers**, `lines 228-231`).
  - Plain `.txt`, `.md`, `.csv` — UTF-8 decode (`lines 232-233`).
  - Hard limits (`lines 6-10`): `MAX_FILE_BYTES = 20 MB`, `MAX_TEXT_CHARS = 1,000,000`, `INDEX_TIMEOUT_MS = 20,000 ms`.
  - **Images & Scanned PDFs:** **Zero OCR (`not found`)**. Images mark `extraction_status = 'unsupported'`; scanned PDFs mark `extraction_status = 'empty'` (`lines 252-262`).
- **Existing Chunk & Embedding Tables (`VERIFIED IN CODE`):**
  1. `note_search_documents` (`lib/note-search.js:46-54`): 1 row per file (`id FK -> files.id`), `content`, `extraction_status`, `extraction_error`, `indexed_at`, `content_truncated`, Postgres generated `search_vector TSVECTOR('english', content)` + GIN index (or SQLite `note_search_fts` FTS5).
  2. `knowledge_resources` + `knowledge_chunks` + `knowledge_jobs` (`migrations/20261014_kyana_v3_knowledge.up.sql:21-109`): `knowledge_chunks` stores `content`, `page_number`, `embedding_model DEFAULT 'gemini-embedding-001'`, `embedding vector(768)`, HNSW index `idx_kc_vector` (`vector_cosine_ops`), generated `tsv_content` (`english` `'A'` + `simple` `'B'`) + GIN `idx_kc_tsv`.
  3. Extended chunk columns (`migrations/20261110_kyana_note_vector_chunks.up.sql:7-22`): `end_page_number`, `section_heading`, `content_hash`, `file_id`, `file_version`, `subject`, `chapter`, `semester`, `cohort_id`, `semester_no`, `audience_scope`. Note `lib/knowledge-schema.js` only auto-applies `20261014`, not `20261110` (`VERIFIED IN CODE`).
  4. Chunking logic (`lib/knowledge-builder.js:251-452`): `chunkNotePage` targets `1,500` chars (`MAX = 2,000`, `MIN = 150`, `OVERLAP = 200`), keeping detected section headings attached to their first paragraph and tracking `page_number..end_page_number` (`VERIFIED IN CODE`).
- **Is `pgvector` Enabled on Neon Today?**
  - `migrations/20261014_kyana_v3_knowledge.up.sql:9` contains `CREATE EXTENSION IF NOT EXISTS vector;` and `docs/KYANA_3_AUDIT.md:19` noted `vector` (`0.8.6`) was in `pg_available_extensions` on Oct 14, **but whether `vector`, `20261014`, and `20261110` are currently applied on production Neon is `UNKNOWN`** without running a live DB check. See **Section 8, Query 4–6**.
- **Embedding Provider (`VERIFIED IN CODE (lib/knowledge-embeddings.js:5-235, lib/knowledge-sync.js:128-165)`):**
  - Provider: Google Gemini **`gemini-embedding-001`** (`EMBEDDING_MODEL`), **`768`** dimensions (`EMBEDDING_DIM`).
  - Batching & Caching: `batchEmbedTexts` chunks up to `MAX_BATCH_SIZE = 100`, `DEFAULT_TIMEOUT_MS = 3,000 ms`, up to 2 retries; `persistKnowledgeResource` reuses existing vectors via SHA-256 `content_hash`. Offline tests use `generateDeterministicVector`.

---

## 6. Database and Infra

- **Users (`students`), Program, Semester & Role (`VERIFIED IN CODE (db.js:498-519 PG, 727-748 SQLite, lib/academic-context.js:93, 246-413)`):**
  - `students` columns: `studentId`, `name`, `passwordHash`, `email`, `supabase_uid`, `username`, `gender`, `avatarUrl`, `coverUrl`, `coverPosition`, `bio`, `department DEFAULT 'BIT'`, `semester DEFAULT 'Semester 1'`, `githubUrl`, `linkedinUrl`, `role DEFAULT 'student'` (`student` | `cr` | `teacher` | `admin`), `verification_status`, `account_status`, `cohort_id` (FK `cohorts(id)`).
  - **Program (`BIT`):** No `program` column or `programs` table (`not found`); BIT is hardcoded in `department DEFAULT 'BIT'` and `syllabus-data.json`.
  - **Semester resolution (`getAcademicContext`, `lib/academic-context.js:246-413`):**
    - `student` / `cr`: Joins `students.cohort_id` -> `cohorts.current_semester` (`1–8`) as the authoritative semester, falling back to `parseSemesterNumber(student.semester)` only if unassigned (`academicStatus: 'unassigned'`).
    - `teacher` / `admin`: Receive all `cohorts`, `canViewAllCohorts: true`; teachers additionally resolve `assignedSubjects` and `assignedSemesters` from `teacher_subjects JOIN subjects` (`lines 326-353`).
- **Neon Access Pattern (`VERIFIED IN CODE (db.js:46-95, 1310-1315)`):**
  - Runtime queries use `@neondatabase/serverless` WebSocket `Pool` (`PG_POOL_MAX = 10`, `idleTimeoutMillis = 30000`, `connectionTimeoutMillis = 10000`) and rewrite `*.neon.tech` hosts to `-pooler` (`ensureNeonPoolerUrl`).
  - Schema initialization / `scripts/migrate-schema.js` (`npm run migrate`) uses `ensureNeonDirectUrl` (unpooled `DIRECT_URL` / stripped `-pooler`) during `db.initSchema()`.
- **Migration System (`VERIFIED IN CODE`):**
  - **Split-brain migration setup:** `db.initSchema()` (`db.js:1295-1303`) programmatically invokes idempotent `ensure*Schema` initializers (`routine`, `push`, `notifications`, `academicCohort`, `games`, `teacher`, `attendance`, `marks`, `003-perf-audit-indexes`). By contrast, timestamped SQL files (`20261014*`, `20261110*`, etc.) in `migrations/` are **not** tracked by a migration runner or called by `scripts/migrate-schema.js`. `lib/knowledge-schema.js` executes only `20261014` dynamically if V3 is enabled, silently falling back in `lib/knowledge-sync.js:275` if `20261110` columns are absent!
- **Hosting, Timeouts, Size Limits, Crons & Job Queue (`VERIFIED IN CODE` + `INFERRED`):**
  - `vercel.json:3, 42-57` routes all requests `/(.*)` to `/api/index.js` (`server.js`) in region `iad1`. Neither `vercel.json` nor `api/index.js` sets `maxDuration`.
  - **Vercel Plan Constraints:** Exact billing plan cannot be verified statically from repo files (`UNKNOWN`, though `docs/KYANA_RAG_AUDIT.md:194` and the presence of only 2 once-daily crons in `vercel.json:48-57` — `/api/internal/push/process` and `/api/internal/posts/cleanup-staging` — strongly indicate **Vercel Hobby tier**: **`10s` serverless function execution limit**, **`4.5 MB` request body limit**, and max **2 daily cron jobs**, `INFERRED`).
  - **Background Cron & Job Queue:**
    - Table `knowledge_jobs` (`migrations/20261014:88-109`) + `processPendingJobs` (`lib/knowledge-worker.js:27-275`, `FOR UPDATE SKIP LOCKED`) exist in code.
    - **Critical Gap:** `.github/workflows/knowledge-reconciliation.yml:32` calls `/api/internal/knowledge/reconcile` every 15 minutes (`curl --max-time 30`), which only enqueues missing/stale jobs (`reconcileKnowledge`), while **no Vercel cron or GitHub Actions workflow invokes `/api/internal/knowledge/worker`** (`VERIFIED IN CODE`).
- **Rate Limiting & AI Cost Controls (`VERIFIED IN CODE`):**
  - `lib/chat-ratelimit.js:1-80` defines `createHourlyRateLimiter` (`HOURLY_LIMIT = 100`, in-memory `Map` per instance), **but has 0 callers in `server.js`**.
  - `server.js:6775-6776` explicitly disables rate limiting on `/api/ai/chat` (`// Unlimited AI Chat: Users can chat with Kyana without message caps or rate limits`). Only `/api/code-lab/*`, auth, DM, and legacy group chat (`chatRateLimiter`) are rate-limited (`server.js:411-1013, 5549`).
  - **AI Cost Controls:** Only message length (`8,000` chars), history compaction (`12` -> `8`), `maxOutputTokens` (`3000/5000`), `MAX_TOOL_CALLS = 4`, and provider timeout (`15s–30s`) exist. **Zero per-user token/request quotas, cost ceilings, or abuse throttles exist (`not found`).**

---

## 7. Access Control

### 7.1 How Permissions Are Enforced Today

- **Files & Assignments & Posts REST APIs (`VERIFIED IN CODE`):**
  - Single-item read/view/download (`GET /api/files/:id`, `/api/files/:id/view`, `/api/files/:id/download` at `server.js:3600-4234`, plus `routes/posts.js:1308,1411` and `routes/code-lab/assignments.js:9`): call `assertContentAccess(context, record)` (`lib/academic-context.js:1109-1194`). Students/CRs must match `cohort_id` (when `audience === 'cohort'`) AND `semester_no` (`currentSemester`). Teachers pass if `entitySem` is in `assignedSemesters` (or null). Admins pass unconditionally.
  - List queries (`GET /api/files`, `routes/posts.js:570`, `lib/note-search.js:531-536, 856-861`): apply `buildAcademicContentFilter(context, ...)` (`lib/academic-context.js:1294-1367`). Students filter to `(cohort_id = ? OR cohort_id IS NULL) AND (semester_no = ? OR semester_no IS NULL)` plus `audience_scope = 'all_students'` within their semester.

### 7.2 Existing Access Control Gaps (Must Fix Before Study Buddy)

1. **Unauthenticated Endpoints Expose `all_students` & Unlimited AI (`VERIFIED IN CODE`):**
   - `POST /api/ai/chat` (`server.js:6776`), `GET /api/library/files`, `/api/library/stats`, `/api/library/subjects`, and `/api/library/subjects/:subject/chapters` (`server.js:4495, 4515, 4539, 4919`) have **no `requireLogin`**. Because `buildAcademicContentFilter` for unauthenticated callers outputs `audience_scope = 'all_students'` without a semester filter (`lib/academic-context.js:1302-1304`), guests can query `all_students` files across all semesters.
2. **Cohort Leak in Path A `resourceFilter` Before LLM (`VERIFIED IN CODE (lib/kyana-access.js:57-63, lib/knowledge-search.js:82, 118, ai-assistant.js:473-551)`):**
   - `resourceFilter('note', 'f')` and `resourceFilter('assignment', 'a')` filter SQL **only by `semester_no`/`semester`/`audience_scope` and OMIT `cohort_id`**. Even though `revalidateCards -> readResource -> canReadResource` checks `cohort` afterward (`ai-assistant.js:550-551`), chunk text from another cohort in the same semester is already sent into the LLM prompt (and causes `'Source permissions changed'` error at line 551!).
3. **Inferred-Subject Note Search Drops `academicContext` (`VERIFIED IN CODE (lib/chat-tools.js:338)`):**
   - When `search_notes` predicts a subject via `predictSubjects`, line 338 calls `searchNotes(db, { query: '', semester: inferredSemester, subject: ... })` without `academicContext`, bypassing cohort isolation for that query.
4. **Teacher List Query Permissiveness (`VERIFIED IN CODE (lib/academic-context.js:1317-1324)`):**
   - `buildAcademicContentFilter` returns `1=1` for `teacher` (unless `requestedSemester` is explicitly provided), differing from `assertContentAccess` (`lines 1133-1140`), which restricts teachers to `assignedSemesters`.

### 7.3 Where Enforcement Applies for Study Buddy

All Study Buddy retrieval (syllabus unit resolution, note chunks, PYQs, generated lesson plans, and active session resume) must:
1. Require authenticated identity (`requireLogin`) on Study Buddy endpoints (`cohort_id` + `current_semester` resolved server-side via `getAcademicContext`).
2. Enforce `buildAcademicContentFilter` **in SQL before any chunk text, PYQ, or lesson step reaches the LLM**, never relying solely on post-generation `revalidateCards`.
3. Replace `lib/kyana-access.js:resourceFilter` note/assignment branch with cohort-aware filtering (`cohort_id` + `semester_no`), and pass `academicContext` on every `searchNotes` call.

---

## 8. Safe Read-Only Neon Diagnostic SQL Queries

Run these read-only queries manually in the Neon SQL console to resolve the `UNKNOWN` production state:

```sql
-- 1. Count of files grouped by semester, semester_no, and subject (with null/empty check)
SELECT
  COALESCE(semester_no::text, '(null)') AS semester_no,
  COALESCE(NULLIF(TRIM(semester), ''), '(empty)') AS semester_text,
  COALESCE(NULLIF(TRIM(subject), ''), '(uncategorized)') AS subject,
  COUNT(*) AS file_count,
  ROUND(SUM("sizeBytes") / (1024.0 * 1024.0), 2) AS total_mb
FROM files
GROUP BY 1, 2, 3
ORDER BY semester_no, file_count DESC;

-- 2. Note extraction status & file extension breakdown (identifies scanned PDFs / images)
SELECT
  LOWER(SUBSTRING("originalName" FROM '\.[^.]+$')) AS ext,
  COALESCE(d.extraction_status, 'not_indexed') AS extraction_status,
  COUNT(*) AS count
FROM files f
LEFT JOIN note_search_documents d ON d.id = f.id
GROUP BY 1, 2
ORDER BY count DESC;

-- 3. Inspect candidate PYQ files (chapter naming, filenames, formats)
SELECT
  COALESCE(semester_no::text, semester) AS sem,
  subject,
  chapter,
  LOWER(SUBSTRING("originalName" FROM '\.[^.]+$')) AS ext,
  COUNT(*) AS count
FROM files
WHERE chapter ILIKE '%pyq%'
   OR title ILIKE '%pyq%'
   OR title ILIKE '%question%'
   OR "originalName" ILIKE '%pyq%'
   OR "originalName" ILIKE '%question%'
GROUP BY 1, 2, 3, 4
ORDER BY count DESC;

-- 4. Verify pgvector extension and V3 knowledge tables/columns on Neon
SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('knowledge_resources', 'knowledge_chunks', 'knowledge_jobs', 'note_search_documents');

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'knowledge_chunks'
  AND column_name IN ('end_page_number', 'section_heading', 'file_id', 'file_version', 'cohort_id', 'semester_no');

-- 5. Knowledge index & job queue backlog (only if tables above exist)
SELECT resource_type, COUNT(*) AS resources FROM knowledge_resources WHERE deleted_at IS NULL GROUP BY 1;
SELECT status, operation, COUNT(*) FROM knowledge_jobs GROUP BY 1, 2;
```

---

## 9. Gap List (What Study Buddy Needs vs What Exists)

| Capability Needed | Current Status in Code | Gap to Build |
| :--- | :--- | :--- |
| **Canonical Curriculum Graph (Subject -> Unit -> Ordered Topics with IDs)** | `syllabus-data.json` prose vs drifted `syllabusPart*.ts` vs topic-less `subjects.config.ts`; zero topic IDs; electives collide on `ELE`. | Normalized curriculum tables (`curriculum_subjects`, `curriculum_units`, `curriculum_topics`) seeded from a single reconciled source with stable IDs and atomic teachable topic granularity. |
| **Clean Note Metadata & Versioning** | Nullable free-text `files.subject`/`chapter`; `isOfficial` only `admin`; no version column; `PATCH` doesn't re-index. | Add `document_kind`, `subject_id`/`unit_id` mapping (backfilled from free text), `content_version`/`checksum`, teacher-primary conflict policy, and re-index on `PATCH`. |
| **Structured PYQ Corpus** | Ordinary rows in `files`, identified only on mobile if placed in `chapter='PYQS'`; missing web upload option; no question-level parsing. | Dedicated PYQ upload path/classification across web & mobile + question-level extraction (`pyq_questions`) linked to `unit_id` & `topic_id`. |
| **Chunk-to-Topic Coverage Mapping** | `knowledge_chunks` has page/heading chunks (`1500` chars) with no topic links (`not found`). | Explicit `note_chunk_topics` mapping every chunk (with `page_number` citation & confidence) to syllabus `topic_id`s, flagging syllabus gaps where notes lack a topic. |
| **OCR for Scanned PDFs & Image Notes/PYQs** | Marked `empty`/`unsupported`; zero OCR in code (`VERIFIED IN CODE`). | Out-of-band OCR pipeline (e.g., Gemini Vision in GitHub Actions / background worker, never inside 10s Vercel request) with per-page storage before chunking. |
| **Deterministic Lesson Plan & Multi-Turn Teaching State** | Stateless 1-shot Q&A; `"teach me"` hits `route.kind = 'direct'` (`tools: []`), capped at 2 notes × 2k chars; history compacted after 12 turns. | `study_lesson_plans` (pre-computed ordered topic checklist + citations + PYQs per unit) & `study_buddy_sessions` (durable DB step cursor, mastery check-ins, active topic state surviving 12-turn chat compaction). |
| **Async Indexing Worker Execution** | `knowledge_jobs` exists, `/worker` endpoint exists, but zero crons execute `/worker`. | Background worker execution outside Vercel 10s limit (GitHub Actions / external queue / dedicated worker trigger) with idempotent per-page/stage checkpoints. |
| **Auth, Cohort Isolation & AI Cost Guardrails** | `/api/ai/chat` open without `requireLogin` & uncapped; `resourceFilter` omits `cohort_id`. | Mandatory auth on Study Buddy, pre-LLM SQL cohort+semester enforcement across chunks/PYQs/sessions, and active per-student rate/token budgets. |

---

## 10. Risks and Blockers

1. **Vercel Execution & Payload Ceilings (Blocker):** Under inferred Hobby limits (`10s` function timeout, `4.5 MB` payload, 2 daily crons), **PDF OCR, multi-page PYQ extraction, batch embedding backfill, and multi-LLM-call lesson planning cannot run synchronously inside Vercel API routes.** Mobile multipart uploads `> 4.5 MB` to `/api/files/upload` also fail on Vercel (`mobile/services/library.ts`). *(Even on Vercel Pro, Gemini + Neon multi-step orchestration risks latency spikes given ~900ms Pokhara–Neon RTT noted in `docs/KYANA_3_AUDIT.md:24`.)*
2. **Client SSE Timeouts vs Long Explanations (Risk):** Web (`90s`, `chatbot.js:1567`) and Mobile (`60s`, `kyana.ts:292`) abort requests if streaming stalls, and Path A (`ai-assistant.js:517`) buffers the entire reply before sending any delta. Multi-topic teaching MUST teach **1 topic per turn** with true token streaming and pre-built `study_lesson_plans` to stay under timeout budgets.
3. **Scanned PDFs & Handwritten/Image PYQs (Blocker):** Because university notes and especially PYQs are frequently image-based PDFs or `.jpg`/`.png` uploads, Study Buddy will silently skip or fail on them until OCR exists (only text-selectable PDFs, PPTX, DOCX work today, and DOCX lacks page numbers!).
4. **Missing Topic IDs & Bundled Syllabus Items (Risk):** Topics like `3.6 Recursion, Recursion vs. Iteration, Tail vs. Non-tail Recursion...` pack 5+ concepts into one string (`syllabusPart2.ts:534`), and wording differs between `syllabus-data.json` and `syllabusPart*.ts`. Without a canonical topic ID list, progress tracking across turns cannot stay consistent.
5. **Inconsistent `files` Metadata & Unindexed Edits (Risk):** Free-text `subject`/`chapter` variations (e.g., `"DSA"` vs `"Data Structure and Algorithms"`, `"Unit 2"` vs `"Chapter 2: Linked List"` vs `"General"`) cause unit filtering to miss teacher notes; `PATCH /api/files/:id` does not re-index.
6. **Uncapped / Unauthenticated AI Cost Exposure (Risk):** With `POST /api/ai/chat` unauthenticated and `lib/chat-ratelimit.js` unmounted, adding heavier Study Buddy prompts/embeddings increases Gemini API spend unless gated by auth and per-student quotas.
7. **Unverified Production DB State (`UNKNOWN` Blocker):** Neither `pgvector` activation nor `20261014`/`20261110` schema presence nor current `extraction_status` distribution on production Neon is confirmed.

---

## 11. Questions for Product / Engineering Lead (with Recommended Defaults)

1. **What Vercel plan (Hobby vs Pro) is the production deployment running on, and can GitHub Actions or an external worker handle background OCR/indexing jobs?**  
   *Recommended default:* Treat Vercel API routes as strict `< 10s` stateless orchestration; run PDF extraction, OCR, chunk-to-topic mapping, and PYQ parsing asynchronously via GitHub Actions / background worker (`scripts/document-worker.js` or dedicated worker runner).
2. **Which syllabus source should become the single canonical curriculum authority for seeding `curriculum_subjects` / `curriculum_units` / `curriculum_topics`?**  
   *Recommended default:* Use `mobile/constants/syllabusPart1..4.ts` + `syllabusElectives.ts` (already pre-structured into `units` and `topics`, reconciled once against `syllabus-data.json` corrections and assigned unique elective codes instead of duplicate `'ELE'`), then deprecate regex runtime parsing (`public/syllabus-helper.js`) in favor of reading from the DB/generated JSON.
3. **Should Study Buddy be restricted to logged-in users (`requireLogin`), and are Kyana AI requests ready to enforce per-student daily/hourly quotas (`lib/chat-ratelimit.js` / DB quota)?**  
   *Recommended default:* Yes—require `requireLogin` on all Study Buddy endpoints (preserving cohort/semester isolation) and enforce a generous per-student quota (e.g., 50–100 AI turns/day or 20/hour).
4. **How should Study Buddy resolve competing notes for the same unit (e.g., Admin official PDF vs Cohort Teacher A slides vs Teacher B notes vs `"General"` multi-unit PDFs)?**  
   *Recommended default:* Prioritize Cohort-matching Teacher notes > Admin (`isOfficial`) notes > Cross-cohort `all_students` notes; cite the primary note used and let teachers/admins flag one canonical/preferred file per unit later.
5. **Should scanned PDFs and image uploads (notes & PYQs) be OCR'd using Gemini Vision in the background worker, and what page limit should apply?**  
   *Recommended default:* Yes—use Gemini Vision OCR in the async worker strictly when extracted text `< 50` chars/page (and for `.png/.jpg/.jpeg/.webp` files marked as notes/PYQs), capped at 40 pages per document initially.
6. **For DOCX files (which have no native page breaks in `mammoth`), how should citations be formatted instead of failing?**  
   *Recommended default:* Cite `[File Title — Section/Heading N]` (or `[Slide N]` for PPTX, `[Page N]` for PDF), never inventing fake page numbers.
7. **How should PYQs be uploaded and classified going forward, and should Study Buddy show unsolved PYQs as practice questions per topic rather than inventing answers?**  
   *Recommended default:* Add a unified `"PYQS"` chapter/kind option to Web upload (`public/library.html`) matching Mobile (`PYQS`), backfill existing files matching `chapter = 'PYQS'` or `%pyq%`/`%question%` via reviewable classification, and attach matched PYQs at the end of each topic lesson as practice prompts (solving only if the student attempts/asks).
8. **Should `teaching sessions` appear inside the normal Kyana chat thread (`ai_conversations`) or in a dedicated Study Mode tab/banner showing unit progress (`Topic 2 of 6`)?**  
   *Recommended default:* Persist a `study_buddy_sessions` record linked optionally via `conversation_id` so the student can converse seamlessly in Kyana chat while mobile/web can render an optional compact Unit Progress header/checklist.

---

## 12. Proposed Schema Sketch (Tables and Columns Only — No Migrations)

Following the existing **"extend, don't duplicate"** principle (`knowledge_chunks` already has `vector(768)` + HNSW + `page_number`), below is the normalized table-and-column sketch for Study Buddy:

### Prerequisites: Canonical Curriculum Tables
*(Required so `note_chunk_topics`, `pyq_questions`, `study_lesson_plans`, and `study_buddy_sessions` reference immutable IDs rather than mutable display strings.)*

- **`curriculum_subjects`**: `id` (PK), `code` (unique normalized code, replacing duplicate `'ELE'`), `title`, `semester_no`, `credit_hours`, `is_elective`, `cluster_name`, `syllabus_version`, `created_at`, `updated_at`.
- **`curriculum_units`**: `id` (PK), `subject_id` (FK -> `curriculum_subjects.id`), `unit_number`, `title`, `hours`, `sort_order`, `created_at`.
- **`curriculum_topics`**: `id` (PK), `unit_id` (FK -> `curriculum_units.id`), `topic_code` (e.g. `2.3`), `title`, `keywords_json`, `display_order`, `is_active`, `created_at`.

### 1. Note Chunks (`knowledge_chunks` — Extend Existing Table)
Already exists (`20261014` + `20261110`) with: `id`, `resource_id`, `chunk_index`, `content`, `page_number`, `end_page_number`, `section_heading`, `content_hash`, `embedding_model`, `embedding`, `tsv_content`, `file_id`, `file_version`, `subject`, `chapter`, `semester`, `cohort_id`, `semester_no`, `audience_scope`, `created_at`.
- **Add / Extend Columns on `files` & `knowledge_chunks`:**
  - On `files`: `document_kind` (`'note' | 'pyq' | 'book' | 'lab' | 'syllabus'`), `subject_id` (nullable FK -> `curriculum_subjects.id`), `unit_id` (nullable FK -> `curriculum_units.id`), `file_version` (INT), `content_checksum`, `is_primary_source` (BOOLEAN).
  - On `knowledge_chunks`: `document_kind`, `subject_id`, `unit_id`, `page_label` (e.g., `'Page 5'`, `'Slide 3'`, `'Section 2.1'`), `token_count`, `extraction_method` (`'pdf_text' | 'ocr_vision' | 'pptx' | 'docx' | 'plain'`).

### 2. Chunk-to-Topic Mapping (`note_chunk_topics`)
- **`note_chunk_topics`**:
  - `id` (PK)
  - `chunk_id` (FK -> `knowledge_chunks.id`)
  - `file_id` (FK -> `files.id`)
  - `topic_id` (FK -> `curriculum_topics.id`)
  - `unit_id` (FK -> `curriculum_units.id`)
  - `page_number` (INT, nullable for DOCX)
  - `coverage_role` (`'primary' | 'supporting' | 'example' | 'definition'`)
  - `confidence` (REAL `0.0–1.0`)
  - `mapping_source` (`'auto_llm' | 'auto_embedding' | 'heading_rule' | 'staff_verified'`)
  - `verified_by` (nullable FK -> `students.studentId`)
  - `verified_at` (TIMESTAMPTZ)
  - `created_at` (TIMESTAMPTZ)

### 3. PYQ Questions (`pyq_questions`)
- **`pyq_questions`**:
  - `id` (PK)
  - `source_file_id` (nullable FK -> `files.id`)
  - `source_page_number` (INT)
  - `subject_id` (FK -> `curriculum_subjects.id`)
  - `unit_id` (nullable FK -> `curriculum_units.id`)
  - `topic_id` (nullable FK -> `curriculum_topics.id`)
  - `semester_no` (INT `1–8`)
  - `exam_year_bs` (TEXT, e.g. `'2081'`)
  - `exam_year_ad` (INT)
  - `exam_type` (`'board' | 'midterm' | 'model' | 'makeup' | 'unknown'`)
  - `question_number` (TEXT, e.g. `'Q3(b)'`)
  - `question_text` (TEXT)
  - `marks` (REAL)
  - `has_diagram` (BOOLEAN)
  - `extraction_method` (`'pdf_text' | 'ocr_vision' | 'manual'`)
  - `extraction_confidence` (REAL)
  - `verification_status` (`'pending' | 'verified' | 'rejected'`)
  - `verified_by` (nullable FK -> `students.studentId`)
  - `content_hash` (TEXT)
  - `cohort_id` (nullable FK -> `cohorts.id`)
  - `audience_scope` (`'cohort' | 'all_students'`)
  - `created_at`, `updated_at`

### 4. Lesson Plans (`study_lesson_plans`)
- **`study_lesson_plans`**:
  - `id` (PK)
  - `subject_id` (FK -> `curriculum_subjects.id`)
  - `unit_id` (FK -> `curriculum_units.id`)
  - `cohort_id` (nullable FK -> `cohorts.id`, null = shared across cohorts of same semester)
  - `semester_no` (INT `1–8`)
  - `syllabus_version` (TEXT)
  - `source_manifest_hash` (TEXT — hash of included `files.id` + `file_version` + verified PYQs so edits invalidate stale plans)
  - `ordered_steps_json` (JSONB array: `[{ step_index, topic_id, topic_code, topic_title, teaching_notes_summary, source_citations: [{ file_id, file_title, page_start, page_end, chunk_ids }], pyq_ids: [], coverage_status: 'covered' | 'partial' | 'missing_in_notes' }]`)
  - `missing_topic_ids_json` (JSONB array — explicit syllabus topics with no uploaded note coverage)
  - `status` (`'draft' | 'active' | 'stale'`)
  - `generated_by_model` (TEXT)
  - `created_at`, `updated_at`

### 5. Per-Student Teaching Sessions (`study_buddy_sessions`)
- **`study_buddy_sessions`**:
  - `id` (PK)
  - `student_id` (FK -> `students.studentId`)
  - `conversation_id` (nullable FK -> `ai_conversations.id`)
  - `cohort_id` (nullable FK -> `cohorts.id`)
  - `semester_no` (INT `1–8`)
  - `subject_id` (FK -> `curriculum_subjects.id`)
  - `unit_id` (FK -> `curriculum_units.id`)
  - `lesson_plan_id` (FK -> `study_lesson_plans.id`)
  - `current_step_index` (INT, 0-based cursor in `ordered_steps_json`)
  - `current_topic_id` (nullable FK -> `curriculum_topics.id`)
  - `topic_progress_json` (JSONB map: `{ [topic_id]: { status: 'pending' | 'in_progress' | 'explained' | 'quizzed' | 'mastered' | 'skipped_no_note', cited_pages: [], pyq_attempted_ids: [], check_score } }`)
  - `mode` (`'guided' | 'revision' | 'pyq_drill'`)
  - `session_status` (`'active' | 'paused' | 'completed' | 'abandoned'`)
  - `last_cited_file_id` (nullable FK -> `files.id`)
  - `last_cited_page` (INT)
  - `started_at`, `last_active_at`, `completed_at`, `updated_at`

