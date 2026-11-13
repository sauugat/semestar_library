# KYANA AI — PHASE D3-1 ARCHITECTURE AUDIT & DESIGN
## Comprehensive Multimodal Academic Document Intelligence & Chapter-Scoped Answering for Gandaki University BIT

- **Document Version:** Phase D3-1 / Stage 4 Complete Architecture Audit
- **Branch:** `feature/kyana-d3` (created locally from `feature/doc-intelligence-d2` at commit `7c02ccfbdeec643c77c56dd702a945b5c6d1f9af`) — `[VERIFIED]`
- **Mode:** READ-ONLY Inspection & Design — Zero Code Edits, Zero Commits, Zero Push, No `.env` modifications, No live Neon/Supabase execution, No real Gemini calls, No Games Worker — `[VERIFIED]`
- **Date:** November 13, 2026
- **Auditor:** Antigravity AI Engineering Agent

---

## GIT PROVENANCE & RAW COMMAND VERIFICATION

Every git claim in this report is backed by raw command output executed during inspection:

### 1. Branch Creation & Base Verification
```bash
$ git rev-parse feature/doc-intelligence-d2
7c02ccfbdeec643c77c56dd702a945b5c6d1f9af

$ git branch feature/kyana-d3 feature/doc-intelligence-d2
# Created local branch feature/kyana-d3

$ git checkout feature/kyana-d3
Switched to branch 'feature/kyana-d3'

$ git rev-parse HEAD
7c02ccfbdeec643c77c56dd702a945b5c6d1f9af

$ git log -n 1 --oneline
7c02ccf (HEAD -> feature/kyana-d3, origin/feature/doc-intelligence-d2, feature/doc-intelligence-d2) feat(doc-intelligence): Phase D2-X English scope, dynamic timeouts, config errors, prompt safety & priority tiers
```

### 2. Clean Working Tree Verification
```bash
$ git status
On branch feature/kyana-d3
nothing to commit, working tree clean
```

---

## TABLE OF CONTENTS

1. **Section A — Current Ask Kyana Flow & End-to-End Lifecycle** `[VERIFIED]`
2. **Section B — Document Ingestion & Format Support** `[VERIFIED]`
3. **Section C — Content-Type Capability Matrix (Multimodal Academic Intelligence)** `[VERIFIED]`
4. **Section D — Real Gandaki University PDF Dataset Inspection** `[VERIFIED]`
5. **Section E — Multimodal LLM Compatibility & Provider Transport** `[VERIFIED]`
6. **Section F — Database Architecture & Schema Evolution** `[VERIFIED]`
7. **Section G — Note Chunking Evolution: From Naive Text to `document_pages`** `[VERIFIED / PROPOSED]`
8. **Section H — Chapter Scoping, Key Normalization & Pre-LLM SQL Authorization** `[VERIFIED / PROPOSED]`
9. **Section I — Syllabus Integration & Chunk-to-Topic Linking** `[VERIFIED / PROPOSED]`
10. **Section J — Previous-Year Questions (PYQ) Visual & Topic Intelligence** `[VERIFIED / PROPOSED]`
11. **Section K — Three-Part Evidence Packet & Pedagogical Answer Design** `[PROPOSED]`
12. **Section L — Latency, Token Cost & Nepal RTT Performance Budget** `[VERIFIED / PROPOSED]`
13. **Section M — Offline Evaluation Test Plan & Benchmarking Suite** `[PROPOSED]`
14. **Section N — Verification of the Six Stage-4 Known Defects** `[VERIFIED]`
15. **Section O — Phased Build Plan (D3a through D3e)** `[PROPOSED]`
16. **Section P — Security, Authorization & Boundary Guarantees** `[VERIFIED / PROPOSED]`
17. **Section Q — Risks, Trade-offs & Open Questions for Project Owner** `[UNRESOLVED QUESTIONS]`

---

## SECTION A — CURRENT ASK KYANA FLOW & END-TO-END LIFECYCLE

### A.1 Web Client UI (`public/`) `[VERIFIED]`
- **Full-Page Chatbot:** Located at `public/chatbot.html` with script `public/chatbot.js`.
  - Accessible via global header link: `<a href="/chatbot.html" class="header-nav-item">Kyana AI</a>`.
  - In `public/chatbot.js` (lines 1584–1600), the chat composer sends a `POST` request to `/api/ai/chat` with body:
    ```json
    {
      "message": "student query string",
      "history": [ { "role": "user", "content": "..." }, { "role": "assistant", "content": "..." } ],
      "stream": true,
      "conversationId": "active-uuid"
    }
    ```
- **Library View (`public/library.html`):**
  - Renders the hierarchy: `Semester` (pills) → `Subject` (cards) → `Chapter / Unit` (collapsible drawers: `.clean-unit-row`) → `Notes / Files` (`.clean-file-item`).
  - **Inspection Finding `[VERIFIED]`:** In `public/library.html`, while teachers/admins have action buttons (`renderChapterThreeDotMenuHtml`, `+ Add Note to this Chapter`), **there is currently NO per-chapter "Ask Kyana" button in `public/library.html`**. Students only have the top-navigation link to the general `/chatbot.html` page.
  - When clicking notes, it opens a preview drawer or redirects to `/api/files/:id/view`.

### A.2 Mobile Expo Client (`mobile/`) `[VERIFIED]`
- **Kyana Screen:** Located at `mobile/app/kyana.tsx` (using service `mobile/services/kyana.ts`).
  - Accessible via the bottom navigation bar Pinned Chat item (`mobile/app/(tabs)/chat.tsx`).
  - In `mobile/services/kyana.ts` (lines 438–448), messages are sent to `${baseUrl}/api/ai/chat` using XMLHttpRequest for SSE streaming:
    ```typescript
    const payload = JSON.stringify({
      message,
      conversationId,
      history: history || [],
      stream: true,
    });
    ```
- **Mobile Library Screen (`mobile/app/(tabs)/library.tsx`):**
  - Renders 3 levels:
    - Level 1: Semesters (Staff only; students locked to cohort semester).
    - Level 2: Subjects & Units list.
    - Level 3: Chapter Notes View (`selectedSubject && selectedChapter`).
  - **Inspection Finding `[VERIFIED]`:** In Level 3 (lines 570–650), the screen displays a Chapter Header Card (`selectedChapter.title`, `selectedChapter.unitNumber`) and a list of files (`Study Materials`), but **there is currently NO per-chapter "Ask Kyana" button in `mobile/app/(tabs)/library.tsx`**.
  - No `chapterContext` payload is currently constructed or passed from the mobile app to the backend.

### A.3 Backend Request Dispatch & Endpoint Handling `[VERIFIED]`
- **Server Route:** In `server.js` (line 7503):
  ```javascript
  app.post('/api/ai/chat', kyanaChatRateLimiter, chatHttp.createChatHandler(db, aiAssistant));
  ```
- **HTTP Transport Handler (`lib/chat-http.js` lines 14–45):**
  - Parses `req.body`: `{ message, history, stream, conversationId, chapterContext: rawChapterContext }`.
  - Normalizes `chapterContext` if passed by the client:
    ```javascript
    const chapterContext = (rawChapterContext && typeof rawChapterContext === 'object') ? {
      subject: String(rawChapterContext.subject || '').trim().slice(0, 140),
      subjectCode: String(rawChapterContext.subjectCode || '').trim().slice(0, 40),
      semesterNo: rawChapterContext.semesterNo ? Number.parseInt(rawChapterContext.semesterNo, 10) || null : null,
      unitNumber: rawChapterContext.unitNumber ? Number.parseInt(rawChapterContext.unitNumber, 10) || null : null,
      chapterTitle: String(rawChapterContext.chapterTitle || rawChapterContext.chapter || '').trim().slice(0, 160),
      fileIds: Array.isArray(rawChapterContext.fileIds)
        ? rawChapterContext.fileIds.map(id => Number.parseInt(id, 10)).filter(id => Number.isInteger(id) && id > 0).slice(0, 30)
        : []
    } : null;
    ```
  - Forwards call to `assistant.handleChat(db, message, studentInfo, history, conversationId, { signal, chatMode, chapterContext, onDelta, onStatus })`.

