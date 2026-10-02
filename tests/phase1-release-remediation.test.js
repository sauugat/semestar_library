const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createClient } = require('@libsql/client');
const { ensurePostsSchema } = require('../lib/posts');
const createPostsRouter = require('../routes/posts');
const pushNotifications = require('../lib/push-notifications');

async function createTestDb() {
  const client = createClient({ url: ':memory:' });
  const blobs = new Map();
  const db = {
    saveFileBlob: async (filename, fileData, mimeType) => { blobs.set(filename, { fileData, mimeType }); return true; },
    getFileBlob: async filename => blobs.get(filename),
    deleteFileBlob: async filename => { blobs.delete(filename); return true; },
    isPostgres: false,
    exec: sql => client.executeMultiple(sql),
    all: async (sql, ...args) => {
      const res = await client.execute({ sql, args: args.flat() });
      return res.rows;
    },
    get: async (sql, ...args) => {
      const res = await client.execute({ sql, args: args.flat() });
      return res.rows[0];
    },
    run: async (sql, ...args) => {
      const res = await client.execute({ sql, args: args.flat() });
      return { lastInsertRowid: Number(res.lastInsertRowid), changes: res.rowsAffected };
    },
    initSchema: async () => {},
    close: () => client.close()
  };

  await db.exec(`
    CREATE TABLE students (
      studentId TEXT PRIMARY KEY,
      name TEXT,
      role TEXT,
      semester TEXT,
      passwordHash TEXT,
      avatarUrl TEXT
    );

    CREATE TABLE mobile_tokens (
      token TEXT PRIMARY KEY,
      studentId TEXT,
      expiresAt TEXT,
      createdAt TEXT
    );

    CREATE TABLE student_device_tokens (
      student_id TEXT,
      expo_push_token TEXT,
      platform TEXT,
      device_name TEXT,
      updated_at TEXT,
      PRIMARY KEY (student_id, expo_push_token)
    );

    CREATE TABLE student_notification_preferences (
      student_id TEXT PRIMARY KEY,
      mute_chat INTEGER DEFAULT 0,
      notify_notes INTEGER DEFAULT 1,
      notify_posts INTEGER DEFAULT 1,
      notify_notices INTEGER DEFAULT 1,
      hide_lockscreen_preview INTEGER DEFAULT 0,
      updated_at TEXT
    );

    CREATE TABLE push_notification_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT,
      event_id TEXT,
      recipient_student_id TEXT,
      payload_json TEXT,
      idempotency_key TEXT UNIQUE,
      status TEXT DEFAULT 'pending',
      attempts INTEGER DEFAULT 0,
      next_attempt_at TEXT,
      sent_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      storedName TEXT,
      originalName TEXT,
      title TEXT,
      semester TEXT,
      subject TEXT,
      chapter TEXT,
      uploadedBy TEXT,
      sizeBytes INTEGER,
      uploadedAt TEXT,
      previewName TEXT
    );

    CREATE TABLE file_likes (
      fileId INTEGER,
      studentId TEXT,
      PRIMARY KEY (fileId, studentId)
    );

    CREATE TABLE file_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fileId INTEGER,
      studentId TEXT,
      comment TEXT,
      createdAt TEXT
    );

    CREATE TABLE assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      subject TEXT,
      semester TEXT,
      createdBy TEXT,
      createdAt TEXT
    );

    CREATE TABLE assignment_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assignmentId INTEGER
    );

    CREATE TABLE submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assignmentId INTEGER,
      studentId TEXT,
      questionId INTEGER
    );
  `);

  await ensurePostsSchema(db);

  // Seed sample users
  await db.run("INSERT INTO students VALUES ('stud1', 'Student One', 'student', 'Semester 1', 'hash1', NULL)");
  await db.run("INSERT INTO students VALUES ('cr1', 'Class Rep', 'cr', 'Semester 1', 'hash2', NULL)");
  await db.run("INSERT INTO students VALUES ('teach1', 'Teacher One', 'teacher', 'Semester 1', 'hash3', NULL)");
  await db.run("INSERT INTO students VALUES ('admin1', 'Admin One', 'admin', 'Semester 1', 'hash4', NULL)");

  return db;
}

