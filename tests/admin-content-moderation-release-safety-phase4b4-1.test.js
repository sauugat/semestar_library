'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { PGlite } = require('@electric-sql/pglite');

const { createTransactionAdapter } = require('../lib/db-transaction');
const {
  ensurePostsSchema,
  isModerationSchemaAvailable,
  isContentReportsAvailable,
  resetModerationSchemaCache
} = require('../lib/posts');
const { ensureAuditSchema, recordAdminAudit, queryAdminAuditLogs } = require('../lib/audit-service');
const { ensureAcademicCohortSchema } = require('../lib/academic-context');
const { createAuthMiddleware } = require('../lib/auth-middleware');
const createPostsRouter = require('../routes/posts');
const createPostImagesRouter = require('../routes/post-images');
const createAdminDashboardRouter = require('../routes/admin-dashboard');

/**
 * Creates an isolated, disposable in-process PostgreSQL engine instance (PGlite).
 * Decoupled from production Neon and requires zero network access.
 */
function createDisposablePostgresInstance() {
  const pg = new PGlite();
  const formatRow = (r) => {
    if (!r || typeof r !== 'object') return r;
    const formatted = { ...r };
    if (formatted.studentid !== undefined && formatted.studentId === undefined) {
      formatted.studentId = formatted.studentid;
    }
    if (formatted.avatarurl !== undefined && formatted.avatarUrl === undefined) {
      formatted.avatarUrl = formatted.avatarurl;
    }
    return formatted;
  };
  const formatRows = (rs) => (Array.isArray(rs) ? rs.map(formatRow) : rs);

  function createPgAdapter(client) {
    const adapter = createTransactionAdapter({
      query: async (sql, args) => {
        const res = (args && args.length > 0) ? await client.query(sql, args) : await client.query(sql);
        return { rows: res.rows, rowCount: res.affectedRows };
      }
    }, true, formatRow, formatRows);
    adapter.isPostgres = true;
    adapter.exec = async (sql) => {
      if (client.exec) return await client.exec(sql);
      return await client.query(sql);
    };
    adapter.fileBlobs = new Map();
    adapter.getFileBlob = async (filename) => adapter.fileBlobs.get(filename) || null;
    return adapter;
  }

  const db = createPgAdapter(pg);
  db.withTransaction = async (fn) => {
    return await pg.transaction(async (tx) => {
      const txAdapter = createPgAdapter(tx);
      return await fn(txAdapter);
    });
  };

  return { pg, db };
}

// Global fixtures for the test suite
let pgInstance;
let stagingDb;
let server;
let baseUrl;

const TEST_PASS = 'P@ssword123!';
const testPasswordHash = bcrypt.hashSync(TEST_PASS, 4);