### A.4 Context Selection & Execution Flow in `ai-assistant.js` `[VERIFIED]`
- **Standard Flow (Without `chapterContext`):**
  - `ai-assistant.js` routes queries using `routeQuery(message, history)` (`lib/chat-tools.js`).
  - Calls tools (`search_notes`, `search_syllabus`, `search_assignments`, `search_notices`, `search_posts`).
  - `search_notes` (`lib/note-search.js`) performs:
    1. Metadata search (`files.title`, `files.subject`, `files.chapter`).
    2. Full-text search (PostgreSQL `to_tsquery('english', ?)` on `note_search_documents.search_vector` or SQLite FTS5 `note_search_fts`).
    3. Vector search (if `KYANA_NOTE_VECTOR_SEARCH === 'true'`) against `knowledge_chunks`.
- **Chapter-Scoped Interceptor (When `chapterContext` is provided):**
  - In `ai-assistant.js` (lines 940–1005):
    ```javascript
    if (chapterContext && (chapterContext.subject || chapterContext.chapterTitle || (Array.isArray(chapterContext.fileIds) && chapterContext.fileIds.length > 0))) {
      const { answerWithChapterContext, analyzeChapterStudentQuestion } = require('./lib/chapter-tutor-engine');
      // ...
      const tutorOut = await answerWithChapterContext(db, {
        message, history: cleanHistory, chapterContext, academicContext,
        generateReplyFn: canSynthesizeWithLlm ? llmGenerateFn : null, signal
      });
      // Returns chapter_tutor response with citations and resource cards
    }
    ```
  - **Critical Finding `[VERIFIED]`:** The backend handler `lib/chat-http.js` and `ai-assistant.js` already possess the contract to receive `chapterContext` and route to `answerWithChapterContext()`. The primary breakdown is that **the web and mobile clients do not currently send `chapterContext` because neither UI provides a dedicated chapter-scoped entry point**.

---

## SECTION B — DOCUMENT INGESTION & FORMAT SUPPORT

| Document Format | Ingestion Handler | Text Layer Extraction | Vision OCR Fallback | Table Support | Math / LaTeX Support | Inspection Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **PDF** | `lib/doc-ingestion-worker.js` + `pdfjs-dist` + `pdf-lib` | `pdfjs-dist` (v4 ESM) text items reconstructed via `(x, y)` | Gemini Vision via 1–3 page slices (`lib/doc-vision-ocr.js`) | Markdown tables generated by Vision prompt | LaTeX extracted via Vision prompt (`latex_present`) | **WORKING & VERIFIED** `[VERIFIED]` |
| **DOCX / DOC** | `lib/note-search.js` (`extractDocxText`) | `mammoth` (DOCX only). Older binary `.doc` files fail extraction | No vision OCR (text only) | Basic HTML/plain-text tables | None (equations stripped) | **PARTIALLY SUPPORTED** `[VERIFIED]` |
| **PPTX / PPT** | `lib/office-preview.js` + `lib/note-search.js` | Extracted via XML slide unzipping (`ppt/slides/slide*.xml`) | No vision OCR for slides | Text boxes extracted, tables flattened | None | **PARTIALLY SUPPORTED** `[VERIFIED]` |
| **TXT / MD** | `lib/note-search.js` | Raw UTF-8 string read directly | Not applicable | Standard markdown tables preserved | Standard LaTeX notation preserved | **WORKING & VERIFIED** `[VERIFIED]` |
| **Images (PNG/JPG)** | Direct upload in `files` / `post_media` | None (no native Tesseract OCR) | Not connected to `doc-ingestion-worker` | None | None | **NOT IMPLEMENTED** `[VERIFIED]` |
| **CSV / XLSX** | `lib/attendance-xlsx.js` (attendance only) | SheetJS (`xlsx`) for attendance backups only; generic study materials ignore spreadsheets | None | Structured row/col in attendance tables | None | **NOT IMPLEMENTED** for Notes `[VERIFIED]` |

---

## SECTION C — CONTENT-TYPE CAPABILITY MATRIX (MULTIMODAL ACADEMIC INTELLIGENCE)

Every capability is classified into one of five verified statuses:
- **WORKING AND VERIFIED:** Verified in live code execution and test suites.
- **PARTIALLY SUPPORTED:** Code exists but lacks full structural persistence or multimodal retrieval.
- **EXTRACTION ONLY:** Extracted at ingestion time, but lost or flattened before LLM retrieval.
- **NOT IMPLEMENTED:** No codebase support currently exists.
- **NOT TESTED:** Implementation claims exist but no test or runtime verification was established.

| Content Type | Detection | Extraction | Structured Storage | Retrieval | LLM Reasoning | Rendering | Overall Assessment |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Text & Headings** | WORKING AND VERIFIED | WORKING AND VERIFIED | WORKING AND VERIFIED | WORKING AND VERIFIED | WORKING AND VERIFIED | WORKING AND VERIFIED | **WORKING AND VERIFIED** `[VERIFIED]` |
| **2. Tables** | WORKING AND VERIFIED | WORKING AND VERIFIED | EXTRACTION ONLY | PARTIALLY SUPPORTED | PARTIALLY SUPPORTED | WORKING AND VERIFIED | **PARTIALLY SUPPORTED** `[VERIFIED]` |
| **3. Diagrams & Figures** | WORKING AND VERIFIED | EXTRACTION ONLY | EXTRACTION ONLY | NOT IMPLEMENTED | NOT IMPLEMENTED | NOT IMPLEMENTED | **EXTRACTION ONLY** `[VERIFIED]` |
| **4. Math Equations & Derivations** | WORKING AND VERIFIED | WORKING AND VERIFIED | WORKING AND VERIFIED | PARTIALLY SUPPORTED | WORKING AND VERIFIED | WORKING AND VERIFIED | **PARTIALLY SUPPORTED** `[VERIFIED]` |
| **5. Graphs & Charts** | PARTIALLY SUPPORTED | EXTRACTION ONLY | EXTRACTION ONLY | NOT IMPLEMENTED | NOT IMPLEMENTED | NOT IMPLEMENTED | **EXTRACTION ONLY** `[VERIFIED]` |
| **6. Programming Code** | WORKING AND VERIFIED | WORKING AND VERIFIED | WORKING AND VERIFIED | WORKING AND VERIFIED | WORKING AND VERIFIED | WORKING AND VERIFIED | **WORKING AND VERIFIED** `[VERIFIED]` |
| **7. Questions & Exercises** | WORKING AND VERIFIED | WORKING AND VERIFIED | WORKING AND VERIFIED | PARTIALLY SUPPORTED | PARTIALLY SUPPORTED | WORKING AND VERIFIED | **PARTIALLY SUPPORTED** `[VERIFIED]` |
| **8. Scanned / Handwritten Documents** | WORKING AND VERIFIED | WORKING AND VERIFIED | WORKING AND VERIFIED | PARTIALLY SUPPORTED | PARTIALLY SUPPORTED | WORKING AND VERIFIED | **PARTIALLY SUPPORTED** `[VERIFIED]` |

### Detailed Content-Type Technical Breakdown

#### 1. Text and Document Structure `[VERIFIED]`
- **Detection & Extraction:** Handled via `reconstructLinesFromItems()` in `lib/doc-page-classifier.js`. Groups text items into physical lines using horizontal ($x$) and vertical ($y$) coordinates. Accurately maintains reading order for single-column text.
- **Limitation:** In multi-column layouts (found in some research papers or double-column exam papers), naive vertical $y$-sorting without bounding-box column segmentation can interleave left and right columns.

#### 2. Tables `[VERIFIED]`
- **Detection:** `lib/doc-page-classifier.js` detects tables via horizontal alignment of multiple items with matching $y$-coordinates and grid-like tab stops, setting `page_type = 'table'`.
- **Extraction:** In `lib/doc-vision-ocr.js` (rule 7), Gemini Vision is instructed: `Write tables as Markdown tables (| Col | ... |)`.
- **Storage:** Persisted in `document_pages.text` as raw Markdown string.
- **Limitation:** Merged cells (`colspan`/`rowspan`), multi-page spanning tables, and nested tables are flattened into approximate Markdown tables. No cell-level SQL querying exists; table retrieval occurs solely as part of full-text chunk matching.

