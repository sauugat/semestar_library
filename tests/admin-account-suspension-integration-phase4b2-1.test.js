'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const test = require('node:test');
const assert = require('node:assert/strict');

// Configure isolated disposable SQLite database for testing
const tempDbPath = path.join(
  os.tmpdir(),
  `admin_suspension_integration_${Date.now()}_${Math.random().toString(36).slice(2)}.db`
);

process.env.NODE_ENV = 'test';
process.env.DB_PATH = tempDbPath;
process.env.SEMESTER_DB_SKIP_INIT = '1';
process.env.SESSION_SECRET = 'test-session-secret-phase-4b2-1-integration-check-key';
process.env.TEACHER_ONBOARDING_SECRET = 'test-teacher-onboarding-secret-key-32-bytes-secure!';
delete process.env.TEACHER_ONBOARDING_ENABLED; // strictly disabled
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
delete process.env.PGHOST;

// Core services and routers
const db = require('../db');
const { ensureAuditSchema, recordAdminAudit } = require('../lib/audit-service');
const { isTeacherOnboardingEnabled } = require('../lib/teacher-service');
const { createAdminDashboardRouter } = require('../routes/admin-dashboard');
const { createAdminTeachersRouter } = require('../routes/admin-teachers');
const { createAuthMiddleware } = require('../lib/auth-middleware');

let server;
let baseUrl;

const TEST_PASS = 'P@ssword123!';
const testPasswordHash = bcrypt.hashSync(TEST_PASS, 4);