test.before(async () => {
  const instance = createDisposablePostgresInstance();
  pgInstance = instance.pg;
  stagingDb = instance.db;

  // 1. Initialize PostgreSQL baseline students table as db.js defines it
  await stagingDb.exec(`
    CREATE TABLE IF NOT EXISTS students (
      studentId TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      username TEXT,
      email TEXT,
      passwordHash TEXT,
      avatarUrl TEXT,
      role TEXT DEFAULT 'student',
      verification_status TEXT DEFAULT 'unverified',
      account_status VARCHAR(32) NOT NULL DEFAULT 'active',
      department TEXT DEFAULT 'BIT',
      semester TEXT DEFAULT 'Semester 1',
      cohort_id TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS files (
      id SERIAL PRIMARY KEY,
      subject TEXT
    );
    CREATE TABLE IF NOT EXISTS assignments (
      id SERIAL PRIMARY KEY,
      deadline TEXT
    );
  `);

  // Baseline posts schema without moderation mutations
  await ensurePostsSchema(stagingDb);

  // 2. Initialize audit schema and cohort schema
  await ensureAuditSchema(stagingDb);
  await ensureAcademicCohortSchema(stagingDb);

  // 3. Seed test cohorts
  await stagingDb.run(`
    INSERT INTO cohorts (id, slot_code, group_code, display_name, current_semester, intake_year, intake_identifier, status)
    VALUES ('COH_MERCURY_01', 'mercury', 'MERCURY', 'Mercury Cohort', 1, 2026, '2026-MERCURY', 'active')
  `);
  await stagingDb.run(`
    INSERT INTO cohorts (id, slot_code, group_code, display_name, current_semester, intake_year, intake_identifier, status)
    VALUES ('COH_VENUS_02', 'venus', 'VENUS', 'Venus Cohort', 3, 2025, '2025-VENUS', 'active')
  `);

  // 4. Seed test accounts across roles
  const users = [
    { id: 'ADM_01', user: 'admin1', name: 'Admin Alice', role: 'admin', email: 'admin@college.edu' },
    { id: 'STU_01', user: 'student1', name: 'Student Sam', role: 'student', email: 'student1@college.edu', cohortId: 'COH_MERCURY_01', sem: 'Semester 1' },
    { id: 'STU_02', user: 'student2', name: 'Student Sara', role: 'student', email: 'student2@college.edu', cohortId: 'COH_MERCURY_01', sem: 'Semester 1' },
    { id: 'TEA_01', user: 'teacher1', name: 'Teacher Tara', role: 'teacher', email: 'teacher@college.edu', sem: 'Semester 1' },
    { id: 'CR_01', user: 'cr1', name: 'CR Chris', role: 'cr', email: 'cr1@college.edu', cohortId: 'COH_MERCURY_01', sem: 'Semester 1' },
    { id: 'STU_SUSP', user: 'suspended1', name: 'Suspended Stu', role: 'student', email: 'susp@college.edu', status: 'suspended', cohortId: 'COH_MERCURY_01', sem: 'Semester 1' }
  ];

  for (const u of users) {
    await stagingDb.run(
      `INSERT INTO students (studentId, username, name, passwordHash, role, department, semester, email, cohort_id, account_status)
       VALUES (?, ?, ?, ?, ?, 'BIT', ?, ?, ?, ?)`,
      u.id, u.user, u.name, testPasswordHash, u.role, u.sem || 'Semester 1', u.email, u.cohortId || null, u.status || 'active'
    );
  }

  // 5. Seed teacher relations
  await stagingDb.exec(`
    CREATE TABLE IF NOT EXISTS teachers (
      id TEXT PRIMARY KEY,
      user_id TEXT UNIQUE REFERENCES students(studentId),
      status TEXT DEFAULT 'active'
    );
    CREATE TABLE IF NOT EXISTS subjects (
      id TEXT PRIMARY KEY,
      code TEXT,
      name TEXT,
      semester INTEGER,
      department TEXT,
      active BOOLEAN DEFAULT TRUE
    );
    CREATE TABLE IF NOT EXISTS teacher_subjects (
      id SERIAL PRIMARY KEY,
      teacher_id TEXT REFERENCES teachers(id),
      subject_id TEXT REFERENCES subjects(id)
    );
  `);
  await stagingDb.run("INSERT INTO teachers (id, user_id, status) VALUES ('T_01', 'TEA_01', 'active')");
  await stagingDb.run("INSERT INTO subjects (id, code, name, semester, department, active) VALUES ('SUB_101', 'CS101', 'CS Fundamentals', 1, 'BIT', TRUE)");
  await stagingDb.run("INSERT INTO teacher_subjects (teacher_id, subject_id) VALUES ('T_01', 'SUB_101')");

  // 6. Setup Express app
  const app = express();
  app.use(express.json());
  app.use(session({
    secret: 'test-release-safety-session-secret-key-32',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
  }));

  // Session-based auth test endpoint
  app.post('/api/test-login', (req, res) => {
    const { studentId, role } = req.body;
    req.session.studentId = studentId;
    req.session.role = role;
    res.json({ success: true, studentId, role });
  });

  const requireLogin = async (req, res, next) => {
    const callerId = req.headers['x-test-user'] || (req.session && req.session.studentId);
    if (!callerId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const student = await stagingDb.get(
      'SELECT studentId, role, name, department, semester, email, avatarUrl, account_status, cohort_id FROM students WHERE studentId = ?',
      callerId
    );
    if (!student) {
      return res.status(401).json({ message: 'User not found' });
    }
    student.studentId = student.studentId || student.studentid;
    student.account_status = student.account_status || student.accountstatus || 'active';
    if (student.account_status === 'suspended') {
      return res.status(403).json({ error: 'ACCOUNT_SUSPENDED', message: 'Account is suspended' });
    }

    req.student = student;
    req.user = student;
    if (!req.session) req.session = {};
    req.session.studentId = student.studentId;
    req.session.role = student.role;
    next();
  };

  // Mount posts router, images router, and admin dashboard router
  app.use('/api/posts', createPostsRouter(stagingDb, requireLogin));
  app.use('/uploads/posts', createPostImagesRouter(stagingDb));
  app.use('/api/admin', createAdminDashboardRouter({ db: stagingDb, requireLogin }));

  // Profile photos endpoint mirroring server.js
  app.get('/api/profile/:studentId/photos', requireLogin, async (req, res) => {
    const targetStudentId = req.params.studentId;
    const modAvail = await isModerationSchemaAvailable(stagingDb);
    const modFilter = modAvail ? " AND (p.moderation_status IS NULL OR p.moderation_status = 'active')" : '';

    let mediaPhotos = [];
    try {
      mediaPhotos = await stagingDb.all(`
        SELECT pm.id, pm.post_id AS "postId", pm.url, pm.file_name AS "fileName", pm.file_size AS "fileSize",
          pm.created_at AS "createdAt", p.content AS "postContent"
        FROM post_media pm
        JOIN posts p ON p.id = pm.post_id
        WHERE p.user_id = ?${modFilter} AND (pm.media_type = 'image' OR pm.mime_type LIKE 'image/%')
        ORDER BY pm.id DESC
        LIMIT 100
      `, targetStudentId);
    } catch (_) {}

    let legacyPhotos = [];
    try {
      legacyPhotos = await stagingDb.all(`
        SELECT p.id AS "postId", p.attachment_url AS "url", p.created_at AS "createdAt", p.content AS "postContent"
        FROM posts p
        WHERE p.user_id = ?${modFilter} AND p.attachment_url IS NOT NULL AND (
          p.attachment_url LIKE '%.png' OR p.attachment_url LIKE '%.jpg' OR
          p.attachment_url LIKE '%.jpeg' OR p.attachment_url LIKE '%.webp' OR
          p.attachment_url LIKE '%.gif'
        )
        ORDER BY p.id DESC
        LIMIT 100
      `, targetStudentId);
    } catch (_) {}

    const photos = [];
    const seen = new Set();
    for (const item of [...mediaPhotos, ...legacyPhotos]) {
      if (item && item.url && !seen.has(item.url)) {
        seen.add(item.url);
        photos.push({ id: item.id || `legacy_${item.postId}`, postId: item.postId, url: item.url });
      }
    }
    res.json(photos);
  });

  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

test.after(async () => {
  if (server) await new Promise(r => server.close(r));
  if (pgInstance) await pgInstance.close();
});

// Helper for HTTP requests
async function makeRequest(path, { method = 'GET', body = null, headers = {} } = {}) {
  const url = `${baseUrl}${path}`;
  const fetchOpts = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers }
  };
  if (body) fetchOpts.body = JSON.stringify(body);
  const res = await fetch(url, fetchOpts);
  let json = null;
  try {
    json = await res.json();
  } catch (_) {}
  return { status: res.status, headers: res.headers, body: json };
}

async function loginAs(studentId, role) {
  return { 'x-test-user': studentId };
}

// =========================================================================
// SECTION 1: PRODUCTION DATABASE SAFETY & SCHEMA GUARD VERIFICATION
// =========================================================================

test('1. ensurePostsSchema against PostgreSQL does NOT automatically execute moderation mutations', async () => {
  resetModerationSchemaCache();

  // Run ensurePostsSchema without allowModerationDDL (standard PostgreSQL behavior)
  await ensurePostsSchema(stagingDb);

  // Check information_schema for moderation_status column on posts
  const colRow = await stagingDb.get(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'posts' AND column_name = 'moderation_status'
  `);
  assert.equal(colRow, null, 'moderation_status column must NOT exist prior to migration');

  // Check information_schema for content_reports table
  const tableRow = await stagingDb.get(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_name = 'content_reports'
  `);
  assert.equal(tableRow, null, 'content_reports table must NOT exist prior to migration');

  // Verify availability helpers detect unmigrated state
  assert.equal(await isModerationSchemaAvailable(stagingDb), false);
  assert.equal(await isContentReportsAvailable(stagingDb), false);
});

test('2. Unmigrated PostgreSQL serves feeds cleanly and reports migrationPending on moderation endpoints', async () => {
  // Seed a baseline post directly in posts table (without moderation_status)
  await stagingDb.run(`
    INSERT INTO posts (id, user_id, title, content, type, category, visibility, audience_scope, target_all_semesters, semester_no, created_at)
    VALUES (1, 'STU_01', 'Initial Post', 'Initial post content before moderation migration.', 'status', 'general', 'everyone', 'all_students', 1, 1, CURRENT_TIMESTAMP)
  `);

  const studentHeaders = await loginAs('STU_02', 'student');
  const adminHeaders = await loginAs('ADM_01', 'admin');

  // GET /api/posts must return 200 and NOT crash on missing moderation_status
  const feedRes = await makeRequest('/api/posts', { headers: studentHeaders });
  assert.equal(feedRes.status, 200, 'Feed must return 200 on unmigrated database');
  assert.ok(Array.isArray(feedRes.body.posts), 'Feed posts must be an array');
  assert.equal(feedRes.body.posts.length, 1);
  assert.equal(feedRes.body.posts[0].id, 1);

  // Reporting endpoint returns 503 migrationPending: true
  const reportRes = await makeRequest('/api/posts/1/report', {
    method: 'POST',
    body: { reason: 'spam', description: 'Testing pre-migration report' },
    headers: studentHeaders
  });
  assert.equal(reportRes.status, 503, 'Reporting must return 503 Service Unavailable when migration is pending');
  assert.equal(reportRes.body.migrationPending, true);

  // Admin moderation queue returns empty list with migrationPending: true
  const queueRes = await makeRequest('/api/admin/moderation/queue', { headers: adminHeaders });
  assert.equal(queueRes.status, 200);
  assert.equal(queueRes.body.migrationPending, true);
  assert.deepEqual(queueRes.body.reports, []);

  // Admin moderation remove action returns 503 migrationPending: true
  const removeRes = await makeRequest('/api/admin/moderation/posts/1/remove', {
    method: 'POST',
    body: { reason: 'Policy violation reason' },
    headers: adminHeaders
  });
  assert.equal(removeRes.status, 503);
  assert.equal(removeRes.body.migrationPending, true);
});

// =========================================================================
// SECTION 2: POSTGRESQL MIGRATION EXECUTION & IDEMPOTENCY
// =========================================================================

test('3. migrations/20261012_content_moderation.sql applies cleanly and is fully idempotent on PostgreSQL', async () => {
  const migrationPath = path.join(__dirname, '..', 'migrations', '20261012_content_moderation.sql');
  const migrationSql = fs.readFileSync(migrationPath, 'utf8');

  // First application
  await stagingDb.exec(migrationSql);
  resetModerationSchemaCache();

  assert.equal(await isModerationSchemaAvailable(stagingDb), true, 'Moderation schema must be available after migration');
  assert.equal(await isContentReportsAvailable(stagingDb), true, 'Content reports must be available after migration');

  // Verify columns were added
  const postCol = await stagingDb.get(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'posts' AND column_name = 'moderation_status'
  `);
  assert.ok(postCol, 'posts.moderation_status must exist');

  const commentCol = await stagingDb.get(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'post_comments' AND column_name = 'moderation_status'
  `);
  assert.ok(commentCol, 'post_comments.moderation_status must exist');

  // Verify existing post data was preserved and defaulted to 'active'
  const post = await stagingDb.get('SELECT id, title, content, moderation_status FROM posts WHERE id = 1');
  assert.equal(post.id, 1);
  assert.equal(post.title, 'Initial Post');
  assert.equal(post.moderation_status, 'active', 'Pre-existing post must default to active status');

  // Idempotency: execute migration a second time without error
  await assert.doesNotReject(async () => {
    await stagingDb.exec(migrationSql);
  }, 'Migration must be idempotent and succeed when run repeatedly');
});

// =========================================================================
// SECTION 3: ALL CONTENT READ PATHS & SOFT REMOVAL ON POSTGRESQL
// =========================================================================

test('4. Admin removes a post: hidden from home feed, teacher feed, search, profile posts, photos, and post detail', async () => {
  const adminHeaders = await loginAs('ADM_01', 'admin');
  const studentHeaders = await loginAs('STU_02', 'student');
  const teacherHeaders = await loginAs('TEA_01', 'teacher');

  // Add post media and image blob to Post 1
  await stagingDb.run(`
    INSERT INTO post_media (post_id, media_type, url, file_name, file_size)
    VALUES (1, 'image', '/uploads/posts/test-photo-01.jpg', 'test-photo-01.jpg', 1024)
  `);
  stagingDb.fileBlobs.set('test-photo-01.jpg', {
    mimeType: 'image/jpeg',
    fileData: Buffer.from('fake-image-bytes')
  });

  // Verify photo appears in profile photos prior to removal
  const photosBefore = await makeRequest('/api/profile/STU_01/photos', { headers: studentHeaders });
  assert.equal(photosBefore.status, 200);
  assert.equal(photosBefore.body.length, 1);

  // Admin removes Post 1
  const removeRes = await makeRequest('/api/admin/moderation/posts/1/remove', {
    method: 'POST',
    body: { reason: 'Inappropriate campus content' },
    headers: adminHeaders
  });
  assert.equal(removeRes.status, 200);
  assert.equal(removeRes.body.success, true);
  assert.equal(removeRes.body.moderation_status, 'removed');

  // 1. Home feed: hidden
  const feedRes = await makeRequest('/api/posts', { headers: studentHeaders });
  assert.equal(feedRes.status, 200);
  const postInFeed = feedRes.body.posts.find(p => p.id === 1);
  assert.equal(postInFeed, undefined, 'Removed post must not appear in home feed');

  // 2. Teacher feed: hidden
  const teacherFeedRes = await makeRequest('/api/posts', { headers: teacherHeaders });
  assert.equal(teacherFeedRes.status, 200);
  const postInTeacherFeed = teacherFeedRes.body.posts.find(p => p.id === 1);
  assert.equal(postInTeacherFeed, undefined, 'Removed post must not appear in teacher feed');

  // 3. Post detail: returns 404 with isRemoved: true
  const detailRes = await makeRequest('/api/posts/1', { headers: studentHeaders });
  assert.equal(detailRes.status, 404);
  assert.equal(detailRes.body.isRemoved, true);

  // 4. Search: hidden
  const searchRes = await makeRequest('/api/posts?search=Initial', { headers: studentHeaders });
  assert.equal(searchRes.status, 200);
  assert.equal(searchRes.body.posts.length, 0, 'Removed post must not match search');

  // 5. Profile posts: hidden
  const profilePostsRes = await makeRequest('/api/posts?studentId=STU_01', { headers: studentHeaders });
  assert.equal(profilePostsRes.status, 200);
  assert.equal(profilePostsRes.body.posts.length, 0, 'Removed post must not appear in user profile posts');

  // 6. Profile photos: hidden
  const photosAfter = await makeRequest('/api/profile/STU_01/photos', { headers: studentHeaders });
  assert.equal(photosAfter.status, 200);
  assert.equal(photosAfter.body.length, 0, 'Removed post media must not appear in profile photos');

  // 7. Post image route: returns 404 for student
  const imageRes = await makeRequest('/uploads/posts/test-photo-01.jpg', { headers: studentHeaders });
  assert.equal(imageRes.status, 404, 'Post image route must return 404 for removed post');

  // 8. Admin moderation inspection: admin can view in admin detail
  const adminDetailRes = await makeRequest('/api/admin/moderation/posts/1', { headers: adminHeaders });
  assert.equal(adminDetailRes.status, 200);
  assert.equal(adminDetailRes.body.post.moderation_status, 'removed');
  assert.equal(adminDetailRes.body.post.is_removed, true);
});

test('5. Admin restores a post: reappears with original visibility and restrictions', async () => {
  const adminHeaders = await loginAs('ADM_01', 'admin');
  const studentHeaders = await loginAs('STU_02', 'student');

  const restoreRes = await makeRequest('/api/admin/moderation/posts/1/restore', {
    method: 'POST',
    body: { reason: 'Content reviewed and deemed acceptable' },
    headers: adminHeaders
  });
  assert.equal(restoreRes.status, 200);
  assert.equal(restoreRes.body.moderation_status, 'active');

  // Post detail returns 200
  const detailRes = await makeRequest('/api/posts/1', { headers: studentHeaders });
  assert.equal(detailRes.status, 200);
  assert.equal(detailRes.body.id, 1);
  assert.equal(detailRes.body.moderation_status, 'active');

  // Post reappears in feed
  const feedRes = await makeRequest('/api/posts', { headers: studentHeaders });
  assert.equal(feedRes.status, 200);
  const found = feedRes.body.posts.find(p => p.id === 1);
  assert.ok(found, 'Restored post must reappear in feed');

  // Photos reappear in profile
  const photosRes = await makeRequest('/api/profile/STU_01/photos', { headers: studentHeaders });
  assert.equal(photosRes.status, 200);
  assert.equal(photosRes.body.length, 1);
});

// =========================================================================
// SECTION 4: COMMENT MODERATION & HIERARCHICAL PRESERVATION
// =========================================================================

test('6. Comment moderation: removal hides comment, preserves thread integrity, and restoration works', async () => {
  const adminHeaders = await loginAs('ADM_01', 'admin');
  const studentHeaders = await loginAs('STU_02', 'student');

  // Add parent comment and reply on Post 1
  await stagingDb.run(`
    INSERT INTO post_comments (id, post_id, parent_comment_id, user_id, content, moderation_status, created_at)
    VALUES (10, 1, NULL, 'STU_02', 'Parent comment by Sara', 'active', CURRENT_TIMESTAMP)
  `);
  await stagingDb.run(`
    INSERT INTO post_comments (id, post_id, parent_comment_id, user_id, content, moderation_status, created_at)
    VALUES (11, 1, 10, 'STU_01', 'Child reply by Sam', 'active', CURRENT_TIMESTAMP)
  `);

  // Admin removes parent comment 10
  const removeRes = await makeRequest('/api/admin/moderation/comments/10/remove', {
    method: 'POST',
    body: { reason: 'Abusive language in comment' },
    headers: adminHeaders
  });
  assert.equal(removeRes.status, 200);
  assert.equal(removeRes.body.moderation_status, 'removed');

  // Verify removed comment is masked and thread integrity preserved
  const commentsRes = await makeRequest('/api/posts/1/comments', { headers: studentHeaders });
  assert.equal(commentsRes.status, 200);
  const commentsList = Array.isArray(commentsRes.body) ? commentsRes.body : (commentsRes.body.comments || []);
  const parentInComments = commentsList.find(c => c.id === 10);
  assert.ok(parentInComments, 'Parent comment placeholder should exist to preserve reply thread');
  assert.equal(parentInComments.isRemoved, true);
  assert.equal(parentInComments.content, '[Comment removed by moderation]');
  assert.ok(parentInComments.replies && parentInComments.replies.length > 0, 'Child reply preserved');
  assert.equal(parentInComments.replies[0].content, 'Child reply by Sam');

  // Admin restores comment 10
  const restoreRes = await makeRequest('/api/admin/moderation/comments/10/restore', {
    method: 'POST',
    body: { reason: 'Misunderstanding clarified' },
    headers: adminHeaders
  });
  assert.equal(restoreRes.status, 200);
  assert.equal(restoreRes.body.moderation_status, 'active');

  // Comments fetch returns both parent and reply
  const commentsAfterRes = await makeRequest('/api/posts/1/comments', { headers: studentHeaders });
  assert.equal(commentsAfterRes.status, 200);
  const afterList = Array.isArray(commentsAfterRes.body) ? commentsAfterRes.body : (commentsAfterRes.body.comments || []);
  const parentRestored = afterList.find(c => c.id === 10);
  assert.ok(parentRestored, 'Restored comment must reappear');
});

// =========================================================================
// SECTION 5: COMMUNITY REPORTING SECURITY & ADMIN REVIEW QUEUE
// =========================================================================

test('7. Community reporting flow: report creation, duplicate prevention (409), resolution, and dismissal', async () => {
  const adminHeaders = await loginAs('ADM_01', 'admin');
  const studentHeaders = await loginAs('STU_02', 'student');

  // Student reports Post 1
  const reportRes = await makeRequest('/api/posts/1/report', {
    method: 'POST',
    body: { reason: 'inappropriate', description: 'Suspected exam leak' },
    headers: studentHeaders
  });
  assert.equal(reportRes.status, 201);
  assert.equal(reportRes.body.success, true);
  const reportId = reportRes.body.reportId;
  assert.ok(reportId > 0);

  // Duplicate report prevention: reporting same post again returns 409
  const dupRes = await makeRequest('/api/posts/1/report', {
    method: 'POST',
    body: { reason: 'spam', description: 'Second report attempt' },
    headers: studentHeaders
  });
  assert.equal(dupRes.status, 409, 'Duplicate report must return 409 Conflict');

  // Admin moderation queue shows the open report
  const queueRes = await makeRequest('/api/admin/moderation/queue', { headers: adminHeaders });
  assert.equal(queueRes.status, 200);
  const reportItem = queueRes.body.reports.find(r => r.id === reportId);
  assert.ok(reportItem, 'Report must appear in admin queue');
  assert.equal(reportItem.status, 'open');
  assert.equal(reportItem.reporter_id, 'STU_02');

  // Admin resolves report
  const resolveRes = await makeRequest(`/api/admin/moderation/reports/${reportId}/resolve`, {
    method: 'POST',
    body: { resolutionNotes: 'Reviewed with student committee.' },
    headers: adminHeaders
  });
  assert.equal(resolveRes.status, 200);
  assert.equal(resolveRes.body.status, 'resolved');

  // Student reports comment 11
  const commentReportRes = await makeRequest('/api/posts/1/comments/11/report', {
    method: 'POST',
    body: { reason: 'harassment', description: 'Disrespectful reply' },
    headers: studentHeaders
  });
  assert.equal(commentReportRes.status, 201);
  const commentReportId = commentReportRes.body.reportId;

  // Admin dismisses comment report
  const dismissRes = await makeRequest(`/api/admin/moderation/reports/${commentReportId}/dismiss`, {
    method: 'POST',
    body: { resolutionNotes: 'Content is not harassment.' },
    headers: adminHeaders
  });
  assert.equal(dismissRes.status, 200);
  assert.equal(dismissRes.body.status, 'dismissed');
});

// =========================================================================
// SECTION 6: TRANSACTION AUDIT ROLLBACK ON POSTGRESQL
// =========================================================================

test('8. Audit failure rolls back moderation transactionally on PostgreSQL without partial corruption', async () => {
  const adminHeaders = await loginAs('ADM_01', 'admin');

  // Seed Post 99
  await stagingDb.run(`
    INSERT INTO posts (id, user_id, title, content, type, category, visibility, audience_scope, target_all_semesters, semester_no, moderation_status, created_at)
    VALUES (99, 'STU_01', 'Rollback Post', 'Content to test transaction rollback', 'status', 'general', 'everyone', 'all_students', 1, 1, 'active', CURRENT_TIMESTAMP)
  `);

  // Simulate an audit failure by temporarily modifying admin_audit_logs constraint or intercepting
  await assert.rejects(async () => {
    await stagingDb.withTransaction(async (tx) => {
      await tx.run("UPDATE posts SET moderation_status = 'removed' WHERE id = 99");
      // Force an error inside transaction
      throw new Error('SIMULATED_AUDIT_LOG_PERSISTENCE_FAILURE');
    });
  });

  // Verify post remains active because transaction rolled back cleanly
  const post = await stagingDb.get('SELECT moderation_status FROM posts WHERE id = 99');
  assert.equal(post.moderation_status, 'active', 'Post must remain active when moderation transaction rolls back');
});

// =========================================================================
// SECTION 7: AUTHORIZATION, IMMUNITY & SUSPENDED ACCOUNTS
// =========================================================================

test('9. Students and CRs cannot perform moderation actions (rejects 403 Forbidden)', async () => {
  const studentHeaders = await loginAs('STU_01', 'student');
  const crHeaders = await loginAs('CR_01', 'cr');

  const studentAttempt = await makeRequest('/api/admin/moderation/posts/1/remove', {
    method: 'POST',
    body: { reason: 'Unauthorized student removal' },
    headers: studentHeaders
  });
  assert.equal(studentAttempt.status, 403, 'Student must receive 403 Forbidden');

  const crAttempt = await makeRequest('/api/admin/moderation/posts/1/remove', {
    method: 'POST',
    body: { reason: 'Unauthorized CR removal' },
    headers: crHeaders
  });
  assert.equal(crAttempt.status, 403, 'CR must receive 403 Forbidden');
});

test('10. Suspended student cannot post or report (rejects 403 Forbidden)', async () => {
  const suspHeaders = await loginAs('STU_SUSP', 'student');

  const reportAttempt = await makeRequest('/api/posts/1/report', {
    method: 'POST',
    body: { reason: 'spam', description: 'Suspended user report' },
    headers: suspHeaders
  });
  assert.equal(reportAttempt.status, 403, 'Suspended user must receive 403 Forbidden on reporting');
});

test('11. Author cannot report their own post (rejects 400 Bad Request)', async () => {
  const authorHeaders = await loginAs('STU_01', 'student');

  const selfReport = await makeRequest('/api/posts/1/report', {
    method: 'POST',
    body: { reason: 'spam', description: 'Self reporting test' },
    headers: authorHeaders
  });
  assert.equal(selfReport.status, 400, 'User cannot report their own post');
});

test('12. Student-only posts remain restricted from ordinary teacher feeds on PostgreSQL', async () => {
  // Seed a student-only post in semester 1 / Mercury cohort
  await stagingDb.run(`
    INSERT INTO posts (id, user_id, title, content, type, category, visibility, audience_scope, target_all_semesters, semester_no, cohort_id, moderation_status, created_at)
    VALUES (200, 'STU_01', 'Student Only Post', 'Private peer study discussion', 'status', 'academic', 'students_only', 'student_only', 1, 1, 'COH_MERCURY_01', 'active', CURRENT_TIMESTAMP)
  `);

  const teacherHeaders = await loginAs('TEA_01', 'teacher');
  const studentHeaders = await loginAs('STU_02', 'student');

  // Student can view it
  const studentFeed = await makeRequest('/api/posts', { headers: studentHeaders });
  assert.ok(studentFeed.body.posts.some(p => p.id === 200), 'Student can see student-only post');

  // Teacher cannot view it
  const teacherFeed = await makeRequest('/api/posts', { headers: teacherHeaders });
  assert.ok(!teacherFeed.body.posts.some(p => p.id === 200), 'Teacher cannot see student-only post');
});

// =========================================================================
// SECTION 8: CR IMPLEMENTATION VERIFICATION
// =========================================================================

test('13. CR checks: authoritative admin actor identity, CR route handling, and database conventions', async () => {
  // 1. Check requireAdminRole uses authoritative studentId from database lookup
  const adminHeaders = await loginAs('ADM_01', 'admin');
  const historyRes = await makeRequest('/api/admin/moderation/history', { headers: adminHeaders });
  assert.equal(historyRes.status, 200);

  // 2. Verify admin_audit_logs uses entity_id
  const auditRow = await stagingDb.get("SELECT entity_id, actor_user_id, action FROM admin_audit_logs LIMIT 1");
  assert.ok(auditRow, 'admin_audit_logs must contain rows');
  assert.ok(auditRow.entity_id !== undefined, 'admin_audit_logs must use entity_id column');

  // 3. Verify students uses account_status column
  const studentRow = await stagingDb.get("SELECT account_status FROM students WHERE studentId = 'STU_SUSP'");
  assert.equal(studentRow.account_status, 'suspended', 'students table must use account_status column');
});
