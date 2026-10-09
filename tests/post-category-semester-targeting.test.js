const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createClient } = require('@libsql/client');
const { ensurePostsSchema, VALID_POST_CATEGORIES, DEFAULT_POST_CATEGORY, CATEGORY_LABELS } = require('../lib/posts');
const createPostsRouter = require('../routes/posts');

async function fixture(t) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'post-cat-sem-'));
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
      ('student_s3', 'Charlie Sem3', 'student', '/a3.png', 'Semester 3'),
      ('cr_s1', 'Danielle CR', 'cr', '/a4.png', 'Semester 1'),
      ('admin_user', 'Admin Alex', 'admin', '/a5.png', 'Semester 4'),
      ('teacher_user', 'Prof Smith', 'teacher', '/a6.png', NULL);
  `);

  await ensurePostsSchema(db);

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { studentId: req.headers['x-test-user'] || 'student_s1' };
    next();
  });
  const requireLogin = (req, res, next) => req.session.studentId
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
    return { status: response.status, body: await response.json() };
  }

  return { db, request, client };
}

test('1. Meta endpoint returns all canonical categories, labels, and default values', async (t) => {
  const { request } = await fixture(t);
  const res = await request('GET', '/meta');
  assert.equal(res.status, 200);
  assert.equal(res.body.defaultCategory, 'general');
  assert.deepEqual(res.body.semesters, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(res.body.categories.length, 6);
  const ids = res.body.categories.map(c => c.id);
  assert.deepEqual(ids, ['notice', 'general', 'announcement', 'news', 'complaints', 'feedback']);
});

test('2. Default post creation assigns General category and All Semesters targeting', async (t) => {
  const { request } = await fixture(t);
  const created = await request('POST', '', { content: 'Default post testing' }, 'student_s1');
  assert.equal(created.status, 201);
  assert.equal(created.body.category, 'general');
  assert.equal(created.body.category_label, 'General');
  assert.equal(created.body.allSemesters, true);
  assert.deepEqual(created.body.targetSemesters, []);
  assert.equal(created.body.semester_display, 'All Semesters');
});

test('3. Custom category creation and case-insensitivity validation', async (t) => {
  const { request } = await fixture(t);
  for (const cat of ['Notice', 'ANNOUNCEMENT', 'news', 'Complaints', 'Feedback']) {
    const res = await request('POST', '', {
      content: `Testing category ${cat}`,
      category: cat
    }, 'student_s1');
    assert.equal(res.status, 201);
    assert.equal(res.body.category, cat.toLowerCase());
    assert.equal(res.body.category_label, CATEGORY_LABELS[cat.toLowerCase()]);
  }
});

test('4. Invalid category is rejected with HTTP 400', async (t) => {
  const { request } = await fixture(t);
  for (const badCat of ['random', 'flair', '123', 'invalid', 'meme']) {
    const res = await request('POST', '', {
      content: 'Bad category post',
      category: badCat
    }, 'student_s1');
    assert.equal(res.status, 400);
    assert.match(res.body.message, /invalid category/i);
  }
});

test('5. Single semester targeting and multi-semester targeting', async (t) => {
  const { request } = await fixture(t);

  // Single semester
  const single = await request('POST', '', {
    content: 'Only for Semester 2',
    category: 'news',
    targetSemesters: [2]
  }, 'student_s1');
  assert.equal(single.status, 201);
  assert.equal(single.body.allSemesters, false);
  assert.deepEqual(single.body.targetSemesters, [2]);
  assert.equal(single.body.semester_display, 'Semester 2');

  // Multi-semester: 1, 3, 5
  const multi = await request('POST', '', {
    content: 'For Semester 1, 3, 5',
    category: 'announcement',
    targetSemesters: [5, 1, 3]
  }, 'student_s1');
  assert.equal(multi.status, 201);
  assert.equal(multi.body.allSemesters, false);
  assert.deepEqual(multi.body.targetSemesters, [1, 3, 5]); // Sorted
  assert.equal(multi.body.semester_display, 'Semester 1, 3, 5');
});

test('6. All Semesters canonical representations and deduplication', async (t) => {
  const { request } = await fixture(t);

  // Repeated values are deduplicated
  const dedup = await request('POST', '', {
    content: 'Dedup check',
    targetSemesters: [3, 3, 1, 1, 5]
  }, 'student_s1');
  assert.equal(dedup.status, 201);
  assert.deepEqual(dedup.body.targetSemesters, [1, 3, 5]);

  // Selecting all 8 semesters canonicalizes to All Semesters
  const all8 = await request('POST', '', {
    content: 'All 8 selected',
    targetSemesters: [1, 2, 3, 4, 5, 6, 7, 8]
  }, 'student_s1');
  assert.equal(all8.status, 201);
  assert.equal(all8.body.allSemesters, true);
  assert.deepEqual(all8.body.targetSemesters, []);
  assert.equal(all8.body.semester_display, 'All Semesters');

  // String 'all' canonicalizes to All Semesters
  const allStr = await request('POST', '', {
    content: 'All string selected',
    targetSemesters: 'all'
  }, 'student_s1');
  assert.equal(allStr.status, 201);
  assert.equal(allStr.body.allSemesters, true);
});

test('7. Invalid semesters rejected with HTTP 400', async (t) => {
  const { request } = await fixture(t);
  for (const badList of [[0], [9], [-1], [1, 9], ['bad'], ['semester 99']]) {
    const res = await request('POST', '', {
      content: 'Bad semester list',
      targetSemesters: badList
    }, 'student_s1');
    assert.equal(res.status, 400);
    assert.match(res.body.message, /invalid semester/i);
  }
});

test('8. Feed retrieval respects semester visibility and author access', async (t) => {
  const { request } = await fixture(t);

  // Post 1: Target = Semester 1
  const p1 = await request('POST', '', { content: 'Post for Sem 1', targetSemesters: [1] }, 'student_s1');
  // Post 2: Target = Semester 2
  const p2 = await request('POST', '', { content: 'Post for Sem 2', targetSemesters: [2] }, 'student_s2');
  const p3 = await request('POST', '', { content: 'Post for Sem 1 & 3', targetSemesters: [1, 3] }, 'student_s3');
  // Post 4: Target = All Semesters
  const p4 = await request('POST', '', { content: 'Post for All Semesters', targetSemesters: 'all' }, 'admin_user');

  // Viewer Alice (Semester 1): should see Post 1, Post 3, Post 4 (and NOT Post 2)
  const aliceFeed = await request('GET', '', undefined, 'student_s1');
  const aliceIds = aliceFeed.body.posts.map(p => p.id);
  assert.ok(aliceIds.includes(p1.body.id), 'Alice sees Sem 1 post');
  assert.ok(aliceIds.includes(p3.body.id), 'Alice sees Sem 1&3 post');
  assert.ok(aliceIds.includes(p4.body.id), 'Alice sees All Semesters post');
  assert.ok(!aliceIds.includes(p2.body.id), 'Alice CANNOT see Sem 2 post');

  // Viewer Bob (Semester 2): should see Post 2 and Post 4 (and NOT Post 1 or Post 3)
  const bobFeed = await request('GET', '', undefined, 'student_s2');
  const bobIds = bobFeed.body.posts.map(p => p.id);
  assert.ok(bobIds.includes(p2.body.id), 'Bob sees Sem 2 post');
  assert.ok(bobIds.includes(p4.body.id), 'Bob sees All Semesters post');
  assert.ok(!bobIds.includes(p1.body.id), 'Bob CANNOT see Sem 1 post');
  assert.ok(!bobIds.includes(p3.body.id), 'Bob CANNOT see Sem 1&3 post');

  // Viewer Admin: sees all posts
  const adminFeed = await request('GET', '', undefined, 'admin_user');
  const adminIds = adminFeed.body.posts.map(p => p.id);
  assert.ok(adminIds.includes(p1.body.id));
  assert.ok(adminIds.includes(p2.body.id));
  assert.ok(adminIds.includes(p3.body.id));
  assert.ok(adminIds.includes(p4.body.id));
});

test('9. Single post detail access (GET /:id) denies wrong-semester access', async (t) => {
  const { request } = await fixture(t);
  const pSem3 = await request('POST', '', { content: 'Private to Sem 3', targetSemesters: [3] }, 'student_s3');
  const postId = pSem3.body.id;

  // Semester 3 student can access
  const sem3Res = await request('GET', `/${postId}`, undefined, 'student_s3');
  assert.equal(sem3Res.status, 200);
  assert.equal(sem3Res.body.content, 'Private to Sem 3');

  // Semester 1 student receives 404 (wrong-semester access denied)
  const sem1Res = await request('GET', `/${postId}`, undefined, 'student_s1');
  assert.equal(sem1Res.status, 404);

  // Admin can access any semester post
  const adminRes = await request('GET', `/${postId}`, undefined, 'admin_user');
  assert.equal(adminRes.status, 200);
});

test('10. Legacy posts compatibility: defaults to General category and All Semesters', async (t) => {
  const { db, request } = await fixture(t);
  // Directly insert a legacy post with no category and no targeting
  const insertLegacy = await db.run(
    `INSERT INTO posts (user_id, content, type, created_at)
     VALUES (?, ?, ?, ?)`,
    'student_s1', 'Ancient legacy post from previous version', 'status', new Date().toISOString()
  );
  const legacyId = insertLegacy.lastInsertRowid;

  const res = await request('GET', `/${legacyId}`, undefined, 'student_s2');
  assert.equal(res.status, 200);
  assert.equal(res.body.category, 'general');
  assert.equal(res.body.category_label, 'General');
  assert.equal(res.body.allSemesters, true);
  assert.deepEqual(res.body.targetSemesters, []);
  assert.equal(res.body.semester_display, 'All Semesters');
});

test('11. Post editing allows changing category and target semesters', async (t) => {
  const { request } = await fixture(t);
  const created = await request('POST', '', {
    content: 'Initial post content',
    category: 'general',
    targetSemesters: 'all'
  }, 'student_s1');
  const postId = created.body.id;

  // Edit to category 'complaints' and target Semester 1, 2
  const edited = await request('PUT', `/${postId}`, {
    content: 'Updated post content',
    category: 'complaints',
    targetSemesters: [1, 2]
  }, 'student_s1');
  assert.equal(edited.status, 200);
  assert.equal(edited.body.category, 'complaints');
  assert.equal(edited.body.category_label, 'Complaints');
  assert.equal(edited.body.allSemesters, false);
  assert.deepEqual(edited.body.targetSemesters, [1, 2]);

  // Re-fetch to ensure database persistence
  const fetched = await request('GET', `/${postId}`, undefined, 'student_s1');
  assert.equal(fetched.status, 200);
  assert.equal(fetched.body.category, 'complaints');
  assert.deepEqual(fetched.body.targetSemesters, [1, 2]);
});

test('12. Category filter in feed (GET /api/posts?category=...)', async (t) => {
  const { request } = await fixture(t);
  await request('POST', '', { content: 'Notice post 1', category: 'notice' }, 'student_s1');
  await request('POST', '', { content: 'News post 1', category: 'news' }, 'student_s1');
  await request('POST', '', { content: 'Feedback post 1', category: 'feedback' }, 'student_s1');

  const noticeFeed = await request('GET', '?category=notice', undefined, 'student_s1');
  assert.equal(noticeFeed.status, 200);
  assert.ok(noticeFeed.body.posts.every(p => p.category === 'notice'));

  const newsFeed = await request('GET', '?category=news', undefined, 'student_s1');
  assert.equal(newsFeed.status, 200);
  assert.ok(newsFeed.body.posts.every(p => p.category === 'news'));
});

test('13. Role permissions: Student posting category=Notice does NOT make it an official university notice', async (t) => {
  const { request } = await fixture(t);
  // Student creates post with category "notice"
  const studentPost = await request('POST', '', {
    content: 'Classmates reminder: bring calculators',
    category: 'notice'
  }, 'student_s1');
  assert.equal(studentPost.status, 201);
  assert.equal(studentPost.body.category, 'notice');
  // Must NOT be official notice
  assert.equal(studentPost.body.type, 'status');
  assert.equal(studentPost.body.is_official, false);
});
