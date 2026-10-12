-- Migration: Unified Administrative Audit Logging
-- File: migrations/20261012_admin_audit_logs.sql
-- Non-destructive, additive, idempotent forward-only migration for PostgreSQL.
-- NOTE: PREPARED FOR PHASE 4B.1. DO NOT EXECUTE DIRECTLY AGAINST PRODUCTION NEON.

BEGIN;

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE RESTRICT,
  action VARCHAR(64) NOT NULL,
  entity_type VARCHAR(64) NOT NULL,
  entity_id TEXT,
  before_state JSONB,
  after_state JSONB,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Index for chronological activity streams
CREATE INDEX IF NOT EXISTS idx_admin_audit_created_at ON admin_audit_logs (created_at DESC);

-- Index for administrator-specific audit lookups
CREATE INDEX IF NOT EXISTS idx_admin_audit_actor ON admin_audit_logs (actor_user_id, created_at DESC);

-- Index for action-filtered audits
CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON admin_audit_logs (action, created_at DESC);

-- Index for entity-targeted audits
CREATE INDEX IF NOT EXISTS idx_admin_audit_entity ON admin_audit_logs (entity_type, entity_id, created_at DESC);

COMMIT;
