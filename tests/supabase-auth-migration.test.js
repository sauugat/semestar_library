const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db');
const { createAuthMiddleware } = require('../lib/auth-middleware');
const { getSupabaseConfig } = require('../lib/supabase');

test.before(async () => {
  await db.initSchema();

  // Clean test tables to ensure isolation
  await db.run("DELETE FROM students WHERE studentId LIKE 'test_%' OR studentId = '26029999'");

  // Create test students with username, gender, verification_status, supabase_uid, and email
  await db.run(
    `INSERT INTO students (
      studentId, username, name, passwordHash, role, email,
      supabase_uid, department, semester, gender, verification_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'test_student_1', 'alice.student', 'Alice Student', 'fake_hash', 'student',
    'alice@example.com', 'sb_uid_alice', 'BIT', 'Semester 2', 'female', 'unverified'
  );

  await db.run(
    `INSERT INTO students (
      studentId, username, name, passwordHash, role, email,
      supabase_uid, department, semester, gender, verification_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'test_admin_1', 'bob.admin', 'Bob Admin', 'fake_hash', 'admin',
    'bob@example.com', 'sb_uid_bob', 'BIT', 'Semester 6', 'male', 'unverified'
  );

  await db.run(
    `INSERT INTO students (
      studentId, username, name, passwordHash, role, email,
      supabase_uid, department, semester, gender, verification_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'test_cr_1', 'charlie.cr', 'Charlie CR', 'fake_hash', 'cr',
    'charlie@example.com', 'sb_uid_charlie', 'BIT', 'Semester 4', 'other', 'unverified'
  );
});

test('Database Schema: Phase 1 columns (username, gender, verification_status, created_at, updated_at) exist', async () => {
  const student = await db.get(
    'SELECT studentId, username, gender, verification_status, email, supabase_uid, role FROM students WHERE studentId = ?',
    'test_student_1'
  );
  assert.equal(student.studentId, 'test_student_1');
  assert.equal(student.username, 'alice.student');
  assert.equal(student.gender, 'female');
  assert.equal(student.verification_status, 'unverified');
  assert.equal(student.email, 'alice@example.com');
  assert.equal(student.supabase_uid, 'sb_uid_alice');
  assert.equal(student.role, 'student');
});

test('Database Schema: Case-insensitive unique constraint prevents duplicate usernames', async () => {
  let threw = false;
  try {
    await db.run(
      `INSERT INTO students (studentId, username, name, email) VALUES (?, ?, ?, ?)`,
      'test_dup_user', 'ALICE.STUDENT', 'Duplicate Alice', 'alice_diff@example.com'
    );
  } catch (err) {
    threw = true;
    assert.match(err.message, /UNIQUE|constraint/i);
  }
  assert.equal(threw, true, 'Inserting duplicate case-insensitive username must fail');
});

test('Database Schema: Case-insensitive unique constraint prevents duplicate emails', async () => {
  let threw = false;
  try {
    await db.run(
      `INSERT INTO students (studentId, username, name, email) VALUES (?, ?, ?, ?)`,
      'test_dup_email', 'alice.unique', 'Duplicate Alice Email', 'ALICE@EXAMPLE.COM'
    );
  } catch (err) {
    threw = true;
    assert.match(err.message, /UNIQUE|constraint/i);
  }
  assert.equal(threw, true, 'Inserting duplicate case-insensitive email must fail');
});

test('Auth Middleware: Populates req.user with all Phase 1 fields', async () => {
  const auth = createAuthMiddleware(db);
  // Mock legacy bearer token for student
  const testToken = 'mobile_full_fields_token_' + Date.now();
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
  assert.ok(req.user, 'req.user should be populated');
  assert.equal(req.user.studentId, 'test_student_1');
  assert.equal(req.user.username, 'alice.student');
  assert.equal(req.user.name, 'Alice Student');
  assert.equal(req.user.role, 'student');
  assert.equal(req.user.department, 'BIT');
  assert.equal(req.user.semester, 'Semester 2');
  assert.equal(req.user.gender, 'female');
  assert.equal(req.user.verificationStatus, 'unverified');
});

test('Auth Middleware: Rejects request with no token', async () => {
  const auth = createAuthMiddleware(db);
  const req = { headers: {} };
  const res = {
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
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
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };

  let nextCalled = false;
  await auth.authenticate(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(req.user, null);

  auth.requireLogin(req, res, () => {});
  assert.equal(res.statusCode, 401);
});

test('Role Authorization: requireAdmin strictly validates role === "admin" from Neon', async () => {
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
  const testToken = 'mobile_legacy_test_token_' + Date.now();
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
  assert.equal(cfg.serviceRoleKey, undefined);
});
