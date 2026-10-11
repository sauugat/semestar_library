const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createClient } = require('@libsql/client');

// Fast in-memory stub for notifications-service to avoid remote network latency in tests
require.cache[require.resolve('../lib/notifications-service')] = {
  exports: {
    createNotification: async () => {},
    removeReactionFromGroup: async () => {}
  }
};

const { ensurePostsSchema } = require('../lib/posts');
const createPostsRouter = require('../routes/posts');

async function fixture(t) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rb-post-vis-'));
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

  // Seed authoritative schema
  await db.exec(`
    CREATE TABLE students (
      studentId TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT DEFAULT 'student',
      avatarUrl TEXT,
      semester TEXT DEFAULT 'Semester 1',
      cohort_id TEXT
    );

    CREATE TABLE subjects (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      semester INTEGER NOT NULL,
      department TEXT DEFAULT 'BIT',
      credit_hours REAL DEFAULT 3.0,
      nature TEXT DEFAULT 'TH'
    );

    CREATE TABLE teachers (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE REFERENCES students(studentId),
      designation TEXT DEFAULT 'Instructor',
      status TEXT NOT NULL DEFAULT 'active'
    );

    CREATE TABLE teacher_subjects (
      id TEXT PRIMARY KEY,
      teacher_id TEXT NOT NULL REFERENCES teachers(id),
      subject_id TEXT NOT NULL REFERENCES subjects(id)
    );

    CREATE TABLE student_device_tokens (
      studentId TEXT,
      token TEXT,
      platform TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id TEXT,
      studentId TEXT,
      title TEXT,
      message TEXT,
      type TEXT,
      data TEXT,
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Seed students across various semesters
    INSERT INTO students (studentId, name, role, avatarUrl, semester) VALUES
      ('student_s3', 'Alice Sem3', 'student', '/a3.png', 'Semester 3'),
      ('student_s5', 'Bob Sem5', 'student', '/a5.png', 'Semester 5'),
      ('student_s7', 'Carol Sem7', 'student', '/a7.png', 'Semester 7'),
      ('student_s8', 'Dave Sem8', 'student', '/a8.png', 'Semester 8'),
      ('teacher_3_5', 'Prof Richards (Sem 3 & 5)', 'teacher', '/t1.png', NULL),
      ('teacher_other', 'Prof Jones (Sem 7)', 'teacher', '/t2.png', NULL),
      ('admin_user', 'Admin Sarah', 'admin', '/adm.png', NULL);

    -- Seed subjects
    INSERT INTO subjects (id, code, name, semester) VALUES
      ('SUB_301', 'CIT301', 'Data Structures', 3),
      ('SUB_501', 'CIT501', 'Software Engineering', 5),
      ('SUB_701', 'CIT701', 'Cloud Computing', 7);

    -- Seed teacher domain records
    INSERT INTO teachers (id, user_id, designation, status) VALUES
      ('t_richards', 'teacher_3_5', 'Associate Professor', 'active'),
      ('t_jones', 'teacher_other', 'Assistant Professor', 'active');

    -- Assign subjects:
    -- teacher_3_5 assigned to Semester 3 and Semester 5
    INSERT INTO teacher_subjects (id, teacher_id, subject_id) VALUES
      ('ts_1', 't_richards', 'SUB_301'),
      ('ts_2', 't_richards', 'SUB_501');

    -- teacher_other assigned to Semester 7
    INSERT INTO teacher_subjects (id, teacher_id, subject_id) VALUES
      ('ts_3', 't_jones', 'SUB_701');
  `);

  await ensurePostsSchema(db);

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { studentId: req.headers['x-test-user'] || 'student_s3' };
    next();
  });
  const requireLogin = (req, res, next) => req.session?.studentId
    ? next() : res.status(401).json({ message: 'Authentication required.' });

  app.use('/api/posts', createPostsRouter(db, requireLogin, { uploadDir }));

  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    client.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function request(method, urlPath = '', body, user = 'student_s3') {
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

// 1. Student Semester 3 sees Semester 3 posts.
test('1. Student Semester 3 sees Semester 3 posts', async (t) => {
  const { request } = await fixture(t);
  const pSem3 = await request('POST', '', { content: 'Semester 3 study notes', targetSemesters: [3] }, 'student_s3');
  assert.equal(pSem3.status, 201);

  const feed = await request('GET', '', undefined, 'student_s3');
  assert.equal(feed.status, 200);
  const postIds = feed.body.posts.map(p => p.id);
  assert.ok(postIds.includes(pSem3.body.id), 'Semester 3 student must see Semester 3 post');
});

// 2. Student Semester 3 sees all-semester posts.
test('2. Student Semester 3 sees all-semester posts', async (t) => {
  const { request } = await fixture(t);
  const pAll = await request('POST', '', { content: 'Campus library open 24/7', targetSemesters: 'all' }, 'student_s5');
  assert.equal(pAll.status, 201);

  const feed = await request('GET', '', undefined, 'student_s3');
  assert.equal(feed.status, 200);
  const postIds = feed.body.posts.map(p => p.id);
  assert.ok(postIds.includes(pAll.body.id), 'Semester 3 student must see all-semester post');
});

// 3. Student Semester 3 cannot retrieve Semester 8-only posts.
test('3. Student Semester 3 cannot retrieve Semester 8-only posts in feed', async (t) => {
  const { request } = await fixture(t);
  const pSem8 = await request('POST', '', { content: 'Semester 8 final year project guidelines', targetSemesters: [8] }, 'student_s8');
  assert.equal(pSem8.status, 201);

  const feed = await request('GET', '', undefined, 'student_s3');
  assert.equal(feed.status, 200);
  const postIds = feed.body.posts.map(p => p.id);
  assert.ok(!postIds.includes(pSem8.body.id), 'Semester 3 student must NOT see Semester 8-only post in feed');
});

// 4. Changing query parameters does not bypass authorization.
test('4. Changing query parameters (?semester=8, ?semester_no=8, ?targetSemester=8) does not bypass student authorization', async (t) => {
  const { request } = await fixture(t);
  const pSem8 = await request('POST', '', { content: 'Restricted Sem 8 notes', targetSemesters: [8] }, 'student_s8');
  assert.equal(pSem8.status, 201);

  // Attempt query parameter injection with ?semester=8
  const feedBySem = await request('GET', '?semester=8', undefined, 'student_s3');
  assert.equal(feedBySem.status, 200);
  assert.ok(!feedBySem.body.posts.some(p => p.id === pSem8.body.id), '?semester=8 must NOT leak Sem 8 posts to Sem 3 student');

  // Attempt query parameter injection with ?semester_no=8
  const feedBySemNo = await request('GET', '?semester_no=8', undefined, 'student_s3');
  assert.equal(feedBySemNo.status, 200);
  assert.ok(!feedBySemNo.body.posts.some(p => p.id === pSem8.body.id), '?semester_no=8 must NOT leak Sem 8 posts to Sem 3 student');

  // Attempt query parameter injection with ?targetSemester=8
  const feedByTargetSem = await request('GET', '?targetSemester=8', undefined, 'student_s3');
  assert.equal(feedByTargetSem.status, 200);
  assert.ok(!feedByTargetSem.body.posts.some(p => p.id === pSem8.body.id), '?targetSemester=8 must NOT leak Sem 8 posts to Sem 3 student');

  // Attempt query parameter injection with ?target_semester=8
  const feedByTargetSemSnake = await request('GET', '?target_semester=8', undefined, 'student_s3');
  assert.equal(feedByTargetSemSnake.status, 200);
  assert.ok(!feedByTargetSemSnake.body.posts.some(p => p.id === pSem8.body.id), '?target_semester=8 must NOT leak Sem 8 posts to Sem 3 student');
});

// 5. Teacher assigned Semesters 3 and 5 sees eligible student posts from both.
test('5. Teacher assigned Semesters 3 and 5 sees eligible student posts from both', async (t) => {
  const { request } = await fixture(t);
  const pSem3 = await request('POST', '', { content: 'Student Sem 3 question', targetSemesters: [3] }, 'student_s3');
  const pSem5 = await request('POST', '', { content: 'Student Sem 5 question', targetSemesters: [5] }, 'student_s5');

  const teacherFeed = await request('GET', '', undefined, 'teacher_3_5');
  assert.equal(teacherFeed.status, 200);
  const postIds = teacherFeed.body.posts.map(p => p.id);
  assert.ok(postIds.includes(pSem3.body.id), 'Teacher must see student post from assigned Semester 3');
  assert.ok(postIds.includes(pSem5.body.id), 'Teacher must see student post from assigned Semester 5');
});

// 6. Teacher cannot see unrelated Semester 7 student posts.
test('6. Teacher cannot see unrelated Semester 7 student posts', async (t) => {
  const { request } = await fixture(t);
  const pSem7 = await request('POST', '', { content: 'Student Sem 7 elective poll', targetSemesters: [7] }, 'student_s7');

  const teacherFeed = await request('GET', '', undefined, 'teacher_3_5');
  assert.equal(teacherFeed.status, 200);
  const postIds = teacherFeed.body.posts.map(p => p.id);
  assert.ok(!postIds.includes(pSem7.body.id), 'Teacher must NOT see student post from unassigned Semester 7');

  // Passing ?semester=7 also must not bypass teacher assignment boundary
  const teacherQuerySem7 = await request('GET', '?semester=7', undefined, 'teacher_3_5');
  assert.equal(teacherQuerySem7.status, 200);
  assert.ok(!teacherQuerySem7.body.posts.some(p => p.id === pSem7.body.id), 'Teacher passing ?semester=7 cannot see unassigned student posts');
});

// 7. Teacher sees own posts.
test('7. Teacher sees own posts even if targeting an unassigned semester', async (t) => {
  const { request } = await fixture(t);
  // Teacher 3_5 creates a post targeting Semester 7 (an unassigned semester)
  const teacherOwnPost = await request('POST', '', {
    content: 'Prof Richards notice for senior batch',
    targetSemesters: [7]
  }, 'teacher_3_5');
  assert.equal(teacherOwnPost.status, 201);

  const teacherFeed = await request('GET', '', undefined, 'teacher_3_5');
  assert.equal(teacherFeed.status, 200);
  const postIds = teacherFeed.body.posts.map(p => p.id);
  assert.ok(postIds.includes(teacherOwnPost.body.id), 'Teacher must always see their own posts in feed');
});

// 8. Teacher cannot see other teachers ordinary posts in the normal feed.
test('8. Teacher cannot see other teachers ordinary posts in the normal feed', async (t) => {
  const { request } = await fixture(t);
  // Teacher Jones creates an ordinary General post targeting Semester 3
  const otherTeacherGeneral = await request('POST', '', {
    content: 'Prof Jones casual message',
    category: 'general',
    targetSemesters: [3]
  }, 'teacher_other');
  assert.equal(otherTeacherGeneral.status, 201);

  // Teacher Richards views normal feed
  const teacherFeed = await request('GET', '', undefined, 'teacher_3_5');
  assert.equal(teacherFeed.status, 200);
  const postIds = teacherFeed.body.posts.map(p => p.id);
  assert.ok(!postIds.includes(otherTeacherGeneral.body.id), 'Teacher must NOT see other teachers ordinary posts in feed');

  // But other teacher official notice IS visible
  const otherTeacherNotice = await request('POST', '', {
    content: 'Prof Jones official exam schedule',
    category: 'notice',
    targetSemesters: [3]
  }, 'teacher_other');
  assert.equal(otherTeacherNotice.status, 201);

  const feedWithNotice = await request('GET', '', undefined, 'teacher_3_5');
  const idsWithNotice = feedWithNotice.body.posts.map(p => p.id);
  assert.ok(idsWithNotice.includes(otherTeacherNotice.body.id), 'Teacher must see official notices from other teachers');
});

// 9. Teacher cannot see students-only posts.
test('9. Teacher cannot see students-only posts', async (t) => {
  const { request } = await fixture(t);
  const priv = await request('POST', '', {
    content: 'Private student homework help for Sem 3',
    audience: 'students_only',
    targetSemesters: [3]
  }, 'student_s3');
  assert.equal(priv.status, 201);

  // Student 3 sees it
  const s3Feed = await request('GET', '', undefined, 'student_s3');
  assert.ok(s3Feed.body.posts.some(p => p.id === priv.body.id));

  // Teacher Richards (teaches Sem 3) must NOT see students_only post
  const teacherFeed = await request('GET', '', undefined, 'teacher_3_5');
  assert.ok(!teacherFeed.body.posts.some(p => p.id === priv.body.id), 'Teacher must NOT see students-only post');
});

// 10. Admin can access all normal posts.
test('10. Admin can access all normal posts across all semesters', async (t) => {
  const { request } = await fixture(t);
  const p3 = await request('POST', '', { content: 'Post Sem 3', targetSemesters: [3] }, 'student_s3');
  const p7 = await request('POST', '', { content: 'Post Sem 7', targetSemesters: [7] }, 'student_s7');
  const p8 = await request('POST', '', { content: 'Post Sem 8', targetSemesters: [8] }, 'student_s8');

  const adminFeed = await request('GET', '', undefined, 'admin_user');
  assert.equal(adminFeed.status, 200);
  const adminIds = adminFeed.body.posts.map(p => p.id);
  assert.ok(adminIds.includes(p3.body.id), 'Admin sees Semester 3 post');
  assert.ok(adminIds.includes(p7.body.id), 'Admin sees Semester 7 post');
  assert.ok(adminIds.includes(p8.body.id), 'Admin sees Semester 8 post');
});

// 11. Authorized admin moderation can access restricted posts.
test('11. Authorized admin moderation (?moderation=true) can access restricted posts while separated from normal feed', async (t) => {
  const { request } = await fixture(t);
  const priv = await request('POST', '', {
    content: 'Flagged confidential student post',
    audience: 'students_only',
    targetSemesters: [3]
  }, 'student_s3');

  // Normal admin feed does NOT include students_only post
  const normalFeed = await request('GET', '', undefined, 'admin_user');
  assert.ok(!normalFeed.body.posts.some(p => p.id === priv.body.id), 'Normal admin feed hides students_only posts');

  // Moderation view allows admin to inspect restricted posts
  const modFeed = await request('GET', '?moderation=true', undefined, 'admin_user');
  assert.ok(modFeed.body.posts.some(p => p.id === priv.body.id), 'Admin with ?moderation=true sees restricted posts');

  // Direct access with ?moderation=true
  const modDirect = await request('GET', `/${priv.body.id}?moderation=true`, undefined, 'admin_user');
  assert.equal(modDirect.status, 200);
  assert.equal(modDirect.body.id, priv.body.id);
});

// 12. Multi-semester targeting still works.
test('12. Multi-semester targeting allows visibility across specified semesters and assigned teachers', async (t) => {
  const { request } = await fixture(t);
  const multiPost = await request('POST', '', {
    content: 'Seminar for Semesters 3 and 7',
    targetSemesters: [3, 7]
  }, 'student_s3');
  assert.equal(multiPost.status, 201);

  // Student 3 sees it (semester 3 matched)
  const s3Feed = await request('GET', '', undefined, 'student_s3');
  assert.ok(s3Feed.body.posts.some(p => p.id === multiPost.body.id), 'Semester 3 student sees multi-sem post');

  // Student 7 sees it (semester 7 matched)
  const s7Feed = await request('GET', '', undefined, 'student_s7');
  assert.ok(s7Feed.body.posts.some(p => p.id === multiPost.body.id), 'Semester 7 student sees multi-sem post');

  // Student 5 does NOT see it (only 3 & 7 targeted)
  const s5Feed = await request('GET', '', undefined, 'student_s5');
  assert.ok(!s5Feed.body.posts.some(p => p.id === multiPost.body.id), 'Semester 5 student does not see 3&7 post');

  // Teacher 3_5 sees it (teaches semester 3)
  const t3Feed = await request('GET', '', undefined, 'teacher_3_5');
  assert.ok(t3Feed.body.posts.some(p => p.id === multiPost.body.id), 'Teacher of Sem 3 sees multi-sem post');
});

// 13. Direct post access does not bypass audience rules.
test('13. Direct post access (GET /:id, likes, comments) enforces audience and semester visibility', async (t) => {
  const { request } = await fixture(t);

  // A. Students Only post direct access
  const priv = await request('POST', '', {
    content: 'Direct link restricted student post',
    audience: 'students_only',
    targetSemesters: [3]
  }, 'student_s3');
  const privId = priv.body.id;

  // Student 3 can access
  const sAccess = await request('GET', `/${privId}`, undefined, 'student_s3');
  assert.equal(sAccess.status, 200);

  // Teacher receives 404
  const tAccess = await request('GET', `/${privId}`, undefined, 'teacher_3_5');
  assert.equal(tAccess.status, 404, 'Teacher direct access to students_only post must return 404');

  // Teacher cannot comment on students_only post (returns 404)
  const tComment = await request('POST', `/${privId}/comments`, { content: 'Unauthorized comment' }, 'teacher_3_5');
  assert.equal(tComment.status, 404, 'Teacher comment on students_only post must return 404');

  // Teacher cannot like students_only post (returns 404)
  const tLike = await request('POST', `/${privId}/like`, {}, 'teacher_3_5');
  assert.equal(tLike.status, 404, 'Teacher like on students_only post must return 404');

  // B. Other teacher ordinary post direct access
  const otherTeachGeneral = await request('POST', '', {
    content: 'Prof Jones ordinary note',
    category: 'general',
    targetSemesters: [7]
  }, 'teacher_other');
  const otId = otherTeachGeneral.body.id;

  const tAccessOt = await request('GET', `/${otId}`, undefined, 'teacher_3_5');
  assert.equal(tAccessOt.status, 404, 'Teacher direct access to other teacher ordinary post must return 404');

  // C. Unassigned semester student post direct access
  const sem7Post = await request('POST', '', {
    content: 'Semester 7 student assignment discussion',
    targetSemesters: [7]
  }, 'student_s7');
  const sem7Id = sem7Post.body.id;

  // Teacher 3_5 cannot access Semester 7 student post
  const tAccessSem7 = await request('GET', `/${sem7Id}`, undefined, 'teacher_3_5');
  assert.equal(tAccessSem7.status, 404, 'Teacher direct access to unassigned semester student post must return 404');

  // Student 3 cannot access Semester 7 student post
  const s3AccessSem7 = await request('GET', `/${sem7Id}`, undefined, 'student_s3');
  assert.equal(s3AccessSem7.status, 404, 'Student 3 direct access to Semester 7 post must return 404');
});
