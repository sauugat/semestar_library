'use strict';

const os = require('os');
const path = require('path');
const testDbPath = path.join(os.tmpdir(), `admin_teacher_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
process.env.NODE_ENV = 'test';
process.env.DB_PATH = testDbPath;
process.env.SEMESTER_DB_SKIP_INIT = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const bcrypt = require('bcryptjs');
const db = require('../db');
const {
  ensureTeacherSchema,
  seedCanonicalSubjects,
  createTeacherInvitesBatch,
  listTeacherInvites,
  getTeacherInviteDetail,
  regenerateTeacherInvitePassword,
  reissueTeacherInvite,
  revokeTeacherInvite,
  verifyTemporaryTeacherCredentials,
  signOnboardingToken
} = require('../lib/teacher-service');
const createAdminTeachersRouter = require('../routes/admin-teachers');

let server;
let baseUrl;

// Fixture student IDs
const ADMIN_ID = 'admin_tester_01';
const STUDENT_ID = 'student_tester_01';
const CR_ID = 'cr_tester_01';
const TEACHER_USER_ID = 'teacher_user_01';

test.before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.TEACHER_ONBOARDING_ENABLED = '1';
  process.env.TEACHER_ONBOARDING_SECRET = 'test-teacher-onboarding-secret-key-32-bytes-secure!';

  await db.initSchema();
  await ensureTeacherSchema({ exec: db.exec, isPostgres: db.isPostgres });
  await seedCanonicalSubjects(db);

  // Clean test tables
  await db.run("DELETE FROM teacher_onboarding_pending_subjects").catch(() => {});
  await db.run("DELETE FROM teacher_onboarding_pending").catch(() => {});
  await db.run("DELETE FROM teacher_subjects").catch(() => {});
  await db.run("DELETE FROM teachers").catch(() => {});
  await db.run("DELETE FROM teacher_invites").catch(() => {});
  await db.run("DELETE FROM students WHERE studentId IN (?, ?, ?, ?)", ADMIN_ID, STUDENT_ID, CR_ID, TEACHER_USER_ID).catch(() => {});

  // Seed test users: Admin, Student, CR, Teacher
  await db.run(
    `INSERT INTO students (studentId, username, name, role, email, department, semester, passwordHash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ADMIN_ID, 'admin_user', 'Admin User', 'admin', 'admin@example.com', 'BIT', null, 'fake_hash'
  );

  await db.run(
    `INSERT INTO students (studentId, username, name, role, email, department, semester, passwordHash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    STUDENT_ID, 'student_user', 'Regular Student', 'student', 'student@example.com', 'BIT', 'Semester 1', 'fake_hash'
  );

  await db.run(
    `INSERT INTO students (studentId, username, name, role, email, department, semester, passwordHash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    CR_ID, 'cr_user', 'Class Representative', 'cr', 'cr@example.com', 'BIT', 'Semester 1', 'fake_hash'
  );

  await db.run(
    `INSERT INTO students (studentId, username, name, role, email, department, semester, passwordHash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    TEACHER_USER_ID, 'teacher_user', 'Teacher Staff', 'teacher', 'teacher@example.com', 'BIT', null, 'fake_hash'
  );

  // Spin up test Express app
  const express = require('express');
  const app = express();
  app.use(express.json());

  // Test session middleware populating req.user based on header 'x-test-user-id'
  const testAuthMiddleware = (req, res, next) => {
    const testUserId = req.headers['x-test-user-id'];
    if (testUserId) {
      req.user = { studentId: testUserId };
      req.student = req.user;
    }
    next();
  };

  const requireLogin = (req, res, next) => {
    if (!req.user || !req.user.studentId) {
      return res.status(401).json({ message: 'Authentication required.' });
    }
    next();
  };

  app.use(testAuthMiddleware);
  app.use('/api/admin', createAdminTeachersRouter(db, requireLogin));

  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
});

test.after(async () => {
  if (server) {
    await new Promise(resolve => server.close(resolve));
  }
});

// ============================================================================
// 1. AUTHORIZATION MATRIX TESTS
// ============================================================================

test('1. Authorization Matrix: Unauthenticated request rejected with 401', async () => {
  const res = await fetch(`${baseUrl}/api/admin/teacher-invites`);
  assert.equal(res.status, 401);
});

test('2. Authorization Matrix: Student role strictly denied with 403', async () => {
  const res = await fetch(`${baseUrl}/api/admin/teacher-invites`, {
    headers: { 'x-test-user-id': STUDENT_ID }
  });
  assert.equal(res.status, 403);
});

test('3. Authorization Matrix: Class Representative (CR) strictly denied with 403', async () => {
  const res = await fetch(`${baseUrl}/api/admin/teacher-invites`, {
    headers: { 'x-test-user-id': CR_ID }
  });
  assert.equal(res.status, 403);
});

test('4. Authorization Matrix: Teacher role strictly denied from admin routes with 403', async () => {
  const res = await fetch(`${baseUrl}/api/admin/teacher-invites`, {
    headers: { 'x-test-user-id': TEACHER_USER_ID }
  });
  assert.equal(res.status, 403);
});

test('5. Authorization Matrix: Admin role allowed with 200', async () => {
  const res = await fetch(`${baseUrl}/api/admin/teacher-invites`, {
    headers: { 'x-test-user-id': ADMIN_ID }
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data.invites));
  assert.ok(data.summary);
});

test('6. Authorization Matrix: All mutating endpoints enforce admin authorization', async () => {
  const endpoints = [
    { method: 'POST', path: '/api/admin/teacher-invites', body: { count: 1 } },
    { method: 'POST', path: '/api/admin/teacher-invites/dummy-id/regenerate-password' },
    { method: 'POST', path: '/api/admin/teacher-invites/dummy-id/reissue' },
    { method: 'POST', path: '/api/admin/teacher-invites/dummy-id/revoke' },
    { method: 'GET', path: '/api/admin/teacher-invites/dummy-id/detail' }
  ];

  for (const ep of endpoints) {
    // Unauthenticated
    const resUnauth = await fetch(`${baseUrl}${ep.path}`, {
      method: ep.method,
      headers: { 'Content-Type': 'application/json' },
      body: ep.body ? JSON.stringify(ep.body) : undefined
    });
    assert.equal(resUnauth.status, 401, `Expected 401 for unauth ${ep.method} ${ep.path}`);

    // Student
    const resStudent = await fetch(`${baseUrl}${ep.path}`, {
      method: ep.method,
      headers: {
        'Content-Type': 'application/json',
        'x-test-user-id': STUDENT_ID
      },
      body: ep.body ? JSON.stringify(ep.body) : undefined
    });
    assert.equal(resStudent.status, 403, `Expected 403 for student ${ep.method} ${ep.path}`);

    // Teacher
    const resTeacher = await fetch(`${baseUrl}${ep.path}`, {
      method: ep.method,
      headers: {
        'Content-Type': 'application/json',
        'x-test-user-id': TEACHER_USER_ID
      },
      body: ep.body ? JSON.stringify(ep.body) : undefined
    });
    assert.equal(resTeacher.status, 403, `Expected 403 for teacher ${ep.method} ${ep.path}`);
  }
});

// ============================================================================
// 2. CREATE VALIDATION & SECURITY TESTS
// ============================================================================

test('7. Create Validation: count 0 rejected with 400', async () => {
  const res = await fetch(`${baseUrl}/api/admin/teacher-invites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-user-id': ADMIN_ID },
    body: JSON.stringify({ count: 0 })
  });
  assert.equal(res.status, 400);
});

