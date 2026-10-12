-- Migration: Account Suspension and Reactivation
-- File: migrations/20261012_account_suspension.sql
-- Non-destructive, additive, idempotent forward-only migration for PostgreSQL.
-- NOTE: PREPARED FOR PHASE 4B.2. DO NOT EXECUTE DIRECTLY AGAINST PRODUCTION NEON.

BEGIN;

ALTER TABLE students 
ADD COLUMN IF NOT EXISTS account_status VARCHAR(32) NOT NULL DEFAULT 'active';

CREATE INDEX IF NOT EXISTS idx_students_account_status ON students (account_status);

COMMIT;
