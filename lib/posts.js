async function ensurePostsSchema(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id ${db.isPostgres ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
      user_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
      content TEXT NOT NULL DEFAULT '' CHECK (length(content) <= 5000),
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
    CREATE TABLE IF NOT EXISTS post_comments (
      id ${db.isPostgres ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
      content TEXT NOT NULL CHECK (length(trim(content)) BETWEEN 1 AND 2000),
      parent_comment_id INTEGER REFERENCES post_comments(id) ON DELETE CASCADE,
      reply_to_user_id TEXT REFERENCES students(studentId) ON DELETE SET NULL,
      created_at ${db.isPostgres ? 'TIMESTAMPTZ' : 'TEXT'} NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at ${db.isPostgres ? 'TIMESTAMPTZ' : 'TEXT'},
      deleted_at ${db.isPostgres ? 'TIMESTAMPTZ' : 'TEXT'}
    );
    CREATE TABLE IF NOT EXISTS post_comment_reactions (
      id ${db.isPostgres ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
      comment_id INTEGER NOT NULL REFERENCES post_comments(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
      reaction_type TEXT NOT NULL DEFAULT 'like',
      created_at ${db.isPostgres ? 'TIMESTAMPTZ' : 'TEXT'} NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(comment_id, user_id, reaction_type)
    );
    CREATE TABLE IF NOT EXISTS post_media (
      id ${db.isPostgres ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      media_type TEXT NOT NULL DEFAULT 'image',
      url TEXT NOT NULL,
      mime_type TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at ${db.isPostgres ? 'TIMESTAMPTZ' : 'TEXT'} NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_posts_user ON posts (user_id);
    CREATE INDEX IF NOT EXISTS idx_post_likes_user ON post_likes (user_id);
    CREATE INDEX IF NOT EXISTS idx_post_submissions_user ON post_submissions (user_id);
    CREATE INDEX IF NOT EXISTS idx_post_comments_post ON post_comments (post_id);
    CREATE INDEX IF NOT EXISTS idx_post_comments_user ON post_comments (user_id);
    CREATE INDEX IF NOT EXISTS idx_post_comment_reactions_comment ON post_comment_reactions (comment_id);
    CREATE INDEX IF NOT EXISTS idx_post_comment_reactions_user ON post_comment_reactions (user_id);
    CREATE INDEX IF NOT EXISTS idx_post_media_post ON post_media (post_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_post_media_url ON post_media (url);
  `);

  // Safe non-destructive column migrations for existing post_comments tables
  const alterColumns = [
    `ALTER TABLE post_comments ADD COLUMN parent_comment_id INTEGER REFERENCES post_comments(id) ON DELETE CASCADE`,
    `ALTER TABLE post_comments ADD COLUMN reply_to_user_id TEXT REFERENCES students(studentId) ON DELETE SET NULL`,
    `ALTER TABLE post_comments ADD COLUMN updated_at ${db.isPostgres ? 'TIMESTAMPTZ' : 'TEXT'}`,
    `ALTER TABLE post_comments ADD COLUMN deleted_at ${db.isPostgres ? 'TIMESTAMPTZ' : 'TEXT'}`
  ];

  for (const alterSql of alterColumns) {
    try {
      if (typeof db.run === 'function') {
        await db.run(alterSql);
      } else if (typeof db.exec === 'function') {
        await db.exec(alterSql);
      }
    } catch (_) {
      // Ignored: Column already exists
    }
  }

  try {
    if (typeof db.exec === 'function') {
      await db.exec('CREATE INDEX IF NOT EXISTS idx_post_comments_parent ON post_comments (parent_comment_id);');
    }
  } catch (_) { }

  if (db.isPostgres) {
    try {
      if (typeof db.run === 'function') {
        await db.run('ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_content_check');
        await db.run('ALTER TABLE posts ADD CONSTRAINT posts_content_check CHECK (length(content) <= 5000)');
      } else if (typeof db.exec === 'function') {
        await db.exec('ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_content_check; ALTER TABLE posts ADD CONSTRAINT posts_content_check CHECK (length(content) <= 5000);');
      }
    } catch (_) { }
  }
}

module.exports = { ensurePostsSchema };
