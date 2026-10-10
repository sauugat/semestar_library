async function ensurePostsSchema(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id ${db.isPostgres ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
      user_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
      title TEXT,
      content TEXT NOT NULL DEFAULT '' CHECK (length(content) <= 1000000),
      type TEXT NOT NULL DEFAULT 'status' CHECK (type IN ('status', 'assignment', 'notice')),
      category TEXT NOT NULL DEFAULT 'general',
      visibility TEXT NOT NULL DEFAULT 'everyone',
      target_all_semesters INTEGER NOT NULL DEFAULT 1,
      attachment_url TEXT,
      cohort_id TEXT,
      semester_no INTEGER,
      audience_scope TEXT NOT NULL DEFAULT 'all_students',
      created_at ${db.isPostgres ? 'TIMESTAMPTZ' : 'TEXT'} NOT NULL DEFAULT CURRENT_TIMESTAMP,
      edited_at ${db.isPostgres ? 'TIMESTAMPTZ' : 'TEXT'}
    );
    CREATE TABLE IF NOT EXISTS post_target_semesters (
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      semester INTEGER NOT NULL CHECK (semester BETWEEN 1 AND 8),
      PRIMARY KEY (post_id, semester)
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
      file_name TEXT,
      file_size BIGINT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at ${db.isPostgres ? 'TIMESTAMPTZ' : 'TEXT'} NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS post_attachment_staging (
      id TEXT PRIMARY KEY,
      filename TEXT UNIQUE NOT NULL,
      url TEXT NOT NULL,
      uploader_student_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE CASCADE,
      media_type TEXT NOT NULL DEFAULT 'image',
      mime_type TEXT,
      file_name TEXT,
      file_size BIGINT,
      is_committed INTEGER NOT NULL DEFAULT 0,
      post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
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
    CREATE INDEX IF NOT EXISTS idx_post_att_staging_uploader ON post_attachment_staging (uploader_student_id);
    CREATE INDEX IF NOT EXISTS idx_post_att_staging_filename ON post_attachment_staging (filename);
    CREATE INDEX IF NOT EXISTS idx_post_att_staging_committed ON post_attachment_staging (is_committed, created_at);
  `);

  function isDuplicateColumnError(err) {
    if (!err) return false;
    const msg = (err.message || '').toLowerCase();
    if (err.code === '42701') return true; // PostgreSQL duplicate_column error code
    if (msg.includes('duplicate column name')) return true; // SQLite duplicate column name error
    if (msg.includes('already exists')) return true;
    return false;
  }

  // Safe non-destructive column migrations for existing tables
  const alterColumns = [
    `ALTER TABLE posts ADD COLUMN ${db.isPostgres ? 'IF NOT EXISTS ' : ''}title TEXT`,
    `ALTER TABLE posts ADD COLUMN ${db.isPostgres ? 'IF NOT EXISTS ' : ''}edited_at ${db.isPostgres ? 'TIMESTAMPTZ' : 'TEXT'}`,
    `ALTER TABLE posts ADD COLUMN ${db.isPostgres ? 'IF NOT EXISTS ' : ''}cohort_id TEXT`,
    `ALTER TABLE posts ADD COLUMN ${db.isPostgres ? 'IF NOT EXISTS ' : ''}semester_no INTEGER`,
    `ALTER TABLE posts ADD COLUMN ${db.isPostgres ? 'IF NOT EXISTS ' : ''}audience_scope TEXT NOT NULL DEFAULT 'all_students'`,
    `ALTER TABLE posts ADD COLUMN ${db.isPostgres ? 'IF NOT EXISTS ' : ''}category TEXT NOT NULL DEFAULT 'general'`,
    `ALTER TABLE posts ADD COLUMN ${db.isPostgres ? 'IF NOT EXISTS ' : ''}visibility TEXT NOT NULL DEFAULT 'everyone'`,
    `ALTER TABLE posts ADD COLUMN ${db.isPostgres ? 'IF NOT EXISTS ' : ''}target_all_semesters INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE post_media ADD COLUMN ${db.isPostgres ? 'IF NOT EXISTS ' : ''}file_name TEXT`,
    `ALTER TABLE post_media ADD COLUMN ${db.isPostgres ? 'IF NOT EXISTS ' : ''}file_size BIGINT`,
    `ALTER TABLE post_comments ADD COLUMN ${db.isPostgres ? 'IF NOT EXISTS ' : ''}parent_comment_id INTEGER REFERENCES post_comments(id) ON DELETE CASCADE`,
    `ALTER TABLE post_comments ADD COLUMN ${db.isPostgres ? 'IF NOT EXISTS ' : ''}reply_to_user_id TEXT REFERENCES students(studentId) ON DELETE SET NULL`,
    `ALTER TABLE post_comments ADD COLUMN ${db.isPostgres ? 'IF NOT EXISTS ' : ''}updated_at ${db.isPostgres ? 'TIMESTAMPTZ' : 'TEXT'}`,
    `ALTER TABLE post_comments ADD COLUMN ${db.isPostgres ? 'IF NOT EXISTS ' : ''}deleted_at ${db.isPostgres ? 'TIMESTAMPTZ' : 'TEXT'}`
  ];

  for (const alterSql of alterColumns) {
    try {
      if (typeof db.run === 'function') {
        await db.run(alterSql);
      } else if (typeof db.exec === 'function') {
        await db.exec(alterSql);
      }
    } catch (err) {
      if (!isDuplicateColumnError(err)) {
        console.error('[Posts Schema Migration Real Failure]:', err.message);
        throw err;
      }
    }
  }

  try {
    if (typeof db.exec === 'function') {
      await db.exec(`
        CREATE INDEX IF NOT EXISTS idx_post_comments_parent ON post_comments (parent_comment_id);
        CREATE INDEX IF NOT EXISTS idx_posts_category ON posts (category);
        CREATE INDEX IF NOT EXISTS idx_posts_visibility ON posts (visibility);
        CREATE INDEX IF NOT EXISTS idx_posts_target_all_sem ON posts (target_all_semesters);
        CREATE INDEX IF NOT EXISTS idx_post_target_semesters_sem ON post_target_semesters (semester);
      `);
    }
  } catch (_) { }

  // Backfill legacy posts without category, visibility, or target_all_semesters
  try {
    if (typeof db.exec === 'function') {
      await db.exec(`
        UPDATE posts SET category = 'general' WHERE category IS NULL OR category = '';
        UPDATE posts SET visibility = 'everyone' WHERE visibility IS NULL OR visibility = '';
        UPDATE posts SET target_all_semesters = 1 WHERE target_all_semesters IS NULL;
      `);
    } else if (typeof db.run === 'function') {
      await db.run("UPDATE posts SET category = 'general' WHERE category IS NULL OR category = ''");
      await db.run("UPDATE posts SET visibility = 'everyone' WHERE visibility IS NULL OR visibility = ''");
      await db.run("UPDATE posts SET target_all_semesters = 1 WHERE target_all_semesters IS NULL");
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

const path = require('path');
const fs = require('fs');

/**
 * Server-side garbage collection for abandoned staged uncommitted attachments.
 * Finds attachments older than ttlHours that are NOT committed and NOT referenced by any active post.
 */
async function cleanupAbandonedStagedAttachments(db, { ttlHours = 24, uploadDir } = {}) {
  let abandonedRows = [];
  try {
    if (db.isPostgres) {
      if (ttlHours <= 0) {
        abandonedRows = await db.all(
          `SELECT * FROM post_attachment_staging WHERE is_committed = 0`
        );
      } else {
        abandonedRows = await db.all(
          `SELECT * FROM post_attachment_staging 
           WHERE is_committed = 0 AND created_at < NOW() - ($1 || ' hours')::interval`,
          String(ttlHours)
        );
      }
    } else {
      if (ttlHours <= 0) {
        abandonedRows = await db.all(
          `SELECT * FROM post_attachment_staging WHERE is_committed = 0`
        );
      } else {
        abandonedRows = await db.all(
          `SELECT * FROM post_attachment_staging 
           WHERE is_committed = 0 AND CAST(strftime('%s', created_at) AS INTEGER) < CAST(strftime('%s', 'now', '-' || ? || ' hours') AS INTEGER)`,
          String(ttlHours)
        );
      }
    }
  } catch (err) {
    console.error('[Cleanup Staging Query Error]:', err.message);
    return { cleanedCount: 0, cleanedFilenames: [] };
  }

  if (!abandonedRows || abandonedRows.length === 0) {
    return { cleanedCount: 0, cleanedFilenames: [] };
  }

  const cleanedFilenames = [];
  for (const row of abandonedRows) {
    const filename = row.filename;
    const fileUrl = `/uploads/posts/${filename}`;
    const altUrl = `uploads/posts/${filename}`;

    try {
      // Safety check: NEVER delete any blob that is referenced by an active post or post_media
      const inPosts = await db.get('SELECT COUNT(*) AS c FROM posts WHERE attachment_url = ? OR attachment_url = ?', fileUrl, altUrl);
      const inMedia = await db.get('SELECT COUNT(*) AS c FROM post_media WHERE url = ? OR url = ?', fileUrl, altUrl);

      if ((Number(inPosts?.c || 0) + Number(inMedia?.c || 0)) === 0) {
        if (typeof db.deleteFileBlob === 'function') {
          await db.deleteFileBlob(filename);
        }
        if (uploadDir) {
          const localPath = path.join(uploadDir, filename);
          try {
            await fs.promises.unlink(localPath);
          } catch (_) {}
        }
        await db.run('DELETE FROM post_attachment_staging WHERE filename = ?', filename);
        cleanedFilenames.push(filename);
      }
    } catch (err) {
      console.error(`[Cleanup Staging Error for ${filename}]:`, err.message);
    }
  }

  return { cleanedCount: cleanedFilenames.length, cleanedFilenames };
}

// Canonical Category & Semester Constants
const VALID_POST_CATEGORIES = [
  'notice',
  'general',
  'announcement',
  'news',
  'complaints',
  'feedback'
];

const DEFAULT_POST_CATEGORY = 'general';

const CATEGORY_LABELS = {
  notice: 'Notice',
  general: 'General',
  announcement: 'Announcement',
  news: 'News',
  complaints: 'Complaints',
  feedback: 'Feedback'
};

const VALID_SEMESTERS = [1, 2, 3, 4, 5, 6, 7, 8];

function normalizeCategory(cat) {
  if (!cat || typeof cat !== 'string') return DEFAULT_POST_CATEGORY;
  const lower = cat.trim().toLowerCase();
  if (VALID_POST_CATEGORIES.includes(lower)) return lower;
  return null;
}

function parseAndValidateTargetSemesters(rawSemesters, rawAllSemesters = undefined) {
  if (rawAllSemesters === true || rawAllSemesters === 'true' || rawAllSemesters === 1 || rawAllSemesters === '1') {
    return { allSemesters: true, semesters: [] };
  }

  if (rawSemesters === undefined || rawSemesters === null || rawSemesters === 'all' || rawSemesters === '') {
    return { allSemesters: true, semesters: [] };
  }

  let list = rawSemesters;
  if (typeof rawSemesters === 'string') {
    try {
      const parsed = JSON.parse(rawSemesters);
      if (Array.isArray(parsed)) list = parsed;
      else if (parsed === 'all') return { allSemesters: true, semesters: [] };
      else list = rawSemesters.split(',').map(s => s.trim()).filter(Boolean);
    } catch (_) {
      list = rawSemesters.split(',').map(s => s.trim()).filter(Boolean);
    }
  }

  if (!Array.isArray(list)) {
    const err = new Error('Target semesters must be an array of semester numbers or "all".');
    err.status = 400;
    throw err;
  }

  if (list.length === 0) {
    return { allSemesters: true, semesters: [] };
  }

  const seen = new Set();
  const validList = [];

  for (const item of list) {
    if (item === 'all' || item === 'ALL') {
      return { allSemesters: true, semesters: [] };
    }
    const num = Number(item);
    if (!Number.isInteger(num) || num < 1 || num > 8) {
      const err = new Error(`Invalid semester "${item}". Semesters must be integers between 1 and 8.`);
      err.status = 400;
      throw err;
    }
    if (!seen.has(num)) {
      seen.add(num);
      validList.push(num);
    }
  }

  validList.sort((a, b) => a - b);

  // If all 8 semesters are selected, it canonically represents All Semesters!
  if (validList.length === 8) {
    return { allSemesters: true, semesters: [] };
  }

  return { allSemesters: false, semesters: validList };
}

function formatSemesterDisplay(targetSemesters, isAllSemesters) {
  if (isAllSemesters || !targetSemesters || targetSemesters.length === 0 || targetSemesters.length === 8) {
    return 'All Semesters';
  }
  return `Semester ${targetSemesters.join(', ')}`;
}

const VALID_POST_VISIBILITIES = Object.freeze(['everyone', 'students_only']);
const DEFAULT_POST_VISIBILITY = 'everyone';

function normalizeVisibility(val) {
  if (val === undefined || val === null || val === '') return DEFAULT_POST_VISIBILITY;
  if (typeof val !== 'string') return null;
  const lower = val.toLowerCase().trim();
  if (VALID_POST_VISIBILITIES.includes(lower)) return lower;
  return null;
}

module.exports = {
  ensurePostsSchema,
  cleanupAbandonedStagedAttachments,
  VALID_POST_CATEGORIES,
  DEFAULT_POST_CATEGORY,
  CATEGORY_LABELS,
  VALID_SEMESTERS,
  VALID_POST_VISIBILITIES,
  DEFAULT_POST_VISIBILITY,
  normalizeCategory,
  normalizeVisibility,
  parseAndValidateTargetSemesters,
  formatSemesterDisplay
};