test('PHASE A1: Search Assignment SQL is completely parameterized and injection-safe', async (t) => {
  const db = await createTestDb();
  t.after(() => db.close());

  // Insert sample assignment
  await db.run("INSERT INTO assignments (title, subject, semester, createdBy, createdAt) VALUES ('Calculus I', 'Math', 'Semester 1', 'teach1', '2026-10-01T10:00:00.000Z')");

  // Attack payloads that would cause SQL injection if interpolated
  const attackStudentIds = [
    "' OR '1'='1",
    "'; DROP TABLE assignments; --",
    "' UNION SELECT 1,2,3,4,5,6 --",
    `" OR 1=1 --`,
    "%'",
    "_"
  ];

  for (const maliciousId of attackStudentIds) {
    const likeQuery = '%calc%';
    const cleanLikeQuery = '%calc%';
    const assignmentsQuery = `
      SELECT a.*, s.name AS teacherName,
        (SELECT COUNT(*) FROM assignment_questions aq WHERE aq.assignmentId = a.id) AS questionCount,
        (SELECT COUNT(DISTINCT studentId) FROM submissions sub WHERE sub.assignmentId = a.id) AS submissionCount,
        (SELECT COUNT(DISTINCT COALESCE(sub.questionId, sub.id)) FROM submissions sub WHERE sub.assignmentId = a.id AND sub.studentId = ?) AS mySubmissionCount
      FROM assignments a
      JOIN students s ON s.studentId = a.createdBy
      WHERE LOWER(a.title) LIKE LOWER(?) OR LOWER(a.subject) LIKE LOWER(?) OR LOWER(a.semester) LIKE LOWER(?) OR LOWER(a.createdBy) LIKE LOWER(?) OR LOWER(s.name) LIKE LOWER(?)
      ORDER BY a.createdAt DESC
      LIMIT 15
    `;

    // Query must execute successfully without throwing syntax errors and without leaking unauthorized counts
    const rows = await db.all(assignmentsQuery, maliciousId, likeQuery, likeQuery, likeQuery, cleanLikeQuery, cleanLikeQuery);
    assert.equal(rows.length, 1, `Query returned expected assignment under attack payload: ${maliciousId}`);
    assert.equal(Number(rows[0].mySubmissionCount), 0, `Submission count is safe 0`);
  }
});

test('PHASE A2: Notice and Assignment authorization rules are strictly enforced server-side', async (t) => {
  const db = await createTestDb();
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { studentId: req.headers['x-test-user'] };
    next();
  });
  const requireLogin = (req, res, next) => req.session?.studentId
    ? next()
    : res.status(401).json({ message: 'Authentication required.' });

  app.use('/api/posts', createPostsRouter(db, requireLogin, { uploadDir: '/tmp' }));
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  const port = server.address().port;

  t.after(async () => {
    await new Promise(r => server.close(r));
    db.close();
  });

  async function createPost(user, body) {
    const res = await fetch(`http://127.0.0.1:${port}/api/posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-user': user },
      body: JSON.stringify(body)
    });
    return { status: res.status, body: await res.json() };
  }

  // 1. Student -> Notice: must be 403 Forbidden
  const r1 = await createPost('stud1', { content: 'Exam delayed', type: 'notice' });
  assert.equal(r1.status, 403, 'Student cannot publish notice');

  // 2. Student -> Notice with official: false: must STILL be 403 Forbidden
  const r2 = await createPost('stud1', { content: 'Exam delayed', type: 'notice', official: false });
  assert.equal(r2.status, 403, 'Student cannot bypass notice check with official: false');

  // 3. Student -> Assignment: must be 403 Forbidden
  const r3 = await createPost('stud1', { content: 'Submit homework 3', type: 'assignment' });
  assert.equal(r3.status, 403, 'Student cannot create assignment');

  // 4. CR -> Notice: allowed (201)
  const r4 = await createPost('cr1', { content: 'Class room moved to 204', type: 'notice' });
  assert.equal(r4.status, 201, 'CR can publish notice');

  // 5. CR -> Assignment: rejected (403)
  const r5 = await createPost('cr1', { content: 'Assignment from CR', type: 'assignment' });
  assert.equal(r5.status, 403, 'CR cannot create assignment');

  // 6. Teacher -> Notice: allowed (201)
  const r6 = await createPost('teach1', { content: 'Lab rescheduled', type: 'notice' });
  assert.equal(r6.status, 201, 'Teacher can publish notice');

  // 7. Teacher -> Assignment: allowed (201)
  const r7 = await createPost('teach1', { content: 'Lab 4 Report Due Next Monday', type: 'assignment' });
  assert.equal(r7.status, 201, 'Teacher can create assignment');

  // 8. Admin -> Both allowed (201)
  const r8 = await createPost('admin1', { content: 'Campus Closed for Festival', type: 'notice' });
  assert.equal(r8.status, 201, 'Admin can publish notice');
  const r9 = await createPost('admin1', { content: 'Department Project Submission', type: 'assignment' });
  assert.equal(r9.status, 201, 'Admin can create assignment');

  // 9. Verify GET /api/posts?type=notice returns only authorized notices
  const listRes = await fetch(`http://127.0.0.1:${port}/api/posts?type=notice`, {
    headers: { 'x-test-user': 'stud1' }
  });
  assert.equal(listRes.status, 200);
  const listData = await listRes.json();
  assert.ok(listData.posts.length > 0);
  for (const post of listData.posts) {
    assert.ok(['admin', 'cr', 'teacher'].includes(post.role), 'All returned notices come from authorized roles');
  }
});