test('8. Create Validation: negative count rejected with 400', async () => {
  const res = await fetch(`${baseUrl}/api/admin/teacher-invites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-user-id': ADMIN_ID },
    body: JSON.stringify({ count: -5 })
  });
  assert.equal(res.status, 400);
});

test('9. Create Validation: count > 50 rejected with 400', async () => {
  const res = await fetch(`${baseUrl}/api/admin/teacher-invites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-user-id': ADMIN_ID },
    body: JSON.stringify({ count: 51 })
  });
  assert.equal(res.status, 400);
});

test('10. Create Validation: string count rejected with 400', async () => {
  const res = await fetch(`${baseUrl}/api/admin/teacher-invites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-user-id': ADMIN_ID },
    body: JSON.stringify({ count: "5" })
  });
  assert.equal(res.status, 400);
});

test('11. Create Security: Client-supplied role, username, password fields are completely ignored', async () => {
  const res = await fetch(`${baseUrl}/api/admin/teacher-invites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-user-id': ADMIN_ID },
    body: JSON.stringify({
      count: 1,
      role: 'superadmin',
      username: 'hacked_admin_name',
      password: 'HackedPassword123!',
      initial_username: 'hacked_name'
    })
  });
  assert.equal(res.status, 201);
  const data = await res.json();
  const created = data.invites[0];

  // Must follow server sequence, not client payload
  assert.equal(created.temporary_username, 'teacher001');
  assert.notEqual(created.temporary_password, 'HackedPassword123!');
});