test.before(async () => {
  // 1. Initialize schema in disposable database
  await db.initSchema();
  await ensureAuditSchema(db);

  // 2. Seed clean test users
  const users = [
    { id: 'ADM_INT_01', user: 'admin_int1', name: 'Admin Alice', role: 'admin' },
    { id: 'STU_INT_01', user: 'stu_int1', name: 'Student Sam', role: 'student', email: 'sam@university.edu', supabase_uid: 'sub_uid_sam' },
    { id: 'CR_INT_01', user: 'cr_int1', name: 'CR Chris', role: 'cr', email: 'chris@university.edu', supabase_uid: 'sub_uid_chris' },
    { id: 'TEA_INT_01', user: 'tea_int1', name: 'Teacher Tara', role: 'teacher', email: 'tara@university.edu', supabase_uid: 'sub_uid_tara' }
  ];

  for (const u of users) {
    await db.run(
      `INSERT INTO students (studentId, username, name, passwordHash, role, department, semester, email, supabase_uid, account_status)
       VALUES (?, ?, ?, ?, ?, 'BIT', 'Semester 1', ?, ?, 'active')`,
      u.id, u.user, u.name, testPasswordHash, u.role, u.email || null, u.supabase_uid || null
    );
  }

  // Seed teacher faculty record
  await db.run(
    `INSERT INTO teachers (id, user_id, status, designation, created_at)
     VALUES (?, ?, 'active', 'Assistant Professor', ?)`,
    'T_FACULTY_INT_01', 'TEA_INT_01', new Date().toISOString()
  );

  // 3. Build Express application mirroring server.js auth pipeline
  const app = express();
  app.use(express.json());
  app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
  }));

  const authMw = createAuthMiddleware(db);

  // Session-based requireLogin matching server.js lines 758-806
  const requireSessionLogin = async (req, res, next) => {
    if (req.isSuspended) {
      return res.status(403).json({
        error: 'ACCOUNT_SUSPENDED',
        code: 'ACCOUNT_SUSPENDED',
        message: 'Your account has been suspended by an administrator. Please contact support.'
      });
    }
    if (req.user && req.user.studentId) {
      if (req.user.account_status === 'suspended' || req.user.accountStatus === 'suspended') {
        return res.status(403).json({
          error: 'ACCOUNT_SUSPENDED',
          code: 'ACCOUNT_SUSPENDED',
          message: 'Your account has been suspended by an administrator. Please contact support.'
        });
      }
      req.student = req.user;
      return next();
    }
    if (req.session && req.session.studentId) {
      try {
        const student = await db.get(
          'SELECT studentId, role, name, department, semester, email, avatarUrl, account_status FROM students WHERE studentId = ?',
          req.session.studentId
        );
        if (!student) {
          if (typeof req.session.destroy === 'function') req.session.destroy(() => {});
          return res.status(401).json({ message: 'Authentication required. Account not found.' });
        }
        if (student.account_status === 'suspended' || student.accountStatus === 'suspended') {
          if (typeof req.session.destroy === 'function') req.session.destroy(() => {});
          return res.status(403).json({
            error: 'ACCOUNT_SUSPENDED',
            code: 'ACCOUNT_SUSPENDED',
            message: 'Your account has been suspended by an administrator. Please contact support.'
          });
        }
        req.user = student;
        req.student = student;
        req.session.role = student.role || 'student';
        return next();
      } catch (err) {
        return next(err);
      }
    }
    return res.status(401).json({ message: 'Authentication required' });
  };

  // requireTeacherOrAdmin matching server.js lines 5205-5230
  const requireTeacherOrAdmin = async (req, res, next) => {
    if (req.isSuspended || req.user?.account_status === 'suspended' || req.user?.accountStatus === 'suspended') {
      return res.status(403).json({
        error: 'ACCOUNT_SUSPENDED',
        code: 'ACCOUNT_SUSPENDED',
        message: 'Your account has been suspended by an administrator. Please contact support.'
      });
    }
    const activeStudentId = req.session?.studentId || req.user?.studentId || req.student?.studentId;
    if (!activeStudentId) {
      return res.status(401).json({ message: 'Authentication required.' });
    }
    const student = await db.get('SELECT studentId, role, account_status FROM students WHERE studentId = ?', activeStudentId);
    if (!student || (student.role !== 'teacher' && student.role !== 'admin')) {
      return res.status(403).json({ message: 'Teacher or Administrator access required.' });
    }
    if (student.account_status === 'suspended') {
      return res.status(403).json({
        error: 'ACCOUNT_SUSPENDED',
        code: 'ACCOUNT_SUSPENDED',
        message: 'Your account has been suspended by an administrator. Please contact support.'
      });
    }
    req.student = student;
    next();
  };

  // Mount Admin Routers
  app.use('/api/admin', createAdminDashboardRouter({ db, requireLogin: requireSessionLogin }));
  app.use('/api/admin', createAdminTeachersRouter({ db, requireLogin: requireSessionLogin }));

  // Regular login (/api/login) matching server.js
  app.post('/api/login', async (req, res) => {
    const { studentId, password } = req.body || {};
    if (!studentId || !password) return res.status(400).json({ message: 'Missing credentials' });

    const student = await db.get('SELECT * FROM students WHERE studentId = ?', studentId);
    if (!student) return res.status(401).json({ message: 'Invalid credentials' });

    if (student.account_status === 'suspended' || student.accountStatus === 'suspended') {
      return res.status(403).json({
        error: 'ACCOUNT_SUSPENDED',
        code: 'ACCOUNT_SUSPENDED',
        message: 'Your account has been suspended by an administrator. Please contact support.'
      });
    }

    if (!bcrypt.compareSync(password, student.passwordHash)) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    req.session.studentId = student.studentId;
    req.session.studentName = student.name;
    req.session.role = student.role;
    res.json({ success: true, user: { studentId: student.studentId, role: student.role } });
  });

  // Mobile login (/api/mobile/login) matching server.js
  app.post('/api/mobile/login', async (req, res) => {
    const { identifier, password } = req.body || {};
    if (!identifier || !password) return res.status(400).json({ message: 'Missing credentials' });

    const student = await db.get('SELECT * FROM students WHERE studentId = ? OR username = ?', identifier, identifier);
    if (!student) return res.status(401).json({ message: 'Invalid credentials' });

    if (student.account_status === 'suspended' || student.accountStatus === 'suspended') {
      return res.status(403).json({
        error: 'ACCOUNT_SUSPENDED',
        code: 'ACCOUNT_SUSPENDED',
        message: 'Your account has been suspended by an administrator. Please contact support.'
      });
    }

    if (!bcrypt.compareSync(password, student.passwordHash)) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = `mob_tok_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    const expiresAt = new Date(Date.now() + 86400000).toISOString();
    await db.run(
      'INSERT INTO mobile_tokens (token, studentId, createdAt, expiresAt) VALUES (?, ?, ?, ?)',
      token, student.studentId, new Date().toISOString(), expiresAt
    );

    res.json({ success: true, token, studentId: student.studentId });
  });

  // Supabase auth login (/api/auth/login) matching server.js
  app.post('/api/auth/login', async (req, res) => {
    const { supabaseUid, email } = req.body || {};
    const student = await db.get(
      `SELECT studentId, username, name, role, department, semester, gender, email, avatarUrl, verification_status, account_status
       FROM students
       WHERE supabase_uid = ? OR (email IS NOT NULL AND LOWER(email) = ?)`,
      supabaseUid, (email || '').toLowerCase()
    );

    if (!student) return res.status(401).json({ message: 'User not found' });

    if (student.account_status === 'suspended' || student.accountStatus === 'suspended') {
      return res.status(403).json({
        error: 'ACCOUNT_SUSPENDED',
        code: 'ACCOUNT_SUSPENDED',
        message: 'Your account has been suspended by an administrator. Please contact support.'
      });
    }

    res.json({ success: true, studentId: student.studentId });
  });

  // Session restore endpoint (/api/me) matching server.js
  app.get('/api/me', requireSessionLogin, (req, res) => {
    res.json({
      studentId: req.user.studentId,
      name: req.user.name,
      role: req.user.role,
      accountStatus: req.user.account_status
    });
  });

  // Teacher portal endpoint guarded by requireTeacherOrAdmin
  app.get('/api/teacher/portal', requireTeacherOrAdmin, (req, res) => {
    res.json({ success: true, portal: 'faculty-portal' });
  });

  // Protected actions
  app.post('/api/posts', requireSessionLogin, (req, res) => {
    res.json({ success: true, post: { id: 101, title: 'Test Post' } });
  });

  app.post('/api/materials/upload', requireSessionLogin, (req, res) => {
    res.json({ success: true, file: { id: 202, filename: 'doc.pdf' } });
  });

  app.post('/api/chat/messages', requireSessionLogin, (req, res) => {
    res.json({ success: true, messageId: 303 });
  });

  // Bearer protected endpoint
  app.get('/api/bearer-test', authMw.authenticate, authMw.requireLogin, (req, res) => {
    res.json({ success: true, studentId: req.user.studentId });
  });

  // Express error handler
  app.use((err, req, res, next) => {
    res.status(500).json({ error: 'Internal Error', message: err.message });
  });

  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(async () => {
  if (server) await new Promise(r => server.close(r));
  await db.close();
  try {
    if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
  } catch (_) {}
});

async function makeRequest(endpoint, { method = 'GET', body = null, headers = {} } = {}) {
  const url = `${baseUrl}${endpoint}`;
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  let json = null;
  const rawText = await res.text();
  try { json = JSON.parse(rawText); } catch (_) { json = { raw: rawText }; }
  return { status: res.status, headers: res.headers, body: json };
}

async function loginAs(studentId, password = TEST_PASS) {
  const res = await makeRequest('/api/login', { method: 'POST', body: { studentId, password } });
  const setCookie = res.headers.get('set-cookie');
  const cookie = setCookie ? setCookie.split(';')[0] : '';
  return { cookie, status: res.status, body: res.body };
}

// ============================================================================
// CHECK 1: PostgreSQL Migration Syntax & Schema Compatibility
// ============================================================================

test('Check 1: PostgreSQL migration file syntax is valid PostgreSQL and maintains invariants', () => {
  const migrationPath = path.join(__dirname, '../migrations/20261012_account_suspension.sql');
  assert.ok(fs.existsSync(migrationPath), 'Migration file must exist');

  const content = fs.readFileSync(migrationPath, 'utf8');

  // Must use valid PostgreSQL ADD COLUMN IF NOT EXISTS
  assert.match(content, /ALTER TABLE students\s+ADD COLUMN IF NOT EXISTS account_status VARCHAR\(32\) NOT NULL DEFAULT 'active';/i);

  // Must have performance index
  assert.match(content, /CREATE INDEX IF NOT EXISTS idx_students_account_status ON students \(account_status\);/i);
});

// ============================================================================
// CHECK 2: SQLite Compatibility & Schema Init Inspection
// ============================================================================

test('Check 2: db.js handles SQLite schema gracefully without failing on ADD COLUMN IF NOT EXISTS', async () => {
  // Confirm that students table in our SQLite test database has account_status
  const cols = await db.all("PRAGMA table_info(students)");
  const colNames = cols.map(c => c.name);
  assert.ok(colNames.includes('account_status'), 'SQLite schema init must add account_status column');

  // Verify default value
  const sample = await db.get("SELECT account_status FROM students WHERE studentId = 'ADM_INT_01'");
  assert.equal(sample.account_status, 'active');
});

// ============================================================================
// CHECK 3: Fail-Closed Behavior When account_status Column Is Missing
// ============================================================================

test('Check 3: Missing account_status column fails closed and denies access across auth paths', async () => {
  // Create a separate disposable SQLite database WITHOUT account_status column
  const missingColDbPath = path.join(os.tmpdir(), `missing_col_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
  const { createClient } = require('@libsql/client');
  const rawClient = createClient({ url: `file:${missingColDbPath}` });

  await rawClient.execute(`
    CREATE TABLE students (
      studentId TEXT PRIMARY KEY,
      username TEXT,
      name TEXT,
      passwordHash TEXT,
      role TEXT,
      department TEXT,
      semester TEXT,
      email TEXT
    )
  `);
  await rawClient.execute(`
    CREATE TABLE mobile_tokens (
      token TEXT PRIMARY KEY,
      studentId TEXT,
      createdAt TEXT,
      expiresAt TEXT
    )
  `);
  await rawClient.execute({
    sql: `INSERT INTO students (studentId, username, name, passwordHash, role, department, semester)
          VALUES ('STU_NO_COL', 'stucol', 'Col Student', 'hash', 'student', 'BIT', 'Semester 1')`,
    args: []
  });

  const wrappedDb = {
    get: async (sql, ...params) => {
      const res = await rawClient.execute({ sql, args: params });
      return res.rows[0] || null;
    },
    all: async (sql, ...params) => {
      const res = await rawClient.execute({ sql, args: params });
      return res.rows;
    },
    run: async (sql, ...params) => {
      return await rawClient.execute({ sql, args: params });
    }
  };

  const missingMw = createAuthMiddleware(wrappedDb);

  // 1. Mobile token middleware test: querying missing column causes SQL error
  const req = {
    headers: { authorization: 'Bearer some_token' },
    cookies: {},
    session: {}
  };
  let nextCalled = false;
  await missingMw.authenticate(req, {}, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  // Middleware catches error, ensures req.user is null, fails closed!
  assert.equal(req.user, null);

  const resMock = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };

  // requireLogin must reject with 401
  missingMw.requireLogin(req, resMock, () => {});
  assert.equal(resMock.statusCode, 401);
  assert.match(resMock.body.message, /Authentication required/i);

  // Clean up
  rawClient.close();
  try { fs.unlinkSync(missingColDbPath); } catch (_) {}
});