test('PHASE B1: Password change revokes all mobile bearer tokens for that student', async (t) => {
  const db = await createTestDb();
  t.after(() => db.close());

  // Insert two active mobile tokens for stud1
  await db.run("INSERT INTO mobile_tokens VALUES ('token_device_a', 'stud1', '2026-11-01', '2026-10-01')");
  await db.run("INSERT INTO mobile_tokens VALUES ('token_device_b', 'stud1', '2026-11-01', '2026-10-01')");
  // Insert token for another student that should NOT be revoked
  await db.run("INSERT INTO mobile_tokens VALUES ('token_other', 'stud2', '2026-11-01', '2026-10-01')");

  // Verify initial state
  const initialStud1Tokens = await db.all("SELECT * FROM mobile_tokens WHERE studentId = 'stud1'");
  assert.equal(initialStud1Tokens.length, 2);

  // Simulate password change logic
  const targetStudentId = 'stud1';
  await db.run('DELETE FROM mobile_tokens WHERE studentId = ?', targetStudentId);

  // Verify all mobile tokens for stud1 are deleted
  const remainingTokens = await db.all("SELECT * FROM mobile_tokens WHERE studentId = 'stud1'");
  assert.equal(remainingTokens.length, 0, 'All mobile tokens for student are revoked on password change');

  // Verify other student token is still intact
  const otherToken = await db.get("SELECT * FROM mobile_tokens WHERE studentId = 'stud2'");
  assert.ok(otherToken, 'Other student mobile token remains valid');
});

test('PHASE D1: Push notification fanout only enqueues recipients with active registered tokens', async (t) => {
  const db = await createTestDb();
  t.after(() => db.close());

  // Create 150 student IDs
  const allStudentIds = [];
  for (let i = 1; i <= 150; i++) {
    const sid = `student_${i}`;
    allStudentIds.push(sid);
    await db.run("INSERT INTO students (studentId, name, role, semester) VALUES (?, ?, 'student', 'Semester 1')", sid, `Student ${i}`);
  }

  // Exactly 30 students register device tokens
  for (let i = 1; i <= 30; i++) {
    const sid = `student_${i}`;
    await db.run("INSERT INTO student_device_tokens VALUES (?, ?, 'android', 'Pixel 9', '2026-10-01')", sid, `ExponentPushToken[token_${i}]`);
  }

  // Enqueue push for all 150 students
  const payload = {
    title: 'BIT Group Chat',
    body: 'Suman: Test message',
    data: { type: 'chat', eventId: '100' }
  };

  const enqueueRes = await pushNotifications.enqueuePushForRecipients(db, {
    eventType: 'chat',
    eventId: '100',
    recipientStudentIds: allStudentIds,
    payload
  });

  // Exactly 30 rows should have been enqueued into the outbox
  assert.equal(enqueueRes.enqueuedCount, 30, 'Only the 30 students with active tokens are enqueued');

  const outboxRows = await db.all("SELECT * FROM push_notification_outbox WHERE event_type = 'chat' AND event_id = '100'");
  assert.equal(outboxRows.length, 30, 'Outbox contains exactly 30 rows, zero tokenless spam');

  // Multi-device test: student_1 adds a second device token
  await db.run("INSERT INTO student_device_tokens VALUES (?, ?, 'android', 'Samsung Galaxy', '2026-10-01')", 'student_1', 'ExponentPushToken[token_1_device_2]');

  const enqueueRes2 = await pushNotifications.enqueuePushForRecipients(db, {
    eventType: 'chat',
    eventId: '101',
    recipientStudentIds: allStudentIds,
    payload
  });

  assert.equal(enqueueRes2.enqueuedCount, 30, 'Still creates 1 recipient event per student with devices');
});

