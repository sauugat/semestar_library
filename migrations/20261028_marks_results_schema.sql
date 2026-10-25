-- Migration: Marks Entry & Results System Schema (Exam Configurations, Student Marks, and Audit Logs)
-- File: migrations/20261028_marks_results_schema.sql
-- Non-destructive, additive, idempotent forward-only migration for PostgreSQL.

BEGIN;

-- 1. exam_configurations: Per-subject, per-semester, per-exam-type maximum marks configuration
CREATE TABLE IF NOT EXISTS exam_configurations (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  semester_no INTEGER NOT NULL CHECK (semester_no BETWEEN 1 AND 8),
  exam_type TEXT NOT NULL CHECK (exam_type IN ('Mid-Term Exam', 'Pre-Board Exam', 'Final Exam')),
  max_marks NUMERIC(8, 2) NOT NULL CHECK (max_marks > 0),
  created_by TEXT NOT NULL REFERENCES students(studentId) ON DELETE RESTRICT,
  updated_by TEXT NOT NULL REFERENCES students(studentId) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (subject_id, semester_no, exam_type)
);

CREATE INDEX IF NOT EXISTS idx_exam_configurations_subject_sem
  ON exam_configurations (subject_id, semester_no, exam_type);

-- 2. student_marks: One row per student, subject, semester, and exam type
CREATE TABLE IF NOT EXISTS student_marks (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE RESTRICT,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  semester_no INTEGER NOT NULL CHECK (semester_no BETWEEN 1 AND 8),
  cohort_id TEXT REFERENCES cohorts(id) ON DELETE SET NULL,
  exam_type TEXT NOT NULL CHECK (exam_type IN ('Mid-Term Exam', 'Pre-Board Exam', 'Final Exam')),
  obtained_marks NUMERIC(8, 2) CHECK (obtained_marks IS NULL OR (obtained_marks >= 0 AND obtained_marks <= max_marks)),
  max_marks NUMERIC(8, 2) NOT NULL CHECK (max_marks > 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at TIMESTAMPTZ,
  published_by TEXT REFERENCES students(studentId) ON DELETE SET NULL,
  created_by TEXT NOT NULL REFERENCES students(studentId) ON DELETE RESTRICT,
  updated_by TEXT NOT NULL REFERENCES students(studentId) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (student_id, subject_id, semester_no, exam_type)
);

CREATE INDEX IF NOT EXISTS idx_student_marks_subj_sem_exam
  ON student_marks (subject_id, semester_no, exam_type, status);

CREATE INDEX IF NOT EXISTS idx_student_marks_student_status
  ON student_marks (student_id, status, semester_no);

CREATE INDEX IF NOT EXISTS idx_student_marks_cohort_subj_exam
  ON student_marks (cohort_id, subject_id, exam_type);

-- 3. marks_audit_logs: Durable audit trail for exam configuration updates, draft saves, result publications, and authorized edits to published marks
CREATE TABLE IF NOT EXISTS marks_audit_logs (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  semester_no INTEGER NOT NULL CHECK (semester_no BETWEEN 1 AND 8),
  exam_type TEXT NOT NULL CHECK (exam_type IN ('Mid-Term Exam', 'Pre-Board Exam', 'Final Exam')),
  student_id TEXT REFERENCES students(studentId) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('config_created', 'config_updated', 'draft_saved', 'results_published', 'published_marks_edited')),
  actor_user_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE RESTRICT,
  actor_role TEXT NOT NULL,
  reason TEXT,
  before_state JSONB,
  after_state JSONB,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_marks_audit_subj_exam
  ON marks_audit_logs (subject_id, semester_no, exam_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_marks_audit_actor
  ON marks_audit_logs (actor_user_id, created_at DESC);

COMMIT;
