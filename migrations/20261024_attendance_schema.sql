-- Migration: Attendance System Schema (Sessions, Records, Audit Logs, and Settings)
-- File: migrations/20261024_attendance_schema.sql
-- Non-destructive, additive, idempotent forward-only migration for PostgreSQL.

BEGIN;

-- 1. attendance_sessions: One row per class attendance session (unique per cohort, subject, and calendar date)
CREATE TABLE IF NOT EXISTS attendance_sessions (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  cohort_id TEXT NOT NULL REFERENCES cohorts(id) ON DELETE RESTRICT,
  semester_no INTEGER NOT NULL CHECK (semester_no BETWEEN 1 AND 8),
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE RESTRICT,
  recorded_by_user_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE RESTRICT,
  session_date TEXT NOT NULL CHECK (session_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('draft', 'submitted', 'locked')),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (cohort_id, subject_id, session_date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_sessions_cohort_sem_subj
  ON attendance_sessions (cohort_id, semester_no, subject_id, session_date DESC);

CREATE INDEX IF NOT EXISTS idx_attendance_sessions_teacher_date
  ON attendance_sessions (teacher_id, session_date DESC);

-- 2. attendance_records: One row per student per attendance session
CREATE TABLE IF NOT EXISTS attendance_records (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES attendance_sessions(id) ON DELETE RESTRICT,
  student_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('present', 'absent')),
  marked_by TEXT NOT NULL REFERENCES students(studentId) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (session_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_attendance_records_session
  ON attendance_records (session_id);

CREATE INDEX IF NOT EXISTS idx_attendance_records_student_session
  ON attendance_records (student_id, session_id);

-- 3. attendance_audit_logs: Durable audit trail for session creations, 24h teacher edits, and post-24h admin corrections
CREATE TABLE IF NOT EXISTS attendance_audit_logs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES attendance_sessions(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('session_created', 'teacher_edit', 'admin_correction', 'session_locked')),
  actor_user_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE RESTRICT,
  actor_role TEXT NOT NULL,
  reason TEXT,
  before_state JSONB,
  after_state JSONB,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_attendance_audit_session
  ON attendance_audit_logs (session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_attendance_audit_actor
  ON attendance_audit_logs (actor_user_id, created_at DESC);

-- 4. attendance_settings: Admin-configurable attendance settings (e.g., eligibility_threshold_percent)
CREATE TABLE IF NOT EXISTS attendance_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_by TEXT REFERENCES students(studentId) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMIT;