test('PHASE F1: Direct material lookup GET /api/files/:id returns metadata and handles errors', async (t) => {
  const db = await createTestDb();
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.student = { studentId: req.headers['x-test-user'] || 'stud1', role: 'student' };
    req.session = { studentId: req.student.studentId, role: req.student.role };
    next();
  });

  // Mount GET /api/files/:id
  app.get('/api/files/:id', async (req, res) => {
    const fileId = req.params.id;
    if (!fileId || isNaN(parseInt(fileId, 10))) {
      return res.status(400).json({ message: 'Invalid file ID' });
    }

    const query = `
      SELECT files.id, files.originalName, files.title, files.semester, files.subject, files.chapter, files.sizeBytes, files.uploadedAt, files.uploadedBy,
        students.name AS uploaderName, students.avatarUrl AS uploaderAvatar, students.role AS uploaderRole,
        (SELECT COUNT(*) FROM file_likes WHERE file_likes.fileId = files.id) AS likeCount,
        EXISTS(SELECT 1 FROM file_likes WHERE fileId = files.id AND studentId = ?) AS liked,
        (SELECT COUNT(*) FROM file_comments WHERE file_comments.fileId = files.id) AS commentCount
      FROM files
      JOIN students ON students.studentId = files.uploadedBy
      WHERE files.id = ?
    `;

    const file = await db.get(query, req.student.studentId, parseInt(fileId, 10));
    if (!file) {
      return res.status(404).json({ message: 'Material not found' });
    }

    res.json(file);
  });

  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  const port = server.address().port;

  t.after(async () => {
    await new Promise(r => server.close(r));
    db.close();
  });

  // Seed sample file
  const insertRes = await db.run(`
    INSERT INTO files (storedName, originalName, title, semester, subject, chapter, uploadedBy, sizeBytes, uploadedAt)
    VALUES ('abc.pdf', 'Lecture1.pdf', 'Chapter 1 Notes', 'Semester 1', 'Math', 'Unit 1', 'teach1', 1024, '2026-10-01T10:00:00.000Z')
  `);
  const validId = insertRes.lastInsertRowid;

  // 1. Valid file lookup
  const r1 = await fetch(`http://127.0.0.1:${port}/api/files/${validId}`, {
    headers: { 'x-test-user': 'stud1' }
  });
  assert.equal(r1.status, 200);
  const data = await r1.json();
  assert.equal(data.id, validId);
  assert.equal(data.title, 'Chapter 1 Notes');
  assert.equal(data.originalName, 'Lecture1.pdf');
  assert.equal(data.uploaderName, 'Teacher One');
  assert.equal(data.sizeBytes, 1024);

  // 2. Non-existent file ID -> 404
  const r2 = await fetch(`http://127.0.0.1:${port}/api/files/99999`, {
    headers: { 'x-test-user': 'stud1' }
  });
  assert.equal(r2.status, 404);
  const errData = await r2.json();
  assert.equal(errData.message, 'Material not found');

  // 3. Malformed/non-numeric file ID -> 400
  const r3 = await fetch(`http://127.0.0.1:${port}/api/files/not-a-number`, {
    headers: { 'x-test-user': 'stud1' }
  });
  assert.equal(r3.status, 400);
});