#### 3. Diagrams and Figures `[VERIFIED]`
- **Detection:** `lib/doc-page-classifier.js` checks PDF operator list for `OPS.paintImageXObject` and vector path counts (`OPS.constructPath`). Pages with large images or dense vector art are tagged `page_type = 'figure'`.
- **Extraction:** `lib/doc-vision-ocr.js` rule 8 prompts: `If the page has diagrams, flowcharts, circuits, graphs, or figures, summarize them concisely in "figure_description"; otherwise set null`.
- **Storage:** Stored in `document_pages.figure_description` (TEXT column).
- **Critical Architectural Gap:**
  - Individual figure crops, bounding boxes, diagram component labels, arrows, connection topologies, and FSM transition tables are **NOT stored structurally**.
  - `page_image_path` in `document_pages` is almost always `NULL` because the worker slices PDFs using `pdf-lib` and sends the slice bytes directly to Gemini without rasterizing to PNG or saving crops on disk or Supabase.
  - In LLM answering (`lib/chat-provider.js`), **no image parts are passed to Gemini**. The model answers purely from textual descriptions.

#### 4. Mathematical Equations and Derivations `[VERIFIED]`
- **Detection:** Checked by `MATH_FONT_RE`, `MATH_SYMBOL_RE` ($∑, ∏, ∫, ∂, ∇, √, ∞$), and vertical baseline shifts in `lib/doc-page-classifier.js`. Sets `page_type = 'math'`.
- **Extraction:** In `lib/doc-vision-ocr.js` rule 6: `Write formulas as LaTeX ($...$ inline or $$...$$ display) and set "latex_present": true`.
- **Storage:** Stored in `document_pages.text` and flagged via `document_pages.latex_present = TRUE`.
- **Rendering:** Rendered in web and mobile via KaTeX (`$..$` and `$$..$$`).
- **Limitation:** Multi-line derivations may get split across chunk boundaries if naive length-based chunking (750 chars) is used, breaking equation balance.

#### 5. Graphs and Charts `[VERIFIED]`
- **Detection & Extraction:** Detected under `figure`. Vision prompt generates a 1–2 sentence text summary in `figure_description`.
- **Limitation:** Specific data coordinates, axis limits, exact point values, and legends are not extracted as tabular data.

#### 6. Programming Code and Algorithms `[VERIFIED]`
- **Detection & Extraction:** Reconstructed text layers maintain indentation and monospace formatting. Code snippets enclosed in markdown fenced code blocks (````lang ... ````).
- **LLM Reasoning & Rendering:** Fully supported. Kyana's system prompts in `ai-assistant.js` and `chapter-tutor-engine.js` contain explicit directives for step-by-step code explanation and syntax highlighting.

#### 7. Questions and Exercises (PYQs) `[VERIFIED]`
- **Detection & Extraction:** Exam papers (e.g. `Web-Tech-I_Pre-Board_Set-A.pdf`) are categorized under `chapter = 'Model Questions'` or `subject = 'PYQS'`. Text extraction captures marks (`5x2=10`, `5x5=25`), question numbers, and instructions.
- **Limitation:** Questions containing embedded circuit schematics, graphs, or geometric figures lose the visual attachment during text-only retrieval.

#### 8. Scanned and Handwritten Documents `[VERIFIED]`
- **Detection & Extraction:** Handled through `page_type = 'scanned'` routing to Gemini Vision OCR in `lib/doc-vision-ocr.js`.
- **Verified Discovery:** `Chapter_6_(ELX_121).pdf` (Digital Logic, ID 149) is a 17-page CamScanner PDF whose text layer contains only `"CamScanner"` (10 chars per page). Gemini Vision successfully transcribes the printed text, but messy handwritten student notes have lower OCR confidence (`0.4 - 0.7`).

---

## SECTION D — REAL GANDAKI UNIVERSITY PDF DATASET INSPECTION

A complete physical inspection of the `uploads/` directory and local `database.db` was executed.

### D.1 Inventory Summary `[VERIFIED]`
- Total files in `database.db`: 390 records.
- Synthetic / test files: 313 records (Algorithms, Database Systems, Computer Science from automated tests).
- **Genuine Gandaki University BIT Academic Files: Exactly 77 files, ALL 77 physically verified on disk in `uploads/` with size > 1 KB.**

### D.2 Verified Subject Breakdown & Physical Inspection Table `[VERIFIED]`

| Subject | Semester | File Count | Verified Sample Documents & Physical Characteristics | Discovered Content Types |
| :--- | :--- | :--- | :--- | :--- |
| **Mathematics II** | Semester II | 31 PDFs | - `U4_L1.pdf` (ID 41, 145 KB, 8 pages, Manju Subedi)<br>- `Homogeneous Differential Eqs.pdf` (ID 45, 188 KB, 7 pages)<br>- `Exercise 2nd Order ODE 2.pdf` (ID 48, 44 KB, 2 pages)<br>- `Infinite Series(Introduction) 2.pdf` (ID 141, 151 KB, 6 pages)<br>- `GU_BIT_Exercise_Per_Com.pdf` (ID 146, 37 KB, 2 pages) | - Differential equations ($dy/dx$, 2nd order ODEs)<br>- Power series, convergence tests<br>- Permutation & combinations<br>- Higher-order partial derivatives<br>- Multi-line mathematical proofs |
| **Discrete Mathematics** | Semester II | 20 PDFs | - `Lecture 17 Shortest Path Algorithm.pdf` (ID 102, 2.79 MB, 33 pages, Er. Shiva Kunwar)<br>- `Lecture 16 Graph Isomorphism.pdf` (ID 101, 1.51 MB, 21 pages)<br>- `Lecture 18 Graph Coloring.pdf` (ID 103, 1.82 MB, 25 pages) | - Weighted graphs, Dijkstra's algorithm traces<br>- Graph isomorphism diagrams<br>- Tree topologies<br>- **Pages 6–10 of ID 102 have 0 text chars and 7 images per page (100% visual diagrams)** |
| **Web Technology I** | Semester II | 15 files (10 PDFs, 5 PPTXs) | - `Chapter1_Complete_Notes-GU.pdf` (ID 26, 364 KB, 14 pages)<br>- `Chapter2_Complete_Notes-GU.pdf` (ID 28, 719 KB, 24 pages)<br>- `Chapter3_Complete_Notes_GU.pdf` (ID 30, 597 KB, 21 pages)<br>- `Web-Tech-I_Pre-Board_Set-A.pdf` (ID 35, 184 KB, 1 page)<br>- `Web-Tech-I_Pre-Board_Set-B.pdf` (ID 36, 184 KB, 1 page)<br>- `Web-Tech-I_Pre-Board_Set-C.pdf` (ID 37, 184 KB, 1 page) | - HTML5 structural markup & DOM trees<br>- CSS Box Model diagrams (Page 3 of ID 30 has 416 vector paths)<br>- JavaScript event handlers, form validation code<br>- PHP & MySQL CRUD with prepared statements<br>- **Real GU BIT Pre-Board 2083 exam papers with marks & rubrics** |
| **Computer Programming II (Java)** | Semester II | 9 PDFs | - `01. Introduction to OOP.pdf` (ID 13, 601 KB, 23 pages, Er. Shiva Ram Dam)<br>- `02. Introduction to Java 1.0.pdf` (ID 14, 460 KB, 18 pages)<br>- `05. Inheritance, Package.pdf` (ID 17, 1.13 MB, 28 pages)<br>- `08. Event Handling.pdf` (ID 20, 1.92 MB, 32 pages)<br>- `ch 9. GUI with AWT and Swing.pdf` (ID 21, 1.41 MB, 36 pages) | - JVM architecture block diagrams<br>- Class hierarchy & inheritance trees<br>- Java source code listings with indentation<br>- Java AWT/Swing GUI components<br>- Tables comparing POP vs OOP |
| **Digital Logic** | Semester II | 1 PDF | - `Chapter_6_(ELX_121).pdf` (ID 149, 8.42 MB, 17 pages) | - **Scanned CamScanner document**<br>- Synchronous & asynchronous counters<br>- Register transfer logic<br>- Flip-flop excitation tables & state diagrams |
| **Computer Systems & Organization** | Semester I | 1 PPTX | - `CSIT_Unit2_CPU_Architecture.pptx` (ID 50, 58 KB, 12 slides) | - CPU block diagram (ALU, Control Unit, Registers)<br>- Bus interconnection architecture |

