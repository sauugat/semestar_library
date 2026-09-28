const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db');
const { createAuthMiddleware } = require('../lib/auth-middleware');
const { getSupabaseConfig } = require('../lib/supabase');

test.before(async () => {
  await db.initSchema();

  // Create test students with supabase_uid and email
  await db.run(
    `INSERT INTO students (studentId, name, passwordHash, role, email, supabase_uid)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (studentId) DO UPDATE SET
       name = EXCLUDED.name,
       role = EXCLUDED.role,
       email = EXCLUDED.email,
       supabase_uid = EXCLUDED.supabase_uid`,
    'test_student_1', 'Test Regular Student', 'fake_hash', 'student', 'student1@example.com', 'sb_uid_student_1'
  );

  await db.run(
    `INSERT INTO students (studentId, name, passwordHash, role, email, supabase_uid)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (studentId) DO UPDATE SET
       name = EXCLUDED.name,
       role = EXCLUDED.role,
       email = EXCLUDED.email,
       supabase_uid = EXCLUDED.supabase_uid`,
    'test_admin_1', 'Test Admin User', 'fake_hash', 'admin', 'admin1@example.com', 'sb_uid_admin_1'
  );

  await db.run(
    `INSERT INTO students (studentId, name, passwordHash, role, email, supabase_uid)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (studentId) DO UPDATE SET
       name = EXCLUDED.name,
       role = EXCLUDED.role,
       email = EXCLUDED.email,
       supabase_uid = EXCLUDED.supabase_uid`,
    'test_cr_1', 'Test CR User', 'fake_hash', 'cr', 'cr1@example.com', 'sb_uid_cr_1'
  );
});

test('Database Schema: email and supabase_uid columns exist on students table', async () => {
  const student = await db.get('SELECT studentId, email, supabase_uid, role FROM students WHERE studentId = ?', 'test_student_1');
  assert.equal(student.studentId, 'test_student_1');
  assert.equal(student.email, 'student1@example.com');
  assert.equal(student.supabase_uid, 'sb_uid_student_1');
  assert.equal(student.role, 'student');
});

test('Auth Middleware: Rejects request with no token', async () => {
  const auth = createAuthMiddleware(db);
  const req = { headers: {} };
  const res = {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };

  let nextCalled = false;
  await auth.authenticate(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(req.user, null);

  let requireLoginCalled = false;
  auth.requireLogin(req, res, () => { requireLoginCalled = true; });
  assert.equal(requireLoginCalled, false);
  assert.equal(res.statusCode, 401);
  assert.match(res.body.message, /Authentication required/i);
});

test('Auth Middleware: Rejects request with invalid or malformed Supabase JWT', async () => {
  const auth = createAuthMiddleware(db);
  const req = { headers: { authorization: 'Bearer invalid.token.payload' } };
  const res = {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };

  let nextCalled = false;
  await auth.authenticate(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(req.user, null);

  auth.requireLogin(req, res, () => {});
  assert.equal(res.statusCode, 401);
});

test('Role Authorization: requireAdmin allows admin and blocks student and CR', async () => {
  const auth = createAuthMiddleware(db);

  // Student test
  const studentReq = { user: { studentId: 'test_student_1', role: 'student' } };
  const studentRes = {
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
  let studentAdminNext = false;
  auth.requireAdmin(studentReq, studentRes, () => { studentAdminNext = true; });
  assert.equal(studentAdminNext, false);
  assert.equal(studentRes.statusCode, 403);

  // CR test
  const crReq = { user: { studentId: 'test_cr_1', role: 'cr' } };
  const crRes = {
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
  let crAdminNext = false;
  auth.requireAdmin(crReq, crRes, () => { crAdminNext = true; });
  assert.equal(crAdminNext, false);
  assert.equal(crRes.statusCode, 403);

  // Admin test
  const adminReq = { user: { studentId: 'test_admin_1', role: 'admin' } };
  const adminRes = {
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
  let adminNext = false;
  auth.requireAdmin(adminReq, adminRes, () => { adminNext = true; });
  assert.equal(adminNext, true);
});

test('Mobile Bearer Tokens: Legacy mobile token continues working alongside Supabase Auth', async () => {
  const auth = createAuthMiddleware(db);
  const testToken = 'mobile_legacy_test_token_1234567890';
  const expiresAt = new Date(Date.now() + 3600000).toISOString();

  await db.run(
    'INSERT INTO mobile_tokens (token, studentId, createdAt, expiresAt) VALUES (?, ?, ?, ?)',
    testToken, 'test_student_1', new Date().toISOString(), expiresAt
  );

  const req = { headers: { authorization: `Bearer ${testToken}` } };
  const res = {};
  let nextCalled = false;
  await auth.authenticate(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.ok(req.user, 'req.user should be populated from mobile_tokens');
  assert.equal(req.user.studentId, 'test_student_1');
  assert.equal(req.user.role, 'student');
  assert.equal(req.mobileToken, testToken);
});

test('Supabase Config: Returns valid URL and anon key without service role key', () => {
  const cfg = getSupabaseConfig();
  assert.ok(cfg.url, 'Supabase URL should be configured');
  assert.ok(cfg.key, 'Supabase publishable/anon key should be configured');
  assert.equal(cfg.url.startsWith('https://'), true);
  // Service role key must not be part of public config
  assert.equal(cfg.serviceRoleKey, undefined);
});
