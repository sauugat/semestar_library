'use strict';

/**
 * Safe Performance Audit Index Migration
 * Applies missing indexes in deterministic order using CREATE INDEX IF NOT EXISTS.
 */
const INDEX_MIGRATION_STEPS = [
  {
    order: 1,
    name: 'idx_chat_messages_created_at',
    table: 'chat_messages',
    sql: 'CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages (createdAt DESC)'
  },
  {
    order: 2,
    name: 'idx_chat_messages_student_created',
    table: 'chat_messages',
    sql: 'CREATE INDEX IF NOT EXISTS idx_chat_messages_student_created ON chat_messages (studentId, createdAt DESC)'
  },
  {
    order: 3,
    name: 'idx_files_uploaded_at',
    table: 'files',
    sql: 'CREATE INDEX IF NOT EXISTS idx_files_uploaded_at ON files (uploadedAt DESC)'
  },
  {
    order: 4,
    name: 'idx_files_uploaded_by',
    table: 'files',
    sql: 'CREATE INDEX IF NOT EXISTS idx_files_uploaded_by ON files (uploadedBy)'
  },
  {
    order: 5,
    name: 'idx_files_subject_chapter',
    table: 'files',
    sql: 'CREATE INDEX IF NOT EXISTS idx_files_subject_chapter ON files (subject, chapter)'
  },
  {
    order: 6,
    name: 'idx_file_comments_file_id',
    table: 'file_comments',
    sql: 'CREATE INDEX IF NOT EXISTS idx_file_comments_file_id ON file_comments (fileId, createdAt ASC)'
  },
  {
    order: 7,
    name: 'idx_file_likes_file_id',
    table: 'file_likes',
    sql: 'CREATE INDEX IF NOT EXISTS idx_file_likes_file_id ON file_likes (fileId)'
  },
  {
    order: 8,
    name: 'idx_posts_created_at',
    table: 'posts',
    sql: 'CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts (created_at DESC)'
  },
  {
    order: 9,
    name: 'idx_posts_user_id',
    table: 'posts',
    sql: 'CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts (user_id)'
  },
  {
    order: 10,
    name: 'idx_post_media_post_id',
    table: 'post_media',
    sql: 'CREATE INDEX IF NOT EXISTS idx_post_media_post_id ON post_media (post_id, sort_order ASC)'
  },
  {
    order: 11,
    name: 'idx_post_comments_post_id',
    table: 'post_comments',
    sql: 'CREATE INDEX IF NOT EXISTS idx_post_comments_post_id ON post_comments (post_id)'
  },
  {
    order: 12,
    name: 'idx_post_likes_post_id',
    table: 'post_likes',
    sql: 'CREATE INDEX IF NOT EXISTS idx_post_likes_post_id ON post_likes (post_id)'
  },
  {
    order: 13,
    name: 'idx_submissions_assignment_student',
    table: 'submissions',
    sql: 'CREATE INDEX IF NOT EXISTS idx_submissions_assignment_student ON submissions (assignmentId, studentId)'
  },
  {
    order: 14,
    name: 'idx_follows_following_id',
    table: 'follows',
    sql: 'CREATE INDEX IF NOT EXISTS idx_follows_following_id ON follows (followingId)'
  }
];

async function ensurePerfAuditIndexes(dbOrExec) {
  const execFn = typeof dbOrExec === 'function' ? dbOrExec : (dbOrExec && dbOrExec.exec ? dbOrExec.exec.bind(dbOrExec) : null);
  if (!execFn) return;
  for (const step of INDEX_MIGRATION_STEPS) {
    try {
      await execFn(step.sql);
    } catch (_) {
      // Ignore if an optional table is not yet created
    }
  }
}

module.exports = {
  INDEX_MIGRATION_STEPS,
  ensurePerfAuditIndexes
};
