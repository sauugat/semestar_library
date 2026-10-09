-- Semester Library Post Category & Semester Targeting Migration
-- PostgreSQL / Neon compatible, non-destructive, idempotent

ALTER TABLE posts ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'general';
ALTER TABLE posts ADD COLUMN IF NOT EXISTS target_all_semesters INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS post_target_semesters (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  semester INTEGER NOT NULL CHECK (semester BETWEEN 1 AND 8),
  PRIMARY KEY (post_id, semester)
);

CREATE INDEX IF NOT EXISTS idx_posts_category ON posts (category);
CREATE INDEX IF NOT EXISTS idx_posts_target_all_sem ON posts (target_all_semesters);
CREATE INDEX IF NOT EXISTS idx_post_target_semesters_sem ON post_target_semesters (semester);

-- Backfill legacy posts
UPDATE posts SET category = 'general' WHERE category IS NULL OR category = '';
UPDATE posts SET target_all_semesters = 1 WHERE target_all_semesters IS NULL;
