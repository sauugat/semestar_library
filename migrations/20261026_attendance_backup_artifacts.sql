-- Migration: Phase 2 Per-Artifact Backup Tracking & Lease Recovery
-- File: migrations/20261026_attendance_backup_artifacts.sql
-- Additive, idempotent migration for environments that already applied 20261025_attendance_drive_backup.sql.

BEGIN;

ALTER TABLE teacher_drive_connections
  ADD COLUMN IF NOT EXISTS root_folder_name TEXT DEFAULT 'Semester Library Attendance Backups';

-- Widen per-artifact status CHECK constraints on attendance_backup_runs if needed
DO $$ BEGIN
  ALTER TABLE attendance_backup_runs DROP CONSTRAINT IF EXISTS attendance_backup_runs_snapshot_status_check;
  ALTER TABLE attendance_backup_runs DROP CONSTRAINT IF EXISTS attendance_backup_runs_daily_workbook_status_check;
  ALTER TABLE attendance_backup_runs DROP CONSTRAINT IF EXISTS attendance_backup_runs_annual_workbook_status_check;

  ALTER TABLE attendance_backup_runs
    ADD CONSTRAINT attendance_backup_runs_snapshot_status_check
    CHECK (snapshot_status IN ('pending', 'in_progress', 'backed_up', 'failed', 'reconnect_required', 'superseded'));
  ALTER TABLE attendance_backup_runs
    ADD CONSTRAINT attendance_backup_runs_daily_workbook_status_check
    CHECK (daily_workbook_status IN ('pending', 'in_progress', 'backed_up', 'failed', 'reconnect_required', 'superseded'));
  ALTER TABLE attendance_backup_runs
    ADD CONSTRAINT attendance_backup_runs_annual_workbook_status_check
    CHECK (annual_workbook_status IN ('pending', 'in_progress', 'backed_up', 'failed', 'reconnect_required', 'superseded'));
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

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