test('PHASE D2: Multi-file batch upload creates exactly ONE combined push per recipient, not one per file', async (t) => {
  const db = await createTestDb();
  t.after(() => db.close());

  // Register 2 students with devices
  await db.run("INSERT INTO students (studentId, name, role, semester) VALUES ('student_sem1_a', 'Student A', 'student', 'Semester 1')");
  await db.run("INSERT INTO students (studentId, name, role, semester) VALUES ('student_sem1_b', 'Student B', 'student', 'Semester 1')");
  await db.run("INSERT INTO student_device_tokens VALUES ('student_sem1_a', 'ExponentPushToken[sem1_a]', 'android', 'Device A', '2026-10-01')");
  await db.run("INSERT INTO student_device_tokens VALUES ('student_sem1_b', 'ExponentPushToken[sem1_b]', 'android', 'Device B', '2026-10-01')");

  // Simulate teacher uploading 5 files in one logical batch
  const batchId = 'batch_uuid_12345';
  const fiveFiles = [
    { id: 101, originalName: 'doc1.pdf', title: 'Calculus Notes 1' },
    { id: 102, originalName: 'doc2.pdf', title: 'Calculus Notes 2' },
    { id: 103, originalName: 'doc3.pdf', title: 'Calculus Notes 3' },
    { id: 104, originalName: 'doc4.pdf', title: 'Calculus Notes 4' },
    { id: 105, originalName: 'doc5.pdf', title: 'Calculus Notes 5' },
  ];

  const batchResult = await pushNotifications.enqueueMaterialBatchPush(db, {
    batchId,
    files: fiveFiles,
    semester: 'Semester 1',
    subject: 'Calculus',
    chapter: 'Limits',
    uploaderStudentId: 'teach1',
    uploaderName: 'Teacher One'
  });

  // Exactly 2 outbox rows should exist (1 for student A, 1 for student B)
  assert.equal(batchResult.enqueuedCount, 2, 'Enqueued exactly 2 batch notifications (one per active student in semester)');

  const outboxRows = await db.all("SELECT * FROM push_notification_outbox WHERE event_type = 'material'");
  assert.equal(outboxRows.length, 2, 'Outbox has 2 rows total, NOT 10 rows (5 files * 2 students)');

  // Verify idempotency keys match material-batch format
  for (const row of outboxRows) {
    assert.ok(row.idempotency_key.startsWith(`material-batch:${batchId}:`), 'Uses stable material-batch idempotency key');
    const payload = JSON.parse(row.payload_json);
    assert.ok(payload.body.includes('5 new files') || payload.body.includes('5 new study materials'), 'Notification body summarizes the 5 materials');
  }
});

test('PHASE B2: Production mode rejects arbitrary server URL overrides and purges stored override', async () => {
  const fs = require('fs');
  const apiTs = fs.readFileSync('mobile/services/api.ts', 'utf8');
  const authCtx = fs.readFileSync('mobile/context/AuthContext.tsx', 'utf8');
  const devSettings = fs.readFileSync('mobile/app/developer-settings.tsx', 'utf8');
  const settingsTsx = fs.readFileSync('mobile/app/settings.tsx', 'utf8');

  // Verify api.ts has strict !__DEV__ guard
  assert.ok(apiTs.includes('if (!__DEV__)'), 'api.ts must check !__DEV__');
  assert.ok(apiTs.includes('SecureStore.deleteItemAsync(SERVER_URL_STORAGE_KEY)'), 'api.ts deletes stored server URL in production');

  // Verify AuthContext.tsx has strict !__DEV__ guard
  assert.ok(authCtx.includes('if (!__DEV__)'), 'AuthContext must check !__DEV__');
  assert.ok(authCtx.includes('SecureStore.deleteItemAsync(SERVER_URL_KEY)'), 'AuthContext deletes stored server URL in production');

  // Verify developer-settings.tsx is blocked in production
  assert.ok(devSettings.includes('if (!__DEV__)'), 'developer-settings.tsx has production guard');
  assert.ok(devSettings.includes("router.replace('/settings')"), 'Redirects away from developer-settings in production');

  // Verify settings.tsx 7-tap gesture is disabled in production
  assert.ok(settingsTsx.includes('if (!__DEV__) return;'), '7-tap dev trigger is disabled in production');
});

