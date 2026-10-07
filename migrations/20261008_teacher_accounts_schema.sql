-- Migration: Teacher Accounts, Subjects Catalog, and Teacher Capabilities
-- File: migrations/20261008_teacher_accounts_schema.sql
-- Non-destructive, additive, idempotent migration for PostgreSQL.

BEGIN;

-- 1. teacher_invites: Provisioning & temporary first-login credentials
CREATE TABLE IF NOT EXISTS teacher_invites (
  id TEXT PRIMARY KEY,
  initial_username TEXT NOT NULL,
  temporary_password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'provisioned' CHECK (status IN ('provisioned', 'onboarding', 'awaiting_email_verification', 'completed', 'expired', 'disabled')),
  expires_at TIMESTAMPTZ NOT NULL,
  claimed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  onboarding_nonce INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT REFERENCES students(studentId) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_teacher_invites_username ON teacher_invites (LOWER(initial_username));
CREATE INDEX IF NOT EXISTS idx_teacher_invites_status ON teacher_invites (status);
CREATE INDEX IF NOT EXISTS idx_teacher_invites_expires ON teacher_invites (expires_at);

-- 2. subjects: Canonical Gandaki University BIT curriculum catalog
CREATE TABLE IF NOT EXISTS subjects (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  semester INTEGER NOT NULL CHECK (semester BETWEEN 1 AND 8),
  department TEXT NOT NULL DEFAULT 'BIT',
  credit_hours NUMERIC(3, 1) DEFAULT 3.0,
  nature TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_subjects_semester ON subjects (semester);
CREATE UNIQUE INDEX IF NOT EXISTS idx_subjects_code ON subjects (code);

-- 3. teachers: Domain table for faculty profiles (Auth identity anchored in students)
CREATE TABLE IF NOT EXISTS teachers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES students(studentId) ON DELETE CASCADE,
  invite_id TEXT UNIQUE REFERENCES teacher_invites(id) ON DELETE SET NULL,
  designation TEXT DEFAULT 'Instructor',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_teachers_user_id ON teachers (user_id);
CREATE INDEX IF NOT EXISTS idx_teachers_status ON teachers (status);

-- 4. teacher_subjects: Capabilities mapping (many-to-many relationship)
CREATE TABLE IF NOT EXISTS teacher_subjects (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(teacher_id, subject_id)
);

-- 5. teacher_onboarding_pending: Pending registration state before email verification
CREATE TABLE IF NOT EXISTS teacher_onboarding_pending (
  id TEXT PRIMARY KEY,
  invite_id TEXT NOT NULL UNIQUE REFERENCES teacher_invites(id) ON DELETE CASCADE,
  supabase_uid TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_verification_sent_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE teacher_onboarding_pending ADD COLUMN IF NOT EXISTS last_verification_sent_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS idx_teacher_pending_username ON teacher_onboarding_pending (LOWER(username));
CREATE UNIQUE INDEX IF NOT EXISTS idx_teacher_pending_email ON teacher_onboarding_pending (LOWER(email));
CREATE UNIQUE INDEX IF NOT EXISTS idx_teacher_pending_supabase_uid ON teacher_onboarding_pending (supabase_uid);

-- 6. teacher_onboarding_pending_subjects: Multi-subject selection awaiting verification
CREATE TABLE IF NOT EXISTS teacher_onboarding_pending_subjects (
  id TEXT PRIMARY KEY,
  pending_id TEXT NOT NULL REFERENCES teacher_onboarding_pending(id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(pending_id, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_teacher_pending_subjects_pending ON teacher_onboarding_pending_subjects (pending_id);
CREATE INDEX IF NOT EXISTS idx_teacher_pending_subjects_subject ON teacher_onboarding_pending_subjects (subject_id);

COMMIT;