// ============================================================================
// 3. USERNAME SEQUENCE TESTS
// ============================================================================

test('12. Username Sequence: Initial sequence starts at teacher001, then teacher002, then bulk', async () => {
  // teacher001 was created in test 11. Now create single: should be teacher002
  const res2 = await fetch(`${baseUrl}/api/admin/teacher-invites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-user-id': ADMIN_ID },
    body: JSON.stringify({ count: 1 })
  });
  assert.equal(res2.status, 201);
  const data2 = await res2.json();
  assert.equal(data2.invites[0].temporary_username, 'teacher002');

  // Now create batch of 3: should be teacher003, teacher004, teacher005
  const resBulk = await fetch(`${baseUrl}/api/admin/teacher-invites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-user-id': ADMIN_ID },
    body: JSON.stringify({ count: 3 })
  });
  assert.equal(resBulk.status, 201);
  const dataBulk = await resBulk.json();
  assert.equal(dataBulk.invites.length, 3);
  assert.equal(dataBulk.invites[0].temporary_username, 'teacher003');
  assert.equal(dataBulk.invites[1].temporary_username, 'teacher004');
  assert.equal(dataBulk.invites[2].temporary_username, 'teacher005');
});

// ============================================================================
// 4. PASSWORD SECURITY & PRIVACY TESTS
// ============================================================================

test('13. Password Security: Passwords have high entropy and are stored strictly as bcrypt hash in DB', async () => {
  const row = await db.get("SELECT * FROM teacher_invites WHERE initial_username = 'teacher001'");
  assert.ok(row);

  // Hash starts with bcrypt signature
  assert.ok(row.temporary_password_hash.startsWith('$2a$12$') || row.temporary_password_hash.startsWith('$2b$12$'));

  // Plaintext must never exist in any column
  const cols = Object.keys(row);
  for (const c of cols) {
    assert.notEqual(c, 'temporary_password');
    assert.notEqual(c, 'plaintext_password');
    assert.notEqual(c, 'password');
  }
});

test('14. Password Security: All generated passwords are unique with high entropy', async () => {
  const res = await fetch(`${baseUrl}/api/admin/teacher-invites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-user-id': ADMIN_ID },
    body: JSON.stringify({ count: 5 })
  });
  const data = await res.json();
  const passwords = data.invites.map(i => i.temporary_password);
  const unique = new Set(passwords);

  assert.equal(passwords.length, 5);
  assert.equal(unique.size, 5);

  for (const pw of passwords) {
    assert.ok(typeof pw === 'string');
    assert.ok(pw.length >= 16);
  }
});

test('15. Privacy Audit: GET list and detail NEVER return password hashes, nonces, or secrets', async () => {
  const listRes = await fetch(`${baseUrl}/api/admin/teacher-invites`, {
    headers: { 'x-test-user-id': ADMIN_ID }
  });
  const listData = await listRes.json();
  const invite = listData.invites[0];

  assert.equal(invite.temporary_password, undefined);
  assert.equal(invite.temporary_password_hash, undefined);
  assert.equal(invite.passwordHash, undefined);
  assert.equal(invite.onboarding_nonce, undefined);
  assert.equal(invite.access_token, undefined);
  assert.equal(invite.refresh_token, undefined);

  const detailRes = await fetch(`${baseUrl}/api/admin/teacher-invites/${invite.id}/detail`, {
    headers: { 'x-test-user-id': ADMIN_ID }
  });
  const detailData = await detailRes.json();

  assert.equal(detailData.temporary_password, undefined);
  assert.equal(detailData.temporary_password_hash, undefined);
  assert.equal(detailData.onboarding_nonce, undefined);
});

// ============================================================================
// 5. REGENERATION TESTS
// ============================================================================

test('16. Regeneration Lifecycle: Old temp password works, regenerate, old password fails, new works', async () => {
  // Create single invite
  const createRes = await fetch(`${baseUrl}/api/admin/teacher-invites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-user-id': ADMIN_ID },
    body: JSON.stringify({ count: 1 })
  });
  const createData = await createRes.json();
  const inv = createData.invites[0];
  const oldPassword = inv.temporary_password;

  // Verify old password works in auth check
  const checkOld = await verifyTemporaryTeacherCredentials(db, {
    username: inv.temporary_username,
    password: oldPassword
  });
  assert.equal(checkOld.success, true);

  // Regenerate password via admin endpoint
  const regenRes = await fetch(`${baseUrl}/api/admin/teacher-invites/${inv.id}/regenerate-password`, {
    method: 'POST',
    headers: { 'x-test-user-id': ADMIN_ID }
  });
  assert.equal(regenRes.status, 200);
  const regenData = await regenRes.json();
  const newPassword = regenData.temporary_password;

  assert.notEqual(newPassword, oldPassword);

  // Old password must fail immediately
  const checkOldAfter = await verifyTemporaryTeacherCredentials(db, {
    username: inv.temporary_username,
    password: oldPassword
  });
  assert.equal(checkOldAfter.success, false);

  // New password must succeed
  const checkNewAfter = await verifyTemporaryTeacherCredentials(db, {
    username: inv.temporary_username,
    password: newPassword
  });
  assert.equal(checkNewAfter.success, true);
});

