-- Migration: Content Moderation & Reporting System
-- File: migrations/20261012_content_moderation.sql
-- Non-destructive, additive, idempotent forward-only migration for PostgreSQL.
-- NOTE: PREPARED FOR PHASE 4B.4. DO NOT EXECUTE DIRECTLY AGAINST PRODUCTION NEON.

BEGIN;

-- 1. Extend posts table with safe moderation state columns
ALTER TABLE posts 
ADD COLUMN IF NOT EXISTS moderation_status VARCHAR(32) NOT NULL DEFAULT 'active';

ALTER TABLE posts 
ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMPTZ;

ALTER TABLE posts 
ADD COLUMN IF NOT EXISTS moderated_by TEXT;

ALTER TABLE posts 
ADD COLUMN IF NOT EXISTS moderation_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_posts_moderation_status ON posts (moderation_status);

-- 2. Extend post_comments table with safe moderation state columns
ALTER TABLE post_comments 
ADD COLUMN IF NOT EXISTS moderation_status VARCHAR(32) NOT NULL DEFAULT 'active';

ALTER TABLE post_comments 
ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMPTZ;

ALTER TABLE post_comments 
ADD COLUMN IF NOT EXISTS moderated_by TEXT;

ALTER TABLE post_comments 
ADD COLUMN IF NOT EXISTS moderation_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_post_comments_moderation_status ON post_comments (moderation_status);

-- 3. Create content_reports table for community reporting
CREATE TABLE IF NOT EXISTS content_reports (
  id BIGSERIAL PRIMARY KEY,
  content_type VARCHAR(32) NOT NULL,
  content_id BIGINT NOT NULL,
  reporter_id TEXT NOT NULL,
  reason VARCHAR(64) NOT NULL,
  description TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_content_reports_reporter UNIQUE (reporter_id, content_type, content_id)
);

CREATE INDEX IF NOT EXISTS idx_content_reports_status ON content_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_reports_target ON content_reports (content_type, content_id);

COMMIT;
