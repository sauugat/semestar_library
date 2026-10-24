-- Migration: Google Drive Attendance Backup Schema (Teacher Connections, Immutable Revision Outbox & Per-Artifact State)
-- File: migrations/20261025_attendance_drive_backup.sql
-- Non-destructive, additive, idempotent forward-only migration for PostgreSQL.
-- Stores ONLY non-secret metadata, canonical snapshot payloads, and SHA-256 hashes (NEVER OAuth tokens or secrets).

BEGIN;

-- 1. Track latest revision number on attendance_sessions for transaction-safe monotonic revision allocation
ALTER TABLE attendance_sessions
  ADD COLUMN IF NOT EXISTS latest_revision_no INTEGER NOT NULL DEFAULT 1;

-- 2. teacher_drive_connections: Non-secret Google Drive folder & connection state per teacher
CREATE TABLE IF NOT EXISTS teacher_drive_connections (
  teacher_id TEXT PRIMARY KEY REFERENCES teachers(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL UNIQUE REFERENCES students(studentId) ON DELETE RESTRICT,
  google_email TEXT,
  root_folder_id TEXT,
  root_folder_name TEXT DEFAULT 'Semester Library Attendance Backups',
  daily_folder_id TEXT,
  full_folder_id TEXT,
  snapshots_folder_id TEXT,
  connection_status TEXT NOT NULL DEFAULT 'disconnected'
    CHECK (connection_status IN ('disconnected', 'connected', 'reconnect_required')),
  last_synced_at TIMESTAMPTZ,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE teacher_drive_connections
  ADD COLUMN IF NOT EXISTS root_folder_name TEXT DEFAULT 'Semester Library Attendance Backups';

CREATE INDEX IF NOT EXISTS idx_teacher_drive_connections_user
  ON teacher_drive_connections (user_id);

CREATE INDEX IF NOT EXISTS idx_teacher_drive_connections_status
  ON teacher_drive_connections (connection_status);

-- 3. attendance_backup_runs: Durable outbox & immutable revision ledger per committed attendance change
CREATE TABLE IF NOT EXISTS attendance_backup_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES attendance_sessions(id) ON DELETE RESTRICT,
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE RESTRICT,
  revision_no INTEGER NOT NULL CHECK (revision_no >= 1),
  audit_log_id TEXT NOT NULL UNIQUE REFERENCES attendance_audit_logs(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('session_created', 'teacher_edit', 'admin_correction')),
  previous_snapshot_sha256 TEXT,
  snapshot_sha256 TEXT NOT NULL CHECK (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  snapshot_payload JSONB NOT NULL,
  backup_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (backup_status IN ('pending', 'in_progress', 'backed_up', 'failed', 'reconnect_required')),
  snapshot_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (snapshot_status IN ('pending', 'in_progress', 'backed_up', 'failed', 'reconnect_required', 'superseded')),
  daily_workbook_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (daily_workbook_status IN ('pending', 'in_progress', 'backed_up', 'failed', 'reconnect_required', 'superseded')),
  annual_workbook_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (annual_workbook_status IN ('pending', 'in_progress', 'backed_up', 'failed', 'reconnect_required', 'superseded')),
  snapshot_drive_file_id TEXT,
  daily_drive_file_id TEXT,
  annual_drive_file_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error_code TEXT,
  last_error_message TEXT,
  claimed_by_client_id TEXT,
  lease_expires_at TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ,
  next_retry_at TIMESTAMPTZ,
  backed_up_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (session_id, revision_no),
  UNIQUE (session_id, snapshot_sha256)
);

CREATE INDEX IF NOT EXISTS idx_attendance_backup_runs_teacher_status
  ON attendance_backup_runs (teacher_id, backup_status, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_attendance_backup_runs_session_rev
  ON attendance_backup_runs (session_id, revision_no DESC);

-- 4. attendance_backup_artifacts: Independent per-artifact state, lease/claim, retry bounds, and Drive file metadata
CREATE TABLE IF NOT EXISTS attendance_backup_artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES attendance_backup_runs(id) ON DELETE RESTRICT,
  session_id TEXT NOT NULL REFERENCES attendance_sessions(id) ON DELETE RESTRICT,
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE RESTRICT,
  revision_no INTEGER NOT NULL CHECK (revision_no >= 1),
  artifact_type TEXT NOT NULL CHECK (artifact_type IN ('snapshot', 'daily_workbook', 'annual_workbook')),
  target_scope_key TEXT NOT NULL,
  snapshot_sha256 TEXT NOT NULL CHECK (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  artifact_sha256 TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'backed_up', 'failed', 'reconnect_required', 'superseded')),
  drive_file_id TEXT,
  drive_file_name TEXT,
  mime_type TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),
  claim_token TEXT,
  claimed_by_client_id TEXT,
  claimed_at TIMESTAMPTZ,
  lease_expires_at TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ,
  next_retry_at TIMESTAMPTZ,
  last_error_code TEXT,
  last_error_message TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (run_id, artifact_type)
);

CREATE INDEX IF NOT EXISTS idx_attendance_backup_artifacts_run
  ON attendance_backup_artifacts (run_id);

CREATE INDEX IF NOT EXISTS idx_attendance_backup_artifacts_teacher_status
  ON attendance_backup_artifacts (teacher_id, status, next_retry_at);

CREATE INDEX IF NOT EXISTS idx_attendance_backup_artifacts_session_type
  ON attendance_backup_artifacts (session_id, artifact_type, revision_no DESC);

COMMIT;
