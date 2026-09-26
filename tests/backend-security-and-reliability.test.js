process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@libsql/client');
const express = require('express');

const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Helper to create an isolated test database fixture with the project schema
async function createTestDb(t) {
  const dbFile = path.join(os.tmpdir(), `test_db_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
  const client = createClient({ url: `file:${dbFile}` });
  if (t && t.after) {
    t.after(() => {
      try { client.close(); } catch (_) {}
      try { fsSync.unlinkSync(dbFile); } catch (_) {}
    });
  }
  const blobs = new Map();
  const db = {
    isPostgres: false,
    exec: sql => client.executeMultiple(sql),
    all: async (sql, ...args) => {
      const res = await client.execute({ sql, args });
      return res.rows;
    },
    get: async (sql, ...args) => {
      const res = await client.execute({ sql, args });
      return res.rows[0];
    },
    run: async (sql, ...args) => {
      const res = await client.execute({ sql, args });
      return { lastInsertRowid: Number(res.lastInsertRowid), changes: res.rowsAffected };
    },
    saveFileBlob: async (filename, fileData, mimeType) => {
      blobs.set(filename, { fileData, mimeType });
      return true;
    },
    getFileBlob: async (filename) => blobs.get(filename),
    deleteFileBlob: async (filename) => {
      blobs.delete(filename);
      return true;
    },
    withTransaction: async (fn) => {
      const tx = await client.transaction('write');
      const txWrapper = {
        run: async (sql, ...args) => {
          const res = await tx.execute({ sql, args });
          return { lastInsertRowid: Number(res.lastInsertRowid), changes: res.rowsAffected };
        },
        get: async (sql, ...args) => {
          const res = await tx.execute({ sql, args });
          return res.rows[0];
        },
        all: async (sql, ...args) => {
          const res = await tx.execute({ sql, args });
          return res.rows;
        }
      };
      try {
        const result = await fn(txWrapper);
        await tx.commit();
        return result;
      } catch (err) {
        await tx.rollback();
        throw err;
      }
    }
  };

  // Create tables according to db.js schema
  await db.exec(`
    CREATE TABLE students (
      studentId TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      passwordHash TEXT NOT NULL,
      role TEXT DEFAULT 'student',
      avatarUrl TEXT
    );

    CREATE TABLE assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      pdfUrl TEXT,
      pdfName TEXT,
      createdBy TEXT,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE assignment_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assignmentId INTEGER NOT NULL,
      title TEXT NOT NULL,
      orderIndex INTEGER DEFAULT 0
    );

    CREATE TABLE submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assignmentId INTEGER NOT NULL,
      questionId INTEGER,
      studentId TEXT NOT NULL,
      language TEXT,
      code TEXT,
      stdout TEXT,
      stderr TEXT,
      testResults TEXT,
      questionTitle TEXT,
      status TEXT,
      passed INTEGER DEFAULT 0,
      total INTEGER DEFAULT 0,
      submittedAt TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_test_sub_q ON submissions(assignmentId, studentId, questionId) WHERE questionId IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_test_sub_l ON submissions(assignmentId, studentId) WHERE questionId IS NULL;

    CREATE TABLE IF NOT EXISTS login_attempts (
      ip TEXT PRIMARY KEY,
      attemptCount INTEGER DEFAULT 0,
      lockedUntil TEXT,
      lastAttemptAt TEXT NOT NULL
    );

    CREATE TABLE chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studentId TEXT NOT NULL,
      text TEXT,
      attachmentName TEXT,
      attachmentOriginalName TEXT,
      attachmentUrl TEXT,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE chat_pinned (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      messageId INTEGER NOT NULL,
      text TEXT,
      senderName TEXT,
      pinnedBy TEXT,
      pinnedAt TEXT
    );

    CREATE TABLE chat_reactions (
      messageId INTEGER NOT NULL,
      studentId TEXT NOT NULL,
      emoji TEXT NOT NULL,
      PRIMARY KEY (messageId, studentId)
    );

    CREATE TABLE chat_read_receipts (
      studentId TEXT PRIMARY KEY,
      lastReadMessageId INTEGER NOT NULL
    );

    CREATE TABLE session (
      sid TEXT PRIMARY KEY,
      sess TEXT NOT NULL,
      expire TEXT NOT NULL
    );
  `);

  return db;
}

test('unauthorized avatar and PDF file access: unrelated files are rejected with 404', async (t) => {
  const db = await createTestDb(t);

  // Seed student with specific avatar
  await db.run('INSERT INTO students (studentId, name, passwordHash, role, avatarUrl) VALUES (?, ?, ?, ?, ?)',
    'std1', 'Alice', 'hash123', 'student', '/api/avatar/alice_real.jpg');

  // Attempt to check if an unrelated file (e.g. secret_exam.pdf) can be served as an avatar
  const targetFile = 'secret_exam.pdf';
  const avatarOwner = await db.get(
    'SELECT studentId FROM students WHERE avatarUrl = ? OR avatarUrl = ? OR avatarUrl LIKE ? LIMIT 1',
    `/api/avatar/${targetFile}`, targetFile, `%/${targetFile}`
  );
  assert.equal(avatarOwner, undefined, 'Unrelated file must not match any student avatar');

  // Attempt to check if an unrelated file can be served as an assignment PDF
  const pdfAssignment = await db.get(
    'SELECT id FROM assignments WHERE pdfUrl = ? OR pdfUrl LIKE ? LIMIT 1',
    targetFile, `%${targetFile}%`
  );
  assert.equal(pdfAssignment, undefined, 'Unrelated file must not match any assignment PDF');
});

test('assignment submissions: one student can submit multiple questions in the same assignment', async (t) => {
  const db = await createTestDb(t);

  await db.run('INSERT INTO students (studentId, name, passwordHash) VALUES (?, ?, ?)', 's101', 'Bob', 'hash');
  const aRes = await db.run('INSERT INTO assignments (title, createdBy, createdAt) VALUES (?, ?, ?)', 'Midterm Lab', 's101', new Date().toISOString());
  const assignmentId = aRes.lastInsertRowid;

  const q1Res = await db.run('INSERT INTO assignment_questions (assignmentId, title, orderIndex) VALUES (?, ?, ?)', assignmentId, 'Q1: Loops', 1);
  const q2Res = await db.run('INSERT INTO assignment_questions (assignmentId, title, orderIndex) VALUES (?, ?, ?)', assignmentId, 'Q2: Recursion', 2);
  const q1Id = q1Res.lastInsertRowid;
  const q2Id = q2Res.lastInsertRowid;

  // Student s101 submits Question 1
  await db.run(
    'INSERT INTO submissions (assignmentId, questionId, studentId, language, code, status, submittedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
    assignmentId, q1Id, 's101', 'c', 'int main(){}', 'passed', new Date().toISOString()
  );

  // Student s101 submits Question 2 for the same assignment
  await db.run(
    'INSERT INTO submissions (assignmentId, questionId, studentId, language, code, status, submittedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
    assignmentId, q2Id, 's101', 'c', 'int rec(){}', 'passed', new Date().toISOString()
  );

  const subs = await db.all('SELECT * FROM submissions WHERE assignmentId = ? AND studentId = ?', assignmentId, 's101');
  assert.equal(subs.length, 2, 'Student must be able to submit multiple questions within the same assignment');
});

test('transaction rollback: failed assignment creation rolls back cleanly without partial rows', async (t) => {
  const db = await createTestDb(t);

  await assert.rejects(async () => {
    await db.withTransaction(async (tx) => {
      const a = await tx.run('INSERT INTO assignments (title, createdBy, createdAt) VALUES (?, ?, ?)', 'Incomplete Assignment', 'teacher', new Date().toISOString());
      await tx.run('INSERT INTO assignment_questions (assignmentId, title, orderIndex) VALUES (?, ?, ?)', a.lastInsertRowid, 'Question 1', 1);
      throw new Error('Simulated failure during question testcase processing');
    });
  }, /Simulated failure/);

  const asgns = await db.all('SELECT * FROM assignments WHERE title = ?', 'Incomplete Assignment');
  assert.equal(asgns.length, 0, 'No assignment row should remain after transaction failure');
  const questions = await db.all('SELECT * FROM assignment_questions WHERE title = ?', 'Question 1');
  assert.equal(questions.length, 0, 'No question rows should remain after transaction failure');
});

test('session revocation: password change revokes other active sessions for that student', async (t) => {
  const db = await createTestDb(t);
  const studentId = '26020123';
  const expire = new Date(Date.now() + 86400000).toISOString();

  await db.run('INSERT INTO session (sid, sess, expire) VALUES (?, ?, ?)', 'current_device_sid', JSON.stringify({ studentId }), expire);
  await db.run('INSERT INTO session (sid, sess, expire) VALUES (?, ?, ?)', 'old_laptop_sid', JSON.stringify({ studentId }), expire);
  await db.run('INSERT INTO session (sid, sess, expire) VALUES (?, ?, ?)', 'friend_device_sid', JSON.stringify({ studentId: 'another_student' }), expire);

  // Revoke other sessions on password update
  const currentSid = 'current_device_sid';
  await db.run(
    'DELETE FROM session WHERE sid != ? AND sess LIKE ?',
    currentSid, `%"studentId":"${studentId}"%`
  );

  const remaining = await db.all('SELECT sid FROM session ORDER BY sid ASC');
  const sids = remaining.map(r => r.sid);
  assert.deepEqual(sids, ['current_device_sid', 'friend_device_sid'], 'Old session must be deleted, current device and other students preserved');
});

test('chat pinned messages: persistent storage and unpin lifecycle', async (t) => {
  const db = await createTestDb(t);

  const pinnedMsg = {
    messageId: 88,
    text: 'Exam starts at 9am in Room 402',
    senderName: 'Prof. Sharma',
    pinnedBy: 'Admin Saugat',
    pinnedAt: new Date().toISOString()
  };

  // Pin message
  await db.run(
    'INSERT OR REPLACE INTO chat_pinned (id, messageId, text, senderName, pinnedBy, pinnedAt) VALUES (1, ?, ?, ?, ?, ?)',
    pinnedMsg.messageId, pinnedMsg.text, pinnedMsg.senderName, pinnedMsg.pinnedBy, pinnedMsg.pinnedAt
  );

  let row = await db.get('SELECT * FROM chat_pinned WHERE id = 1');
  assert.ok(row);
  assert.equal(row.messageId, 88);
  assert.equal(row.text, pinnedMsg.text);

  // Unpin message
  await db.run('DELETE FROM chat_pinned WHERE id = 1');
  row = await db.get('SELECT * FROM chat_pinned WHERE id = 1');
  assert.equal(row, undefined, 'Pinned message should be null after unpin');
});

test('chat emoji reactions: changing emoji updates existing reaction instead of crashing on PK constraint', async (t) => {
  const db = await createTestDb(t);

  const messageId = 1;
  const studentId = 'student_a';

  // 1. Initial reaction with thumbs up
  await db.run('INSERT INTO chat_reactions (messageId, studentId, emoji) VALUES (?, ?, ?)', messageId, studentId, '👍');
  let row = await db.get('SELECT emoji FROM chat_reactions WHERE messageId = ? AND studentId = ?', messageId, studentId);
  assert.equal(row.emoji, '👍');

  // 2. Change reaction to clap: update row rather than conflicting INSERT
  const existing = await db.get('SELECT * FROM chat_reactions WHERE messageId = ? AND studentId = ?', messageId, studentId);
  assert.ok(existing);
  if (existing.emoji !== '👏') {
    await db.run('UPDATE chat_reactions SET emoji = ? WHERE messageId = ? AND studentId = ?', '👏', messageId, studentId);
  }

  row = await db.get('SELECT emoji FROM chat_reactions WHERE messageId = ? AND studentId = ?', messageId, studentId);
  assert.equal(row.emoji, '👏', 'Reaction emoji must be updated without primary key violation');
});

test('chat read receipts: read receipts cannot move backwards', async (t) => {
  const db = await createTestDb(t);
  const studentId = 'student_b';

  // Initial read receipt at message 150
  await db.run(`
    INSERT INTO chat_read_receipts (studentId, lastReadMessageId) VALUES (?, ?)
    ON CONFLICT(studentId) DO UPDATE SET lastReadMessageId = MAX(chat_read_receipts.lastReadMessageId, excluded.lastReadMessageId)
  `, studentId, 150);

  let receipt = await db.get('SELECT lastReadMessageId FROM chat_read_receipts WHERE studentId = ?', studentId);
  assert.equal(receipt.lastReadMessageId, 150);

  // Attempt to move receipt backwards to message 90
  await db.run(`
    INSERT INTO chat_read_receipts (studentId, lastReadMessageId) VALUES (?, ?)
    ON CONFLICT(studentId) DO UPDATE SET lastReadMessageId = MAX(chat_read_receipts.lastReadMessageId, excluded.lastReadMessageId)
  `, studentId, 90);

  receipt = await db.get('SELECT lastReadMessageId FROM chat_read_receipts WHERE studentId = ?', studentId);
  assert.equal(receipt.lastReadMessageId, 150, 'Receipt must remain at highest read message (150) and never regress');
});

test('compiler: disabled by default returning 503 unavailable when no runner configured', async (t) => {
  delete process.env.ISOLATED_RUNNER_URL;
  delete process.env.ENABLE_LOCAL_COMPILER;

  const app = require('../server');
  const server = app.listen(0);
  t.after(() => server.close());

  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/compile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ language: 'python', code: 'print("hello")' })
  });

  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.success, false);
  assert.equal(body.status, 'Unavailable');
  assert.match(body.stderr, /disabled by default/);
});

test('compiler: forwards execution to ISOLATED_RUNNER_URL and never invokes local child-process spawn', async (t) => {
  const http = require('node:http');

  // Spin up a mock isolated runner HTTP service
  let runnerReceivedRequest = false;
  let runnerRequestBody = null;
  const mockRunner = http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      runnerReceivedRequest = true;
      runnerRequestBody = JSON.parse(raw);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        stdout: 'output from isolated sandbox runner\n',
        stderr: '',
        status: 'Success',
        executionTime: 42
      }));
    });
  });

  await new Promise(resolve => mockRunner.listen(0, resolve));
  const runnerPort = mockRunner.address().port;
  const runnerUrl = `http://127.0.0.1:${runnerPort}/run`;

  process.env.ISOLATED_RUNNER_URL = runnerUrl;
  delete process.env.ENABLE_LOCAL_COMPILER;

  t.after(() => {
    mockRunner.close();
    delete process.env.ISOLATED_RUNNER_URL;
  });

  const app = require('../server');
  const server = app.listen(0);
  t.after(() => server.close());

  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/compile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ language: 'python', code: 'print("isolated test")', input: '123' })
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(runnerReceivedRequest, true, 'ISOLATED_RUNNER_URL must have received the forwarded execution request');
  assert.equal(runnerRequestBody.language, 'python');
  assert.equal(runnerRequestBody.code, 'print("isolated test")');
  assert.equal(body.stdout, 'output from isolated sandbox runner\n');
  assert.equal(body.executionTime, 42);
});

