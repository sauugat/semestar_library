-- Performance Indexes Migration Script
-- Safe, Non-Destructive, Idempotent (Safe to run multiple times)
-- Compatible with both PostgreSQL and SQLite
--
-- TARGET TABLES & COLUMNS:
-- 1. chat_messages:
--    - createdAt DESC: accelerates descending chronological sort and pagination (before/since)
--    - studentId: accelerates foreign key joins with students table and member lookup
--    - replyToId: accelerates self-joins on reply_msg resolution
-- 2. files:
--    - uploadedAt DESC: eliminates full table sequential sort on library files list
--    - uploadedBy: accelerates joins with students table
-- 3. file_likes:
--    - fileId: accelerates count & lookup joins (composite PK is fileId, studentId, but standalone lookup benefits query planner)
-- 4. file_comments:
--    - fileId: accelerates comment count aggregation per file

-- Index on chat_messages (createdAt DESC)
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at_desc
  ON chat_messages (createdAt DESC);

-- Index on chat_messages (studentId)
CREATE INDEX IF NOT EXISTS idx_chat_messages_student_id
  ON chat_messages (studentId);

-- Index on chat_messages (replyToId)
CREATE INDEX IF NOT EXISTS idx_chat_messages_reply_to_id
  ON chat_messages (replyToId);

-- Index on files (uploadedAt DESC)
CREATE INDEX IF NOT EXISTS idx_files_uploaded_at_desc
  ON files (uploadedAt DESC);

-- Index on files (uploadedBy)
CREATE INDEX IF NOT EXISTS idx_files_uploaded_by
  ON files (uploadedBy);

-- Index on file_likes (fileId)
CREATE INDEX IF NOT EXISTS idx_file_likes_file_id
  ON file_likes (fileId);

-- Index on file_comments (fileId)
CREATE INDEX IF NOT EXISTS idx_file_comments_file_id
  ON file_comments (fileId);
