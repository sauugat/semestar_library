-- Migration: Kyana AI Study Partner & PYQ Intelligence Engine
-- Compatible with PostgreSQL (Neon / PGlite) and SQLite (@libsql/client via rag-schema.js)

-- 1. Past Year Question Papers (Uploaded PDF/DOCX or standalone past exam records)
CREATE TABLE IF NOT EXISTS pyq_papers (
  id TEXT PRIMARY KEY,
  file_id INTEGER,
  subject TEXT NOT NULL,
  subject_code TEXT,
  semester_no INTEGER NOT NULL,
  exam_year TEXT NOT NULL,
  exam_type TEXT NOT NULL DEFAULT 'Final Exam',
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
  section_label TEXT,
  question_number TEXT NOT NULL,
  question_text TEXT NOT NULL,
  clean_question_text TEXT NOT NULL,
  marks INTEGER DEFAULT 5,
  unit_number INTEGER,
  chapter_title TEXT,
  primary_topic TEXT,
  normalized_topic TEXT,
  difficulty TEXT DEFAULT 'medium',
  question_category TEXT DEFAULT 'theory',
  model_answer_hint TEXT,
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
  note_file_id TEXT,
  note_chunk_id TEXT,
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
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  pedagogical_stage TEXT NOT NULL DEFAULT 'TEACHING',
  current_step_index INTEGER NOT NULL DEFAULT 1,
  total_steps INTEGER NOT NULL DEFAULT 1,
  mastered_steps INTEGER NOT NULL DEFAULT 0,
  reconciled_plan_json TEXT NOT NULL DEFAULT '[]',
  source_files_json TEXT NOT NULL DEFAULT '[]',
  pyq_summary_json TEXT NOT NULL DEFAULT '{}',
  last_interaction_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_study_sessions_student ON study_partner_sessions(student_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_study_sessions_conv ON study_partner_sessions(conversation_id, status);

-- 5. Per-Micro-Topic Mastery & Coverage Tracker
CREATE TABLE IF NOT EXISTS study_partner_topic_progress (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  topic_title TEXT NOT NULL,
  normalized_topic TEXT NOT NULL,
  source_origin TEXT NOT NULL DEFAULT 'syllabus_and_note',
  syllabus_ref TEXT,
  note_citations_json TEXT DEFAULT '[]',
  pyq_matches_json TEXT DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'PENDING',
  checkpoint_question TEXT,
  student_last_answer TEXT,
  attempts_count INTEGER NOT NULL DEFAULT 0,
  mastered_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(session_id, step_index)
);

CREATE INDEX IF NOT EXISTS idx_study_topic_progress_session ON study_partner_topic_progress(session_id, step_index);
CREATE INDEX IF NOT EXISTS idx_study_topic_progress_student ON study_partner_topic_progress(student_id, normalized_topic);