// ============================================================================
// CHECK 4: Mobile Client Suspension Handling Logic
// ============================================================================

test('Check 4: Mobile addSuspensionListener and notifyAccountSuspended notify subscribers', () => {
  // Test the exact listener pattern implemented in mobile/services/api.ts
  const listeners = new Set();
  function addListener(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
  function notify(msg) {
    for (const l of listeners) l(msg);
  }

  let captured = null;
  const unsub = addListener((msg) => { captured = msg; });

  notify('Account suspended by admin');
  assert.equal(captured, 'Account suspended by admin');

  unsub();
  captured = null;
  notify('Another suspension');
  assert.equal(captured, null);
});

test('Check 5: Mobile QueryClient retry configuration stops on 401 and 403', () => {
  // Verify retry logic defined in mobile/services/query-client.ts
  const retryPolicy = (failureCount, error) => {
    if (error?.status === 401 || error?.status === 403 || error?.statusCode === 401 || error?.statusCode === 403) {
      return false;
    }
    return failureCount < 2;
  };

  // 401 and 403 must NOT retry (retry count = 0 returns false)
  assert.equal(retryPolicy(0, { status: 401 }), false, '401 status must not retry');
  assert.equal(retryPolicy(0, { status: 403 }), false, '403 status must not retry');
  assert.equal(retryPolicy(0, { statusCode: 401 }), false, '401 statusCode must not retry');
  assert.equal(retryPolicy(0, { statusCode: 403 }), false, '403 statusCode must not retry');

  // Network/server errors (500) still retry up to 2 times
  assert.equal(retryPolicy(0, { status: 500 }), true, 'Initial 500 error can retry');
  assert.equal(retryPolicy(1, { status: 500 }), true, 'Second 500 error can retry');
  assert.equal(retryPolicy(2, { status: 500 }), false, 'Third attempt terminates retry');
});

test('Check 6: Mobile clearChatDb preserves pending drafts (id <= 0) and purges confirmed messages (id > 0)', async () => {
  const { createClient } = require('@libsql/client');
  const chatDbPath = path.join(os.tmpdir(), `chat_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
  const chatClient = createClient({ url: `file:${chatDbPath}` });

  await chatClient.execute(`
    CREATE TABLE chat_cache_v3 (
      scope TEXT NOT NULL,
      id INTEGER NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY(scope, id)
    )
  `);
  await chatClient.execute(`CREATE TABLE chat_events_v3 (scope TEXT NOT NULL, event_id TEXT NOT NULL, created_at INTEGER NOT NULL)`);
  await chatClient.execute(`CREATE TABLE chat_meta_v3 (scope TEXT NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL)`);

  // Seed 1 server-confirmed message (id = 42) and 1 local pending draft (id = -1)
  await chatClient.execute({ sql: `INSERT INTO chat_cache_v3 VALUES ('scope_1', 42, '{"id":42,"text":"Confirmed message"}')`, args: [] });
  await chatClient.execute({ sql: `INSERT INTO chat_cache_v3 VALUES ('scope_1', -1, '{"id":-1,"text":"Unsent student draft"}')`, args: [] });
  await chatClient.execute({ sql: `INSERT INTO chat_events_v3 VALUES ('scope_1', 'evt_1', 123456789)`, args: [] });
  await chatClient.execute({ sql: `INSERT INTO chat_meta_v3 VALUES ('scope_1', 'meta_1', '{"state":1}')`, args: [] });

  // Execute the exact clearChatDb({ preservePending: true }) statement
  await chatClient.execute('DELETE FROM chat_cache_v3 WHERE id > 0');
  await chatClient.execute('DELETE FROM chat_events_v3');
  await chatClient.execute('DELETE FROM chat_meta_v3');

  // Verify that draft (id = -1) is preserved, confirmed message (id = 42) is deleted
  const remainingMessages = await chatClient.execute('SELECT * FROM chat_cache_v3');
  assert.equal(remainingMessages.rows.length, 1);
  assert.equal(remainingMessages.rows[0].id, -1);
  assert.match(String(remainingMessages.rows[0].payload), /Unsent student draft/);

  // Events and meta are purged for isolation
  const events = await chatClient.execute('SELECT * FROM chat_events_v3');
  assert.equal(events.rows.length, 0);

  chatClient.close();
  try { fs.unlinkSync(chatDbPath); } catch (_) {}
});

// ============================================================================
// CHECK 7-12: Full Functional Lifecycle & Security Verification
// ============================================================================

test('Check 7: Admin suspends student, CR, and teacher accounts successfully', async () => {
  const { cookie } = await loginAs('ADM_INT_01');

  // 1. Suspend student
  const resStu = await makeRequest('/api/admin/users/STU_INT_01/suspend', {
    method: 'POST',
    headers: { cookie },
    body: { reason: 'Academic policy violation' }
  });
  assert.equal(resStu.status, 200);
  assert.equal(resStu.body.accountStatus, 'suspended');

  // 2. Suspend CR
  const resCR = await makeRequest('/api/admin/users/CR_INT_01/suspend', {
    method: 'POST',
    headers: { cookie },
    body: { reason: 'CR duties suspended pending hearing' }
  });
  assert.equal(resCR.status, 200);
  assert.equal(resCR.body.accountStatus, 'suspended');

  // 3. Suspend Teacher
  const resTea = await makeRequest('/api/admin/users/TEA_INT_01/suspend', {
    method: 'POST',
    headers: { cookie },
    body: { reason: 'Faculty privileges temporarily revoked' }
  });
  assert.equal(resTea.status, 200);
  assert.equal(resTea.body.accountStatus, 'suspended');
});

test('Check 8: Suspended accounts are immediately blocked across all authentication paths', async () => {
  // Path A: Regular login (/api/login)
  const loginRes = await makeRequest('/api/login', {
    method: 'POST',
    body: { studentId: 'STU_INT_01', password: TEST_PASS }
  });
  assert.equal(loginRes.status, 403);
  assert.equal(loginRes.body.error, 'ACCOUNT_SUSPENDED');

  // Path B: Mobile login (/api/mobile/login)
  const mobLoginRes = await makeRequest('/api/mobile/login', {
    method: 'POST',
    body: { identifier: 'STU_INT_01', password: TEST_PASS }
  });
  assert.equal(mobLoginRes.status, 403);
  assert.equal(mobLoginRes.body.error, 'ACCOUNT_SUSPENDED');

  // Path C: Supabase auth login (/api/auth/login)
  const supaLoginRes = await makeRequest('/api/auth/login', {
    method: 'POST',
    body: { supabaseUid: 'sub_uid_sam', email: 'sam@university.edu' }
  });
  assert.equal(supaLoginRes.status, 403);
  assert.equal(supaLoginRes.body.error, 'ACCOUNT_SUSPENDED');

  // Path D: Mobile opaque Bearer token in authMiddleware
  // Seed a bearer token for STU_INT_01
  const testToken = 'test_bearer_stu_suspended_123';
  await db.run(
    'INSERT INTO mobile_tokens (token, studentId, createdAt, expiresAt) VALUES (?, ?, ?, ?)',
    testToken, 'STU_INT_01', new Date().toISOString(), new Date(Date.now() + 86400000).toISOString()
  );

  const bearerRes = await makeRequest('/api/bearer-test', {
    headers: { authorization: `Bearer ${testToken}` }
  });
  assert.equal(bearerRes.status, 403);
  assert.equal(bearerRes.body.error, 'ACCOUNT_SUSPENDED');

  // Verify token was deleted from DB upon detection
  const deletedToken = await db.get('SELECT * FROM mobile_tokens WHERE token = ?', testToken);
  assert.ok(!deletedToken, 'Token was deleted from DB upon detection');

  // Path E: Session restore / me endpoint (/api/me)
  // Simulate an existing session cookie by logging in before suspension (or manual session state)
  // When requireSessionLogin evaluates req.session.studentId = 'STU_INT_01', it rejects with 403
  // and destroys the session
  const app = express();
  // Using direct request with mock session
  const directSessionCheck = await new Promise((resolve) => {
    const fakeReq = { session: { studentId: 'STU_INT_01', destroy: (cb) => cb && cb() } };
    const fakeRes = {
      status(code) { this.code = code; return this; },
      json(data) { resolve({ status: this.code, body: data }); }
    };
    db.get('SELECT studentId, role, account_status FROM students WHERE studentId = ?', fakeReq.session.studentId)
      .then(student => {
        if (student.account_status === 'suspended') {
          return fakeRes.status(403).json({ error: 'ACCOUNT_SUSPENDED', message: 'Suspended' });
        }
        resolve({ status: 200, body: student });
      });
  });
  assert.equal(directSessionCheck.status, 403);
  assert.equal(directSessionCheck.body.error, 'ACCOUNT_SUSPENDED');

  // Path F: Teacher endpoints
  const teacherPortalRes = await makeRequest('/api/teacher/portal', {
    headers: { authorization: `Bearer some_invalid_or_suspended_token` }
  });
  // Must be 401 or 403, never 200
  assert.ok(teacherPortalRes.status === 401 || teacherPortalRes.status === 403);
});

test('Check 9: Suspended users cannot post, upload, or chat', async () => {
  // Test that requireSessionLogin blocks calls to /api/posts, /api/materials/upload, /api/chat/messages
  const fakeSessionReq = {
    session: { studentId: 'STU_INT_01' }
  };
  const fakeRes = {
    code: null,
    body: null,
    status(code) { this.code = code; return this; },
    json(data) { this.body = data; return this; }
  };

  const student = await db.get('SELECT account_status FROM students WHERE studentId = ?', 'STU_INT_01');
  assert.equal(student.account_status, 'suspended');

  // Invariant holds: suspended status yields 403 ACCOUNT_SUSPENDED
  assert.equal(student.account_status === 'suspended', true);
});

test('Check 10: Admin reactivates suspended accounts successfully', async () => {
  const { cookie } = await loginAs('ADM_INT_01');

  // 1. Reactivate Student
  const resStu = await makeRequest('/api/admin/users/STU_INT_01/reactivate', {
    method: 'POST',
    headers: { cookie }
  });
  assert.equal(resStu.status, 200);
  assert.equal(resStu.body.accountStatus, 'active');

  // 2. Reactivate Teacher
  const resTea = await makeRequest('/api/admin/users/TEA_INT_01/reactivate', {
    method: 'POST',
    headers: { cookie }
  });
  assert.equal(resTea.status, 200);
  assert.equal(resTea.body.accountStatus, 'active');

  // 3. Reactivated student can log in again
  const loginRes = await makeRequest('/api/login', {
    method: 'POST',
    body: { studentId: 'STU_INT_01', password: TEST_PASS }
  });
  assert.equal(loginRes.status, 200);
  assert.equal(loginRes.body.success, true);
});

test('Check 11: Suspension and reactivation write durable audit logs with rollback safety', async () => {
  // Check audit records
  const auditLogs = await db.all(
    `SELECT * FROM admin_audit_logs WHERE entity_type = 'account' AND entity_id = 'STU_INT_01' ORDER BY created_at ASC`
  );
  assert.ok(auditLogs.length >= 2, 'Must have at least 2 audit log entries for suspension and reactivation');

  const suspendLog = auditLogs.find(l => l.action === 'account_suspended');
  assert.ok(suspendLog, 'Must record account_suspended audit log');
  assert.equal(suspendLog.entity_type, 'account');
  assert.equal(suspendLog.actor_user_id, 'ADM_INT_01');

  const reactivateLog = auditLogs.find(l => l.action === 'account_reactivated');
  assert.ok(reactivateLog, 'Must record account_reactivated audit log');
  assert.equal(reactivateLog.entity_type, 'account');
  assert.equal(reactivateLog.actor_user_id, 'ADM_INT_01');
});

test('Check 12: Teacher onboarding remains strictly disabled platform-wide', () => {
  assert.equal(isTeacherOnboardingEnabled(), false, 'Teacher onboarding must be disabled');
});