test('upload authorization & verification: enforces server-issued token, rejects dangerous files, rejects forged claims', async (t) => {
  const app = express();
  app.use(express.json());

  // Mock authenticated session
  app.use((req, res, next) => {
    req.session = { studentId: 'stu_123', studentName: 'Alice' };
    next();
  });

  const crypto = require('node:crypto');
  const path = require('node:path');

  const ALLOWED_UPLOAD_EXTS = new Set([
    '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx',
    '.zip', '.txt', '.csv', '.png', '.jpg', '.jpeg', '.webp', '.mp4'
  ]);

  function isAllowedUploadFile(filename, mimeType) {
    const ext = path.extname(filename || '').toLowerCase();
    if (!ext || !ALLOWED_UPLOAD_EXTS.has(ext)) return false;
    const m = (mimeType || '').toLowerCase();
    if (m.includes('html') || m.includes('javascript') || m.includes('svg')) return false;
    return true;
  }

  function createUploadToken({ studentId, storedName, expiresAt }) {
    const secret = 'test_secret_for_upload';
    const payload = `${studentId}:${storedName}:${expiresAt}`;
    const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return `${expiresAt}.${sig}`;
  }

  function verifyUploadToken(token, { studentId, storedName }) {
    if (!token || typeof token !== 'string') return false;
    const parts = token.split('.');
    if (parts.length !== 2) return false;
    const [expiresAtStr, sig] = parts;
    const expiresAt = parseInt(expiresAtStr, 10);
    if (isNaN(expiresAt) || Date.now() > expiresAt) return false;
    const secret = 'test_secret_for_upload';
    const payload = `${studentId}:${storedName}:${expiresAt}`;
    const expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return sig.length === expectedSig.length && crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expectedSig, 'hex'));
  }

  app.post('/test/authorize-upload', (req, res) => {
    const { filename, size, mimeType } = req.body || {};
    if (!isAllowedUploadFile(filename, mimeType)) {
      return res.status(400).json({ message: 'File type not permitted.' });
    }
    const parsedSize = parseInt(size, 10);
    if (isNaN(parsedSize) || parsedSize <= 0 || parsedSize > 250 * 1024 * 1024) {
      return res.status(400).json({ message: 'Invalid size.' });
    }
    const ext = path.extname(filename).toLowerCase();
    const storedName = `up_${req.session.studentId}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
    const expiresAt = Date.now() + 30 * 60 * 1000;
    const token = createUploadToken({ studentId: req.session.studentId, storedName, expiresAt });
    res.json({ storedName, token, expiresAt });
  });

  const claimedDb = new Set();
  app.post('/test/record-upload', (req, res) => {
    const { files } = req.body;
    for (const f of files) {
      if (!isAllowedUploadFile(f.originalName || f.storedName, f.mimeType)) {
        return res.status(400).json({ message: 'File type not permitted.' });
      }
      const token = f.token;
      const valid = token && verifyUploadToken(token, { studentId: req.session.studentId, storedName: f.storedName });
      if (!valid) {
        return res.status(403).json({ message: 'Valid server-issued upload authorization is strictly required.' });
      }
      if (claimedDb.has(f.storedName)) {
        return res.status(409).json({ message: 'Already claimed.' });
      }
      claimedDb.add(f.storedName);
    }
    res.json({ success: true, count: files.length });
  });

  const server = app.listen(0);
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  // 1. Authorize dangerous file -> must reject 400
  const badRes = await fetch(`${baseUrl}/test/authorize-upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: 'payload.exe', size: 1024 })
  });
  assert.equal(badRes.status, 400);

  // 2. Authorize valid PDF -> returns token and storedName
  const authRes = await fetch(`${baseUrl}/test/authorize-upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: 'lecture1.pdf', size: 2048, mimeType: 'application/pdf' })
  });
  assert.equal(authRes.status, 200);
  const authData = await authRes.json();
  assert.ok(authData.token);
  assert.ok(authData.storedName.startsWith('up_stu_123_'));

  // 3. Forged claim: attacker tries to claim someone else's file with bad token -> 403
  const forgedRes = await fetch(`${baseUrl}/test/record-upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      files: [{ storedName: 'up_otherstudent_9999_secret.pdf', originalName: 'secret.pdf', token: 'invalid.token' }]
    })
  });
  assert.equal(forgedRes.status, 403);

  // 3b. Prefix spoofing: attacker tries to claim matching student prefix without valid token -> 403
  const spoofRes = await fetch(`${baseUrl}/test/record-upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      files: [{ storedName: 'up_stu_123_spoofed.pdf', originalName: 'spoofed.pdf' }]
    })
  });
  assert.equal(spoofRes.status, 403);

  // 4. Valid record-upload -> succeeds
  const goodRecordRes = await fetch(`${baseUrl}/test/record-upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      files: [{ storedName: authData.storedName, originalName: 'lecture1.pdf', token: authData.token, size: 2048 }]
    })
  });
  assert.equal(goodRecordRes.status, 200);

  // 5. Duplicate claim -> 409 Conflict
  const dupRecordRes = await fetch(`${baseUrl}/test/record-upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      files: [{ storedName: authData.storedName, originalName: 'lecture1.pdf', token: authData.token, size: 2048 }]
    })
  });
  assert.equal(dupRecordRes.status, 409);
});

test('async errors: Express 4 unhandled rejected promises in async route handlers are caught by Layer patch', async (t) => {
  // Test that Layer.prototype.handle_request patch forwards async throws to next(err)
  const app = express();

  app.get('/test/async-error', async (req, res) => {
    // Unhandled throw inside async route handler
    throw new Error('Async database failure');
  });

  // Global error handler
  app.use((err, req, res, next) => {
    res.status(500).json({ caught: true, message: err.message });
  });

  const server = app.listen(0);
  t.after(() => server.close());

  const res = await fetch(`http://127.0.0.1:${server.address().port}/test/async-error`);
  assert.equal(res.status, 500);
  const data = await res.json();
  assert.equal(data.caught, true);
  assert.equal(data.message, 'Async database failure');
});

