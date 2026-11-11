'use strict';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createClient } = require('@libsql/client');

const {
  isModerationSchemaAvailable,
  isContentReportsAvailable,
  resetModerationSchemaCache,
} = require('../lib/posts');
const { createTransactionAdapter } = require('../lib/db-transaction');
const createPostsRouter = require('../routes/posts');
const createPostImagesRouter = require('../routes/post-images');
const { fixture: cohortFixture } = require('./helpers/cohort-fixture');
const cohortChatRouter = require('../routes/cohort-chat');

const ID_LESS_TABLES = new Set([
  'post_target_semesters',
  'post_votes',
  'file_votes',
  'assignment_votes',
  'chat_read_receipts',
  'chat_room_read_receipts',
  'chat_room_revocations',
  'chat_room_typing',
  'chat_send_keys',
  'chat_online_sessions',
  'chat_pinned_announcements',
  'chat_realtime_memberships',
  'chat_attachment_ownership',
  'chat_erasure_files',
  'chat_group_slots',
  'document_embeddings',
  'document_topic_metadata',
  'kyana_cache_state',
  'session',
  'post_likes',
  'file_likes',
  'follows',
  'chat_reactions',
]);

function createMultiSchemaPgMock({ currentHasModeration = false, currentHasPartialCommentMod = true } = {}) {
  const client = createClient({ url: ':memory:' });
  const blobs = new Map();

  // Base columns present in public schema; staging schema adds moderation_status & deleted_at.
  const basePostCols = [
    'id', 'user_id', 'title', 'content', 'type', 'category', 'visibility',
    'target_all_semesters', 'attachment_url', 'cohort_id', 'semester_no',
    'audience_scope', 'created_at', 'updated_at',
  ];
  const stagingOnlyPostCols = ['moderation_status', 'deleted_at'];
  const currentPostCols = currentHasModeration ? [...basePostCols, ...stagingOnlyPostCols] : basePostCols;
  const currentCommentCols = currentHasModeration && currentHasPartialCommentMod
    ? ['id', 'post_id', 'user_id', 'content', 'moderation_status', 'created_at']
    : ['id', 'post_id', 'user_id', 'content', 'created_at'];

  const handleInfoSchema = (sql) => {
    if (!/information_schema\./i.test(sql)) return null;
    const isScoped = /table_schema\s*=\s*current_schema\(\)/i.test(sql);

    if (/EXISTS\s*\(/i.test(sql) && /post_comments/i.test(sql) && /posts/i.test(sql)) {
      const ok = isScoped
        ? (currentPostCols.includes('moderation_status') && currentCommentCols.includes('moderation_status'))
        : true;
      return ok ? [{ '?column?': 1 }] : [];
    }

    if (/information_schema\.tables/i.test(sql) && /content_reports/i.test(sql)) {
      if (!isScoped || currentHasModeration) return [{ '?column?': 1 }];
      return [];
    }

    if (/information_schema\.columns/i.test(sql) && /table_name\s*=\s*'posts'|LOWER\(table_name\)\s*=\s*'posts'/i.test(sql)) {
      const cols = isScoped ? currentPostCols : [...basePostCols, ...stagingOnlyPostCols];
      if (/column_name\s*=\s*'moderation_status'/i.test(sql)) {
        return cols.includes('moderation_status') ? [{ column_name: 'moderation_status' }] : [];
      }
      return cols.map(c => ({ column_name: c }));
    }

    return [];
  };

  const assertValidPublicSql = (sql) => {
    if (/information_schema\./i.test(sql)) return;
    const withoutFallbackAliases = String(sql).replace(/'active'\s+AS\s+moderation_status/gi, "'active'");
    if (!currentHasModeration && /\bmoderation_status\b/i.test(withoutFallbackAliases)) {
      throw new Error('column "moderation_status" does not exist');
    }
    if ((!currentHasModeration || !currentHasPartialCommentMod) && /c\.moderation_status/i.test(withoutFallbackAliases)) {
      throw new Error('column "moderation_status" does not exist');
    }
    if (/content_reports/i.test(withoutFallbackAliases) && !currentHasModeration) {
      throw new Error('relation "content_reports" does not exist');
    }
  };

  const toSqliteSql = (sql, args = []) => {
    let translated = String(sql).replace(/\$\d+/g, '?');
    // Handle RETURNING id check
    const returningMatch = /\bRETURNING\s+id\s*$/i.exec(translated);
    if (returningMatch) {
      const insertMatch = /INSERT\s+INTO\s+(?:"?public"?\.)?"?([a-zA-Z0-9_]+)"?/i.exec(translated);
      const table = insertMatch ? insertMatch[1].toLowerCase() : '';
      if (ID_LESS_TABLES.has(table)) {
        throw new Error(`column "id" does not exist on table "${table}"`);
      }
      translated = translated.replace(/\s+RETURNING\s+id\s*$/i, '');
    }
    translated = translated
      .replace(/ON\s+CONFLICT\s*\([^)]+\)\s+DO\s+NOTHING/gi, 'ON CONFLICT DO NOTHING')
      .replace(/\s+NULLS\s+LAST/gi, '');
    return { sql: translated, args };
  };

  const adapter = {
    query: async (sql, args = []) => {
      const infoRows = handleInfoSchema(sql);
      if (infoRows !== null) {
        return { rows: infoRows, rowCount: infoRows.length };
      }
      assertValidPublicSql(sql);
      if (/^\s*(DO\s+\$\$|ALTER\s+TABLE)/i.test(sql)) {
        return { rows: [], rowCount: 0 };
      }
      const norm = toSqliteSql(sql, args);
      if (/^\s*INSERT\s+INTO/i.test(norm.sql) && /\bRETURNING\b/i.test(sql)) {
        const res = await client.execute({ sql: norm.sql, args: norm.args });
        const insertedId = Number(res.lastInsertRowid);
        return { rows: Number.isFinite(insertedId) ? [{ id: insertedId }] : [], rowCount: res.rowsAffected };
      }
      const res = await client.execute({ sql: norm.sql, args: norm.args });
      return { rows: res.rows || [], rowCount: res.rowsAffected || 0, lastInsertRowid: res.lastInsertRowid };
    },
  };

  const txAdapter = createTransactionAdapter(adapter, true);

  const db = {
    isPostgres: true,
    exec: async (sql) => {
      const stripped = String(sql)
        .replace(/DO\s+\$\$[\s\S]*?END\s+\$\$\s*;/gi, '')
        .replace(/ALTER\s+TABLE[^;]*;/gi, '');
      const sanitized = stripped
        .replace(/SERIAL PRIMARY KEY/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT')
        .replace(/\bTIMESTAMPTZ\b/gi, 'TEXT')
        .replace(/\bBIGINT\b/gi, 'INTEGER')
        .replace(/\bBOOLEAN\b/gi, 'INTEGER')
        .replace(/\bBYTEA\b/gi, 'BLOB')
        .replace(/\bJSONB\b/gi, 'TEXT');
      if (!sanitized.trim()) return;
      try {
        await client.executeMultiple(sanitized);
      } catch (err) {
        if (!/already exists/i.test(err.message)) throw err;
      }
    },
    all: txAdapter.all,
    get: txAdapter.get,
    run: async (sql, ...args) => txAdapter.run(sql, ...args),
    query: (sql, args = []) => adapter.query(sql, args),
    withTransaction: async (fn) => fn(txAdapter),
    saveFileBlob: async (filename, fileData, mimeType) => {
      blobs.set(filename, { fileData, mimeType });
      return true;
    },
    getFileBlob: async (filename) => blobs.get(filename) || null,
    deleteFileBlob: async (filename) => {
      blobs.delete(filename);
      return true;
    },
    initSchema: async () => {},
    close: () => client.close(),
  };

  return { db, client, blobs };
}

async function seedMinimalPublicSchema(db, { withModerationColumns = false } = {}) {
  const modPostCols = withModerationColumns
    ? ", moderation_status TEXT DEFAULT 'active', deleted_at TEXT"
    : '';
  const modCommentCols = withModerationColumns
    ? ", moderation_status TEXT DEFAULT 'active'"
    : '';

  await db.exec(`
    CREATE TABLE cohorts (
      id TEXT PRIMARY KEY,
      group_code TEXT,
      display_name TEXT,
      current_semester INTEGER,
      status TEXT
    );
    CREATE TABLE students (
      studentId TEXT PRIMARY KEY,
      name TEXT,
      role TEXT,
      department TEXT,
      semester INTEGER,
      cohort_id TEXT,
      avatarUrl TEXT
    );
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      title TEXT,
      content TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'status',
      category TEXT NOT NULL DEFAULT 'general',
      visibility TEXT NOT NULL DEFAULT 'everyone',
      target_all_semesters INTEGER NOT NULL DEFAULT 1,
      attachment_url TEXT,
      cohort_id TEXT,
      semester_no INTEGER,
      audience_scope TEXT NOT NULL DEFAULT 'all_students',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      edited_at TEXT,
      updated_at TEXT${modPostCols}
    );
    CREATE TABLE post_media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      url TEXT NOT NULL,
      media_type TEXT NOT NULL DEFAULT 'image',
      mime_type TEXT,
      file_name TEXT,
      file_size INTEGER,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE post_target_semesters (
      post_id INTEGER NOT NULL,
      semester INTEGER NOT NULL,
      PRIMARY KEY (post_id, semester)
    );
    CREATE TABLE post_likes (
      post_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (post_id, user_id)
    );
    CREATE TABLE post_votes (
      post_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      vote_type INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (post_id, user_id)
    );
    CREATE TABLE post_submissions (
      post_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (post_id, user_id)
    );
    CREATE TABLE post_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      parent_comment_id INTEGER,
      reply_to_user_id TEXT,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT,
      deleted_at TEXT${modCommentCols}
    );
    CREATE TABLE post_comment_reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      comment_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      reaction_type TEXT NOT NULL DEFAULT 'like',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(comment_id, user_id, reaction_type)
    );
    CREATE TABLE post_attachment_staging (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      url TEXT NOT NULL,
      uploader_student_id TEXT NOT NULL,
      media_type TEXT NOT NULL,
      mime_type TEXT,
      file_name TEXT,
      file_size INTEGER,
      is_committed INTEGER NOT NULL DEFAULT 0,
      post_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE notifications (
      id TEXT PRIMARY KEY,
      recipientStudentId TEXT,
      message TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  if (withModerationColumns) {
    await db.exec(`
      CREATE TABLE content_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_type TEXT,
        target_id INTEGER,
        reporter_id TEXT,
        status TEXT DEFAULT 'pending'
      );
    `);
  }

  await db.exec(`
    INSERT INTO cohorts (id, group_code, display_name, current_semester, status)
    VALUES ('coh-merc', 'MERCURY', 'BIT 2024', 1, 'active');
    INSERT INTO students (studentId, name, role, department, semester, cohort_id)
    VALUES
      ('stu1', 'Student One', 'student', 'BIT', 1, 'coh-merc'),
      ('cr1', 'CR One', 'cr', 'BIT', 1, 'coh-merc'),
      ('admin1', 'Admin One', 'admin', NULL, NULL, NULL);
  `);
}

test('Multi-schema Postgres: staging moderation schema does not leak into public schema checks or post creation', async (t) => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'pg-staging-recovery-'));
  const { db } = createMultiSchemaPgMock({ currentHasModeration: false });
  await seedMinimalPublicSchema(db, { withModerationColumns: false });

  resetModerationSchemaCache();
  t.after(async () => {
    resetModerationSchemaCache();
    db.close();
    await fsp.rm(tempDir, { recursive: true, force: true });
  });

  // 1. Schema probes must scope to current_schema() and return false
  assert.equal(await isModerationSchemaAvailable(db), false);
  assert.equal(await isContentReportsAvailable(db), false);

  // 2. Mount Express routers backed by the PG mock
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { studentId: req.headers['x-test-user'] || 'stu1' };
    next();
  });
  const requireLogin = (req, res, next) => req.session.studentId ? next() : res.status(401).json({ message: 'Auth required' });
  app.use('/api/posts', createPostsRouter(db, requireLogin, { uploadDir: tempDir }));
  app.use('/uploads/posts', createPostImagesRouter(db, { uploadDir: tempDir }));

  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const apiReq = async (method, urlPath, body, user = 'stu1') => {
    const res = await fetch(`${baseUrl}${urlPath}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-test-user': user },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed = text;
    try { parsed = JSON.parse(text); } catch {}
    return { status: res.status, body: parsed, headers: res.headers };
  };

  // Seed a blob via staging + direct insert on post_media to exercise /uploads/posts JOIN branch
  const sampleFilename = '11111111-2222-3333-4444-555555555555.jpg';
  await db.saveFileBlob(sampleFilename, Buffer.from('fake-jpeg-bytes'), 'image/jpeg');

  // Create post for All semesters (201)
  const createAll = await apiReq('POST', '/api/posts', {
    content: 'Hello from recovered feed!',
    type: 'status',
    targetSemesters: 'all',
  });
  assert.equal(createAll.status, 201);
  assert.ok(createAll.body.id);

  // Create post targeting specific semester [1] -> exercises post_target_semesters inside transaction (no RETURNING id!)
  await db.run(
    `INSERT INTO post_attachment_staging (id, filename, url, uploader_student_id, media_type, mime_type, file_name, file_size, is_committed)
     VALUES ('stg-1', ?, ?, 'stu1', 'image', 'image/jpeg', ?, 15, 0)`,
    sampleFilename, `/uploads/posts/${sampleFilename}`, sampleFilename
  );
  const createTargeted = await apiReq('POST', '/api/posts', {
    content: 'Semester 1 post with photo',
    type: 'status',
    targetSemesters: [1],
    attachments: [{ stagingId: 'stg-1', url: `/uploads/posts/${sampleFilename}`, media_type: 'image' }],
  });
  assert.equal(createTargeted.status, 201, `Expected 201, got ${createTargeted.status}: ${JSON.stringify(createTargeted.body)}`);
  const targetedId = createTargeted.body.id;

  // Feed, detail, vote (post_votes no RETURNING id), comments, and /uploads/posts
  const feed = await apiReq('GET', '/api/posts?limit=10');
  assert.equal(feed.status, 200);
  assert.ok(Array.isArray(feed.body.posts));
  assert.equal(feed.body.posts.length, 2);

  const detail = await apiReq('GET', `/api/posts/${targetedId}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.id, targetedId);

  const postsRouteSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'posts.js'), 'utf8');
  if (postsRouteSrc.includes("'/:id/vote'")) {
    const vote = await apiReq('POST', `/api/posts/${targetedId}/vote`, { voteType: 'up' });
    assert.equal(vote.status, 200);
  } else {
    const like = await apiReq('POST', `/api/posts/${targetedId}/like`);
    assert.equal(like.status, 200);
  }

  const comments = await apiReq('GET', `/api/posts/${targetedId}/comments`);
  assert.equal(comments.status, 200);

  const imgRes = await fetch(`${baseUrl}/uploads/posts/${sampleFilename}`, {
    headers: { 'x-test-user': 'stu1' },
  });
  assert.equal(imgRes.status, 200);
  assert.equal(await imgRes.text(), 'fake-jpeg-bytes');
});

test('Multi-schema Postgres: partial moderation schema (posts only, post_comments missing column) disables moderation filter', async (t) => {
  const { db } = createMultiSchemaPgMock({ currentHasModeration: true, currentHasPartialCommentMod: false });
  resetModerationSchemaCache();
  t.after(() => {
    resetModerationSchemaCache();
    db.close();
  });

  assert.equal(await isModerationSchemaAvailable(db), false);
});

test('Multi-schema Postgres: transaction adapter skips RETURNING id for newly registered ID-less tables', async () => {
  const seenSql = [];
  const rawClient = {
    query: async (sql) => {
      seenSql.push(sql);
      return { rows: [{ id: 1 }], rowCount: 1 };
    },
  };
  const tx = createTransactionAdapter(rawClient, true);

  for (const table of ['post_target_semesters', 'post_votes', 'file_votes', 'assignment_votes', 'chat_room_read_receipts', 'session']) {
    await tx.run(`INSERT INTO ${table} (a) VALUES (?)`, 'x');
    assert.ok(!/RETURNING\s+id/i.test(seenSql.at(-1)), `${table} must not receive RETURNING id`);
  }

  await tx.run('INSERT INTO posts (content) VALUES (?)', 'hello');
  assert.ok(/RETURNING\s+id/i.test(seenSql.at(-1)), 'posts insert should keep RETURNING id');
});

const aiSearchPath = path.join(__dirname, '..', 'lib', 'ai-search-tools.js');
if (fs.existsSync(aiSearchPath) && typeof require(aiSearchPath).getPostTableColumns === 'function') {
  test('ai-search-tools getPostTableColumns scopes information_schema query to current_schema()', async (t) => {
    const { getPostTableColumns } = require('../lib/ai-search-tools');
    const { db } = createMultiSchemaPgMock({ currentHasModeration: false });
    t.after(() => db.close());

    const cols = await getPostTableColumns(db);
    assert.ok(cols.has('content'));
    assert.equal(cols.has('moderation_status'), false);
    assert.equal(cols.has('deleted_at'), false);
  });
}

test('Cohort chat role matrix: assigned teacher accesses room config, students/CRs get 403, unassigned get 404 on /config', async (t) => {
  const f = await cohortFixture('sqlite');
  const seeded = await f.seed();
  for (const room of Object.values(seeded)) {
    await f.service.syncProjection(room.chatGroupId);
  }

  // Create teacher assignment tables & seed teacher assigned to Semester 1 (MERCURY)
  await f.db.exec(`
    CREATE TABLE teachers (id TEXT PRIMARY KEY, user_id TEXT, name TEXT);
    CREATE TABLE subjects (id INTEGER PRIMARY KEY, code TEXT, title TEXT, semester INTEGER);
    CREATE TABLE teacher_subjects (teacher_id TEXT, subject_id INTEGER);
    INSERT INTO students(studentId, name, username, role, department, semester, supabase_uid)
    VALUES ('t1', 'Teacher One', 't1', 'teacher', NULL, NULL, 'subject-t1');
    INSERT INTO teachers(id, user_id, name) VALUES ('teach-1', 't1', 'Teacher One');
    INSERT INTO subjects(id, code, title, semester) VALUES (101, 'BIT101', 'Programming', 1);
    INSERT INTO teacher_subjects(teacher_id, subject_id) VALUES ('teach-1', 101);
  `);

  const app = express();
  app.use(express.json());
  app.use('/api/chat', async (req, res, next) => {
    const uid = req.headers['x-test-user'];
    if (!uid) return res.status(401).json({ message: 'Authentication required.' });
    const student = await f.db.get('SELECT studentId, role FROM students WHERE studentId=?', uid);
    if (!student) return res.status(401).json({ message: 'Authentication required.' });
    req.student = student;
    next();
  }, cohortChatRouter(f.service));

  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/chat`;

  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await f.close();
  });

  const reqRole = async (urlPath, uid) => {
    const res = await fetch(`${baseUrl}${urlPath}`, { headers: { 'x-test-user': uid } });
    return { status: res.status, body: await res.json() };
  };

  // MERCURY is sem 1; VENUS is sem 3 (seeded by cohort-fixture)
  const mercId = seeded.MERCURY.chatGroupId;
  const venusId = seeded.VENUS.chatGroupId;

  // Assigned teacher can view MERCURY config (200), cannot view unassigned VENUS config (404)
  const tMerc = await reqRole(`/admin/rooms/${mercId}/config`, 't1');
  assert.equal(tMerc.status, 200);
  assert.equal(tMerc.body.chatGroupId, mercId);

  const tVenus = await reqRole(`/admin/rooms/${venusId}/config`, 't1');
  assert.equal(tVenus.status, 404);

  // Admin can view any room config (200)
  const admVenus = await reqRole(`/admin/rooms/${venusId}/config`, 'admin');
  assert.equal(admVenus.status, 200);

  // Students & CRs remain blocked from /admin/rooms/:id/config (403)
  assert.equal((await reqRole(`/admin/rooms/${mercId}/config`, 'm2')).status, 403);
  assert.equal((await reqRole(`/admin/rooms/${mercId}/config`, 'm1')).status, 403);

  // Unassigned student gets 404 on /config, assigned student gets 200
  assert.equal((await reqRole('/config', 'none')).status, 404);
  const okStu = await reqRole('/config', 'm2');
  assert.equal(okStu.status, 200);
  assert.equal(okStu.body.chatGroupId, mercId);
});