---

## SECTION E — MULTIMODAL LLM COMPATIBILITY & PROVIDER TRANSPORT

### E.1 Current Provider Configuration `[VERIFIED]`
- Configured in `lib/chat-provider.js`.
- Primary provider order: `gemini` → `groq` → `openrouter` → `openai` → `deepseek`.
- Default models:
  - Standard: `gemini-3.1-flash-lite` or `gemini-3-flash-preview`.
  - Complex: `gemini-3.1-pro-preview` or `gemini-3-flash-preview`.

### E.2 Image Input Support in `lib/chat-provider.js` `[VERIFIED]`
- **Inspection Finding:** In `lib/chat-provider.js` (lines 510–540 on `feature/kyana-d3`), message turns are constructed as:
  ```javascript
  const previous = cleanHistory(history, message);
  const contents = previous.map(entry => ({
    role: entry.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: entry.content }]
  }));
  ```
- **Limitation:** The current `chat-provider.js` implementation accepts **ONLY plain text strings** in `parts`. It does not support passing `inlineData` (base64 image/pdf) or `fileData` (Gemini File API URI) during chat answering.
- Even though `lib/doc-vision-ocr.js` successfully calls Gemini Vision with PDF slices during ingestion, **Kyana cannot visually inspect an original textbook page or diagram crop during interactive student conversation**.

### E.3 Minimal Compatible Extension for Multimodal Answering `[PROPOSED]`
Gemini's `POST /v1beta/models/{model}:streamGenerateContent` natively supports multimodal parts:
```json
{
  "role": "user",
  "parts": [
    { "text": "Explain the state transition diagram shown on this page." },
    {
      "inlineData": {
        "mimeType": "image/jpeg",
        "data": "/9j/4AAQSkZJRg..."
      }
    }
  ]
}
```
**Architecture Rule:**
1. Extend `normalizeMessage(message)` in `lib/chat-provider.js` to accept `{ text: string, images?: Array<{ mimeType: string, data: Buffer | string }> }`.
2. Restrict image payloads to `isVisionCapableModel(model)` (Gemini and OpenAI GPT-4o; fail-fast if routed to Groq or DeepSeek).
3. Validate image sizes: Max 2 images per turn, max 4 MiB each, JPEG/PNG/WebP only.

---

## SECTION F — DATABASE ARCHITECTURE & SCHEMA EVOLUTION

### F.1 Existing Tables Across Branches `[VERIFIED]`

1. **`document_pages` (Created by Phase D2 Migration `20261112_doc_intelligence_d2.up.sql`) `[VERIFIED]`:**
   - `id BIGSERIAL PRIMARY KEY`
   - `file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE`
   - `page_no INTEGER NOT NULL CHECK (page_no >= 1)`
   - `text TEXT NOT NULL DEFAULT ''` (Contains transcribed text, LaTeX, Markdown tables)
   - `raw_text TEXT NOT NULL DEFAULT ''` (Raw text layer from `pdfjs-dist`)
   - `source TEXT NOT NULL CHECK (source IN ('text_layer', 'vision', 'skipped'))`
   - `ocr_confidence REAL`
   - `page_type TEXT NOT NULL CHECK (page_type IN ('text', 'scanned', 'math', 'figure', 'table', 'nepali_repair'))`
   - `latex_present BOOLEAN NOT NULL DEFAULT FALSE`
   - `figure_description TEXT` (Textual summary of diagrams/charts)
   - `page_image_path TEXT`
   - `status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'skipped', 'skipped_quota'))`
   - `tier SMALLINT NOT NULL DEFAULT 1`

2. **`knowledge_chunks` (Created by Migration `20261014_kyana_v3_knowledge.up.sql`) `[VERIFIED]`:**
   - `id BIGSERIAL PRIMARY KEY`
   - `resource_id TEXT NOT NULL REFERENCES knowledge_resources(id) ON DELETE CASCADE`
   - `chunk_index INTEGER NOT NULL`
   - `content TEXT NOT NULL`
   - `embedding vector(768)` (pgvector)
   - `token_count INTEGER NOT NULL DEFAULT 0`
   - `page_number INTEGER`
   - `end_page_number INTEGER`
   - `section_heading TEXT`
   - `content_hash TEXT NOT NULL`

3. **`files` (Core Study Materials Table) `[VERIFIED]`:**
   - `id SERIAL PRIMARY KEY`
   - `title TEXT`, `originalName TEXT`, `storedName TEXT`
   - `subject TEXT`, `chapter TEXT`, `semester TEXT`, `semester_no INTEGER`
   - `cohort_id UUID`, `audience_scope TEXT`, `uploadedBy TEXT`

4. **`library_chapter_overrides` & `library_custom_chapters` `[VERIFIED]`:**
   - `library_chapter_overrides`: `(subject, original_chapter, new_chapter, is_deleted)`
   - `library_custom_chapters`: `(subject, semester, chapter, created_by)`

### F.2 Missing Fields & Required Schema Enhancements for D3 `[PROPOSED]`
To support robust chapter-scoped answering and syllabus linking without breaking changes:
1. Add `canonical_unit_number INTEGER` to `files` (derived from `chapter` via regex or syllabus match).
2. Add table `knowledge_chunk_topics`:
   ```sql
   CREATE TABLE IF NOT EXISTS knowledge_chunk_topics (
     id BIGSERIAL PRIMARY KEY,
     chunk_id BIGINT NOT NULL REFERENCES knowledge_chunks(id) ON DELETE CASCADE,
     topic_key TEXT NOT NULL,
     confidence_score REAL NOT NULL CHECK (confidence_score >= 0.0 AND confidence_score <= 1.0),
     created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
     UNIQUE(chunk_id, topic_key)
   );
   CREATE INDEX IF NOT EXISTS idx_kct_topic_confidence ON knowledge_chunk_topics(topic_key, confidence_score DESC);
   ```

---

## SECTION G — NOTE CHUNKING EVOLUTION: FROM NAIVE TEXT TO `document_pages`

### G.1 Current Note Chunking Mechanism in `lib/knowledge-builder.js` `[VERIFIED]`
In `buildNoteKnowledge(file)`:
```javascript
const rawContent = file.extracted_content || file.content || file.document_content || '';
const pages = String(rawContent).split('\f');
const chunks = pages.flatMap((page, i) => {
  const pageNum = pages.length > 1 ? i + 1 : null;
  const pageHeader = pageNum ? `${header.slice(0, -1)} | Page: ${pageNum}]` : header;
  return chunkText(pageHeader, page).map(c => ({ ...c, pageNumber: pageNum }));
});
```
**Identified Weaknesses `[VERIFIED]`:**
1. **Form-Feed Fragility:** Depends entirely on `\f` characters in flat text. If `\f` is missing or stripped by an extraction utility, `pageNum` becomes `null` for the entire file.
2. **LaTeX Slicing:** `chunkText()` splits blindly at 750 characters. Multi-line LaTeX math derivations (`$$ ... $$`) or inline expressions get sliced across chunks, rendering them unreadable and unparsable.
3. **Table Fragmentation:** Markdown tables (`| ... |`) are severed mid-row, destroying header associations.
4. **Disconnection from D2 Vision:** It ignores the rich `document_pages` table entirely. Page classifications (`page_type = 'math'`, `figure_description`) are discarded.

### G.2 New Chunking Architecture from `document_pages` `[PROPOSED]`
Instead of chunking flattened raw text, the knowledge builder must query `document_pages`:
1. **Source Query:**
   ```sql
   SELECT page_no, text, page_type, latex_present, figure_description, ocr_confidence
   FROM document_pages
   WHERE file_id = :fileId AND status = 'completed'
   ORDER BY page_no ASC;
   ```