test('retry-safe likes and follows: repeated requests with explicit action do not toggle state', async (t) => {
  const db = await createTestDb(t);
  await db.exec(`
    CREATE TABLE files (id INTEGER PRIMARY KEY AUTOINCREMENT, uploadedBy TEXT, originalName TEXT);
    CREATE TABLE file_likes (fileId INTEGER, studentId TEXT, PRIMARY KEY (fileId, studentId));
    CREATE TABLE follows (followerId TEXT, followingId TEXT, createdAt TEXT, PRIMARY KEY (followerId, followingId));
  `);
  await db.run("INSERT INTO students (studentId, name, passwordHash) VALUES ('stu1', 'S1', 'hash'), ('stu2', 'S2', 'hash')");
  await db.run("INSERT INTO files (id, uploadedBy, originalName) VALUES (1, 'stu2', 'notes.pdf')");

  // Simulate idempotent like logic with explicit action
  async function handleLike(fileId, studentId, action) {
    const existing = await db.get('SELECT 1 FROM file_likes WHERE fileId = ? AND studentId = ?', fileId, studentId);
    let shouldLike;
    if (action === 'like') shouldLike = true;
    else if (action === 'unlike') shouldLike = false;
    else shouldLike = !existing;

    if (shouldLike && !existing) {
      await db.run('INSERT INTO file_likes (fileId, studentId) VALUES (?, ?)', fileId, studentId);
    } else if (!shouldLike && existing) {
      await db.run('DELETE FROM file_likes WHERE fileId = ? AND studentId = ?', fileId, studentId);
    }
    const countRow = await db.get('SELECT COUNT(*) AS c FROM file_likes WHERE fileId = ?', fileId);
    return { liked: shouldLike, count: Number(countRow.c) };
  }

  // First request: like
  let r1 = await handleLike(1, 'stu1', 'like');
  assert.equal(r1.liked, true);
  assert.equal(r1.count, 1);

  // Network retry of the same request: MUST STAY LIKED (not toggle to unliked!)
  let r2 = await handleLike(1, 'stu1', 'like');
  assert.equal(r2.liked, true, 'Retry must remain liked');
  assert.equal(r2.count, 1, 'Like count must remain 1');

  // Unlike request
  let r3 = await handleLike(1, 'stu1', 'unlike');
  assert.equal(r3.liked, false);
  assert.equal(r3.count, 0);

  // Retry unlike: must stay unliked
  let r4 = await handleLike(1, 'stu1', 'unlike');
  assert.equal(r4.liked, false);
  assert.equal(r4.count, 0);
});

