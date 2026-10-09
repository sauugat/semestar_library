-- Migration: Add post visibility (audience) support
-- Supports 'everyone' and 'students_only'

ALTER TABLE posts ADD COLUMN IF NOT EXISTS visibility VARCHAR(32) NOT NULL DEFAULT 'everyone';

CREATE INDEX IF NOT EXISTS idx_posts_visibility ON posts(visibility);

-- Ensure all existing legacy posts default to 'everyone'
UPDATE posts SET visibility = 'everyone' WHERE visibility IS NULL OR visibility = '';