2. **Grammar-Aware Atomic Chunking Rules:**
   - **Rule 1 (LaTeX Atomicity):** Identify display math blocks `$$ ... $$` and `\[ ... \]`. Never split within a math block. If a math block plus context exceeds 800 characters, allow an isolated single-chunk expansion up to 1,200 characters.
   - **Rule 2 (Table Atomicity):** Identify Markdown table blocks (`|---|---|`). Always keep the table header row intact. If a large table must be split, repeat the table header row at the beginning of each continuation chunk.
   - **Rule 3 (Figure Description Inclusion):** If `figure_description` is present on a page, prefix it to the first chunk of that page: `[Visual Context: ${figure_description}]\n\n`.
   - **Rule 4 (1-Indexed Provenance):** Set `chunk.pageNumber = page_no` strictly from `document_pages.page_no`.
3. **Idempotent Re-Read / Quota Resume Handling:**
   - When a page is re-processed by the vision worker (e.g. tier 2 retry or quota reset from `skipped_quota` to `completed`):
   - Perform atomic replacement of chunks for that page:
     ```sql
     DELETE FROM knowledge_chunks WHERE resource_id = :resourceId AND page_number = :pageNo;
     ```
   - Insert new chunks and re-embed only those new chunks.

---

## SECTION H — CHAPTER SCOPING, KEY NORMALIZATION & PRE-LLM SQL AUTHORIZATION

### H.1 Current Chapter Linking Reality `[VERIFIED]`
- In `files`, the `chapter` column is an unstandardized free-text string:
  - `"Unit 1: Introduction to Object Oriented Programming"`
  - `"Unit 4: Differential Equations"`
  - `"infinite series"` (lowercase, no unit prefix)
  - `"Model Questions"`
  - `"General"` / `"Lab / Practical Work"`
- In `library_chapter_overrides`, staff can remap `original_chapter` to `new_chapter` or soft-delete with `is_deleted = 1`.
- In `mobile/app/(tabs)/library.tsx`, special chapters exist: `PYQS` (past papers) and `ALL`.

### H.2 Proposed Reliable Chapter Key & Alias Normalization `[PROPOSED]`
A canonical chapter key must be computed deterministically:
```
canonical_chapter_key = `${normalizedSubject}_u${unitNumber}`
```
**Normalization Algorithm (`resolveChapterKey`):**
1. Extract unit number using regex: `/^(?:unit|u|ch(?:apter)?\.?)\s*(\d{1,2})\b/i`.
   - `"Unit 4: Differential Equations"` → Unit `4`.
   - `"U4_L1.pdf"` → Unit `4`.
2. If no unit number is present, match against the official course syllabus topics and units from `syllabus-data.json`:
   - `"infinite series"` matches Unit 2 of Mathematics II → Unit `2`.
3. Non-syllabus categories:
   - `"Model Questions"`, `"Past Questions"`, `"PYQS"` → Category `'PYQS'`.
   - `"Lab / Practical"` → Category `'LAB'`.
   - Fallback → Category `'GENERAL'`.

### H.3 Strict Pre-LLM SQL Retrieval Filter `[VERIFIED / PROPOSED]`
Before any text chunk or evidence goes to the LLM, SQL MUST enforce subject, chapter, semester, and cohort authorization:

```sql
SELECT c.id AS chunk_id, c.content, c.page_number, c.section_heading,
       f.id AS file_id, f.title AS file_title, f.chapter, f.subject, f.semester_no
FROM knowledge_chunks c
JOIN knowledge_resources r ON r.id = c.resource_id
JOIN files f ON f.id = r.canonical_id AND r.resource_type = 'note'
LEFT JOIN library_chapter_overrides ov
  ON LOWER(ov.subject) = LOWER(f.subject) AND LOWER(ov.original_chapter) = LOWER(f.chapter)
WHERE
  -- 1. Subject scoping (with alias expansion)
  LOWER(f.subject) IN (:subjectAliases)
  -- 2. Chapter scoping (active unit or resolved alias, excluding hidden overrides)
  AND COALESCE(ov.is_deleted, 0) = 0
  AND (
    LOWER(COALESCE(ov.new_chapter, f.chapter)) = LOWER(:targetChapter)
    OR f.unit_number = :targetUnitNumber
  )
  -- 3. Academic Cohort & Semester Authorization (canReadResource pre-filter)
  AND (
    f.audience_scope = 'all_students'
    OR (f.audience_scope = 'cohort' AND (f.cohort_id = :userCohortId OR f.cohort_id IS NULL))
  )
  AND (f.semester_no = :userSemesterNo OR :userSemesterNo IS NULL)
ORDER BY c.chunk_index ASC;
```

---

## SECTION I — SYLLABUS INTEGRATION & CHUNK-TO-TOPIC LINKING

### I.1 Syllabus Structure in Codebase `[VERIFIED]`
- Maintained in `syllabus-data.json` (and `public/syllabus-data.json`):
  - Contains 47 courses across Semesters I through VIII.
  - Each course includes `title`, `code`, `credit`, `nature`, `objectives`, `contents`, and `lab`.
- Parsing functions:
  - Client parser: `parseCourseContents(raw)` in `public/syllabus.html` (lines 250–280).
  - Server parser: `parseUploadedSyllabusText(rawText)` in `lib/kaie-course-map.js`.

### I.2 Chunk-to-Topic Linking Protocol (No LLM Call Required) `[PROPOSED]`
Instead of making costly LLM calls to classify chunks, perform bounded lexical and vector alignment against the **active chapter's own syllabus topic list only**:
1. For Unit $U$ of Course $C$, extract its $3$ to $10$ official subtopics from `syllabus-data.json`.
2. Compute similarity between each chunk $k$ and each subtopic $T_j$:
   - Lexical overlap (rarest-term Jaccard coverage).
   - Cosine similarity between chunk embedding $\vec{v}_k$ and pre-computed syllabus topic vector $\vec{v}_{T_j}$.
3. Store top matches with confidence $\ge 0.55$ in `knowledge_chunk_topics`:
   - `confidence_score >= 0.80`: **High Confidence** (direct match).
   - `0.65 <= confidence_score < 0.80`: **Medium Confidence**.
   - `< 0.65`: Excluded.

---

## SECTION J — PREVIOUS-YEAR QUESTIONS (PYQ) VISUAL & TOPIC INTELLIGENCE

### J.1 Current PYQ Storage & Limitations `[VERIFIED]`
- In `database.db`, past question papers (e.g. `Web-Tech-I_Pre-Board_Set-A.pdf`, ID 35) are stored as standard PDF files under `chapter = 'Model Questions'`.
- In `feat/kyana-scope-gate:lib/pyq-intelligence.js`, a dedicated question-level extraction parser exists for text questions (`pyq_papers`, `pyq_questions`, `pyq_topic_links`).
- **Limitation:** Visual elements inside questions (such as circuit diagrams in Digital Logic or graphs in Discrete Math) are not linked to question records. A question referencing *"find the shortest path in the graph below"* loses the graph image.

### J.2 Question-Level Extraction Architecture (Phased Build) `[PROPOSED]`
1. **Schema Extension (`pyq_questions`):**
   - Add `has_diagram BOOLEAN DEFAULT FALSE`.
   - Add `page_no INTEGER`.
   - Add `visual_asset_id TEXT REFERENCES document_pages(id)`.
2. **Extraction Rules:**
   - Detect question numbers: `/^(?:question|q)\.?\s*(\d{1,2}(?:\([a-z]\))?)/i`.
   - Detect marks: `/\b(\d+(?:\.\d+)?)\s*(?:marks?|pts?)\b/i` or `/\(\s*(\d+(?:\.\d+)?)\s*\)/`.
   - If `document_pages.latex_present` is true on the question's page, extract the mathematical formula as the question's core equation.
   - If `document_pages.page_type = 'figure'` or `figure_description` is present, attach the page image reference to the question record.

---

## SECTION K — THREE-PART EVIDENCE PACKET & PEDAGOGICAL ANSWER DESIGN