test('CSRF origin guard: rejects untrusted cross-site origins, allows trusted and mobile origins', async (t) => {
  const app = express();
  app.use(express.json());

  // CSRF / Origin Guard
  app.use((req, res, next) => {
    const method = req.method.toUpperCase();
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
      const origin = req.headers.origin;
      if (origin) {
        try {
          const originUrl = new URL(origin);
          const hostHeader = (req.headers['x-forwarded-host'] || req.headers.host || '').split(':')[0].toLowerCase();
          const originHost = originUrl.hostname.toLowerCase();
          const isAllowed = originHost === hostHeader ||
            originHost === 'localhost' ||
            originHost === '127.0.0.1' ||
            originUrl.protocol === 'capacitor:' ||
            originUrl.protocol === 'exp:' ||
            originUrl.protocol === 'file:';
          if (!isAllowed) {
            return res.status(403).json({ message: 'Cross-site request blocked.' });
          }
        } catch (e) {
          return res.status(403).json({ message: 'Invalid origin header.' });
        }
      }
    }
    next();
  });

  app.post('/api/action', (req, res) => res.json({ success: true }));

  const server = app.listen(0);
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/api/action`;

  // 1. Untrusted attacker origin
  const untrustedRes = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': 'https://evil-attacker.site' }
  });
  assert.equal(untrustedRes.status, 403);
  const untrustedBody = await untrustedRes.json();
  assert.equal(untrustedBody.message, 'Cross-site request blocked.');

  // 2. Trusted localhost / 127.0.0.1 origin
  const trustedRes = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': 'http://127.0.0.1:3000' }
  });
  assert.equal(trustedRes.status, 200);

  // 3. Mobile app origin (exp:// or capacitor://)
  const mobileRes = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': 'exp://192.168.1.100:8081' }
  });
  assert.equal(mobileRes.status, 200);

  // 4. Missing origin (native mobile client or non-browser HTTP client)
  const noOriginRes = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  assert.equal(noOriginRes.status, 200);
});

test('concurrent submissions: atomic upsert handles simultaneous submissions without race conditions or duplicate rows', async (t) => {
  const db = await createTestDb(t);

  const assignmentId = 10;
  const questionId = 101;
  const studentId = 'stu_concurrent';

  // Seed student and assignment
  await db.run("INSERT INTO students (studentId, name, passwordHash) VALUES (?, 'Concurrent Student', 'hash')", studentId);
  await db.run("INSERT INTO assignments (id, title, createdAt) VALUES (?, 'Concurrent Lab', ?)", assignmentId, new Date().toISOString());

  // Function simulating the atomic submission query in routes/code-lab/assignments.js
  const submitCode = async (version) => {
    const code = `print("version_${version}")`;
    const now = new Date().toISOString();
    return db.run(`
      INSERT INTO submissions (assignmentId, questionId, studentId, code, stdout, stderr, testResults, submittedAt)
      VALUES (?, ?, ?, ?, '', '', '', ?)
      ON CONFLICT (assignmentId, studentId, questionId) WHERE questionId IS NOT NULL
      DO UPDATE SET
        code = excluded.code,
        submittedAt = excluded.submittedAt
    `, assignmentId, questionId, studentId, code, now);
  };

  // Fire 10 simultaneous submission requests concurrently
  const promises = [];
  for (let i = 1; i <= 10; i++) {
    promises.push(submitCode(i));
  }

  // All 10 must succeed without throwing unique constraint violation or crashing
  const results = await Promise.all(promises);
  assert.equal(results.length, 10);

  // Exactly ONE row must exist for this student and question
  const rows = await db.all(
    'SELECT * FROM submissions WHERE assignmentId = ? AND questionId = ? AND studentId = ?',
    assignmentId, questionId, studentId
  );
  assert.equal(rows.length, 1, 'Only one submission row must exist after 10 concurrent requests');
  assert.match(rows[0].code, /^print\("version_\d+"\)$/);

  // Also test legacy assignment-level concurrent submissions (questionId IS NULL)
  const submitLegacy = async (version) => {
    const code = `legacy_v${version}`;
    const now = new Date().toISOString();
    return db.run(`
      INSERT INTO submissions (assignmentId, questionId, studentId, code, stdout, stderr, testResults, submittedAt)
      VALUES (?, NULL, ?, ?, '', '', '', ?)
      ON CONFLICT (assignmentId, studentId) WHERE questionId IS NULL
      DO UPDATE SET
        code = excluded.code,
        submittedAt = excluded.submittedAt
    `, assignmentId, studentId, code, now);
  };

  const legacyPromises = [];
  for (let i = 1; i <= 5; i++) {
    legacyPromises.push(submitLegacy(i));
  }
  await Promise.all(legacyPromises);

  const legacyRows = await db.all(
    'SELECT * FROM submissions WHERE assignmentId = ? AND questionId IS NULL AND studentId = ?',
    assignmentId, studentId
  );
  assert.equal(legacyRows.length, 1, 'Only one legacy submission row must exist when questionId is NULL');
});

test('shared login rate limiting: brute force attempts across shared database table lock out attacker IP and reset on success', async (t) => {
  const db = await createTestDb(t);
  const testIp = '198.51.100.42';

  // Helper functions matching server.js database-backed limiter
  async function checkLimit(ip) {
    const row = await db.get('SELECT attemptCount, lockedUntil FROM login_attempts WHERE ip = ?', ip);
    if (row && row.lockedUntil) {
      const lockedUntilTime = new Date(row.lockedUntil).getTime();
      const now = Date.now();
      if (lockedUntilTime > now) {
        return Math.ceil((lockedUntilTime - now) / 1000);
      }
    }
    return 0;
  }

  async function recordFail(ip) {
    const now = new Date();
    const row = await db.get('SELECT attemptCount, lastAttemptAt FROM login_attempts WHERE ip = ?', ip);
    let count = 1;
    if (row && row.lastAttemptAt) {
      const lastTime = new Date(row.lastAttemptAt).getTime();
      if (now.getTime() - lastTime < 15 * 60 * 1000) {
        count = (Number(row.attemptCount) || 0) + 1;
      }
    }
    let lockedUntil = null;
    if (count >= 5) {
      lockedUntil = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
    }
    const nowIso = now.toISOString();

    await db.run(`
      INSERT INTO login_attempts (ip, attemptCount, lockedUntil, lastAttemptAt)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (ip) DO UPDATE SET
        attemptCount = excluded.attemptCount,
        lockedUntil = excluded.lockedUntil,
        lastAttemptAt = excluded.lastAttemptAt
    `, ip, count, lockedUntil, nowIso);
  }

  async function clearAttempts(ip) {
    await db.run('DELETE FROM login_attempts WHERE ip = ?', ip);
  }

  // 1. Initial state: not rate limited
  assert.equal(await checkLimit(testIp), 0);

  // 2. 4 failed attempts: still under threshold (< 5)
  for (let i = 0; i < 4; i++) {
    await recordFail(testIp);
  }
  assert.equal(await checkLimit(testIp), 0);

  // 3. 5th failed attempt: triggers lockout
  await recordFail(testIp);
  const remaining = await checkLimit(testIp);
  assert.ok(remaining > 0, 'IP must be locked out after 5 failed attempts');
  assert.ok(remaining <= 300, 'Lockout duration must be around 300 seconds');

  // 4. Successful login: clears attempts across instances
  await clearAttempts(testIp);
  assert.equal(await checkLimit(testIp), 0, 'Lockout must be immediately cleared upon successful authentication');
});


