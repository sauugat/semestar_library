'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

const testDbPath = path.join(os.tmpdir(), `admin_audit_p4b1_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
process.env.NODE_ENV = 'test';
process.env.DB_PATH = testDbPath;
process.env.SEMESTER_DB_SKIP_INIT = '1';

const app = require('../server');
const db = require('../db');
const {
  ensureTeacherSchema,
  seedCanonicalSubjects,
  isTeacherOnboardingEnabled,
  assignTeacherSubject,
  removeTeacherSubject
} = require('../lib/teacher-service');
const {
  ensureAuditSchema,
  recordAdminAudit,
  sanitizeAuditData,
  queryAdminAuditLogs
} = require('../lib/audit-service');

let server;
let baseUrl;

// Test Passwords
const adminPassword = 'Admin_Secret99!';
const studentPassword = 'Student_Secret99!';
const crPassword = 'CR_Secret99!';
const teacherPassword = 'Teacher_Secret99!';

let adminCookie = '';
let studentCookie = '';
let crCookie = '';
let teacherCookie = '';

test.before(async () => {
  await db.initSchema();
  await ensureTeacherSchema({ exec: db.exec, isPostgres: db.isPostgres });
  await ensureAuditSchema(db);
  await seedCanonicalSubjects(db);

  // Start HTTP server on ephemeral port
  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  const hashAdmin = bcrypt.hashSync(adminPassword, 10);
  const hashStudent = bcrypt.hashSync(studentPassword, 10);
  const hashCR = bcrypt.hashSync(crPassword, 10);
  const hashTeacher = bcrypt.hashSync(teacherPassword, 10);

  // 1. Seed Admin
  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, department)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    'admin_p4', 'admin_phase4', 'Master Admin', 'admin@gandaki.edu.np', 'admin', hashAdmin, null, 'ADMIN'
  );

  // 2. Seed Cohort slot
  await db.run(
    `INSERT INTO cohorts (id, slot_code, display_name, current_semester, status)
     VALUES (?, ?, ?, ?, ?)`,
    'cohort_mercury', 'mercury', 'Batch 2025 (Mercury)', 1, 'active'
  );

  // 3. Seed Students
  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, department, cohort_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'stu_p4_1', 'stu_one', 'Student Alice', 'stu1@gandaki.edu.np', 'student', hashStudent, '1', 'BIT', 'cohort_mercury'
  );

  // 4. Seed CR
  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, department, cohort_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'cr_p4', 'cr_charlie', 'CR Charlie', 'cr@gandaki.edu.np', 'cr', hashCR, '1', 'BIT', 'cohort_mercury'
  );

  // 5. Seed Teacher
  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, department)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    'tea_p4', 'prof_david', 'Prof David', 'david@gandaki.edu.np', 'teacher', hashTeacher, null, 'BIT'
  );
  await db.run(
    `INSERT INTO teachers (id, user_id, designation, status)
     VALUES (?, ?, ?, ?)`,
    'T_UUID_P4', 'tea_p4', 'Senior Lecturer', 'active'
  );
  await db.run(
    `INSERT INTO teacher_subjects (id, teacher_id, subject_id)
     VALUES (?, ?, ?)`,
    'ts_p4_1', 'T_UUID_P4', 'BCT111'
  );

  // Authenticate sessions via Web (/api/login)
  const [resAdmin, resStu, resCR, resTea] = await Promise.all([
    fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: 'admin_p4', password: adminPassword })
    }),
    fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: 'stu_p4_1', password: studentPassword })
    }),
    fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: 'cr_p4', password: crPassword })
    }),
    fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: 'tea_p4', password: teacherPassword })
    })
  ]);

  adminCookie = resAdmin.headers.get('set-cookie') || '';
  studentCookie = resStu.headers.get('set-cookie') || '';
  crCookie = resCR.headers.get('set-cookie') || '';
  teacherCookie = resTea.headers.get('set-cookie') || '';
});

test.after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await db.close();
  try {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  } catch {}
});

// ============================================================================
// REQUIREMENT 1: Non-admin users cannot read audit logs
// ============================================================================
test('1. Authorization: Non-admin users cannot read audit logs', async () => {
  // Unauthenticated -> 401
  const resUnauth = await fetch(`${baseUrl}/api/admin/activity`);
  assert.equal(resUnauth.status, 401, 'Unauthenticated request must return 401');

  // Student -> 403
  const resStudent = await fetch(`${baseUrl}/api/admin/activity`, {
    headers: { Cookie: studentCookie }
  });
  assert.equal(resStudent.status, 403, 'Student request must return 403');

  // CR -> 403
  const resCR = await fetch(`${baseUrl}/api/admin/activity`, {
    headers: { Cookie: crCookie }
  });
  assert.equal(resCR.status, 403, 'CR request must return 403');

  // Teacher -> 403
  const resTeacher = await fetch(`${baseUrl}/api/admin/activity`, {
    headers: { Cookie: teacherCookie }
  });
  assert.equal(resTeacher.status, 403, 'Teacher request must return 403');

  // Admin -> 200
  const resAdmin = await fetch(`${baseUrl}/api/admin/activity`, {
    headers: { Cookie: adminCookie }
  });
  assert.equal(resAdmin.status, 200, 'Admin request must return 200');
  const body = await resAdmin.json();
  assert.equal(body.auditTableAvailable, true, 'auditTableAvailable must be true');
  assert.ok(Array.isArray(body.logs), 'logs must be an array');
});

// ============================================================================
// REQUIREMENT 2: Non-admin users cannot write audit logs
// ============================================================================
test('2. Authorization: Non-admin users cannot write audit logs (no client writes)', async () => {
  // No arbitrary client write endpoint for activity logs
  const resPost = await fetch(`${baseUrl}/api/admin/activity`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: adminCookie
    },
    body: JSON.stringify({ action: 'custom_hack', details: 'arbitrary log' })
  });
  assert.equal(resPost.status, 404, 'Direct POST to activity logs must be 404');

  // Student cannot trigger administrative teacher subject mutations
  const resStuMutate = await fetch(`${baseUrl}/api/admin/teachers/T_UUID_P4/subjects`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: studentCookie
    },
    body: JSON.stringify({ subjectCode: 'BCT112' })
  });
  assert.equal(resStuMutate.status, 403, 'Student cannot trigger teacher subject assignment');
});

// ============================================================================
// REQUIREMENT 3: Teacher assignment generates durable audit data
// ============================================================================
test('3. Audit generation: Teacher subject assignment creates audit record', async () => {
  const res = await fetch(`${baseUrl}/api/admin/teachers/T_UUID_P4/subjects`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: adminCookie
    },
    body: JSON.stringify({ subjectCode: 'CIT111' })
  });
  assert.equal(res.status, 201, 'Assign subject must return 201');

  // Verify record in admin_audit_logs
  const auditRow = await db.get(
    `SELECT * FROM admin_audit_logs WHERE action = 'teacher_subject_assigned' AND entity_id = 'T_UUID_P4' ORDER BY created_at DESC LIMIT 1`
  );
  assert.ok(auditRow, 'Durable audit row must exist in admin_audit_logs');
  assert.equal(auditRow.entity_type, 'teacher_subject');
  assert.equal(auditRow.actor_user_id, 'admin_p4');

  const meta = JSON.parse(auditRow.metadata || '{}');
  assert.equal(meta.subjectCode, 'CIT111', 'Metadata must record assigned subjectCode');
});

// ============================================================================
// REQUIREMENT 4: Teacher subject removal generates durable audit data
// ============================================================================
test('4. Audit generation: Teacher subject removal creates audit record', async () => {
  const res = await fetch(`${baseUrl}/api/admin/teachers/T_UUID_P4/subjects/CIT111`, {
    method: 'DELETE',
    headers: { Cookie: adminCookie }
  });
  assert.equal(res.status, 200, 'Remove subject must return 200');

  const auditRow = await db.get(
    `SELECT * FROM admin_audit_logs WHERE action = 'teacher_subject_removed' AND entity_id = 'T_UUID_P4' ORDER BY created_at DESC LIMIT 1`
  );
  assert.ok(auditRow, 'Durable audit row must exist for removal');
  assert.equal(auditRow.entity_type, 'teacher_subject');
  assert.equal(auditRow.actor_user_id, 'admin_p4');

  const before = JSON.parse(auditRow.before_state || '{}');
  assert.equal(before.subjectCode, 'CIT111', 'Before state must record removed subjectCode');
});

// ============================================================================
// REQUIREMENT 5: Actor identity comes from authentication
// ============================================================================
test('5. Identity: Actor identity strictly derives from authenticated session', async () => {
  const auditRows = await db.all(
    `SELECT actor_user_id FROM admin_audit_logs WHERE entity_id = 'T_UUID_P4'`
  );
  assert.ok(auditRows.length >= 2, 'Audit rows must exist');
  for (const row of auditRows) {
    assert.equal(row.actor_user_id, 'admin_p4', 'Actor must match authenticated admin');
  }
});

// ============================================================================
// REQUIREMENT 6: Spoofed actor IDs are ignored
// ============================================================================
test('6. Security: Spoofed actor IDs in body/query are completely ignored', async () => {
  const res = await fetch(`${baseUrl}/api/admin/teachers/T_UUID_P4/subjects`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: adminCookie
    },
    body: JSON.stringify({
      subjectCode: 'CIT112',
      actor_user_id: 'spoofed_imposter_user',
      actorUserId: 'hacker_actor_99',
      adminId: 'fake_admin'
    })
  });
  assert.equal(res.status, 201, 'Subject assignment must succeed');

  const auditRow = await db.get(
    `SELECT * FROM admin_audit_logs WHERE action = 'teacher_subject_assigned' AND metadata LIKE '%CIT112%'`
  );
  assert.ok(auditRow, 'Audit row for CIT112 must exist');
  assert.equal(auditRow.actor_user_id, 'admin_p4', 'Actor must remain authenticated admin, ignoring spoofed values');
  assert.notEqual(auditRow.actor_user_id, 'spoofed_imposter_user');
  assert.notEqual(auditRow.actor_user_id, 'hacker_actor_99');
});

// ============================================================================
// REQUIREMENT 7: Sensitive values are never logged (Zero Credential Leakage)
// ============================================================================
test('7. Sanitization: Sensitive passwords, hashes, and tokens are never written to audit logs', async () => {
  // 1. Create a teacher invite
  const resInvite = await fetch(`${baseUrl}/api/admin/teacher-invites`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: adminCookie
    },
    body: JSON.stringify({ count: 1 })
  });
  assert.equal(resInvite.status, 201, 'Teacher invite creation must return 201');
  const inviteData = await resInvite.json();
  const inviteId = inviteData.invites[0].id;
  const rawPlaintextPassword = inviteData.invites[0].temporary_password;

  // Verify the invite audit record does NOT contain the plaintext password
  const inviteAudit = await db.get(
    `SELECT * FROM admin_audit_logs WHERE action = 'teacher_invite_created' AND entity_id = ?`,
    inviteId
  );
  assert.ok(inviteAudit, 'Teacher invite audit record must exist');
  assert.ok(!JSON.stringify(inviteAudit).includes(rawPlaintextPassword), 'Raw password must never appear in audit log');

  // 2. Regenerate password
  const resRegen = await fetch(`${baseUrl}/api/admin/teacher-invites/${inviteId}/regenerate-password`, {
    method: 'POST',
    headers: { Cookie: adminCookie }
  });
  assert.equal(resRegen.status, 200, 'Password regeneration must return 200');
  const regenData = await resRegen.json();
  const newPlaintext = regenData.temporary_password;

  const regenAudit = await db.get(
    `SELECT * FROM admin_audit_logs WHERE action = 'teacher_invite_password_regenerated' AND entity_id = ?`,
    inviteId
  );
  assert.ok(regenAudit, 'Regenerate audit record must exist');
  assert.ok(!JSON.stringify(regenAudit).includes(newPlaintext), 'Regenerated password must never appear in audit log');

  // 3. Test sanitizeAuditData unit function
  const dirty = {
    password: 'super_secret_pw',
    temporaryPassword: 'temp_pw_123',
    passwordHash: '$2a$10$abcdef...',
    sessionToken: 'jwt.token.here',
    apiKey: 'secret_key',
    normalField: 'safe_value',
    nested: {
      adminPassword: 'nested_secret',
      count: 42
    }
  };
  const clean = sanitizeAuditData(dirty);
  assert.equal(clean.password, '[REDACTED]');
  assert.equal(clean.temporaryPassword, '[REDACTED]');
  assert.equal(clean.passwordHash, '[REDACTED]');
  assert.equal(clean.sessionToken, '[REDACTED]');
  assert.equal(clean.apiKey, '[REDACTED]');
  assert.equal(clean.normalField, 'safe_value');
  assert.equal(clean.nested.adminPassword, '[REDACTED]');
  assert.equal(clean.nested.count, 42);
});

// ============================================================================
// REQUIREMENT 8: Activity listing is paginated
// ============================================================================
test('8. Activity Viewer: Activity endpoint supports pagination', async () => {
  const res = await fetch(`${baseUrl}/api/admin/activity?page=1&limit=2`, {
    headers: { Cookie: adminCookie }
  });
  assert.equal(res.status, 200, 'Paginated activity request must return 200');
  const data = await res.json();

  assert.equal(data.pagination.page, 1);
  assert.equal(data.pagination.limit, 2);
  assert.ok(data.pagination.total >= 4, 'Total logs must be >= 4');
  assert.ok(data.pagination.totalPages >= 2, 'Total pages must be >= 2');
  assert.equal(data.logs.length, 2, 'Returned logs count must equal limit of 2');
  assert.equal(data.pagination.hasNextPage, true);

  // Page 2
  const resPage2 = await fetch(`${baseUrl}/api/admin/activity?page=2&limit=2`, {
    headers: { Cookie: adminCookie }
  });
  assert.equal(resPage2.status, 200);
  const data2 = await resPage2.json();
  assert.equal(data2.pagination.page, 2);
  assert.equal(data2.pagination.hasPrevPage, true);
  assert.notEqual(data2.logs[0].id, data.logs[0].id, 'Page 2 must return different log records');
});

// ============================================================================
// REQUIREMENT 9: Filtering works correctly
// ============================================================================
test('9. Filtering: Activity logs can be filtered by action and actor', async () => {
  // Filter by action
  const resAction = await fetch(`${baseUrl}/api/admin/activity?action=teacher_subject_assigned`, {
    headers: { Cookie: adminCookie }
  });
  assert.equal(resAction.status, 200);
  const actionData = await resAction.json();
  assert.ok(actionData.logs.length > 0, 'Must return assigned subject events');
  for (const log of actionData.logs) {
    assert.equal(log.action, 'teacher_subject_assigned');
  }

  // Filter by actor
  const resActor = await fetch(`${baseUrl}/api/admin/activity?actor=admin_p4`, {
    headers: { Cookie: adminCookie }
  });
  assert.equal(resActor.status, 200);
  const actorData = await resActor.json();
  assert.ok(actorData.logs.length > 0, 'Must return logs by admin_p4');
  for (const log of actorData.logs) {
    assert.equal(log.actor_user_id, 'admin_p4');
  }
});

// ============================================================================
// REQUIREMENT 10: Critical mutations cannot silently succeed if auditing fails
// ============================================================================
test('10. Atomicity & Invariants: Required audit failure aborts mutation', async () => {
  // Direct audit call with required=true and missing actor must throw
  await assert.rejects(
    async () => {
      await recordAdminAudit(db, {
        actorUserId: '', // Invalid actor
        action: 'teacher_subject_assigned',
        required: true
      });
    },
    /Valid administrator actor identity is required/
  );

  // Critical assignTeacherSubject with missing adminId must abort and reject
  await assert.rejects(
    async () => {
      await assignTeacherSubject(db, {
        adminId: '', // Invalid actor
        teacherId: 'T_UUID_P4',
        subjectIdOrCode: 'CIT113'
      });
    },
    /Required audit record could not be written|Valid administrator actor identity is required/
  );

  // Verify that CIT113 was NOT committed to teacher_subjects
  const assigned = await db.get(
    `SELECT * FROM teacher_subjects WHERE teacher_id = 'T_UUID_P4' AND subject_id = 'CIT113'`
  );
  assert.equal(assigned, null, 'Un-audited subject assignment must NOT be committed to database');
});

// ============================================================================
// REQUIREMENT 11: Existing teacher management works
// ============================================================================
test('11. Regression: Existing teacher management functionality works', async () => {
  const resList = await fetch(`${baseUrl}/api/admin/teachers/assignments`, {
    headers: { Cookie: adminCookie }
  });
  assert.equal(resList.status, 200, 'Teacher assignments list must return 200');
  const data = await resList.json();
  assert.ok(Array.isArray(data.teachers), 'Must return teachers array');

  const resSubjects = await fetch(`${baseUrl}/api/admin/subjects`, {
    headers: { Cookie: adminCookie }
  });
  assert.equal(resSubjects.status, 200, 'Canonical subjects list must return 200');
  const subData = await resSubjects.json();
  assert.ok(Array.isArray(subData.subjects), 'Must return subjects array');
});

// ============================================================================
// REQUIREMENT 12: Existing cohort management works
// ============================================================================
test('12. Regression: Existing cohort management functionality works', async () => {
  const resCohorts = await fetch(`${baseUrl}/api/admin/cohorts`, {
    headers: { Cookie: adminCookie }
  });
  assert.equal(resCohorts.status, 200, 'Cohorts list must return 200');
  const cohortsData = await resCohorts.json();
  assert.ok(Array.isArray(cohortsData.cohorts), 'Must return cohorts array');
});

// ============================================================================
// REQUIREMENT 13: Student and teacher dashboards work
// ============================================================================
test('13. Regression: Student and teacher dashboards continue to function', async () => {
  const resTeacherDash = await fetch(`${baseUrl}/api/teacher/dashboard-init`, {
    headers: { Cookie: teacherCookie }
  });
  assert.equal(resTeacherDash.status, 200, 'Teacher dashboard-init must return 200');
  const teacherDash = await resTeacherDash.json();
  assert.ok(teacherDash.teacher || teacherDash.user, 'Teacher user or profile must be returned');
  assert.ok(Array.isArray(teacherDash.assignedSubjects), 'assignedSubjects must be returned');

  const resAdminOverview = await fetch(`${baseUrl}/api/admin/overview`, {
    headers: { Cookie: adminCookie }
  });
  assert.equal(resAdminOverview.status, 200, 'Admin overview must return 200');
  const overview = await resAdminOverview.json();
  assert.ok(overview.counts, 'Admin counts must be returned');
});

// ============================================================================
// REQUIREMENT 14: No production schema changes occur
// ============================================================================
test('14. Safety: Proposed SQL migration file is prepared, idempotent, and unapplied to production', () => {
  const migrationPath = path.join(__dirname, '..', 'migrations', '20261012_admin_audit_logs.sql');
  assert.ok(fs.existsSync(migrationPath), 'Migration file must exist');

  const migrationContent = fs.readFileSync(migrationPath, 'utf8');
  assert.ok(migrationContent.includes('CREATE TABLE IF NOT EXISTS admin_audit_logs'), 'Must be forward-only CREATE TABLE IF NOT EXISTS');
  assert.ok(migrationContent.includes('CREATE INDEX IF NOT EXISTS'), 'Must be idempotent with CREATE INDEX IF NOT EXISTS');
  assert.ok(!migrationContent.toLowerCase().includes('drop table'), 'Must not contain DROP TABLE');
  assert.ok(!migrationContent.toLowerCase().includes('alter table'), 'Must not contain destructive ALTER TABLE');
});

// ============================================================================
// REQUIREMENT 15: Teacher onboarding remains disabled
// ============================================================================
test('15. Security Invariant: Teacher onboarding remains disabled platform-wide', async () => {
  assert.equal(isTeacherOnboardingEnabled(), false, 'isTeacherOnboardingEnabled() must be false');

  const resClaim = await fetch(`${baseUrl}/api/teacher/onboarding/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'test_token', permanentUsername: 'teacher_bob' })
  });
  assert.equal(resClaim.status, 503, 'Claim attempt must return 503 Service Unavailable');
  const body = await resClaim.json();
  assert.ok(body.message.includes('disabled'), 'Must state teacher onboarding is disabled');
});
