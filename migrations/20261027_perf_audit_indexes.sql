-- =============================================================================
-- Safe Performance Audit Index Migration (PostgreSQL & SQLite compatible)
-- Migration Order:
--   1. chat_messages(createdAt DESC) & chat_messages(studentId, createdAt DESC)
--   2. files(uploadedAt DESC), files(uploadedBy), files(subject, chapter)
--   3. file_comments(fileId, createdAt ASC) & file_likes(fileId)
--   4. posts(created_at DESC) & posts(user_id)
--   5. post_media(post_id, sort_order ASC), post_comments(post_id), post_likes(post_id)
--   6. submissions(assignmentId, studentId) & follows(followingId)
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages (createdAt DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_student_created ON chat_messages (studentId, createdAt DESC);

CREATE INDEX IF NOT EXISTS idx_files_uploaded_at ON files (uploadedAt DESC);
CREATE INDEX IF NOT EXISTS idx_files_uploaded_by ON files (uploadedBy);
CREATE INDEX IF NOT EXISTS idx_files_subject_chapter ON files (subject, chapter);

CREATE INDEX IF NOT EXISTS idx_file_comments_file_id ON file_comments (fileId, createdAt ASC);
CREATE INDEX IF NOT EXISTS idx_file_likes_file_id ON file_likes (fileId);

CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts (user_id);
CREATE INDEX IF NOT EXISTS idx_post_media_post_id ON post_media (post_id, sort_order ASC);
CREATE INDEX IF NOT EXISTS idx_post_comments_post_id ON post_comments (post_id);
CREATE INDEX IF NOT EXISTS idx_post_likes_post_id ON post_likes (post_id);

CREATE INDEX IF NOT EXISTS idx_submissions_assignment_student ON submissions (assignmentId, studentId);
CREATE INDEX IF NOT EXISTS idx_follows_following_id ON follows (followingId);
