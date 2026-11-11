# KYANA AI STUDY PARTNER (V4) — ARCHITECTURE, RESEARCH & LIVING MASTER PLAN

> **Canonical Living Document for Autonomous Agents & Developers**
> - **File Path**: `KYANA_STUDY_PARTNER_MASTER_PLAN.md`
> - **Project**: Semester Library (Gandaki University — Bachelor of Information Technology, Semesters I–VIII)
> - **Current Phase**: `PHASE 0 — ARCHITECTURE & MASTER PLAN FINALIZED (Ready for Wave 1 Execution)`
> - **Last Updated**: `2026-11-11`

---

## 0. AGENTIC HANDOFF & AUTO-UPDATE PROTOCOL (READ FIRST)

**Mandatory Instructions for Any AI Coding Agent (Gemini, Claude, Cursor, Windsurf, GSD Executor) Working on This Project:**

1. **Single Source of Truth**: This file (`KYANA_STUDY_PARTNER_MASTER_PLAN.md`) is the authoritative blueprint and state tracker for upgrading **Kyana AI** from a single-turn Q&A assistant into a **Stateful Step-by-Step Course Study Partner** grounded in the student's **enrolled semester (1–8)**, **official BIT syllabus**, **teacher-uploaded PDF/DOCX notes**, and **Past Year Questions (PYQs)**.
2. **Zero Re-Explanation Required**: Before writing any code, inspect **Section 9 (Wave-by-Wave Implementation Tracker)** and **Section 10 (Agent Execution Log)** at the bottom of this file to see which tasks are `[x]` (completed), `[/]` (in progress), or `[ ]` (pending).
3. **Strict Architectural Guardrails**:
   - **Dual Database Compatibility**: Every SQL table, index, and query MUST work identically on **Neon PostgreSQL** (`db.isPostgres = true`) and **SQLite / `@libsql/client`** (`database.db` / `:memory:`). Use `?` placeholders in queries (`db.js` auto-converts `?` to `$1..$n` via `toPostgresSql`) and register new snake_case columns in `camelMap` inside `db.js`.
   - **Strict Monochrome UI**: Follow the platform's obsidian/charcoal monochrome aesthetic (`#080808` / `#0a0a0a` background, `#141414` surface, `#1c1c1c` elevated card, `#282828` border, `#ffffff` primary text, `#a1a1a1` secondary text) in `public/chatbot.css` and `mobile/constants/theme.ts`. Never introduce rainbow gradients.
   - **Defense-in-Depth & Untrusted Evidence Isolation**: All extracted note chunks and PYQ text remain wrapped in `<untrusted_campus_record>` tags (`lib/chat-security.js`). Never allow untrusted document text to trigger mutating tools or bypass `kyana-access.js` semester/cohort checks.
4. **Mandatory Update-on-Completion Rule**:
   - Whenever you complete any sub-task or wave in this plan:
     1. Run the verification test suite (`node --test --test-concurrency=1 tests/<suite>.test.js`).
     2. Update the task checkbox in **Section 9** from `[ ]` to `[x]`.
     3. Append a dated entry in **Section 10 (Agent Execution & State Snapshot Log)** listing the exact files created/modified, test results, and the next unblocked task.

---

## 1. EXECUTIVE VISION: HOW THE KYANA STUDY PARTNER WORKS

When a student logs into **Semester Library** (on Web or Mobile) and opens Kyana AI, the system already knows their authenticated identity, cohort, and enrolled semester (e.g., **Semester 1** or **Semester 3**).

### Core Student Experience ("Teach me Chapter 2 of DSA")
1. **Automatic Semester & Subject Scoping**:
   - A **Semester 1** student asking *"Teach me Chapter 2 of C"* is automatically scoped to **Semester I (`CIT111 — Computer Programming, I (C)`)**, searching only Semester 1 syllabus units, Semester 1 teacher PDFs/DOCX notes, and Semester 1 PYQs.
   - A **Semester 3** student asking *"Teach me Chapter 2 of DSA"* is automatically scoped to **Semester III (`CIT214 — Data Structure and Algorithms`, Unit 2: Linked Lists, 5 hrs)**—while still allowing explicit cross-semester study if a student specifically asks for another semester's course.
2. **Zero-Topic-Left-Behind Reconciliation (Syllabus $\cup$ Teacher PDF/DOCX Notes)**:
   - Teachers often include extra derivations, C/Java code variations, dry-run tables, or numericals in their uploaded PDF/DOCX notes that are not explicitly itemized in the short syllabus string, or vice versa.
   - Kyana builds a **Unified Chapter Checklist** by merging:
     - **Official Syllabus Subtopics** from `public/syllabus-data.json` (e.g., `2.1 Linked List as an ADT`, `2.2 Singly Linked Lists: Insertion, Deletion, Search`, `2.3 Two Way Lists: Insertion, Deletion, Search`, `2.4 Circular Linked List`).
     - **Extracted Teacher Note Headings & Subtopics** from `document_topic_metadata`, `document_pages`, and `document_chunks` for all uploaded PDFs/DOCX in `Data Structure and Algorithms / Chapter 2` (e.g., *Header Linked Lists*, *Memory Representation with `malloc()`*, *Time Complexity Comparison of Array vs. Linked List*, *Reversing a Singly Linked List*).
   - Every micro-topic in the unified checklist is tracked so **not a single topic from either the official syllabus or the teacher's PDF/DOCX notes is skipped**.
3. **Paced Step-by-Step Teaching (Never Dumping Everything at Once)**:
   - Instead of generating a 2,000-word wall of text covering the entire chapter in one turn, Kyana initiates a **Stateful Study Session**:
     - **Turn 1 (Chapter Roadmap + Micro-Topic 1)**: Displays the complete interactive **Chapter 2 Mastery Checklist** (showing all reconciled topics from syllabus + teacher PDFs and how many past exam questions exist for this chapter), then teaches **only Micro-Topic 1** (`2.1 Linked List as an ADT & Node Memory Structure`) using the teacher's uploaded note explanations and diagrams, cites the exact PDF page (`[Teacher Note: DSA_Ch2_Linked_List.pdf, Page 3]`), highlights any **PYQ Exam Alert**, and ends with a **1-question Socratic Check** (*"Quick check before we move to 2.2 Singly Linked List Operations: Why can't we access the 5th element of a linked list in $O(1)$ time like an array?"*).
     - **Turn 2 (Student Replies / Asks Doubt / Clicks "Next Subtopic")**: Kyana evaluates the student's reply. If clear, it marks Micro-Topic 1 as `[x] Mastered (1/5)`, and teaches **Micro-Topic 2** (`2.2 Singly Linked Lists: Insertion, Deletion, Search`). If the student was confused, Kyana re-explains using a simpler real-world analogy and a step-by-step pointer `trace` block before advancing.
