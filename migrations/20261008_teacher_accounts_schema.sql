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

-- Seed 45 canonical BIT courses from Gandaki University curriculum
INSERT INTO subjects (id, code, name, semester, department, credit_hours, nature, active, updated_at) VALUES
  ('ELX111', 'ELX111', 'Basic Electronics', 1, 'BIT', 3, 'TH + PR', TRUE, CURRENT_TIMESTAMP),
  ('BSM111', 'BSM111', 'Mathematics I', 1, 'BIT', 3, 'TH', TRUE, CURRENT_TIMESTAMP),
  ('CIT111', 'CIT111', 'Computer Programming,I (C)', 1, 'BIT', 3, 'TH + PR', TRUE, CURRENT_TIMESTAMP),
  ('CIT112', 'CIT112', 'Basics of IT', 1, 'BIT', 3, 'TH', TRUE, CURRENT_TIMESTAMP),
  ('CIT113', 'CIT113', 'Workshop: Problem Solving and Logic', 1, 'BIT', 1, 'PR', TRUE, CURRENT_TIMESTAMP),
  ('BCT111', 'BCT111', 'Business Communication Technique', 1, 'BIT', 2, 'TH', TRUE, CURRENT_TIMESTAMP),
  ('CIT121', 'CIT121', 'Discrete Mathematics', 2, 'BIT', 3, 'TH', TRUE, CURRENT_TIMESTAMP),
  ('CIT122', 'CIT122', 'Computer Programming II (Java)', 2, 'BIT', 3, 'TH + PR', TRUE, CURRENT_TIMESTAMP),
  ('BSM121', 'BSM121', 'Mathematics II', 2, 'BIT', 3, 'TH', TRUE, CURRENT_TIMESTAMP),
  ('ELX121', 'ELX121', 'Digital Logic', 2, 'BIT', 3, 'TH + PR', TRUE, CURRENT_TIMESTAMP),
  ('CIT123', 'CIT123', 'Web Technology I', 2, 'BIT', 3, 'TH + PR', TRUE, CURRENT_TIMESTAMP),
  ('CIT124', 'CIT124', 'Project I', 2, 'BIT', 2, 'PR', TRUE, CURRENT_TIMESTAMP),
  ('CIT214', 'CIT214', 'Data Structure and Algorithms', 3, 'BIT', 3, 'TH + PR', TRUE, CURRENT_TIMESTAMP),
  ('CIT213', 'CIT213', 'Database Management System', 3, 'BIT', 3, 'TH', TRUE, CURRENT_TIMESTAMP),
  ('ELX211', 'ELX211', 'Microprocessor and Computer Architecture', 3, 'BIT', 4, 'TH + PR', TRUE, CURRENT_TIMESTAMP),
  ('BCT211', 'BCT211', 'Principles of Organization and Management', 3, 'BIT', 3, 'TH', TRUE, CURRENT_TIMESTAMP),
  ('CIT212', 'CIT212', 'Software Engineering', 3, 'BIT', 3, 'TH + PR', TRUE, CURRENT_TIMESTAMP),
  ('CIT211', 'CIT211', 'Web Technology II', 3, 'BIT', 3, 'TH + PR', TRUE, CURRENT_TIMESTAMP),
  ('CIT224', 'CIT224', 'Computer Graphics Technology', 4, 'BIT', 3, 'TH + PR', TRUE, CURRENT_TIMESTAMP),
  ('CIT223', 'CIT223', 'Data Communication and Computer Networks', 4, 'BIT', 4, 'TH + PR', TRUE, CURRENT_TIMESTAMP),
  ('CIT222', 'CIT222', 'Management Information System', 4, 'BIT', 3, 'TH + PR', TRUE, CURRENT_TIMESTAMP),
  ('CIT221', 'CIT221', 'Operating Systems', 4, 'BIT', 3, 'TH + PR', TRUE, CURRENT_TIMESTAMP),
  ('BSM221', 'BSM221', 'Fundamentals of Probability and Statistics', 4, 'BIT', 3, 'TH + PR', TRUE, CURRENT_TIMESTAMP),
  ('CIT225', 'CIT225', 'Project II', 4, 'BIT', 2, 'PR', TRUE, CURRENT_TIMESTAMP),
  ('BCT311', 'BCT311', 'Economics', 5, 'BIT', 3, 'TH', TRUE, CURRENT_TIMESTAMP),
  ('CIT311', 'CIT311', 'Mobile Application Development', 5, 'BIT', 3, 'TH + PR', TRUE, CURRENT_TIMESTAMP),
  ('BSM311', 'BSM311', 'Numerical Methods', 5, 'BIT', 3, 'TH + PR', TRUE, CURRENT_TIMESTAMP),
  ('CIT312', 'CIT312', 'Object Oriented Analysis and Design using UML', 5, 'BIT', 3, 'TH + PR', TRUE, CURRENT_TIMESTAMP),
  ('BCT312', 'BCT312', 'Research Methodology', 5, 'BIT', 3, 'TH', TRUE, CURRENT_TIMESTAMP),
  ('BCT313', 'BCT313', 'Technical Proposal Writing', 5, 'BIT', 1, 'PR', TRUE, CURRENT_TIMESTAMP),
  ('CIT323', 'CIT323', 'Artificial Intelligence', 6, 'BIT', 3, 'TH + PR', TRUE, CURRENT_TIMESTAMP),
  ('CIT322', 'CIT322', 'Digital Forensic Security Technologies', 6, 'BIT', 3, 'TH + PR', TRUE, CURRENT_TIMESTAMP),
  ('BCT322', 'BCT322', 'Financial Accounting', 6, 'BIT', 3, 'TH', TRUE, CURRENT_TIMESTAMP),
  ('CIT321', 'CIT321', 'Human Computer Interface and UI Design', 6, 'BIT', 3, 'TH + PR', TRUE, CURRENT_TIMESTAMP),
  ('BCT321', 'BCT321', 'IT Project Management', 6, 'BIT', 3, 'TH', TRUE, CURRENT_TIMESTAMP),
  ('CIT324', 'CIT324', 'Project III', 6, 'BIT', 2, 'PR', TRUE, CURRENT_TIMESTAMP),
  ('CIT413', 'CIT413', 'Cloud Computing', 7, 'BIT', 3, 'TH + PR', TRUE, CURRENT_TIMESTAMP),
  ('CIT411', 'CIT411', 'Data Mining and Warehousing', 7, 'BIT', 3, 'TH + PR', TRUE, CURRENT_TIMESTAMP),
  ('CIT412', 'CIT412', 'Software Development and Operations (DevOps)', 7, 'BIT', 3, 'TH + PR', TRUE, CURRENT_TIMESTAMP),
  ('BCT411', 'BCT411', 'Technology Entrepreneurship', 7, 'BIT', 3, 'TH', TRUE, CURRENT_TIMESTAMP),
  ('CIT414', 'CIT414', 'Wireless Communication Systems', 7, 'BIT', 3, 'TH + PR', TRUE, CURRENT_TIMESTAMP),
  ('CIT421', 'CIT421', 'Big Data Technologies', 8, 'BIT', 3, 'TH + PR', TRUE, CURRENT_TIMESTAMP),
  ('BCT421', 'BCT421', 'Society, IT and Law', 8, 'BIT', 3, 'TH', TRUE, CURRENT_TIMESTAMP),
  ('CIT422', 'CIT422', 'Internship', 8, 'BIT', 2, 'PR', TRUE, CURRENT_TIMESTAMP),
  ('CIT423', 'CIT423', 'Project IV', 8, 'BIT', 6, 'PR', TRUE, CURRENT_TIMESTAMP)
ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code,
  name = EXCLUDED.name,
  semester = EXCLUDED.semester,
  credit_hours = EXCLUDED.credit_hours,
  nature = EXCLUDED.nature,
  active = EXCLUDED.active,
  updated_at = CURRENT_TIMESTAMP;

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
  last_verification_sent_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE teacher_onboarding_pending ADD COLUMN IF NOT EXISTS last_verification_sent_at TIMESTAMPTZ;

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