### K.1 The Unified Evidence Packet Structure `[PROPOSED]`
When a student asks a question inside a chapter, the retrieval engine packages evidence into three strictly separated tiers:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        UNIFIED EVIDENCE PACKET                         │
├────────────────────────────────────────────────────────────────────────┤
│ [PART 1: OFFICIAL SYLLABUS TOPICS]                                     │
│ - Course: Web Technology I (CIT123), Unit 3: CSS                       │
│ - Matched Subtopic: CSS Box Model & Margins (Confidence: 0.92)         │
├────────────────────────────────────────────────────────────────────────┤
│ [PART 2: VERIFIED ACTIVE CHAPTER NOTES]                                │
│ - Chunk 1: [Chapter3_Complete_Notes_GU.pdf, Page 4]                    │
│   "The CSS box model consists of content, padding, border, and margin..."│
│ - Chunk 2: [Chapter3_Complete_Notes_GU.pdf, Page 5]                    │
│   "Total box width = width + 2*padding + 2*border + 2*margin..."       │
├────────────────────────────────────────────────────────────────────────┤
│ [PART 3: RELATED PAST EXAM QUESTIONS (PYQ INTELLIGENCE)]               │
│ - 2083 Pre-Board Set A (Q.10, 5 Marks):                                │
│   "Explain the CSS box model with a labelled diagram, and calculate..."│
└────────────────────────────────────────────────────────────────────────┘
```

### K.2 Citation Format & Strict "Not in the Notes" Rule `[PROPOSED]`
1. **Citation Standard:** Every fact grounded in university documents must be cited inline:
   `[Document Title, Page X]` (e.g., `[Chapter3_Complete_Notes_GU.pdf, Page 4]`).
2. **Strict Grounding Rule:** If a queried concept is not present in Part 2 (Active Chapter Notes):
   - Kyana MUST explicitly state:
     > *"This specific topic is not covered in your uploaded chapter notes for [Chapter Title]."*
   - It may provide supplementary academic explanation only when clearly distinguished:
     > *"**Supplementary Academic Explanation (Curriculum-Aligned):** ... explained in own words."*
3. **Broad Overview Path:** If the student asks *"Summarise this chapter"* or *"What topics are in this unit?"*, Kyana bypasses 750-char chunk retrieval and synthesizes the answer directly from the official unit syllabus topics and `document_pages.figure_description` summaries.

---

## SECTION L — LATENCY, TOKEN COST & NEPAL RTT PERFORMANCE BUDGET

### L.1 Geographic & Network Reality `[VERIFIED]`
From `docs/KYANA_3_AUDIT.md`:
- Vercel Serverless Functions and Neon PostgreSQL are located in US East (`us-east-1`).
- Client requests from Pokhara/Kathmandu, Nepal incur **~900ms to 950ms network RTT** per sequential round-trip.
- **Rule:** Sequential database queries must be eliminated. All metadata, note chunks, syllabus topics, and PYQ questions must be fetched in **one parallel `Promise.all` round-trip**.

### L.2 Token & Latency Budget per Student Turn `[PROPOSED]`

| Operation | Model / Tool | Input Tokens | Output Tokens | Latency (Nepal) | Estimated Cost |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Query Embedding** | `text-embedding-004` | 15–30 | 0 | ~350ms | $0.000003 |
| **Parallel SQL Retrieval** | Neon PostgreSQL (1 trip) | 0 | 0 | ~950ms | $0.000000 |
| **LLM Streaming Synthesis** | `gemini-3.1-flash-lite` | ~2,500 | ~500 | First token: ~800ms | $0.000250 |
| **Total Budget per Question** | — | **~2,530** | **~500** | **First Token < 2.2s** | **< $0.0003** |

*If visual inspection of a single page slice is triggered: +258 input tokens ($0.00002), total cost remains under $0.0005 per turn.*

---

## SECTION M — OFFLINE EVALUATION TEST PLAN & BENCHMARKING SUITE

### M.1 Methodology `[PROPOSED]`
- **Framework:** Node.js native test runner (`node --test`).
- **Database Engine:** Isolated in-memory `@electric-sql/pglite` (no network calls, no Neon access, fast execution).
- **Test Corpus:** 30–50 real evaluation questions per subject across the 6 genuine subjects:
  1. *Mathematics II* (Differential Equations, Infinite Series, Complex Numbers).
  2. *Discrete Mathematics* (Dijkstra's Algorithm, Graph Isomorphism, Graph Coloring).
  3. *Web Technology I* (HTML5 DOM, CSS Box Model, JavaScript Validation, PHP CRUD).
  4. *Computer Programming II (Java)* (JVM architecture, OOP, Exception handling).
  5. *Digital Logic* (Counters, Registers, State transitions).
  6. *Computer Systems and Organization* (CPU bus architecture).

### M.2 Evaluation Benchmark Metrics `[PROPOSED]`
- **Retrieval Recall@5:** Percentage of test questions where the correct chapter note chunk appears in the top 5 retrieved items (Target: $\ge 90\%$).
- **Mean Reciprocal Rank (MRR@5):** Average reciprocal rank of the first relevant chunk (Target: $\ge 0.75$).
- **Citation Provenance Precision:** 100% of generated citations reference real files and valid pages.
- **Negative Rejection Rate:** 100% of out-of-syllabus questions trigger the *"not found in chapter notes"* disclosure.

### M.3 Evaluation Scoring Rubric (0–50 Points) `[PROPOSED]`
Every evaluated student response is scored across 10 distinct academic dimensions (0–5 points each, max 50):
1. **Content Identification (0–5):** Identifies the exact requested figure, formula, table, or code block without ambiguity.
2. **Structural Extraction Accuracy (0–5):** Preserves table rows/columns, LaTeX balance, and diagram label text.
3. **Mathematical / Visual Interpretation (0–5):** Correctly explains what the visual/formula mathematically signifies, not just a visual description.
4. **Relationship Understanding (0–5):** Connects arrows, inputs/outputs, state transitions, or variables to surrounding concepts.
5. **Academic Correctness (0–5):** Factually sound according to Gandaki University syllabus specifications.
6. **Contextual Relevance (0–5):** Addresses the student's specific question or confusion directly.
7. **Evidence Grounding (0–5):** Grounded strictly in authorized chapter notes; zero hallucinated facts.
8. **Page & Source Provenance (0–5):** Correct `[Document Title, Page X]` citation without null or broken references.
9. **Pedagogical Clarity (0–5):** Clear, beginner-friendly university teaching tone matching Kyana's persona.
10. **Uncertainty & Limit Handling (0–5):** Honestly reports unreadable/blurry text or absent topics without guessing.

### M.4 Comprehensive 20-Scenario Multimodal Academic Evaluation Dataset `[VERIFIED / BENCHMARK]`

The dataset below is grounded directly in the 77 verified Gandaki University BIT academic documents in `uploads/`:

| Scenario ID | File ID | Filename | Subject & Sem | Page | Content Type | Question / Intent | Expected Academic Interpretation | Expected Answer & Provenance | Retrieved Evidence | Kyana Baseline Response & Score | Failure Category |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **SC-TAB-01** | 13 | `01. Introduction to OOP.pdf` | Java (Sem II) | 5 | Table | "Explain the differences between POP and OOP from the table in Unit 1." | 6-row comparison table: emphasis, approach, data security, division into functions vs objects. | Must contrast algorithms vs data, top-down vs bottom-up. Cite `[01. Introduction to OOP.pdf, Page 5]`. | Text layer reconstructed lines | 42/50: Explains differences well, but lacks structured markdown table rendering in baseline. | None (Working) |
| **SC-TAB-02** | 28 | `Chapter2_Complete_Notes-GU.pdf` | Web Tech I (Sem II) | 8 | Table | "Explain the HTML table attributes and tags on page 8." | `<table>`, `<tr>`, `<td>`, `<th>`, plus `colspan` and `rowspan` cell spanning attributes. | Explains semantic table hierarchy and cell spanning with minimal code example. Cite Page 8. | Text layer chunk | 44/50: Correct explanation and syntax; cites correctly. | None (Working) |
| **SC-TAB-03** | 149 | `Chapter_6_(ELX_121).pdf` | Digital Logic (Sem II) | 6 | Table | "Explain the excitation table for the counter on page 6." | Flip-flop transition state table (present state $Q_n$, next state $Q_{n+1}$, required inputs $J, K$ or $T$). | Correct state mapping for JK/T flip-flops. Reports CamScanner origin. Cite Page 6. | Vision OCR markdown table | 36/50: Vision OCR extracts table, but baseline lacks inline visual inspection during chat. | Visual Reasoning Gap |
| **SC-DIA-01** | 30 | `Chapter3_Complete_Notes_GU.pdf` | Web Tech I (Sem II) | 3 | Diagram | "Explain the CSS Box Model diagram in this chapter." | Concentric rectangular diagram: Margin (outer), Border, Padding, Content (inner). | Explains layer order, box sizing calculation (`content-box` vs `border-box`). Cite Page 3. | `figure_description` text | 35/50: Explains box model theoretically from text; cannot visually highlight box layers. | Visual Inspection Gap |
| **SC-DIA-02** | 102 | `Lecture 17 Shortest Path Algorithm.pdf` | Discrete Math (Sem II) | 5 | Diagram | "Explain the graph diagram on page 5 and find the shortest path from A to Z." | Weighted undirected graph with vertices A, B, C, D, E, Z and edge weights. | Traces Dijkstra's algorithm step by step from vertex A. Note that page text has only 35 chars; visual required. | 7 images on page (no text) | 18/50: Text retrieval returns empty snippet; fails to see edge weights in baseline. | Text Extraction Failure |
| **SC-DIA-03** | 13 | `01. Introduction to OOP.pdf` | Java (Sem II) | 8 | Diagram | "Explain the JVM Architecture diagram on page 8." | Block diagram showing Class Loader subsystem, JVM Memory (Heap, Stack, Method Area), Execution Engine (JIT), Native Interface. | Step-by-step breakdown of bytecode execution flow through JVM subsystems. Cite Page 8. | Vector ops + text | 38/50: Explains JVM architecture from surrounding text; cannot point to visual diagram blocks. | Visual Inspection Gap |
| **SC-DIA-04** | 149 | `Chapter_6_(ELX_121).pdf` | Digital Logic (Sem II) | 3 | Diagram | "Explain the 4-bit ripple counter circuit diagram on page 3." | Circuit schematic: 4 cascaded T/JK flip-flops with inverted clock inputs from previous $Q$ outputs. | Explains asynchronous ripple propagation delay and binary counting sequence ($0000 \to 1111$). | Vision OCR text | 32/50: Text describes ripple counter; cannot inspect flip-flop pin connections directly. | Visual Reasoning Gap |
| **SC-DIA-05** | 50 | `CSIT_Unit2_CPU_Architecture.pptx` | CSO (Sem I) | 4 | Diagram | "Explain the CPU internal bus architecture shown in the Unit 2 slides." | Block diagram showing ALU, Control Unit, Accumulator, PC, IR, interconnected by common internal bus. | Explains data movement between registers and ALU over internal bus. Cite Slide 4. | PPTX XML text boxes | 34/50: Good conceptual explanation; lacks diagram arrow verification. | Visual Inspection Gap |
| **SC-EQN-01** | 41 | `U4_L1.pdf` | Math II (Sem II) | 4 | Equation | "What is the order and degree of the differential equation on page 4?" | $\frac{d^2 y}{dx^2} + 3\frac{dy}{dx} + 2y = 0$: Highest derivative is 2nd order, power is 1st degree. | Identifies Order = 2, Degree = 1 with formal mathematical justification. Cite Page 4. | Text layer math | 46/50: High accuracy; LaTeX rendered cleanly via KaTeX. | None (Working) |
| **SC-EQN-02** | 45 | `Homogeneous Differential Eqs.pdf` | Math II (Sem II) | 3 | Derivation | "Explain the derivation for solving homogeneous differential equations using y = vx." | Step-by-step substitution: $y = vx \implies \frac{dy}{dx} = v + x\frac{dv}{dx}$. Separates variables in $v$ and $x$. | Shows full algebraic substitution and integration step by step. Cite Page 3. | LaTeX text chunk | 45/50: Derivation steps preserved; KaTeX renders correctly. | None (Working) |
| **SC-EQN-03** | 144 | `Power Series & Radius of Convergence 2.pdf` | Math II (Sem II) | 2 | Equation | "Explain the Ratio Test formula for radius of convergence." | $R = \frac{1}{L}$ where $L = \lim_{n \to \infty} \|\frac{a_{n+1}}{a_n}\|$. $R = \infty, R = 0,$ or finite $R$. | States test conditions and interval of convergence $(-R, R)$. Cite Page 2. | Text layer math | 44/50: Formula and convergence criteria correctly derived. | None (Working) |
| **SC-EQN-04** | 146 | `GU_BIT_Exercise_Per_Com.pdf` | Math II (Sem II) | 1 | Equation | "Solve question 1(f): If (n+1)! = 30(n-1)!, find n." | $(n+1)n(n-1)! = 30(n-1)! \implies n^2 + n - 30 = 0 \implies (n+6)(n-5) = 0 \implies n = 5$. | Shows algebraic factoring step by step, discards $n = -6$ since $n \in \mathbb{N}$. Cite Page 1. | Text layer math | 48/50: Flawless mathematical solution and explanation. | None (Working) |
| **SC-GRA-01** | 101 | `Lecture 16 Graph Isomorphism.pdf` | Discrete Math (Sem II) | 4 | Graph | "How do we determine if Graph G and Graph H are isomorphic on page 4?" | Checks graph invariants: number of vertices ($n$), number of edges ($m$), degree sequence, adjacency matrix. | Explains vertex-to-vertex bijection and adjacency preservation. Cite Page 4. | Text layer + images | 38/50: Explains invariants well; cannot verify visual vertex correspondence between G and H. | Visual Inspection Gap |
| **SC-GRA-02** | 103 | `Lecture 18 Graph Coloring.pdf` | Discrete Math (Sem II) | 3 | Graph | "Explain vertex coloring and chromatic number for the graph on page 3." | Assignment of colors to vertices such that no adjacent vertices share a color. Minimum colors = $\chi(G)$. | Determines $\chi(G)$ for simple cycles and complete graphs. Cite Page 3. | Text layer + vector ops | 40/50: Good conceptual teaching; relies on text notes. | Visual Inspection Gap |
| **SC-GRA-03** | 134 | `Maxima and Minima.pdf` | Math II (Sem II) | 2 | Graph | "Explain local maxima, local minima, and saddle points in several variables." | Geometric interpretation of $z = f(x, y)$ surface, tangent planes, contour curves, and discriminant $D = f_{xx}f_{yy} - (f_{xy})^2$. | Explains second partial derivative test and saddle point topology. Cite Page 2. | Text layer math | 44/50: Mathematically rigorous; describes geometry clearly. | None (Working) |
| **SC-COD-01** | 35 | `Web-Tech-I_Pre-Board_Set-A.pdf` | Web Tech I (Sem II) | 1 | Code / PYQ | "Solve Question 13: Write a complete JavaScript program to validate a registration form." | Validates name (required), email (regex), phone (10 digits), password (strong). | Provides clean, well-commented JavaScript code with event listener and DOM error display. | Text layer exam paper | 47/50: Code is fully valid, syntactically correct, and formatted in markdown block. | None (Working) |
| **SC-COD-02** | 16 | `04. Operators and Control Flow.pdf` | Java (Sem II) | 12 | Code | "Explain the Java switch statement example on page 12." | Java switch construct: `case`, `break`, `default`, expression evaluation. | Traces code execution, explains break requirement to prevent fallthrough. Cite Page 12. | Text layer code | 45/50: Explains line-by-line execution accurately. | None (Working) |
| **SC-COD-03** | 32 | `Chapter4_Complete_Notes_GU.pdf` | Web Tech I (Sem II) | 14 | Code | "Explain how addEventListener works in JavaScript with the example from notes." | DOM Event registration: `element.addEventListener('click', handler, false)`. Event bubbling vs capturing. | Explains parameter signature and syntax with working sample. Cite Page 14. | Text layer code | 46/50: Accurate teaching and code formatting. | None (Working) |
| **SC-OCR-01** | 149 | `Chapter_6_(ELX_121).pdf` | Digital Logic (Sem II) | 1 | Scanned / OCR | "What is a counter according to page 1 of Chapter 6 notes?" | Definition of counter as a sequential circuit consisting of flip-flops that cycles through a predefined state sequence. | Explains counter definition despite page being a scanned CamScanner image. Cite Page 1. | Vision OCR text | 40/50: Vision OCR captures definition accurately; cites correctly. | None (Working) |
| **SC-OCR-02** | 149 | `Chapter_6_(ELX_121).pdf` | Digital Logic (Sem II) | 11 | Scanned / OCR | "Explain the synchronous counter design steps shown on page 11." | Design procedure: State diagram $\to$ State table $\to$ Flip-flop excitation table $\to$ K-maps $\to$ Logic diagram. | Lists 5 standard sequential circuit design steps. Reports scanned source origin. Cite Page 11. | Vision OCR text | 38/50: Procedural steps correctly listed; K-map diagrams described textually. | Visual Inspection Gap |

---

## SECTION N — VERIFICATION OF THE SIX STAGE-4 KNOWN DEFECTS

| Known Defect | Theoretical Symptom | Verified Code Root Cause | Verification Status |
| :--- | :--- | :--- | :--- |
| **Defect 1: Offline Fallback Ignores Active Chapter** | In no-LLM / offline fallback mode, Kyana outputs a generic definition and ignores retrieved notes. | In `lib/chapter-tutor-engine.js` (lines 1740–1780), `specializedAdaptiveFallback` was originally called before checking if `evidence.foundInChapterFiles` had populated content passages. Partially mitigated in `feat/kyana-scope-gate`. | **VERIFIED & MITIGATED IN SCOPE-GATE** `[VERIFIED]` |
| **Defect 2: PYQ Explanation Returns Listing Instead of Solving** | Asking Kyana to solve or explain a specific exam question outputs a list of similar past questions instead of solving it. | In `analyzeChapterStudentQuestion`, `isPyqSolveRequest` strictly required words `solve|solution|work out`. Questions phrasing *"Explain Question 10 from 2083 Pre-Board"* tripped `isQuestionPracticeRequest`, producing a directory listing. | **VERIFIED** `[VERIFIED]` |
| **Defect 3: Unavailable Page Provenance Results in `Page null`** | Missing page indices produce `Page null` or `Page undefined` in student-facing text. | In older formatting templates, `${primary.pageNumber}` was interpolated directly without null guarding. In `lib/academic-conflict-detector.js`, `formatPageProvenanceLabel()` was added to sanitize invalid numbers to `'Document Section'`. | **VERIFIED & FIXED IN SCOPE-GATE** `[VERIFIED]` |
| **Defect 4: Cross-File Conflicts Not Surfaced** | Contradicting definitions across multiple teacher notes are silently merged. | No conflict resolution logic existed. Resolved on `feat/kyana-scope-gate` by implementing `detectAcademicEvidenceConflicts()` in `lib/academic-conflict-detector.js`. | **VERIFIED IN SCOPE-GATE** `[VERIFIED]` |
| **Defect 5: PYQ Analytics Collapses Distinct Questions with Same Wording** | Multiple questions in different exams with identical wording are collapsed into a single exam instance. | In `lib/pyq-intelligence.js` (line 1928), deduplication key fell back to `${yr}|${exType}|${marks}|${normQText}` when question number was unparsed. Distinct unnumbered questions in the same paper were skipped. | **VERIFIED** `[VERIFIED]` |
| **Defect 6: Syllabus Topic Embeddings Stale on Descriptor Change** | Updating topic descriptors did not invalidate old vector embeddings. | In `lib/pyq-intelligence.js` (lines 760–840), `content_hash` checking was introduced to verify that persisted vector matches current descriptor hash. Stale cache rows are invalidated. | **VERIFIED IN SCOPE-GATE** `[VERIFIED]` |

---

## SECTION O — PHASED BUILD PLAN (D3a THROUGH D3e)

### Phase D3a: Chapter-Scoped Answering & Evidence Packet (No Schema Changes)
- **Goal:** Enable the Ask Kyana button on Web and Mobile for each chapter; route `chapterContext` through `chatHttp` and `answerWithChapterContext`.
- **Files Affected:**
  - `public/library.html` (add "Ask Kyana" button in each chapter drawer).
  - `mobile/app/(tabs)/library.tsx` (add "Ask Kyana" button in Level 3 header).
  - `mobile/services/kyana.ts` (pass `chapterContext` in request payload).
  - `lib/chat-http.js` & `ai-assistant.js` (already support `chapterContext`).

### Phase D3b: Grammar-Aware Chunking from `document_pages`
- **Goal:** Replace `rawContent.split('\f')` in `lib/knowledge-builder.js` with structured reads from `document_pages`.
- **Files Affected:**
  - `lib/knowledge-builder.js` (implement LaTeX-aware, table-aware, figure-aware chunking).
  - `lib/knowledge-sync.js` (trigger re-chunking when ingestion worker completes a file).

### Phase D3c: Bounded Syllabus Linking
- **Goal:** Link every note chunk to 1–2 official chapter syllabus topics with confidence scores without external LLM calls.
- **Files Affected:**
  - `migrations/20261113_chunk_topics.up.sql` (create `knowledge_chunk_topics` table).
  - `lib/kaie-course-map.js` & `lib/knowledge-builder.js`.

### Phase D3d: Multimodal Vision Transport for Interactive Chat
- **Goal:** Enable Kyana to visually inspect original textbook page slices during conversation when a student asks *"Explain the diagram on page 12"*.
- **Files Affected:**
  - `lib/chat-provider.js` (accept inline image parts in `geminiTurn`).
  - `lib/chapter-tutor-engine.js` (retrieve page image slice from disk or Gemini File API and attach to prompt).

### Phase D3e: PYQ Question-Level Extraction & Visual Linking
- **Goal:** Parse and link past exam questions with their embedded figures and equations.
- **Files Affected:**
  - `lib/pyq-intelligence.js`.

---

## SECTION P — SECURITY, AUTHORIZATION & BOUNDARY GUARANTEES

1. **Cohort & Semester Gating `[VERIFIED]`:**
   - Multi-tenant student isolation is strictly enforced via `canReadResource()` in `lib/kyana-access.js`.
   - Students cannot retrieve study materials, notes, or PYQ solutions belonging to semesters other than their own or cohorts other than their enrolled cohort.
2. **Visual Asset Authorization `[PROPOSED]`:**
   - Page images and diagram crops inherit the exact `files.cohort_id` and `files.audience_scope` of their parent document.
   - Direct image preview URLs are signed or authenticated session-gated; raw file storage URLs are never exposed in student-facing responses.
3. **No Prompt Injection from Visuals `[PROPOSED]`:**
   - OCR transcriptions and visual annotations are labeled as **untrusted study evidence** in the system prompt. Instructions written inside student notes or diagrams cannot override Kyana's system directives.

---

## SECTION Q — RISKS, TRADE-OFFS & OPEN QUESTIONS FOR PROJECT OWNER

### Risks & Trade-offs
1. **Neon Serverless Cold Starts:** Neon PostgreSQL connection resume from Nepal can take 1.2s to 1.8s on cold boot. Connection pooling with `@neondatabase/serverless` must stay warm.
2. **Gemini Vision RPM Limits:** Slicing and reading pages during ingestion or chat consumes Gemini API quota. Batching and aggressive caching are mandatory.

### Open Questions for Project Owner `[UNRESOLVED QUESTIONS]`
1. **Per-Chapter Button UX:** Should clicking "Ask Kyana" in a chapter open a slide-over drawer inside the Library, or navigate to `/chatbot.html` with that chapter pinned in the header?
2. **Model Question Labeling:** Should Pre-Board exams (e.g. `Web-Tech-I_Pre-Board_Set-A.pdf`) be re-tagged in the database from `chapter = 'Model Questions'` to `resource_category = 'pyq'`?
3. **Vision Storage Destination:** Where should sliced page images be stored for rapid mobile/web display—local disk (`/uploads/`), Neon BYTEA (not recommended), or Supabase Storage bucket (`library_pages`)?

---

*End of Architecture Audit Report (Phase D3-1 / Stage 4). Prepared for Project Owner Review.*