// ============================================================================
// 6. REVOKE & REISSUE TESTS
// ============================================================================

test('17. Revoke Lifecycle: Revoking invite invalidates credentials immediately', async () => {
  // Create single invite
  const createRes = await fetch(`${baseUrl}/api/admin/teacher-invites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-user-id': ADMIN_ID },
    body: JSON.stringify({ count: 1 })
  });
  const createData = await createRes.json();
  const inv = createData.invites[0];

  // Revoke via admin endpoint
  const revokeRes = await fetch(`${baseUrl}/api/admin/teacher-invites/${inv.id}/revoke`, {
    method: 'POST',
    headers: { 'x-test-user-id': ADMIN_ID }
  });
  assert.equal(revokeRes.status, 200);
  const revokeData = await revokeRes.json();
  assert.equal(revokeData.status, 'revoked');

  // Verify login fails with INVITE_DISABLED
  const check = await verifyTemporaryTeacherCredentials(db, {
    username: inv.temporary_username,
    password: inv.temporary_password
  });
  assert.equal(check.success, false);
  assert.equal(check.reason, 'INVITE_DISABLED');

  // Username must NOT be recycled for new invitations
  const nextRes = await fetch(`${baseUrl}/api/admin/teacher-invites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-user-id': ADMIN_ID },
    body: JSON.stringify({ count: 1 })
  });
  const nextData = await nextRes.json();
  assert.notEqual(nextData.invites[0].temporary_username, inv.temporary_username);
});

