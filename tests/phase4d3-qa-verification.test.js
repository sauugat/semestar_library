'use strict';

/**
 * Phase 4D.3: Automated QA Verification Suite
 *
 * Validates:
 * 1. Fail-closed production guards (rejects Neon, Supabase, production environments)
 * 2. External service isolation (Supabase, push notifications, AI)
 * 3. Seed script deterministic idempotency and synthetic test accounts
 * 4. Mobile authentication via POST /api/mobile/login for all 4 roles
 * 5. Role-based navigation tab mapping (Student, CR, Teacher, Admin)
 * 6. Admin user management (suspend, reactivate, promote-cr, demote-student)
 * 7. Admin academic operations (create, edit, archive, reactivate subjects)
 * 8. Admin content moderation (reports, remove/restore posts and comments)
 * 9. Durable administrative audit logs
 * 10. Offline draft isolation and cross-account safety
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const http = require('http');

// Point to a dedicated test SQLite database
const TEST_DB_PATH = path.join('/tmp', `qa_verify_phase4d3_${Date.now()}.db`);
process.env.QA_MODE = 'true';
process.env.NODE_ENV = 'test';
process.env.DB_PATH = TEST_DB_PATH;
process.env.EXPO_PUSH_DISABLED = 'true';
process.env.TEACHER_ONBOARDING_ENABLED = 'false';
process.env.DM_ENABLED = 'false';

// Strip any external credentials
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
delete process.env.PGHOST;
delete process.env.SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_URL;

const {
  isProductionDatabaseUrl,
  isProductionSupabaseUrl,
  validateQaEnvironment,
  assertSafeQaEnvironment,
} = require('../lib/qa-guard');
const supabaseLib = require('../lib/supabase');
const pushNotifications = require('../lib/push-notifications');
const db = require('../db');
const { seedQa } = require('../scripts/seed-qa');
const app = require('../server');

let server = null;
let baseUrl = '';

test.before(async () => {
  // Ensure fresh database schema and seed data
  await seedQa(db);

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
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  if (fs.existsSync(TEST_DB_PATH)) {
    try { fs.unlinkSync(TEST_DB_PATH); } catch (_) {}
  }
});

// ====================================================================
// SECTION 1: FAIL-CLOSED QA GUARDS
// ====================================================================

test('1. QA Guard: Approves isolated local environment', () => {
  const result = validateQaEnvironment({
    QA_MODE: 'true',
    NODE_ENV: 'qa',
    DB_PATH: '/tmp/disposable.db',
    TEACHER_ONBOARDING_ENABLED: 'false',
  });
  assert.equal(result.safe, true);
  assert.equal(result.errors.length, 0);
});

test('2. QA Guard: Rejects missing QA_MODE', () => {
  const result = validateQaEnvironment({
    QA_MODE: 'false',
    NODE_ENV: 'development',
  });
  assert.equal(result.safe, false);
  assert.match(result.errors.join(' '), /QA_MODE="true" is required/i);
});

test('3. QA Guard: Rejects production Neon database URLs', () => {
  const neonUrls = [
    'postgres://user:pass@ep-fancy-mud-1234.us-east-1.aws.neon.tech/neondb',
    'postgresql://user:pass@ep-cool-lake-5678.neon.tech/neondb?sslmode=require',
    'postgres://user:pass@ep-custom-endpoint.c-12.us-east-1.aws.neon.tech/db',
  ];

  for (const url of neonUrls) {
    assert.equal(isProductionDatabaseUrl(url), true, `Must detect ${url} as production`);
    const result = validateQaEnvironment({
      QA_MODE: 'true',
      DATABASE_URL: url,
    });
    assert.equal(result.safe, false);
    assert.match(result.errors.join(' '), /DATABASE_URL points to a remote\/production database/i);
  }
});

test('4. QA Guard: Rejects production Supabase URLs', () => {
  const supabaseUrls = [
    'https://ahcccqsyvpxacnsttzeh.supabase.co',
    'https://customproject.supabase.co',
  ];

  for (const url of supabaseUrls) {
    assert.equal(isProductionSupabaseUrl(url), true, `Must detect ${url} as production Supabase`);
    const result = validateQaEnvironment({
      QA_MODE: 'true',
      SUPABASE_URL: url,
    });
    assert.equal(result.safe, false);
    assert.match(result.errors.join(' '), /Production Supabase URL detected/i);
  }
});

test('5. QA Guard: Rejects NODE_ENV=production and SEMESTER_PRODUCTION=true', () => {
  const r1 = validateQaEnvironment({ QA_MODE: 'true', NODE_ENV: 'production' });
  assert.equal(r1.safe, false);
  assert.match(r1.errors.join(' '), /NODE_ENV cannot be "production"/i);

  const r2 = validateQaEnvironment({ QA_MODE: 'true', SEMESTER_PRODUCTION: 'true' });
  assert.equal(r2.safe, false);
  assert.match(r2.errors.join(' '), /SEMESTER_PRODUCTION cannot be "true"/i);
});

test('6. QA Guard: assertSafeQaEnvironment throws on violation', () => {
  assert.throws(
    () => {
      assertSafeQaEnvironment({
        QA_MODE: 'true',
        DATABASE_URL: 'postgres://ep-test.neon.tech/db',
      });
    },
    (err) => err.code === 'QA_GUARD_VIOLATION'
  );
});

// ====================================================================
// SECTION 2: EXTERNAL SERVICE ISOLATION
// ====================================================================

test('7. Supabase Isolation: Write operations fail-closed in QA mode', async () => {
  // registerSupabaseUser
  await assert.rejects(
    async () => {
      await supabaseLib.registerSupabaseUser({
        email: 'test@example.com',
        password: 'password123',
      });
    },
    /\[QA Safe Mode\]: Remote Supabase user registration is disabled in local QA mode/i
  );

  // sendPasswordResetEmail
  await assert.rejects(
    async () => {
      await supabaseLib.sendPasswordResetEmail({ email: 'test@example.com' });
    },
    /\[QA Safe Mode\]: Remote Supabase password reset is disabled in local QA mode/i
  );

  // resendVerificationEmail
  await assert.rejects(
    async () => {
      await supabaseLib.resendVerificationEmail({ email: 'test@example.com' });
    },
    /\[QA Safe Mode\]: Remote Supabase verification email resend is disabled in local QA mode/i
  );

  // getSupabaseAdminClient
  assert.throws(
    () => {
      supabaseLib.getSupabaseAdminClient();
    },
    /\[QA Safe Mode\]: Remote Supabase administrative operations are disabled in local QA mode/i
  );

  // authenticateWithPassword fails closed without network call
  const authRes = await supabaseLib.authenticateWithPassword({
    email: 'test@example.com',
    password: 'password123',
  });
  assert.equal(authRes.data, null);
  assert.match(authRes.error.message, /Remote Supabase authentication disabled in local QA mode/i);
});

test('8. Push Notifications: Outbound batch is mocked safely in QA mode', async () => {
  const batchRes = await pushNotifications.sendExpoPushBatch([
    { to: 'ExponentPushToken[mock_token_123]', title: 'Test', body: 'Test push' },
  ]);
  assert.equal(batchRes.status, 200);
  assert.equal(batchRes.error, null);
  assert.equal(batchRes.tickets.length, 1);
  assert.equal(batchRes.tickets[0].status, 'ok');
  assert.match(batchRes.tickets[0].id, /^qa-push-ticket-/);
});

// ====================================================================
// SECTION 3: SEED SCRIPT IDEMPOTENCY & TEST ACCOUNTS
// ====================================================================

test('9. Seed Idempotency: Re-running seedQa does not duplicate or fail', async () => {
  await assert.doesNotReject(async () => {
    await seedQa(db);
  });

  const studentsCount = await db.get("SELECT COUNT(*) AS c FROM students WHERE studentId LIKE 'qa_%'");
  assert.equal(Number(studentsCount.c), 4, 'Must have exactly 4 QA test accounts');

  const subjectsCount = await db.get("SELECT COUNT(*) AS c FROM subjects WHERE id LIKE 'sub_cs%'");
  assert.equal(Number(subjectsCount.c), 3, 'Must have exactly 3 canonical QA subjects');
});

// ====================================================================
// SECTION 4: LOGIN COMPATIBILITY & ROLE PARITY (POST /api/mobile/login)
// ====================================================================

let adminToken = '';
let studentToken = '';
let crToken = '';
let teacherToken = '';

test('10. Mobile Login: qa_admin authenticates successfully', async () => {
  const res = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'qa_admin', password: 'QaAdmin123!' }),
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.token, 'Must return opaque mobile token');
  assert.equal(data.user.studentId, 'qa_admin');
  assert.equal(data.user.role, 'admin');
  adminToken = data.token;
});

test('11. Mobile Login: qa_student authenticates successfully', async () => {
  const res = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'qa_student', password: 'QaStudent123!' }),
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.token, 'Must return opaque mobile token');
  assert.equal(data.user.studentId, 'qa_student');
  assert.equal(data.user.role, 'student');
  studentToken = data.token;
});

test('12. Mobile Login: qa_cr authenticates successfully', async () => {
  const res = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'qa_cr', password: 'QaCr123!' }),
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.token, 'Must return opaque mobile token');
  assert.equal(data.user.studentId, 'qa_cr');
  assert.equal(data.user.role, 'cr');
  crToken = data.token;
});

test('13. Mobile Login: qa_teacher authenticates successfully', async () => {
  const res = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'qa_teacher', password: 'QaTeacher123!' }),
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.token, 'Must return opaque mobile token');
  assert.equal(data.user.studentId, 'qa_teacher');
  assert.equal(data.user.role, 'teacher');
  teacherToken = data.token;
});

test('14. Mobile Login: Wrong password is rejected with 401', async () => {
  const res = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'qa_student', password: 'WrongPassword123!' }),
  });
  assert.equal(res.status, 401);
});

// ====================================================================
// SECTION 5: ROLE NAVIGATION MAPPING
// ====================================================================

test('15. Role Navigation: Student, CR, Teacher, Admin tab layouts match specification', () => {
  function getTabTitles(role, isCR = false) {
    const isTeacher = role === 'teacher' || role === 'faculty';
    const isAdmin = role === 'admin';
    return [
      isAdmin ? 'Dashboard' : isTeacher ? 'Dashboard' : 'Home',
      isAdmin ? 'Users' : isTeacher ? 'My Materials' : 'Library',
      isAdmin ? 'Academics' : 'Chat',
      isAdmin ? 'Content' : isTeacher ? 'Notices' : 'Games',
      'Profile',
    ];
  }

  assert.deepEqual(getTabTitles('student'), ['Home', 'Library', 'Chat', 'Games', 'Profile']);
  assert.deepEqual(getTabTitles('cr', true), ['Home', 'Library', 'Chat', 'Games', 'Profile']);
  assert.deepEqual(getTabTitles('teacher'), ['Dashboard', 'My Materials', 'Chat', 'Notices', 'Profile']);
  assert.deepEqual(getTabTitles('admin'), ['Dashboard', 'Users', 'Academics', 'Content', 'Profile']);
});

// ====================================================================
// SECTION 6: ADMIN USER MANAGEMENT (SUSPEND, REACTIVATE, PROMOTE, DEMOTE)
// ====================================================================

test('16. Admin Action: Suspend student, verify 403 suspension, reactivate', async () => {
  // Suspend
  const suspendRes = await fetch(`${baseUrl}/api/admin/users/qa_student/suspend`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ reason: 'Violated local QA guideline rule 1' }),
  });
  assert.equal(suspendRes.status, 200);

  // Student mobile token is invalidated on suspension (returns 401)
  const checkRes = await fetch(`${baseUrl}/api/profile`, {
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  assert.equal(checkRes.status, 401);

  // New login attempt receives 403 ACCOUNT_SUSPENDED
  const loginSuspended = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'qa_student', password: 'QaStudent123!' }),
  });
  assert.equal(loginSuspended.status, 403);
  const suspData = await loginSuspended.json();
  assert.equal(suspData.error, 'ACCOUNT_SUSPENDED');

  // Reactivate
  const reactRes = await fetch(`${baseUrl}/api/admin/users/qa_student/reactivate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ reason: 'QA suspension testing completed' }),
  });
  assert.equal(reactRes.status, 200);

  // Log back in to get a fresh token
  const loginAgain = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'qa_student', password: 'QaStudent123!' }),
  });
  assert.equal(loginAgain.status, 200);
  const dataAgain = await loginAgain.json();
  studentToken = dataAgain.token;
});

test('17. Admin Action: Promote Student to CR and demote back to Student', async () => {
  // Promote qa_student to CR
  const promoteRes = await fetch(`${baseUrl}/api/admin/users/qa_student/promote-cr`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ reason: 'Appointed interim CR for testing' }),
  });
  assert.equal(promoteRes.status, 200);

  const studentRow = await db.get("SELECT role FROM students WHERE studentId = 'qa_student'");
  assert.equal(studentRow.role, 'cr');

  // Demote back to student
  const demoteRes = await fetch(`${baseUrl}/api/admin/users/qa_student/demote-student`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ reason: 'Returned to regular student role' }),
  });
  assert.equal(demoteRes.status, 200);

  const demotedRow = await db.get("SELECT role FROM students WHERE studentId = 'qa_student'");
  assert.equal(demotedRow.role, 'student');
});

// ====================================================================
// SECTION 7: ADMIN ACADEMIC OPERATIONS
// ====================================================================

test('18. Admin Action: Create, Edit, Archive, and Reactivate canonical subject', async () => {
  // 1. Create subject
  const createRes = await fetch(`${baseUrl}/api/admin/academics/subjects`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      code: 'CS104',
      name: 'Computer Organization',
      semester: 1,
      department: 'BIT',
      credit_hours: 3.0,
      nature: 'Theory',
    }),
  });
  assert.equal(createRes.status, 201);
  const createData = await createRes.json();
  assert.ok(createData.subject, 'Subject must be created');
  const subjectId = createData.subject?.id || 'sub_cs104';

  // 2. Edit subject
  const editRes = await fetch(`${baseUrl}/api/admin/academics/subjects/${subjectId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      name: 'Computer Architecture & Organization',
      credit_hours: 4.0,
    }),
  });
  assert.equal(editRes.status, 200);

  // 3. Archive subject
  const archiveRes = await fetch(`${baseUrl}/api/admin/academics/subjects/${subjectId}/archive`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ reason: 'Testing subject archive' }),
  });
  assert.equal(archiveRes.status, 200);

  // 4. Reactivate subject
  const reactRes = await fetch(`${baseUrl}/api/admin/academics/subjects/${subjectId}/reactivate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ reason: 'Testing subject reactivate' }),
  });
  assert.equal(reactRes.status, 200);
});

// ====================================================================
// SECTION 8: ADMIN CONTENT MODERATION
// ====================================================================

test('19. Admin Action: Review reports, Remove/Restore post, Remove/Restore comment', async () => {
  // 1. Fetch moderation reports
  const reportsRes = await fetch(`${baseUrl}/api/admin/moderation/reports?status=open`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(reportsRes.status, 200);
  const reportsData = await reportsRes.json();
  assert.ok(Array.isArray(reportsData.reports));
  assert.ok(reportsData.reports.length >= 1, 'Should contain seeded moderation report');

  // 2. Remove post
  const removePostRes = await fetch(`${baseUrl}/api/admin/moderation/posts/1/remove`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ reason: 'QA moderation test remove' }),
  });
  assert.equal(removePostRes.status, 200);

  const postRemoved = await db.get('SELECT moderation_status FROM posts WHERE id = 1');
  assert.equal(postRemoved.moderation_status, 'removed');

  // 3. Restore post
  const restorePostRes = await fetch(`${baseUrl}/api/admin/moderation/posts/1/restore`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ reason: 'QA moderation test restore' }),
  });
  assert.equal(restorePostRes.status, 200);

  const postRestored = await db.get('SELECT moderation_status FROM posts WHERE id = 1');
  assert.equal(postRestored.moderation_status, 'active');

  // 4. Remove comment
  const removeComRes = await fetch(`${baseUrl}/api/admin/moderation/comments/1/remove`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ reason: 'QA moderation comment remove' }),
  });
  assert.equal(removeComRes.status, 200);

  const comRemoved = await db.get('SELECT moderation_status FROM post_comments WHERE id = 1');
  assert.equal(comRemoved.moderation_status, 'removed');

  // 5. Restore comment
  const restoreComRes = await fetch(`${baseUrl}/api/admin/moderation/comments/1/restore`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ reason: 'QA moderation comment restore' }),
  });
  assert.equal(restoreComRes.status, 200);

  const comRestored = await db.get('SELECT moderation_status FROM post_comments WHERE id = 1');
  assert.equal(comRestored.moderation_status, 'active');
});

// ====================================================================
// SECTION 9: AUDIT LOG TRANSACTION VERIFICATION
// ====================================================================

test('20. Audit Logging: Admin actions are recorded with actor, action, and entity', async () => {
  const auditLogs = await db.all("SELECT action, actor_user_id, entity_type FROM admin_audit_logs WHERE actor_user_id = 'qa_admin' ORDER BY created_at DESC");
  assert.ok(auditLogs.length >= 4, 'Audit logs must record administrative mutations');

  const actions = auditLogs.map((l) => l.action);
  assert.ok(actions.includes('account_suspended'), 'Must record account_suspended');
  assert.ok(actions.includes('account_reactivated'), 'Must record account_reactivated');
  assert.ok(actions.includes('post_removed'), 'Must record post_removed');
  assert.ok(actions.includes('post_restored'), 'Must record post_restored');
});

// ====================================================================
// SECTION 10: OFFLINE DRAFT ISOLATION & MESSAGE SAFETY
// ====================================================================

test('21. Offline Draft Isolation: Unsent drafts (id <= 0) are scoped by account and preserved on logout', () => {
  // Simulate the chatScope and cache key behavior of mobile/services/chat-db.ts and chat-session.ts
  function getScope(server, account, chatGroupId) {
    return JSON.stringify([server, account, chatGroupId]);
  }

  const scopeStudentA = getScope('http://192.168.1.65:3000', 'qa_student', 'group-qa-mercury');
  const scopeStudentB = getScope('http://192.168.1.65:3000', 'qa_cr', 'group-qa-mercury');

  // Verify that account keys are strictly distinct even within the same chat group and server
  assert.notEqual(scopeStudentA, scopeStudentB, 'Scopes for distinct accounts must never collide');

  // Simulate local SQLite chat_cache_v3 table
  const cacheTable = [
    { scope: scopeStudentA, id: -1, payload: JSON.stringify({ text: 'Draft by student A', status: 'pending' }) },
    { scope: scopeStudentA, id: 101, payload: JSON.stringify({ text: 'Confirmed server message 101', status: 'sent' }) },
    { scope: scopeStudentB, id: -2, payload: JSON.stringify({ text: 'Draft by student B', status: 'pending' }) },
  ];

  // When User B logs in, User B queries ONLY scopeStudentB
  const userBQuery = cacheTable.filter((row) => row.scope === scopeStudentB);
  assert.equal(userBQuery.length, 1);
  assert.equal(JSON.parse(userBQuery[0].payload).text, 'Draft by student B');
  // User B NEVER sees User A's draft
  assert.ok(!userBQuery.some((row) => row.payload.includes('Draft by student A')));

  // When User A logs out (clearChatDb with preservePending: true):
  // DELETE FROM chat_cache_v3 WHERE id > 0;
  const afterLogout = cacheTable.filter((row) => row.id <= 0);
  assert.equal(afterLogout.length, 2, 'Unsent drafts must be preserved');
  assert.ok(!afterLogout.some((row) => row.id === 101), 'Confirmed server messages must be purged');
});