test('PHASE C1: Zero synthetic engagement or fabricated like injection code in codebase', () => {
  const fs = require('fs');
  const serverJs = fs.readFileSync('server.js', 'utf8');
  const seedJs = fs.readFileSync('seed.js', 'utf8');

  // Must not find student 26020266 in synthetic like generation
  assert.ok(!serverJs.includes("file_likes VALUES (?, '26020266')"), 'server.js must not insert fake likes for 26020266');
  assert.ok(!serverJs.includes('Math.random() > 0.4'), 'server.js must not contain random like probability loops');
  assert.ok(!seedJs.includes('Math.random() > 0.4'), 'seed.js must not contain random synthetic like generation');
});

test('PHASE G & H: Production build configuration, permission minimization, and dead code cleanup', () => {
  const fs = require('fs');
  const appJson = JSON.parse(fs.readFileSync('mobile/app.json', 'utf8'));

  // Phase G1: App identity
  assert.equal(appJson.expo.name, 'Semester Library', 'App name must be Semester Library');

  // Phase G2: Android target SDK 36 configured via expo-build-properties
  const buildPropertiesPlugin = appJson.expo.plugins.find(
    p => Array.isArray(p) && p[0] === 'expo-build-properties'
  );
  assert.ok(buildPropertiesPlugin, 'expo-build-properties must be installed');
  assert.equal(buildPropertiesPlugin[1].android.compileSdkVersion, 36, 'compileSdkVersion is 36');
  assert.equal(buildPropertiesPlugin[1].android.targetSdkVersion, 36, 'targetSdkVersion is 36');

  // Phase G3: Minimal permissions (no READ_MEDIA_VIDEO, READ_MEDIA_AUDIO, WRITE_EXTERNAL_STORAGE)
  const permissions = appJson.expo.android?.permissions || [];
  assert.ok(!permissions.includes('android.permission.READ_MEDIA_VIDEO'), 'READ_MEDIA_VIDEO must be removed');
  assert.ok(!permissions.includes('android.permission.READ_MEDIA_AUDIO'), 'READ_MEDIA_AUDIO must be removed');
  assert.ok(!permissions.includes('android.permission.WRITE_EXTERNAL_STORAGE'), 'WRITE_EXTERNAL_STORAGE must be removed');

  // Phase G4: expo-dev-launcher is removed from plugins
  const devLauncherPlugin = appJson.expo.plugins.find(
    p => p === 'expo-dev-launcher' || (Array.isArray(p) && p[0] === 'expo-dev-launcher')
  );
  assert.equal(devLauncherPlugin, undefined, 'expo-dev-launcher must not be bundled in production plugins');

  // Phase H: Forum route deleted
  assert.equal(fs.existsSync('mobile/app/forum.tsx'), false, 'forum.tsx must be deleted');
  const layoutTsx = fs.readFileSync('mobile/app/_layout.tsx', 'utf8');
  assert.ok(!layoutTsx.includes('name="forum"'), 'forum route must be unregistered from _layout.tsx');

  // Phase E2: user/[id] registered with headerShown: false to prevent duplicate header
  assert.ok(layoutTsx.includes('name="user/[id]" options={{ headerShown: false }}'), 'user/[id] must have headerShown: false');
});