4. **Inline Past Year Questions (PYQ) Intelligence**:
   - While teaching each micro-topic, Kyana queries the **PYQ Intelligence Engine** (`pyq_questions` & `pyq_topic_links`) for that exact concept.
   - If that topic appeared in a past university exam (e.g., *GU 2080 Final Exam Q.4a [5 Marks]* or *2079 Pre-Board Q.2b [10 Marks]*), Kyana surfaces an inline **🔥 Past Exam Spotlight** showing the exact year, exam type, marks weight, and verbatim question, and offers to guide the student through writing a full-marks exam answer after the concept explanation.

---

## 2. GLOBAL RESEARCH: HOW LEADING AI STUDY PARTNERS ARE BUILT WORLDWIDE

To design a world-class architecture tailored for Gandaki University, we benchmarked global AI tutoring systems and EdTech research:

| Platform / System | Core Pedagogical & Technical Architecture | Key Takeaway Applied to Kyana Study Partner |
| :--- | :--- | :--- |
| **[Khanmigo (Khan Academy)](https://www.khanmigo.ai/)** ([Engineering Learnings](https://blog.khanacademy.org/how-khan-academy-is-building-a-better-ai-tutor-our-most-recent-learnings/), [Research Evaluation](https://www.researchgate.net/publication/382320210_An_Evaluation_of_Khanmigo_a_Generative_AI_Tool_as_a_Computer-Assisted_Language_Learning_App)) | Combines curriculum-indexed RAG with a **Socratic Policy Layer** that forbids dumping full homework/chapter answers at once. Uses structured lesson state, micro-scaffolding, and diagnostic probing questions to verify student understanding step by step. | Implement a **Stateful Pedagogical State Machine** (`ORIENTATION -> TEACH_MICRO_TOPIC -> CHECK_UNDERSTANDING -> REMEDIATE_OR_ADVANCE -> PYQ_PRACTICE`) so Kyana teaches one subtopic at a time and checks comprehension. |
| **[Google NotebookLM — Learning Guide & Study Aids](https://blog.google/innovation-and-ai/models-and-research/google-labs/notebooklm-student-features/)** ([arXiv Socratic Physics Tutor Study](https://arxiv.org/html/2504.09720v3)) | Restricts retrieval strictly to user/teacher-uploaded documents with **clickable inline passage citations** (document title, page number, section). Its **Learning Guide** mode breaks source documents into step-by-step probing lessons, flashcards, and quizzes grounded 100% in the uploaded files. | Ground every micro-topic lesson in `document_chunks` & `document_pages` with exact PDF page deep-links (`/api/files/:id/view#page=N`) and clearly distinguish **Teacher Note Evidence** from **Syllabus Gap-Fill**. |
| **[Duolingo Max](https://blog.duolingo.com/duolingo-max/) & [Quizlet Q-Chat / Learn](https://play.google.com/store/apps/details?id=com.quizlet.quizletandroid)** | Combines conversational LLM turns with **Explicit Mastery Tracking** and **Adaptive Practice**—splitting a unit into bite-sized nodes, tracking which nodes the learner has mastered vs. struggled with, and dynamically generating quick recall quizzes. | Persist per-student topic mastery in `study_partner_topic_progress` (`pending`, `in_progress`, `mastered`, `needs_review`) with a visual progress bar (`3/6 Topics Mastered`) inside the chat UI. |
| **[Course Hero AI Study Companion](https://www.unite.ai/course-hero-review/)** | Organizes uploaded lecture notes, study guides, and **past exam papers** by exact school and course code (`CIT214`), linking specific past exam questions directly to the lecture note sections that answer them. | Build the **PYQ Question Bank & Topic Linker** (`pyq_papers`, `pyq_questions`, `pyq_topic_links`) so past exam questions are automatically cross-linked to syllabus units and teacher note chunks. |
| **[Proactive vs. Reactive Tutor Calibration Research](https://bampel.com/uploads/calibrating-llm-tutor-initiation.pdf)** & **[EdTech AI Tutor Architecture](https://acquaintsoft.com/blog/ai-tutor-chatbot-development-guide)** | Demonstrates that separating the **Content Ingestion/RAG Layer**, **Curriculum Knowledge Graph**, **Student Memory/Mastery Store**, and **Socratic Pedagogical Policy Layer** prevents hallucination and cognitive overload for beginner/intermediate learners ([Adaptive AI Taxonomy](https://medium.com/@adnanmasood/the-quiet-math-of-edtech-can-ai-tutors-really-teach-737195005abf)). | Keep our architecture modular across `lib/study-partner-reconciler.js`, `lib/pyq-intelligence.js`, and `lib/study-partner-engine.js`, plugging cleanly into `lib/kyana-agent-engine.js`. |

---

## 3. CODEBASE AUDIT: WHAT ALREADY EXISTS IN SEMESTER LIBRARY VS. WHAT WE NEED

We audited the entire Semester Library codebase (`/Users/sauu_gat/semester-library`) to ensure we reuse 100% of the existing infrastructure without duplicating working systems:

### 3.1 Existing Foundation We Will Reuse Directly
1. **Official 8-Semester BIT Syllabus (`public/syllabus-data.json` & `lib/curriculum-reasoning.js`)**:
   - Already contains all 8 semesters (Semesters I–VIII) and 47 courses with course codes (`CIT111`, `CIT214`, `CIT213`, etc.), credit hours, course objectives, unit titles, teaching hours, unit subtopics, lab works, and textbooks.
   - `parseSyllabusCourseDetails(course)` in `lib/chat-tools.js` and `parseSyllabusUnits(contentsText)` in `lib/academic-document-understanding.js` already parse unit numbers, titles, hours, and topic lists.
2. **Enterprise Document Ingestion & Hybrid RAG (`migrations/20261110_kyana_rag_document_intelligence.sql`, `lib/document-ingestion.js`, `lib/semantic-chunker.js`, `lib/hybrid-rag-engine.js`)**:
   - Already extracts PDFs (`pdfjs-dist` with coordinate layout reconstruction, Markdown table reconstruction, heading detection, and OCR fallback), DOCX (`mammoth` HTML hierarchy), DOC, PPTX (`node-pptx-parser`), and TXT/MD.
   - Already populates:
     - `document_pages` (page-by-page cleaned text, `headings_json`, `tables_json`, `sections_json`).
     - `document_chunks` (parent-child semantic chunks with `page_start`, `page_end`, `chapter`, `unit`, `section_heading`, `heading_path`, `topics_json`, `terminology_json`).
     - `document_embeddings` (vector embeddings per chunk).
     - `document_topic_metadata` (per-file extracted `section_headings_json`, `main_topics_json`, `subtopics_json`, `terminology_json`, `summary`).
     - `academic_knowledge_graph` (`subject -> unit -> chapter -> topic -> subtopic -> file_id -> chunk_id -> page_number`).
   - `retrieveAcademicEvidence(db, ...)` in `lib/hybrid-rag-engine.js` already runs 7-strategy retrieval (`A_fts`, `B_vector`, `C_exact`, `D_topic`, `E_syllabus`, `F_related`, `G_heading`) with Reciprocal Rank Fusion (RRF) and second-stage reranking.
3. **Semester-Scoped Authorization (`lib/academic-context.js`, `lib/kyana-access.js`, `lib/ai-search-tools.js`)**:
   - `getAcademicContext(db, req)` resolves the student's `currentSemester` (1–8) and `cohortId`.
   - `resourceFilter()` and `canReadResource()` enforce that learning materials default to the student's enrolled semester while allowing explicit cross-semester queries.
4. **Adaptive Visual Blocks (`lib/academic-intelligence.js` & `public/chatbot.js`)**:
   - Already supports `syllabus`, `diagram`, `flowchart`, `trace`, `comparison`, `quiz`, `roadmap`, `timeline`, and `complexity` blocks in `public/chatbot.js`.

### 3.2 Architectural Gaps We Will Build
1. **Gap A — No Syllabus $\cup$ Teacher PDF Topic Reconciler**:
   - Currently, `get_syllabus` only reads `syllabus-data.json`, and `search_notes` only returns the top 3 matching chunks for a narrow query. When a student says *"Teach me Chapter 2 of DSA"*, Kyana does **not** enumerate all chunks/headings of all teacher PDFs uploaded for DSA Chapter 2 and merge them with the official Unit 2 syllabus subtopics.
2. **Gap B — No Stateful Step-by-Step Study Session or Progress Tracker**:
   - Currently, `ai_conversations` and `ai_messages` (`lib/ai-chat-service.js`) store chat messages, but there is no `study_partner_sessions` or `study_partner_topic_progress` table. Kyana answers in a single turn instead of pacing through a chapter micro-topic by micro-topic and tracking what has been taught vs. what remains.
3. **Gap C — No Structured PYQ (Past Year Questions) Database or Question Parser**:
   - Currently, if a teacher uploads a past question paper PDF/DOCX, it is treated as a generic note in `files`. There is no dedicated schema (`pyq_papers`, `pyq_questions`, `pyq_topic_links`) to parse individual exam questions (`Q.1a`, `Q.2b`, marks, exam year, exam type) and link each question to its exact syllabus unit and micro-topic.
4. **Gap D — No Interactive Study Partner Bar / Quick-Action Controls in Web & Mobile Chat UI**:
   - Students need an interactive **Study Partner Lesson Card** (`study_session` visual block) showing their chapter progress bar (`Topic 2 of 6 · 33% Complete`), source badges (`Syllabus + 2 Teacher PDFs + 4 PYQs`), and 1-click progression buttons (`Next Topic →`, `Test Me on This`, `Show PYQ Question`, `Explain Simpler`).

---

## 4. COMPLETE TECHNICAL ARCHITECTURE OF KYANA STUDY PARTNER (V4)

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│                   STUDENT / TEACHER REQUEST ("Teach me Chapter 2 of DSA")         │
└─────────────────────────────────────────┬─────────────────────────────────────────┘
                                          ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│ 1. SEMESTER & COURSE CONTEXT RESOLVER (`lib/kyana-agent-engine.js`)               │
│    • Student enrolled in Semester 3 -> Resolves "DSA" to CIT214 (Semester III)    │
│    • Resolves "Chapter 2" -> Unit 2: Linked Lists (5 hrs)                         │
└─────────────────────────────────────────┬─────────────────────────────────────────┘
                                          ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│ 2. SYLLABUS + NOTES + PYQ RECONCILIATION ENGINE (`lib/study-partner-reconciler.js`)│
│                                                                                   │
│  ┌─────────────────────────┐  ┌─────────────────────────┐  ┌────────────────────┐ │
│  │ Official BIT Syllabus   │  │ Teacher PDF/DOCX Notes  │  │ PYQ Question Bank  │ │
│  │ (`syllabus-data.json`)  │  │ (`document_chunks` +    │  │ (`pyq_questions` + │ │
│  │ • 2.1 Linked List ADT   │  │  `document_topic_meta`) │  │  `pyq_topic_links`)│ │
│  │ • 2.2 Singly Linked List│  │ • Node Struct in C/Java │  │ • 2080 Final Q.2a  │ │
│  │ • 2.3 Doubly Linked List│  │ • Header Linked List    │  │ • 2079 Pre-Board Q3│ │
│  │ • 2.4 Circular List     │  │ • Complexity Comparison │  │ • 2081 Mid-Term Q1 │ │
│  └────────────┬────────────┘  └────────────┬────────────┘  └─────────┬──────────┘ │
│               └─────────────────────┬──────┴─────────────────────────┘            │
│                                     ▼                                             │
│         [Ordered Master Micro-Topic Graph: Zero Topics Left Behind]               │
│         Each node tagged with: Syllabus Ref + Note File/PageIds + Linked PYQs     │
└─────────────────────────────────────────┬─────────────────────────────────────────┘
                                          ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│ 3. STATEFUL PEDAGOGICAL ENGINE (`lib/study-partner-engine.js`)                    │
│    • Persists state in `study_partner_sessions` & `study_partner_topic_progress`  │
│    • Teaches ONE Micro-Topic per turn using teacher's exact PDF/DOCX content      │
│    • Highlights inline 🔥 PYQ Exam Alerts ("Came in 2080 Final Exam [5 Marks]")   │
│    • Ends every micro-topic with a Socratic Checkpoint / Quick Trace Question     │
│    • Evaluates student reply: Remediate with simpler analogy OR Advance to next   │
└─────────────────────────────────────────┬─────────────────────────────────────────┘
                                          ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│ 4. MONOCHROME STUDY PARTNER UI (`public/chatbot.js` & `mobile/`)                  │
│    • Renders ```study_session progress header & interactive topic checklist       │
│    • Renders ```pyq_card for past exam questions with collapsible solution hints  │
│    • Renders 1-click action chips: [Next Topic →] [Practice PYQ] [Simpler Example]│
└───────────────────────────────────────────────────────────────────────────────────┘
```

### 4.1 Pillar 1: Semester-Aware Automatic Scoping (Semesters 1 to 8)
- For any authenticated student (`req.user` / `academicContext`), `enrolledSemester` is resolved deterministically from their cohort (`academicContext.cohort.currentSemester` or `academicContext.currentSemester`, integer `1`–`8`).
- When a Semester 1 student says:
  - *"What should I study today?"* or *"Teach me Chapter 3"* -> Kyana scopes to their **Semester 1** courses (`ELX111 Basic Electronics`, `BSM111 Mathematics I`, `CIT111 Computer Programming,I (C)`, `CIT112 Basics of IT`, `CIT113 Workshop: Problem Solving and Logic`, `BCT111 Business Communication Technique`).
  - When searching notes (`files`) and PYQs (`pyq_questions`), the SQL filter enforces `semester_no = ?` (the student's current semester) unless the student explicitly names a subject or semester outside their own.

### 4.2 Pillar 2: The "Zero-Topic-Left-Behind" Reconciliation Algorithm (`lib/study-partner-reconciler.js`)
When a student requests to learn a chapter/unit (e.g., *"Teach me Chapter 2 of DSA"*), `buildReconciledStudyPlan(db, { subject, semesterNo, unitOrChapter, academicContext })` executes a 4-step deterministic union:

1. **Step 1 — Parse Official Syllabus Subtopics**:
   - Extracts the ordered list of official syllabus topics for `subject` + `unitNumber` from `public/syllabus-data.json`.
   - Example for `CIT214 Data Structure and Algorithms`, Unit 2 (`Linked Lists`, `5hrs`):
     - `S1`: Linked List as an Abstract Data Type (ADT) & Pointer/Structure Review
     - `S2`: Singly Linked Lists — Representation, Insertion, Deletion, and Search
     - `S3`: Two-Way (Doubly) Linked Lists — Insertion, Deletion, and Search
     - `S4`: Circular Linked Lists — Representation and Operations
2. **Step 2 — Fetch All Authorized Teacher Notes for That Subject & Chapter**:
   - Queries `files`, `document_topic_metadata`, `document_pages`, and `document_chunks` where `subject` matches `CIT214` and `chapter` matches `Chapter 2` / `Unit 2` (or chunks whose `academic_knowledge_graph` edges map to Unit 2 topics).
   - Extracts every structural section heading (`section_heading`), `main_topics_json`, and `subtopics_json` across all teacher PDFs/DOCX for that chapter in reading order (`file_id`, `page_start`..`page_end`, `chunk_id`).
3. **Step 3 — Bipartite Semantic + Lexical Alignment (Union Graph)**:
   - Each extracted note section/topic is compared against the official syllabus subtopics (`S1..Sn`) using normalized token overlap, `CONCEPT_TAXONOMY` aliases (`lib/academic-document-understanding.js`), and chunk embedding cosine similarity (`lib/semantic-chunker.js`):
     - **Case 1: Matched (`SYLLABUS_AND_NOTE`)**: The note section explains syllabus subtopic `Sk`. Its `file_id`, `chunk_id`s, and `page_start..page_end` are attached directly to `Sk`.
     - **Case 2: Teacher Note Exclusive (`NOTE_EXCLUSIVE`)**: The teacher's PDF contains an important section/topic not explicitly written as a separate bullet in the short syllabus string (e.g., *"Header Linked Lists"*, *"Polynomial Addition using Linked List"*, or *"Reversing a Linked List Iteratively vs. Recursively"*). Instead of dropping it, the reconciler inserts it into the ordered micro-topic sequence right after its parent/preceding section!
     - **Case 3: Syllabus Core Without Uploaded Note (`SYLLABUS_ONLY`)**: A syllabus subtopic has no corresponding section in the uploaded PDFs yet. It is kept in the checklist and marked `sourceCoverage: 'syllabus_ai_supplemented'` so the AI teaches it thoroughly using curriculum knowledge while transparently noting that the uploaded PDF didn't cover that subtopic.
4. **Step 4 — Attach Linked PYQs to Each Micro-Topic**:
   - Queries `pyq_questions` and `pyq_topic_links` for the course and unit, attaching matching past exam questions (with year, exam type, marks, and question text) to each micro-topic node.

### 4.3 Pillar 3: Stateful Step-by-Step Pedagogical Engine (`lib/study-partner-engine.js`)
Instead of stateless one-shot generation, Study Partner sessions run a persistent state machine stored in `study_partner_sessions` and `study_partner_topic_progress`:

- **State 1: `SESSION_INIT` (When student says *"Teach me Chapter 2 of DSA"*)**:
  1. Creates or resumes an active row in `study_partner_sessions` for `(student_id, conversation_id, subject_code, unit_number)`.
  2. Populates `study_partner_topic_progress` with the ordered micro-topics (`step_index = 1..N`).
  3. Outputs:
     - A compact **`study_session` visual block** showing the complete Chapter 2 roadmap (`N` micro-topics, `M` teacher PDFs indexed, `P` past exam questions linked) so the student sees the full picture upfront.
     - **Step 1 Lesson (`step_index = 1`)**: Teaches **only Micro-Topic 1** in depth—synthesizing every key definition, formula, diagram (`diagram`/`trace` block), and code snippet from the linked `document_chunks` of the teacher's PDF/DOCX, citing `[File Title, Page X]`.
     - **Inline PYQ Spotlight** (if Micro-Topic 1 appeared in past exams).
     - **Socratic Checkpoint**: A short, engaging conceptual or trace question to confirm the student understood Step 1 before moving to Step 2.
- **State 2: `CHECKPOINT_EVALUATION` (When student replies to the checkpoint or says *"next" / "bujhe" / "continue"*)**:
  - **Fast-Advance Intent** (*"next"*, *"aru padham"*, *"move to next topic"*, *"skip"*): Marks current micro-topic `mastered` (or `skipped` if requested) and immediately teaches `step_index + 1`.
  - **Answer Attempt**: Evaluates the student's answer against the current micro-topic's key concepts:
    - **Correct / Partial-Correct**: Praises/affirms concisely (in English, Romanized Nepali, or Devanagari matching the student), reinforces any subtle point, marks `step_index` as `mastered`, and seamlessly transitions into teaching `step_index + 1`.
    - **Incorrect / Confused (*"bujhina"*, *"feri bujhaideu"*, *"example deu"*)**: Keeps `step_index` in `in_progress`, increments `attempts_count`, and re-teaches the concept using a fresh real-world analogy, a visual `trace`/`diagram` block, or a commented code example, followed by a simpler check question.
- **State 3: `CHAPTER_COMPLETION_AND_PYQ_DRILL` (When all micro-topics `1..N` are completed)**:
  - Congratulates the student on completing all syllabus + teacher-note topics for the chapter.
  - Presents a **Chapter Mastery Summary & Past Exam (PYQ) Workout** featuring the top past board exam questions from that chapter and an interactive `quiz` block.

### 4.4 Pillar 4: PYQ (Past Year Questions) Ingestion & Intelligence Engine (`lib/pyq-intelligence.js`)
How PYQs enter the system and link to topics:
1. **How Teachers/Admins Upload PYQs**:
   - Teachers/Admins can upload past question papers (PDF, DOCX, or image-scanned PDF) via the Library upload flow (tagged with category/chapter `'Past Questions'` / `'PYQ'`, or via dedicated PYQ upload metadata `is_pyq = 1`, `exam_year`, `exam_type`), OR enter/import structured past questions.
2. **Automatic PYQ Parser (`parsePyqDocumentToQuestions` in `lib/pyq-intelligence.js`)**:
   - Uses `lib/document-ingestion.js` (PDF.js + OCR fallback + Mammoth) to extract the raw text of any PYQ file.
   - Splits the exam paper into individual questions using structural regexes + LLM/heuristic segmentation:
     - Detects question numbers (`1.`, `Q.1 a)`, `2 (b)`, `Group A`, `Group B`, `Attempt any FIVE`).
     - Extracts marks weight (`[5]`, `(5 Marks)`, `[2+3=5]`, `10 marks`).
     - Extracts exam metadata from the header or filename (`2080 BS`, `2079 BS`, `2025 AD`, `Final Exam`, `Pre-Board`, `Mid-Term`, `Semester III`, `CIT214`).
3. **Automatic Topic-to-PYQ Linking (`linkPyqQuestionToCurriculum`)**:
   - Matches each extracted question against `academic_knowledge_graph`, `syllabus-data.json` units, and `document_chunks` using our 7-strategy Hybrid RAG scorer.
   - Stores the links in `pyq_topic_links` (`question_id`, `subject_code`, `unit_number`, `normalized_topic`, `matched_chunk_id`, `confidence`).
4. **Runtime PYQ Capabilities in Chat**:
   - **During Step-by-Step Teaching**: Automatically surfaces past questions that tested the exact micro-topic being taught.
   - **Direct PYQ Queries**: Students can ask:
     - *"Has Singly Linked List come in any previous exam?"*
     - *"Show me all PYQs from Chapter 2 of DSA"*
     - *"Which topics in Operating Systems Chapter 3 are most repeated in past exams?"*
     - *"Help me solve the 2080 Final Exam question on Banker's Algorithm according to our teacher's notes."*

---

## 5. DATABASE SCHEMA EXTENSIONS (POSTGRESQL & SQLITE COMPATIBLE)

All new tables will be added via `migrations/20261112_kyana_study_partner_and_pyq.sql` and registered in `lib/rag-schema.js` (`ensureRagSchema`) and `db.js` (`camelMap`):

```sql
-- 1. Past Year Question Papers (Links to `files` when uploaded as PDF/DOCX, or standalone)
CREATE TABLE IF NOT EXISTS pyq_papers (
  id TEXT PRIMARY KEY,
  file_id INTEGER,
  subject TEXT NOT NULL,
  subject_code TEXT,
  semester_no INTEGER NOT NULL,
  exam_year TEXT NOT NULL,              -- e.g., '2080 BS', '2081 BS', '2025 AD'
  exam_type TEXT NOT NULL DEFAULT 'Final Exam', -- 'Final Exam' | 'Pre-Board Exam' | 'Mid-Term Exam'
  university TEXT NOT NULL DEFAULT 'Gandaki University',
  title TEXT NOT NULL,
  total_marks INTEGER DEFAULT 100,
  pass_marks INTEGER DEFAULT 40,
  questions_count INTEGER NOT NULL DEFAULT 0,
  extraction_status TEXT NOT NULL DEFAULT 'INDEXED',
  uploaded_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pyq_papers_sub_sem ON pyq_papers(subject, semester_no);
CREATE INDEX IF NOT EXISTS idx_pyq_papers_code ON pyq_papers(subject_code, semester_no);

-- 2. Individual Extracted Past Exam Questions
CREATE TABLE IF NOT EXISTS pyq_questions (
  id TEXT PRIMARY KEY,
  paper_id TEXT NOT NULL,
  file_id INTEGER,
  subject TEXT NOT NULL,
  subject_code TEXT,
  semester_no INTEGER NOT NULL,
  exam_year TEXT NOT NULL,
  exam_type TEXT NOT NULL DEFAULT 'Final Exam',
  section_label TEXT,                   -- e.g., 'Group A', 'Group B', 'Long Questions'
  question_number TEXT NOT NULL,        -- e.g., '1(a)', '3(b)', '5'
  question_text TEXT NOT NULL,
  clean_question_text TEXT NOT NULL,
  marks INTEGER DEFAULT 5,
  unit_number INTEGER,                  -- Mapped syllabus unit (1..20)
  chapter_title TEXT,                   -- Mapped syllabus unit/chapter title
  primary_topic TEXT,                   -- Canonical micro-topic name
  normalized_topic TEXT,                -- Normalized lowercase topic key
  difficulty TEXT DEFAULT 'medium',     -- 'easy' | 'medium' | 'hard'
  question_category TEXT DEFAULT 'theory', -- 'theory' | 'numerical' | 'code' | 'derivation' | 'comparison'
  model_answer_hint TEXT,               -- Optional teacher/AI verified solution outline
  page_number INTEGER DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pyq_questions_sub_unit ON pyq_questions(subject, semester_no, unit_number);
CREATE INDEX IF NOT EXISTS idx_pyq_questions_norm_topic ON pyq_questions(normalized_topic);
CREATE INDEX IF NOT EXISTS idx_pyq_questions_paper ON pyq_questions(paper_id);

-- 3. Many-to-Many Links Between PYQ Questions, Syllabus Topics, and Teacher Note Chunks
CREATE TABLE IF NOT EXISTS pyq_topic_links (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  subject_code TEXT,
  semester_no INTEGER,
  unit_number INTEGER,
  topic TEXT NOT NULL,
  normalized_topic TEXT NOT NULL,
  note_file_id TEXT,                    -- Links directly to the teacher PDF that answers this PYQ
  note_chunk_id TEXT,                   -- Links directly to the exact `document_chunks.id`
  note_page_number INTEGER,
  relevance_score REAL NOT NULL DEFAULT 0.85,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pyq_links_question ON pyq_topic_links(question_id);
CREATE INDEX IF NOT EXISTS idx_pyq_links_topic ON pyq_topic_links(normalized_topic, subject);

-- 4. Stateful Study Partner Sessions (Tracks a Student's Active Chapter/Course Study Flow)
CREATE TABLE IF NOT EXISTS study_partner_sessions (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  conversation_id TEXT,
  subject TEXT NOT NULL,
  subject_code TEXT,
  semester_no INTEGER NOT NULL,
  unit_number INTEGER,
  chapter_title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE' | 'PAUSED' | 'COMPLETED'
  pedagogical_stage TEXT NOT NULL DEFAULT 'TEACHING', -- 'ORIENTATION' | 'TEACHING' | 'AWAITING_CHECKPOINT' | 'REMEDIATING' | 'PYQ_DRILL' | 'COMPLETED'
  current_step_index INTEGER NOT NULL DEFAULT 1,
  total_steps INTEGER NOT NULL DEFAULT 1,
  mastered_steps INTEGER NOT NULL DEFAULT 0,
  reconciled_plan_json TEXT NOT NULL DEFAULT '[]', -- Full ordered Syllabus U Note U PYQ plan
  source_files_json TEXT NOT NULL DEFAULT '[]',    -- Teacher PDF/DOCX files used in this chapter
  pyq_summary_json TEXT NOT NULL DEFAULT '{}',     -- Summary of PYQs matched for this chapter
  last_interaction_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_study_sessions_student ON study_partner_sessions(student_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_study_sessions_conv ON study_partner_sessions(conversation_id, status);

-- 5. Per-Micro-Topic Mastery & Coverage Tracker
CREATE TABLE IF NOT EXISTS study_partner_topic_progress (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  topic_title TEXT NOT NULL,
  normalized_topic TEXT NOT NULL,
  source_origin TEXT NOT NULL DEFAULT 'syllabus_and_note', -- 'syllabus_and_note' | 'note_exclusive' | 'syllabus_only'
  syllabus_ref TEXT,                    -- e.g., '2.2 Singly Linked Lists'
  note_citations_json TEXT DEFAULT '[]',-- Array of { fileId, title, pageStart, pageEnd, chunkIds }
  pyq_matches_json TEXT DEFAULT '[]',   -- Array of { questionId, examYear, examType, marks, questionText }
  status TEXT NOT NULL DEFAULT 'PENDING', -- 'PENDING' | 'IN_PROGRESS' | 'MASTERED' | 'NEEDS_REVIEW' | 'SKIPPED'
  checkpoint_question TEXT,
  student_last_answer TEXT,
  attempts_count INTEGER NOT NULL DEFAULT 0,
  mastered_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(session_id, step_index)
);

CREATE INDEX IF NOT EXISTS idx_study_topic_progress_session ON study_partner_topic_progress(session_id, step_index ASC);
CREATE INDEX IF NOT EXISTS idx_study_topic_progress_student ON study_partner_topic_progress(student_id, normalized_topic);
```

---

## 6. NEW AGENT TOOLS & BACKEND MODULES

We will add 3 modular domain services in `lib/` and register 5 new tools in `lib/chat-tools.js` and `lib/kyana-agent-engine.js`:

### 6.1 New Domain Services in `lib/`
1. **`lib/study-partner-reconciler.js`**:
   - `buildReconciledStudyPlan(db, { subject, semesterNo, unitNumber, chapterQuery, academicContext })`:
     - Loads official syllabus subtopics for `(subject, unitNumber)`.
     - Queries all authorized teacher PDFs/DOCX (`files` + `document_topic_metadata` + `document_chunks`) for that subject and chapter/unit.
     - Computes the ordered union of syllabus subtopics and teacher-note sections so **zero topics are left out**.
     - Attaches exact `chunk_id`s, `file_id`s, `page_start..page_end`, and linked PYQs (`pyq_questions`) to every micro-topic step.
2. **`lib/pyq-intelligence.js`**:
   - `ingestPyqDocument(db, file, { examYear, examType, buffer })`: Parses uploaded PYQ PDFs/DOCX into structured `pyq_papers` and `pyq_questions`, and populates `pyq_topic_links`.
   - `searchPyqQuestions(db, { query, subject, semesterNo, unitNumber, topic, examYear, limit })`: Retrieves verified past exam questions with frequency analytics (e.g., *"Asked 3 times: 2078, 2080, 2081"*), marks distribution, and linked teacher-note solution chunks.
3. **`lib/study-partner-engine.js`**:
   - `startOrResumeStudySession(db, { studentId, conversationId, subject, semesterNo, unitNumber, chapterQuery, academicContext })`
   - `processStudyPartnerTurn(db, { session, userMessage, academicContext, generateReply, chatMode })`:
     - Handles step-by-step teaching, Socratic checkpoint grading, remediation when a student is stuck, advancing to the next micro-topic, and launching PYQ practice drills.
     - Formats the `study_session` and `pyq_card` visual blocks for web and mobile.

### 6.2 New Tools Registered in `lib/kyana-agent-engine.js` & `lib/chat-tools.js`
1. `start_or_resume_study_session`: Initiates or continues a step-by-step chapter/unit study session reconciling syllabus, teacher PDFs/DOCX, and PYQs.
2. `advance_study_session_step`: Evaluates the student's checkpoint response or advances to the next micro-topic (`step_index + 1`), updating `study_partner_topic_progress`.
3. `get_reconciled_chapter_checklist`: Returns the side-by-side audit of Syllabus Subtopics vs. Teacher Note Topics vs. Past Exam Questions for any course unit.
4. `search_pyqs`: Searches past exam questions by subject, semester, chapter/unit, or topic, returning exact exam years, marks, and frequency counts.
5. `solve_pyq_with_notes`: Retrieves a specific past exam question alongside the exact teacher PDF passages and syllabus rubric to walk the student through a full-marks exam solution.

---

## 7. WALKTHROUGH: HOW "TEACH ME CHAPTER 2 OF DSA" EXECUTES STEP-BY-STEP

Suppose an authenticated **Semester 3** student types:
> `"bro teach me chapter 2 of dsa step by step"`

1. **Step 1 — Intent & Context Resolution (`lib/kyana-agent-engine.js`)**:
   - `understandRequest()` detects intent `study_partner_session` (`teach me ... step by step` / `chapter 2 of dsa`).
   - `resolveAcademicEntity("chapter 2 of dsa", 3)` resolves:
     - `subject`: `"Data Structure and Algorithms"` (`CIT214`)
     - `semester`: `3` (matches student's enrolled Semester 3)
     - `unitNumber`: `2` (`Unit 2: Linked Lists — 5hrs`)
2. **Step 2 — Syllabus $\cup$ Notes $\cup$ PYQ Reconciliation (`lib/study-partner-reconciler.js`)**:
   - **Syllabus Subtopics Found (4)**:
     - `2.1 Linked List as an ADT`
     - `2.2 Singly Linked Lists: Insertion, Deletion, Search`
     - `2.3 Two Way Lists: Insertion, Deletion, Search`
     - `2.4 Circular Linked List`
   - **Teacher PDF Notes Found in `files` / `document_chunks` for `CIT214` Chapter 2**:
     - Suppose teacher uploaded `DSA_Unit2_LinkedList_Complete.pdf` (18 pages) which contains:
       - Pages 1–3: *Linked List ADT & Self-Referential `struct Node` in C* -> Maps to **Step 1 (`2.1`)**
       - Pages 4–9: *Singly Linked List Insertion (Beginning, End, Specific Position), Deletion & Traversal* -> Maps to **Step 2 (`2.2`)**
       - Pages 10–11: *Reversing a Singly Linked List & Finding Middle Node (Teacher Extra)* -> Added as **Step 3 (`Note-Exclusive Topic`)** so nothing in the PDF is skipped!
       - Pages 12–15: *Doubly Linked List Operations* -> Maps to **Step 4 (`2.3`)**
       - Pages 16–18: *Circular Linked List & Header Linked List* -> Maps to **Step 5 (`2.4`)**
   - **PYQs Matched in `pyq_questions` (3 Past Questions)**:
     - `2080 Final Exam Q.2(a) [5 Marks]` -> Linked to Step 2 (`Singly Linked List Insertion/Deletion`)
     - `2079 Final Exam Q.3(b) [5 Marks]` -> Linked to Step 4 (`Doubly Linked List vs Singly Linked List`)
     - `2081 Mid-Term Q.1(c) [5 Marks]` -> Linked to Step 5 (`Circular Linked List`)
3. **Step 3 — Turn 1 Response (Orientation + Teaching Micro-Topic 1 Only)**:
   - Kyana creates `study_partner_sessions` (`current_step_index = 1`, `total_steps = 5`).
   - Kyana renders:
     1. **`study_session` Visual Block**: Shows the 5-step Chapter 2 Mastery Checklist (`[▶] Step 1/5`, `[ ] Step 2/5 🔥 PYQ 2080`, `[ ] Step 3/5 📄 PDF Extra`, `[ ] Step 4/5 🔥 PYQ 2079`, `[ ] Step 5/5 🔥 PYQ 2081`).
     2. **Micro-Topic 1 Lesson (`2.1 Linked List as an ADT & Self-Referential Structure`)**: Explains the concept clearly using the teacher's exact C `struct Node` definition from `DSA_Unit2_LinkedList_Complete.pdf` (Pages 1–3), complete with an ASCII/visual memory pointer diagram (`diagram` block).
     3. **Socratic Checkpoint**: Asks 1 short question to verify understanding of `struct Node* next` before moving to Step 2 (`Singly Linked List Insertion & Deletion`).
     4. **Interactive Action Chips**: `[Next: 2.2 Singly Linked List →]`, `[Show Page 1-3 of PDF]`, `[Give Simpler Analogy]`.

---

## 8. WEB & MOBILE UI/UX DESIGN (STRICT MONOCHROME)

Both `public/chatbot.js` (Web) and `mobile/` (Expo React Native) will support two new validated visual blocks while keeping strict monochrome tokens (`#080808`, `#141414`, `#1c1c1c`, `#282828`, `#ffffff`, `#a1a1a1`):

1. **`study_session` Visual Block**:
   - Header: `STUDY PARTNER · CIT214 · UNIT 2: LINKED LISTS` + Progress Pill (`Step 1 of 5 · 20%`).
   - Horizontal monochrome progress bar (`height: 4px`, track `#282828`, fill `#ffffff`).
   - Collapsible Topic Checklist showing all reconciled steps (`✓ Mastered`, `▶ Current Step`, `○ Pending`) with badges:
     - `SYLLABUS + PDF (p. 4–9)`
     - `PDF EXTRA (p. 10–11)`
     - `PYQ 2080 (5M)`
2. **`pyq_card` Visual Block**:
   - Renders a sleek monochrome exam card displaying:
     - Badge row: `GANDAKI UNIVERSITY · 2080 FINAL EXAM · Q.2(a) · 5 MARKS`
     - Verbatim question text.
     - Teacher Note Reference: `Covered in DSA_Unit2_LinkedList_Complete.pdf (Pages 4–7)`.
     - Interactive button: `"Practice / Show Step-by-Step Exam Answer"`.
3. **Quick-Action Study Chips Bar**:
   - Rendered below assistant study-partner turns so students on mobile or desktop can tap `"✓ I Understand — Next Topic"`, `"Explain with Simpler Example"`, `"Solve Linked PYQ"`, or `"Quiz Me"` with a single tap (`min-height: 44px` touch target).

---

## 9. WAVE-BY-WAVE IMPLEMENTATION ROADMAP & LIVING TASK TRACKER

> **Instructions for Agents**: Execute these waves in order. Mark `[ ]` -> `[/]` when starting a task, and `[x]` only after unit/integration tests pass via `node --test`.

### Wave 1: Database Schema & PYQ Intelligence Engine (Foundation)
- [ ] **Task 1.1**: Create migration `migrations/20261112_kyana_study_partner_and_pyq.sql` and update `lib/rag-schema.js` (`ensureRagSchema`) & `db.js` (`camelMap`) with `pyq_papers`, `pyq_questions`, `pyq_topic_links`, `study_partner_sessions`, and `study_partner_topic_progress` tables (compatible with both PostgreSQL and SQLite).
- [ ] **Task 1.2**: Build `lib/pyq-intelligence.js` with:
  - `parsePyqDocumentToQuestions()` (extracts individual exam questions, marks, question numbers, exam year, and exam type from PDF/DOCX/text).
  - `linkPyqQuestionToCurriculum()` (maps each question to `syllabus-data.json` units, `academic_knowledge_graph`, and teacher `document_chunks`).
  - `searchPyqQuestions()` & `getTopicPyqAnalytics()` (returns matching past questions, year list, and repetition count).
- [ ] **Task 1.3**: Add unit & integration test suite `tests/kyana-pyq-intelligence.test.js` verifying PYQ ingestion, question splitting, topic linking, and semester-scoped search on SQLite (`:memory:`).

### Wave 2: Syllabus $\cup$ Teacher Notes $\cup$ PYQ Reconciliation Engine
- [ ] **Task 2.1**: Build `lib/study-partner-reconciler.js` implementing `buildReconciledStudyPlan(db, { subject, semesterNo, unitNumber, chapterQuery, academicContext })`:
  - Parses all official subtopics from `public/syllabus-data.json`.
  - Extracts all headings, main topics, subtopics, and chunks from uploaded teacher PDFs/DOCX (`document_topic_metadata`, `document_pages`, `document_chunks`) for that subject and chapter.
  - Merges them into an ordered **Zero-Topic-Left-Behind Union Checklist** (`syllabus_and_note`, `note_exclusive`, `syllabus_only`) and attaches linked PYQs from `lib/pyq-intelligence.js`.
- [ ] **Task 2.2**: Add deterministic test suite `tests/kyana-study-partner-reconciler.test.js` proving that when a teacher PDF contains extra topics beyond the syllabus (and vice versa), 100% of topics from both sources appear in the reconciled study plan in logical pedagogical order.

### Wave 3: Stateful Step-by-Step Pedagogical Engine & Agent Integration
- [ ] **Task 3.1**: Build `lib/study-partner-engine.js` implementing the stateful session lifecycle (`startOrResumeStudySession`, `processStudyPartnerTurn`, `evaluateCheckpointResponse`, `advanceToNextMicroTopic`, `generateChapterMasteryQuiz`).
- [ ] **Task 3.2**: Integrate Study Partner routing & tools (`start_or_resume_study_session`, `advance_study_session_step`, `get_reconciled_chapter_checklist`, `search_pyqs`, `solve_pyq_with_notes`) into `lib/kyana-agent-engine.js`, `lib/chat-tools.js`, and `ai-assistant.js`.
- [ ] **Task 3.3**: Add multi-turn integration test suite `tests/kyana-study-partner-engine.test.js` testing:
  - Semester 1 student auto-scoping to Semester 1 syllabus/notes/PYQs.
  - *"Teach me Chapter 2 of DSA"* initiating Step 1 of $N$ (not dumping all at once).
  - Student answering checkpoint / saying *"next"* advancing to Step 2 of $N$.
  - Student saying *"bujhina / give simpler example"* triggering remediation on the current step.
  - Inline PYQ exam alerts appearing automatically when a taught micro-topic matches a past exam question.

### Wave 4: Web & Mobile Monochrome Study Partner UI
- [ ] **Task 4.1**: Update `lib/academic-intelligence.js` (`validateVisualBlockPayload`) and `public/chatbot.js` / `public/chatbot.css` to validate and render `study_session` and `pyq_card` visual blocks plus interactive quick-action study chips (`Next Topic →`, `Solve PYQ`, `Explain Simpler`, `Quiz Me`).
- [ ] **Task 4.2**: Update mobile chat renderer in `mobile/` to support `study_session`, `pyq_card`, and quick-action study chips with `44dp` monochrome touch targets.
- [ ] **Task 4.3**: Run full regression and UI verification suites (`npm run test:chat` and `node --test tests/kyana-*.test.js`).

---

## 10. AGENT EXECUTION & STATE SNAPSHOT LOG

| Date | Agent / Session | Phase / Wave | Summary of Work Completed | Files Created / Modified | Verification / Tests | Next Unblocked Task |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `2026-11-11` | Gemini Architect | Phase 0 (Research & Master Plan) | Audited entire Kyana AI & Hybrid RAG codebase (`ai-assistant.js`, `lib/kyana-agent-engine.js`, `lib/hybrid-rag-engine.js`, `lib/document-ingestion.js`, `lib/note-search.js`, `lib/curriculum-reasoning.js`, `public/syllabus-data.json`, `public/chatbot.js`), researched global AI study partner architectures (Khanmigo, NotebookLM Learning Guide, Duolingo Max, Course Hero), and authored the complete living master plan & schema specification. | `KYANA_STUDY_PARTNER_MASTER_PLAN.md` | Verified repository structure, existing RAG tables (`migrations/20261110_kyana_rag_document_intelligence.sql`), and 8-semester BIT syllabus structure. | **Wave 1 — Task 1.1**: Create `migrations/20261112_kyana_study_partner_and_pyq.sql` and update `lib/rag-schema.js`. |
