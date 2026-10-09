const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createClient } = require('@libsql/client');
const { ensurePostsSchema, VALID_POST_VISIBILITIES, DEFAULT_POST_VISIBILITY } = require('../lib/posts');
const createPostsRouter = require('../routes/posts');

async function fixture(t) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'post-aud-vis-'));
  const uploadDir = path.join(tempDir, 'posts');
  const client = createClient({ url: ':memory:' });
  const blobs = new Map();
  const db = {
    saveFileBlob: async (filename, fileData, mimeType) => { blobs.set(filename, { fileData, mimeType }); return true; },
    getFileBlob: async filename => blobs.get(filename),
    deleteFileBlob: async filename => { blobs.delete(filename); return true; },
    isPostgres: false,
    exec: sql => client.executeMultiple(sql),
    all: async (sql, ...args) => (await client.execute({ sql, args })).rows,
    get: async (sql, ...args) => (await client.execute({ sql, args })).rows[0],
    run: async (sql, ...args) => {
      const result = await client.execute({ sql, args });
      return { lastInsertRowid: Number(result.lastInsertRowid), changes: result.rowsAffected };
    },
    initSchema: async () => {}
  };

  await db.exec(`
    CREATE TABLE students (
      studentId TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT DEFAULT 'student',
      avatarUrl TEXT,
      semester TEXT DEFAULT 'Semester 1',
      cohort_id TEXT
    );
    INSERT INTO students (studentId, name, role, avatarUrl, semester) VALUES
      ('student_s1', 'Alice Sem1', 'student', '/a1.png', 'Semester 1'),
      ('student_s2', 'Bob Sem2', 'student', '/a2.png', 'Semester 2'),
      ('cr_s1', 'Danielle CR', 'cr', '/a3.png', 'Semester 1'),
      ('admin_user', 'Admin Alex', 'admin', '/a4.png', 'Semester 1'),
      ('teacher_user', 'Prof Smith', 'teacher', '/a5.png', NULL);

    CREATE TABLE IF NOT EXISTS student_device_tokens (
      studentId TEXT,
      token TEXT,
      platform TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studentId TEXT,
      title TEXT,
      message TEXT,
      type TEXT,
      data TEXT,
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await ensurePostsSchema(db);

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const testUser = req.headers['x-test-user'];
    if (testUser === 'anonymous') {
      req.session = {};
    } else {
      req.session = { studentId: testUser || 'student_s1' };
    }
    next();
  });
  const requireLogin = (req, res, next) => req.session && req.session.studentId
    ? next() : res.status(401).json({ message: 'Authentication required.' });

  app.use('/api/posts', createPostsRouter(db, requireLogin, { uploadDir }));

  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    client.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function request(method, urlPath = '', body, user = 'student_s1') {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/posts${urlPath}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(user ? { 'x-test-user': user } : {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  }

  return { db, request, client };
}

test('1. Meta endpoint returns visibilities, defaultVisibility, and role permissions', async (t) => {
  const { request } = await fixture(t);

  // Student check
  const studentMeta = await request('GET', '/meta', undefined, 'student_s1');
  assert.equal(studentMeta.status, 200);
  assert.deepEqual(studentMeta.body.visibilities, ['everyone', 'students_only']);
  assert.equal(studentMeta.body.defaultVisibility, 'everyone');
  assert.equal(studentMeta.body.canSelectAudience, true);
  assert.equal(studentMeta.body.canPostNotice, false);

  // Teacher check
  const teacherMeta = await request('GET', '/meta', undefined, 'teacher_user');
  assert.equal(teacherMeta.status, 200);
  assert.equal(teacherMeta.body.canSelectAudience, false);
  assert.equal(teacherMeta.body.canPostNotice, true);

  // Admin check
  const adminMeta = await request('GET', '/meta', undefined, 'admin_user');
  assert.equal(adminMeta.status, 200);
  assert.equal(adminMeta.body.canSelectAudience, false);
  assert.equal(adminMeta.body.canPostNotice, true);
});

test('2. Student can publish Everyone post and Students Only post', async (t) => {
  const { request } = await fixture(t);

  // Default Everyone
  const p1 = await request('POST', '', { content: 'Public hello' }, 'student_s1');
  assert.equal(p1.status, 201);
  assert.equal(p1.body.visibility, 'everyone');

  // Students Only
  const p2 = await request('POST', '', { content: 'Secret student chat', audience: 'students_only' }, 'student_s1');
  assert.equal(p2.status, 201);
  assert.equal(p2.body.visibility, 'students_only');

  // CR can also post Students Only
  const p3 = await request('POST', '', { content: 'CR announcement to students', audience: 'students_only' }, 'cr_s1');
  assert.equal(p3.status, 201);
  assert.equal(p3.body.visibility, 'students_only');
});

test('3. Teacher and Admin cannot forge Students Only post (rejected with 403)', async (t) => {
  const { request } = await fixture(t);

  const teacherTry = await request('POST', '', { content: 'Teacher trying restricted', audience: 'students_only' }, 'teacher_user');
  assert.equal(teacherTry.status, 403);
  assert.match(teacherTry.body.message, /students_only/i);

  const adminTry = await request('POST', '', { content: 'Admin trying restricted', audience: 'students_only' }, 'admin_user');
  assert.equal(adminTry.status, 403);
  assert.match(adminTry.body.message, /students_only/i);
});

test('4. Ordinary student cannot publish Notice category (rejected with 403)', async (t) => {
  const { request } = await fixture(t);

  const studentNotice = await request('POST', '', { category: 'notice', title: 'Fake Notice', content: 'Classes canceled' }, 'student_s1');
  assert.equal(studentNotice.status, 403);
  assert.match(studentNotice.body.message, /publish notices/i);

  // But Teacher can publish Notice
  const teacherNotice = await request('POST', '', { category: 'notice', title: 'Official Exam Notice', content: 'Exam routine posted' }, 'teacher_user');
  assert.equal(teacherNotice.status, 201);
  assert.equal(teacherNotice.body.category, 'notice');
  assert.equal(teacherNotice.body.title, 'Official Exam Notice');

  // Admin can also publish Notice
  const adminNotice = await request('POST', '', { category: 'notice', title: 'University Notice', content: 'Campus update' }, 'admin_user');
  assert.equal(adminNotice.status, 201);
  assert.equal(adminNotice.body.category, 'notice');
});

test('5. General posts have title suppressed and set to null', async (t) => {
  const { request } = await fixture(t);

  // Submitting title with General category
  const generalPost = await request('POST', '', {
    category: 'general',
    title: 'Hidden General Title',
    content: 'Just general discussion'
  }, 'student_s1');
  assert.equal(generalPost.status, 201);
  assert.equal(generalPost.body.title, null);

  // Announcement preserves title
  const announcePost = await request('POST', '', {
    category: 'announcement',
    title: 'Real Announcement Title',
    content: 'Club meeting today'
  }, 'student_s1');
  assert.equal(announcePost.status, 201);
  assert.equal(announcePost.body.title, 'Real Announcement Title');
});

test('6. Feed filtering: Students Only posts are hidden from teacher and admin normal feeds', async (t) => {
  const { request } = await fixture(t);

  // Student creates public post and students_only post
  const pub = await request('POST', '', { content: 'Public study group' }, 'student_s1');
  const priv = await request('POST', '', { content: 'Students only homework help', audience: 'students_only' }, 'student_s1');

  // Student 1 (author) sees both in feed
  const s1Feed = await request('GET', '', undefined, 'student_s1');
  const s1Ids = s1Feed.body.posts.map(p => p.id);
  assert.ok(s1Ids.includes(pub.body.id));
  assert.ok(s1Ids.includes(priv.body.id));

  // CR (another eligible student in Semester 1) sees both
  const s2Feed = await request('GET', '', undefined, 'cr_s1');
  const s2Ids = s2Feed.body.posts.map(p => p.id);
  assert.ok(s2Ids.includes(pub.body.id));
  assert.ok(s2Ids.includes(priv.body.id));

  // Teacher normal feed receives public post, NEVER students_only post
  const teacherFeed = await request('GET', '', undefined, 'teacher_user');
  const teacherIds = teacherFeed.body.posts.map(p => p.id);
  assert.ok(teacherIds.includes(pub.body.id));
  assert.ok(!teacherIds.includes(priv.body.id), 'Teacher normal feed must NOT contain students_only post');

  // Admin normal feed receives public post, NEVER students_only post
  const adminFeed = await request('GET', '', undefined, 'admin_user');
  const adminIds = adminFeed.body.posts.map(p => p.id);
  assert.ok(adminIds.includes(pub.body.id));
  assert.ok(!adminIds.includes(priv.body.id), 'Admin normal feed must NOT contain students_only post');
});

test('7. Unauthorized direct access to Students Only post is blocked (returns 404, preventing ID guessing)', async (t) => {
  const { request } = await fixture(t);

  const priv = await request('POST', '', { content: 'Restricted student info', audience: 'students_only' }, 'student_s1');
  const privId = priv.body.id;

  // Student can view directly
  const sView = await request('GET', `/${privId}`, undefined, 'student_s1');
  assert.equal(sView.status, 200);

  // Teacher cannot view directly (404 Not Found)
  const tView = await request('GET', `/${privId}`, undefined, 'teacher_user');
  assert.equal(tView.status, 404);

  // Teacher cannot like (404 Not Found)
  const tLike = await request('POST', `/${privId}/like`, {}, 'teacher_user');
  assert.equal(tLike.status, 404);

  // Teacher cannot comment (404 Not Found)
  const tComment = await request('POST', `/${privId}/comments`, { content: 'Teacher replying' }, 'teacher_user');
  assert.equal(tComment.status, 404);

  // Teacher cannot get comments (404 Not Found)
  const tCommentsList = await request('GET', `/${privId}/comments`, undefined, 'teacher_user');
  assert.equal(tCommentsList.status, 404);
});

test('8. Admin moderation mechanism: audited moderation flag allows admin review without leaking into normal feed', async (t) => {
  const { request } = await fixture(t);

  const priv = await request('POST', '', { content: 'Reported student post', audience: 'students_only' }, 'student_s1');
  const privId = priv.body.id;

  // Normal admin GET /:id returns 404 (not in normal feed/workflow)
  const normalAdmin = await request('GET', `/${privId}`, undefined, 'admin_user');
  assert.equal(normalAdmin.status, 404);

  // Moderation path (?moderation=true) allows audited moderation review
  const modAdmin = await request('GET', `/${privId}?moderation=true`, undefined, 'admin_user');
  assert.equal(modAdmin.status, 200);
  assert.equal(modAdmin.body.id, privId);
  assert.equal(modAdmin.body.visibility, 'students_only');

  // Teacher cannot use moderation bypass
  const modTeacher = await request('GET', `/${privId}?moderation=true`, undefined, 'teacher_user');
  assert.equal(modTeacher.status, 404);
});

test('9. Semester targeting works in combination with Students Only visibility', async (t) => {
  const { request } = await fixture(t);

  // Student in Sem1 targets only Semester 2 with Students Only
  const sem2Restricted = await request('POST', '', {
    content: 'Sem 2 exam advice',
    category: 'general',
    audience: 'students_only',
    targetSemesters: [2]
  }, 'student_s1');
  assert.equal(sem2Restricted.status, 201);

  // Student in Sem 1 does not see it in normal feed (wrong semester)
  const s1Feed = await request('GET', '', undefined, 'student_s1');
  assert.ok(!s1Feed.body.posts.some(p => p.id === sem2Restricted.body.id));

  // Student in Sem 2 sees it (eligible student + eligible semester)
  const s2Feed = await request('GET', '', undefined, 'student_s2');
  assert.ok(s2Feed.body.posts.some(p => p.id === sem2Restricted.body.id));

  // Teacher does not see it (teacher feed)
  const tFeed = await request('GET', '', undefined, 'teacher_user');
  assert.ok(!tFeed.body.posts.some(p => p.id === sem2Restricted.body.id));
});

test('10. Search endpoint respects Students Only filtering', async (t) => {
  const { request } = await fixture(t);

  await request('POST', '', { content: 'UniqueXylophone public discussion' }, 'student_s1');
  await request('POST', '', { content: 'UniqueXylophone students only secret', audience: 'students_only' }, 'student_s1');

  // Student search finds both
  const sSearch = await request('GET', '?search=UniqueXylophone', undefined, 'student_s1');
  assert.equal(sSearch.body.posts.length, 2);

  // Teacher search finds ONLY public
  const tSearch = await request('GET', '?search=UniqueXylophone', undefined, 'teacher_user');
  assert.equal(tSearch.body.posts.length, 1);
  assert.equal(tSearch.body.posts[0].visibility, 'everyone');
});

test('11. Updating post enforces role rules and strips title for General category', async (t) => {
  const { request } = await fixture(t);

  // Create news post with title
  const post = await request('POST', '', { category: 'news', title: 'Old News Title', content: 'Original body' }, 'student_s1');
  const id = post.body.id;
  assert.equal(post.body.title, 'Old News Title');

  // Update category to General with new title -> Title is forced to null
  const updated1 = await request('PUT', `/${id}`, {
    category: 'general',
    title: 'Attempted Title',
    content: 'Now general discussion',
    audience: 'students_only'
  }, 'student_s1');
  assert.equal(updated1.status, 200);
  assert.equal(updated1.body.category, 'general');
  assert.equal(updated1.body.title, null);
  assert.equal(updated1.body.visibility, 'students_only');

  // Student cannot update category to notice
  const tryNotice = await request('PUT', `/${id}`, { category: 'notice' }, 'student_s1');
  assert.equal(tryNotice.status, 403);
});