test('18. Reissue Lifecycle: Expired invite reissued retains username with fresh credentials and expiry', async () => {
  // Create invite and artificially expire it
  const createRes = await fetch(`${baseUrl}/api/admin/teacher-invites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-user-id': ADMIN_ID },
    body: JSON.stringify({ count: 1 })
  });
  const createData = await createRes.json();
  const inv = createData.invites[0];

  const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await db.run('UPDATE teacher_invites SET expires_at = ?, status = ? WHERE id = ?', pastDate, 'expired', inv.id);

  // Reissue via admin endpoint
  const reissueRes = await fetch(`${baseUrl}/api/admin/teacher-invites/${inv.id}/reissue`, {
    method: 'POST',
    headers: { 'x-test-user-id': ADMIN_ID }
  });
  assert.equal(reissueRes.status, 200);
  const reissueData = await reissueRes.json();

  assert.equal(reissueData.temporary_username, inv.temporary_username);
  assert.notEqual(reissueData.temporary_password, inv.temporary_password);
  assert.ok(new Date(reissueData.expires_at).getTime() > Date.now());

  // Old password fails
  const checkOld = await verifyTemporaryTeacherCredentials(db, {
    username: inv.temporary_username,
    password: inv.temporary_password
  });
  assert.equal(checkOld.success, false);

  // New password succeeds
  const checkNew = await verifyTemporaryTeacherCredentials(db, {
    username: inv.temporary_username,
    password: reissueData.temporary_password
  });
  assert.equal(checkNew.success, true);
});

// ============================================================================
// 7. ACTIVE TEACHER DETAIL & SUBJECTS
// ============================================================================

test('19. Active Teacher Detail: Completed invite returns relational subjects, without student semester', async () => {
  // Create and mark completed invite
  const createRes = await fetch(`${baseUrl}/api/admin/teacher-invites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-user-id': ADMIN_ID },
    body: JSON.stringify({ count: 1 })
  });
  const createData = await createRes.json();
  const inv = createData.invites[0];

  const teacherUserId = 'teacher_active_audit_01';
  const teacherTableId = 'teacher_table_audit_01';

  await db.run(
    `INSERT INTO students (studentId, username, name, role, email, department, semester, passwordHash)
     VALUES (?, ?, ?, 'teacher', ?, 'BIT', null, 'fake_hash')`,
    teacherUserId, 'active.prof', 'Professor Test', 'prof@example.com'
  );

  await db.run(
    `INSERT INTO teachers (id, user_id, invite_id, designation, status)
     VALUES (?, ?, ?, 'Associate Professor', 'active')`,
    teacherTableId, teacherUserId, inv.id
  );

  // Assign subjects CIT123 and CIT211
  await db.run(
    `INSERT INTO teacher_subjects (id, teacher_id, subject_id) VALUES (?, ?, ?)`,
    'ts_audit_1', teacherTableId, 'CIT123'
  );
  await db.run(
    `INSERT INTO teacher_subjects (id, teacher_id, subject_id) VALUES (?, ?, ?)`,
    'ts_audit_2', teacherTableId, 'CIT211'
  );

  await db.run("UPDATE teacher_invites SET status = 'completed' WHERE id = ?", inv.id);

  // Query detail endpoint
  const detailRes = await fetch(`${baseUrl}/api/admin/teacher-invites/${inv.id}/detail`, {
    headers: { 'x-test-user-id': ADMIN_ID }
  });
  assert.equal(detailRes.status, 200);
  const detailData = await detailRes.json();

  assert.equal(detailData.status, 'active');
  assert.equal(detailData.teacher.name, 'Professor Test');
  assert.equal(detailData.teacher.username, 'active.prof');
  assert.equal(detailData.teacher.designation, 'Associate Professor');

  // Verify subjects joined relationally
  assert.equal(detailData.teacher.subjects.length, 2);
  const codes = detailData.teacher.subjects.map(s => s.code);
  assert.ok(codes.includes('CIT123'));
  assert.ok(codes.includes('CIT211'));

  // Ensure student semester is NOT present
  assert.equal(detailData.teacher.semester, undefined);
  assert.equal(detailData.teacher.cohortId, undefined);

  // Active teacher cannot have temporary password regenerated
  const regenRes = await fetch(`${baseUrl}/api/admin/teacher-invites/${inv.id}/regenerate-password`, {
    method: 'POST',
    headers: { 'x-test-user-id': ADMIN_ID }
  });
  assert.equal(regenRes.status, 400);
  const regenErr = await regenRes.json();
  assert.match(regenErr.message, /active teacher/i);
});

// ============================================================================
// 8. ADMIN UI HTML AUDIT
// ============================================================================

test('20. Admin UI HTML Audit: public/admin-teachers.html exists and contains all required features', () => {
  const fs = require('fs');
  const htmlPath = path.join(__dirname, '../public/admin-teachers.html');
  assert.ok(fs.existsSync(htmlPath), 'admin-teachers.html must exist in public directory');

  const content = fs.readFileSync(htmlPath, 'utf8');

  // Headers and navigation
  assert.ok(content.includes('Teacher Management'));
  assert.ok(content.includes('Create and manage temporary teacher access credentials.'));
  assert.ok(content.includes('/admin-cohorts.html'));
  assert.ok(content.includes('/dashboard.html'));

  // Warning banner
  assert.ok(content.includes('Teacher onboarding is currently disabled.'));

  // Summary cards
  assert.ok(content.includes('Total Invites / Slots'));
  assert.ok(content.includes('Awaiting Activation'));
  assert.ok(content.includes('Active Teachers'));
  assert.ok(content.includes('Expired'));
  assert.ok(content.includes('Revoked'));

  // Controls
  assert.ok(content.includes('searchInput'));
  assert.ok(content.includes('statusFilter'));
  assert.ok(content.includes('Create Multiple'));
  assert.ok(content.includes('+ Create Teacher Login'));

  // Modals & Credential safety
  assert.ok(content.includes('This temporary password is shown only once.'));
  assert.ok(content.includes('copySingleUsername'));
  assert.ok(content.includes('copySinglePassword'));
  assert.ok(content.includes('copySingleBoth'));
  assert.ok(content.includes('downloadBulkCsv'));
  assert.ok(content.includes('bulkCountInput'));
  assert.ok(content.includes('regenerateModal'));
  assert.ok(content.includes('reissueModal'));
  assert.ok(content.includes('revokeModal'));
  assert.ok(content.includes('detailModal'));
});
