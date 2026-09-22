async function ensurePostsSchema(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id ${db.isPostgres ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
      user_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
      content TEXT NOT NULL CHECK (length(trim(content)) BETWEEN 1 AND 5000),
      type TEXT NOT NULL DEFAULT 'status' CHECK (type IN ('status', 'assignment', 'notice')),
      attachment_url TEXT,
      created_at ${db.isPostgres ? 'TIMESTAMPTZ' : 'TEXT'} NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS post_likes (
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
      PRIMARY KEY (post_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS post_submissions (
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
      submitted_at ${db.isPostgres ? 'TIMESTAMPTZ' : 'TEXT'} NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (post_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_posts_user ON posts (user_id);
    CREATE INDEX IF NOT EXISTS idx_post_likes_user ON post_likes (user_id);
    CREATE INDEX IF NOT EXISTS idx_post_submissions_user ON post_submissions (user_id);
  `);
}

module.exports = { ensurePostsSchema };