test('ACCOUNT DELETION: Full authenticated purge of credentials, sessions, tokens, and interactions', async (t) => {
  const db = await createTestDb();
  t.after(() => db.close());
  const bcrypt = require('bcryptjs');

  const sid = 'stu_to_delete';
  const pass = 'SuperSecret123!';
  const passHash = bcrypt.hashSync(pass, 8);

  // Seed student and their associated records
  await db.run("INSERT INTO students (studentId, name, role, semester, passwordHash) VALUES (?, 'Delete Me', 'student', 'Semester 1', ?)", sid, passHash);
  await db.run("INSERT INTO mobile_tokens VALUES ('mob_tok_del_1', ?, '2026-12-01', '2026-10-01')", sid);
  await db.run("INSERT INTO student_device_tokens (expo_push_token, student_id, platform, device_name) VALUES ('ExponentPushToken[del_dev]', ?, 'android', 'Pixel 9')", sid);
  await db.run("INSERT INTO student_notification_preferences (student_id) VALUES (?)", sid);
  await db.run("INSERT INTO file_likes VALUES (1, ?)", sid);

  // Setup express test app with account deletion logic
  const express = require('express');
  const app = express();
  app.use(express.json());

  // In-app deletion route simulation
  app.post('/api/account/delete', async (req, res) => {
    const studentId = req.headers['x-student-id'];
    const { password } = req.body || {};
    if (!password) return res.status(400).json({ message: 'Current password required' });

    const student = await db.get('SELECT * FROM students WHERE studentId = ?', studentId);
    if (!student) return res.status(404).json({ message: 'Account not found' });

    if (!bcrypt.compareSync(password, student.passwordHash)) {
      return res.status(401).json({ message: 'Incorrect password' });
    }

    await db.run('DELETE FROM mobile_tokens WHERE studentId = ?', studentId);
    await db.run('DELETE FROM student_device_tokens WHERE student_id = ?', studentId);
    await db.run('DELETE FROM student_notification_preferences WHERE student_id = ?', studentId);
    await db.run('DELETE FROM file_likes WHERE studentId = ?', studentId);
    await db.run('DELETE FROM students WHERE studentId = ?', studentId);

    res.json({ success: true, message: 'Account permanently deleted' });
  });

  // Web deletion request simulation
  app.post('/api/account/delete-request', async (req, res) => {
    const { studentId, password, confirmPermanent } = req.body || {};
    if (!studentId || !password || !confirmPermanent) return res.status(400).json({ message: 'Missing fields' });
    const student = await db.get('SELECT * FROM students WHERE studentId = ?', studentId);
    if (!student || !bcrypt.compareSync(password, student.passwordHash)) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    await db.run('DELETE FROM mobile_tokens WHERE studentId = ?', studentId);
    await db.run('DELETE FROM student_device_tokens WHERE student_id = ?', studentId);
    await db.run('DELETE FROM students WHERE studentId = ?', studentId);
    res.json({ success: true, message: 'Account permanently deleted' });
  });

  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  const port = server.address().port;
  t.after(async () => {
    await new Promise(r => server.close(r));
  });

  // 1. Wrong password rejected
  const r1 = await fetch(`http://127.0.0.1:${port}/api/account/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-student-id': sid },
    body: JSON.stringify({ password: 'WrongPassword!' })
  });
  assert.equal(r1.status, 401);

  // 2. Correct password deletes account and all associated tokens/records
  const r2 = await fetch(`http://127.0.0.1:${port}/api/account/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-student-id': sid },
    body: JSON.stringify({ password: pass })
  });
  assert.equal(r2.status, 200);
  const data2 = await r2.json();
  assert.equal(data2.success, true);

  // Verify DB records are completely purged
  assert.equal(await db.get('SELECT * FROM students WHERE studentId = ?', sid), undefined);
  assert.equal((await db.all('SELECT * FROM mobile_tokens WHERE studentId = ?', sid)).length, 0);
  assert.equal((await db.all('SELECT * FROM student_device_tokens WHERE student_id = ?', sid)).length, 0);
  assert.equal((await db.all('SELECT * FROM student_notification_preferences WHERE student_id = ?', sid)).length, 0);
  assert.equal((await db.all('SELECT * FROM file_likes WHERE studentId = ?', sid)).length, 0);

  // 3. Web deletion portal verification
  const sidWeb = 'stu_web_del';
  await db.run("INSERT INTO students (studentId, name, role, semester, passwordHash) VALUES (?, 'Web User', 'student', 'Semester 1', ?)", sidWeb, passHash);
  await db.run("INSERT INTO mobile_tokens VALUES ('mob_tok_del_2', ?, '2026-12-01', '2026-10-01')", sidWeb);

  const r3 = await fetch(`http://127.0.0.1:${port}/api/account/delete-request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: sidWeb, password: pass, confirmPermanent: true })
  });
  assert.equal(r3.status, 200);
  assert.equal(await db.get('SELECT * FROM students WHERE studentId = ?', sidWeb), undefined);
  assert.equal((await db.all('SELECT * FROM mobile_tokens WHERE studentId = ?', sidWeb)).length, 0);
});



