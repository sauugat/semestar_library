-- Safe, Non-Destructive PostgreSQL Migration Script
-- DO NOT RUN ON PRODUCTION WITHOUT BACKUP
--
-- Objective:
-- 1. Preserve all existing submission data, marks, timestamps, and code.
-- 2. Support multi-question assignments while maintaining backward compatibility with legacy single-question assignments.
-- 3. Correctly handle PostgreSQL's NULL semantics:
--    In PostgreSQL, a standard UNIQUE(assignmentId, studentId, questionId) constraint treats NULL != NULL,
--    allowing duplicate rows where questionId IS NULL.
--    By creating two partial unique indexes, we strictly enforce:
--    - At most ONE submission per (assignmentId, studentId, questionId) when questionId IS NOT NULL.
--    - At most ONE submission per (assignmentId, studentId) when questionId IS NULL (legacy submissions).
-- 4. Include all required new security & reliability tables and indexes:
--    - chat_pinned for persistent pinned chat messages.
--    - login_attempts for shared database-backed brute-force rate limiting.

BEGIN;

-- Step 1: Ensure submissions columns exist without modifying existing data
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS questionId INTEGER REFERENCES assignment_questions(id) ON DELETE CASCADE;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS stdout TEXT;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS stderr TEXT;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS testResults TEXT;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS questionTitle TEXT;

-- Step 2: Safely drop legacy assignment-level unique constraints if present
-- (Drop constraints that restricted a student to only 1 submission per entire assignment)
ALTER TABLE submissions DROP CONSTRAINT IF EXISTS submissions_assignmentid_studentid_key;
ALTER TABLE submissions DROP CONSTRAINT IF EXISTS submissions_assignmentId_studentId_key;
ALTER TABLE submissions DROP CONSTRAINT IF EXISTS submissions_unique;

-- Step 3: Create partial unique indexes to guarantee integrity for both question-level and legacy submissions
CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_question
  ON submissions (assignmentId, studentId, questionId)
  WHERE questionId IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_legacy
  ON submissions (assignmentId, studentId)
  WHERE questionId IS NULL;

-- Step 4: Add lookup index for student submission queries
CREATE INDEX IF NOT EXISTS idx_submissions_student_lookup
  ON submissions (assignmentId, studentId);

-- Step 5: Ensure chat_pinned table exists for persistent message pins
CREATE TABLE IF NOT EXISTS chat_pinned (
  id INTEGER PRIMARY KEY,
  messageId INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  text TEXT,
  senderName TEXT,
  pinnedBy TEXT,
  pinnedAt TIMESTAMPTZ NOT NULL
);

-- Step 6: Ensure login_attempts table exists for shared database-backed rate limiting
CREATE TABLE IF NOT EXISTS login_attempts (
  ip TEXT PRIMARY KEY,
  attemptCount INTEGER DEFAULT 0,
  lockedUntil TIMESTAMPTZ,
  lastAttemptAt TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_locked ON login_attempts (lockedUntil);

-- Step 7: Ensure mobile_tokens table exists for mobile bearer authentication
CREATE TABLE IF NOT EXISTS mobile_tokens (
  token TEXT PRIMARY KEY,
  studentId TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
  createdAt TIMESTAMPTZ NOT NULL,
  expiresAt TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mobile_tokens_expires ON mobile_tokens (expiresAt);
CREATE INDEX IF NOT EXISTS idx_mobile_tokens_student ON mobile_tokens (studentId);

COMMIT;

