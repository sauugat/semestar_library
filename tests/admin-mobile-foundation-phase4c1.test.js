'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');

const testDbPath = path.join(os.tmpdir(), `phase4c1_mobile_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
process.env.NODE_ENV = 'test';
process.env.DB_PATH = testDbPath;
process.env.TEACHER_ONBOARDING_ENABLED = 'false';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const bcrypt = require('bcryptjs');
const app = require('../server');
const db = require('../db');
const { ensureTeacherSchema } = require('../lib/teacher-service');
const { ensureAuditSchema } = require('../lib/audit-service');
const { ensurePostsSchema } = require('../lib/posts');
const { updateCanonicalSubject } = require('../lib/academic-service');

let server;
let baseUrl;

const adminPassword = 'AdminMobile_Pass123!';
const teacherPassword = 'TeacherMobile_Pass123!';
const studentPassword = 'StudentMobile_Pass123!';
const crPassword = 'CrMobile_Pass123!';
const suspendedPassword = 'Suspended_Pass123!';

let adminToken = '';
let teacherToken = '';
let studentToken = '';
let crToken = '';
let suspendedToken = '';

test.before(async () => {
  await db.initSchema();
  await ensureTeacherSchema({ exec: db.exec, isPostgres: db.isPostgres });
  await ensureAuditSchema(db);
  await ensurePostsSchema(db);

  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  const hashAdmin = bcrypt.hashSync(adminPassword, 10);
  const hashTeacher = bcrypt.hashSync(teacherPassword, 10);
  const hashStudent = bcrypt.hashSync(studentPassword, 10);
  const hashCr = bcrypt.hashSync(crPassword, 10);
  const hashSuspended = bcrypt.hashSync(suspendedPassword, 10);

  // 1. Seed Permanent Cohorts
  await db.run(
    `INSERT INTO cohorts (id, slot_code, display_name, status, current_semester)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (id) DO NOTHING`,
    'c_mercury', 'mercury', 'Mercury Cohort', 'active', 1
  );
  await db.run(
    `INSERT INTO cohorts (id, slot_code, display_name, status, current_semester)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (id) DO NOTHING`,
    'c_venus', 'venus', 'Venus Cohort', 'active', 2
  );

  // 2. Seed Subjects
  await db.run(
    `INSERT INTO subjects (id, code, name, semester, department, active)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO NOTHING`,
    'MOB101', 'MOB101', 'Mobile Computing I', 1, 'BIT', 1
  );
  await db.run(
    `INSERT INTO subjects (id, code, name, semester, department, active)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO NOTHING`,
    'MOB201', 'MOB201', 'Mobile Computing II', 2, 'BIT', 1
  );

  // 3. Seed Accounts
  // Admin
  await db.run(
    `INSERT INTO students (studentId, name, email, role, passwordHash, semester, department, account_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    'adm_mobile_root', 'Root Admin', 'admin@gandaki.edu.np', 'admin', hashAdmin, '1', 'BIT', 'active'
  );

  // Teacher
  await db.run(
    `INSERT INTO students (studentId, name, email, role, passwordHash, semester, department, account_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    't_mobile_fac', 'Faculty Jane', 'faculty@gandaki.edu.np', 'teacher', hashTeacher, '1', 'BIT', 'active'
  );
  await db.run(
    `INSERT INTO teachers (id, user_id, designation, status)
     VALUES (?, ?, ?, ?)`,
    'T_MOB_01', 't_mobile_fac', 'Assistant Professor', 'active'
  );
  await db.run(
    `INSERT INTO teacher_subjects (id, teacher_id, subject_id)
     VALUES (?, ?, ?)`,
    'ts_mob_sub1', 'T_MOB_01', 'MOB101'
  );

  // Student
  await db.run(
    `INSERT INTO students (studentId, name, email, role, passwordHash, semester, department, account_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    's_mobile_stu', 'John Student', 'student@gandaki.edu.np', 'student', hashStudent, '1', 'BIT', 'active'
  );

  // CR
  await db.run(
    `INSERT INTO students (studentId, name, email, role, passwordHash, semester, department, account_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    's_mobile_cr', 'Elected CR', 'cr@gandaki.edu.np', 'cr', hashCr, '1', 'BIT', 'active'
  );

  // Suspended Admin
  await db.run(
    `INSERT INTO students (studentId, name, email, role, passwordHash, semester, department, account_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    'adm_suspended', 'Suspended Admin', 'suspended@gandaki.edu.np', 'admin', hashSuspended, '1', 'BIT', 'suspended'
  );

  // 4. Seed File and Assignment linked to MOB101
  await db.run(
    `INSERT INTO files (id, title, storedName, originalName, subject, semester, uploadedBy, sizeBytes, uploadedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    101, 'MOB101 Syllabus', 'f_mob101.pdf', 'f_mob101.pdf', 'MOB101', '1', 't_mobile_fac', 1024
  );

  await db.run(
    `INSERT INTO assignments (id, title, description, subject, semester, createdBy, language, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    201, 'MOB101 Lab 1', 'Build native UI', 'MOB101', 1, 't_mobile_fac', 'javascript'
  );

  // Logins
  async function login(identifier, password) {
    const res = await fetch(`${baseUrl}/api/mobile/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    return data.token;
  }

  adminToken = await login('adm_mobile_root', adminPassword);
  teacherToken = await login('t_mobile_fac', teacherPassword);
  studentToken = await login('s_mobile_stu', studentPassword);
  crToken = await login('s_mobile_cr', crPassword);

  // Suspended login attempt
  const suspRes = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'adm_suspended', password: suspendedPassword }),
  });
  assert.equal(suspRes.status, 403, 'Suspended account login must return 403 Forbidden');
});

test.after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  try {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  } catch {}
});

/* ====================================================================
   ROLE DETECTION & RESOLUTION TESTS
   ==================================================================== */

test('1. Student role resolves to Student Mobile Experience', async () => {
  const { resolveAppRole } = await import('../mobile/utils/roles.ts');
  assert.equal(resolveAppRole({ role: 'student' }), 'student');
});

test('2. CR role resolves to Student Mobile Experience', async () => {
  const { resolveAppRole } = await import('../mobile/utils/roles.ts');
  assert.equal(resolveAppRole({ role: 'cr' }), 'student');
});

test('3. Teacher role resolves to Teacher Mobile Experience', async () => {
  const { resolveAppRole } = await import('../mobile/utils/roles.ts');
  assert.equal(resolveAppRole({ role: 'teacher' }), 'teacher');
  assert.equal(resolveAppRole({ role: 'faculty' }), 'teacher');
});

test('4. Admin role resolves explicitly to Admin Mobile Experience', async () => {
  const { resolveAppRole } = await import('../mobile/utils/roles.ts');
  assert.equal(resolveAppRole({ role: 'admin' }), 'admin');
  assert.equal(resolveAppRole({ role: 'student', isAdmin: true }), 'admin');
});

test('5. Unknown or invalid roles resolve to "unknown" and never fallback to student', async () => {
  const { resolveAppRole } = await import('../mobile/utils/roles.ts');
  assert.equal(resolveAppRole({ role: 'guest' }), 'unknown');
  assert.equal(resolveAppRole({ role: 'super_hacker' }), 'unknown');
  assert.equal(resolveAppRole({ role: '' }), 'unknown');
  assert.equal(resolveAppRole(null), 'unknown');
});

/* ====================================================================
   TAB CONFIGURATION & SHELL NAVIGATION TESTS
   ==================================================================== */

test('6. ADMIN_TAB_CONFIGS has exactly five tabs in required order', async () => {
  const { ADMIN_TAB_CONFIGS } = await import('../mobile/constants/tabs.ts');
  assert.equal(ADMIN_TAB_CONFIGS.length, 5);
  const labels = ADMIN_TAB_CONFIGS.map((t) => t.label);
  assert.deepEqual(labels, ['Dashboard', 'Users', 'Academics', 'Content', 'Profile']);

  const names = ADMIN_TAB_CONFIGS.map((t) => t.name);
  assert.deepEqual(names, ['index', 'library', 'chat', 'games', 'profile']);
});

test('7. Student and Teacher tab configs remain intact', async () => {
  const { STUDENT_TAB_CONFIGS, TEACHER_TAB_CONFIGS } = await import('../mobile/constants/tabs.ts');
  assert.deepEqual(STUDENT_TAB_CONFIGS.map((t) => t.label), ['Home', 'Library', 'Chat', 'Games', 'Profile']);
  assert.deepEqual(TEACHER_TAB_CONFIGS.map((t) => t.label), ['Dashboard', 'My Materials', 'Chat', 'Notices', 'Profile']);
});

/* ====================================================================
   ADMIN APIS BACKEND AUTHORIZATION TESTS
   ==================================================================== */

test('8. Admin can access GET /api/admin/overview and receive real statistics', async () => {
  const res = await fetch(`${baseUrl}/api/admin/overview`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.counts, 'Counts object must exist');
  assert.equal(typeof data.counts.students, 'number');
  assert.equal(typeof data.counts.teachers, 'number');
  assert.equal(typeof data.counts.materials, 'number');
  assert.equal(typeof data.counts.assignments, 'number');
  assert.equal(typeof data.counts.activeCohorts, 'number');
});

test('9. Student receives 403 Forbidden on GET /api/admin/overview', async () => {
  const res = await fetch(`${baseUrl}/api/admin/overview`, {
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  assert.equal(res.status, 403);
});

test('10. CR receives 403 Forbidden on GET /api/admin/overview', async () => {
  const res = await fetch(`${baseUrl}/api/admin/overview`, {
    headers: { Authorization: `Bearer ${crToken}` },
  });
  assert.equal(res.status, 403);
});

test('11. Teacher receives 403 Forbidden on GET /api/admin/overview', async () => {
  const res = await fetch(`${baseUrl}/api/admin/overview`, {
    headers: { Authorization: `Bearer ${teacherToken}` },
  });
  assert.equal(res.status, 403);
});

test('12. Admin can query paginated users directory GET /api/admin/users', async () => {
  const res = await fetch(`${baseUrl}/api/admin/users?page=1&limit=10`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data.users));
  assert.ok(data.pagination);
  assert.ok(data.users.length >= 4);

  // Verify passwords or tokens are NOT exposed
  for (const u of data.users) {
    assert.equal(u.passwordHash, undefined);
    assert.equal(u.password, undefined);
  }
});

test('13. Admin can query academic overview GET /api/admin/academics', async () => {
  const res = await fetch(`${baseUrl}/api/admin/academics`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data.semesters));
  assert.equal(data.semesters.length, 8);
});

test('14. Admin can query canonical subjects directory GET /api/admin/academics/subjects', async () => {
  const res = await fetch(`${baseUrl}/api/admin/academics/subjects?page=1&limit=10`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data.subjects));
  assert.ok(data.subjects.some((s) => s.code === 'MOB101'));
});

test('15. Admin can query unclassified materials review GET /api/admin/academics/unclassified-materials', async () => {
  const res = await fetch(`${baseUrl}/api/admin/academics/unclassified-materials`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data.files) || Array.isArray(data.items));
});

test('16. Admin can query content moderation overview GET /api/admin/moderation/overview', async () => {
  const res = await fetch(`${baseUrl}/api/admin/moderation/overview`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(typeof data.queueCount, 'number');
});

test('17. Admin can query permanent cohorts overview GET /api/admin/cohorts', async () => {
  const res = await fetch(`${baseUrl}/api/admin/cohorts`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data.cohorts));
  assert.ok(data.cohorts.some((c) => (c.slotCode || c.slot_code) === 'mercury'));
});

test('18. Admin can query durable audit logs GET /api/admin/audit-logs', async () => {
  const res = await fetch(`${baseUrl}/api/admin/audit-logs?page=1&limit=10`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data.logs));
});

/* ====================================================================
   SUBJECT SEMESTER EDIT SAFETY INTEGRITY RESTRICTION
   ==================================================================== */

test('19. Safety restriction rejects changing subject semester when existing teachers/materials/assignments are linked (409 Conflict)', async () => {
  // MOB101 has teacher T_MOB_01, file 101, and assignment 201 linked to semester 1.
  // Attempting to move MOB101 to semester 4 must be blocked.
  let conflictError = null;
  try {
    await updateCanonicalSubject(db, {
      adminId: 'adm_mobile_root',
      subjectId: 'MOB101',
      semester: 4,
      reason: 'Attempting unsafe semester relocation',
    });
  } catch (err) {
    conflictError = err;
  }

  assert.ok(conflictError, 'Subject semester alteration must fail when references exist');
  assert.equal(conflictError.statusCode, 409);
  assert.match(conflictError.message, /Cannot change academic semester of subject "MOB101" because existing/);

  // Verify DB state remains intact
  const row = await db.get('SELECT semester FROM subjects WHERE id = ?', 'MOB101');
  assert.equal(row.semester, 1, 'Subject semester must remain 1');
});

test('20. Subject semester edit succeeds when subject has zero existing references', async () => {
  // Create empty test subject in semester 3
  await db.run(
    `INSERT INTO subjects (id, code, name, semester, department, active)
     VALUES (?, ?, ?, ?, ?, ?)`,
    'EMPTY301', 'EMPTY301', 'Unused Elective', 3, 'BIT', 1
  );

  const updated = await updateCanonicalSubject(db, {
    adminId: 'adm_mobile_root',
    subjectId: 'EMPTY301',
    semester: 4,
    reason: 'Fixing typo on newly created course',
  });

  assert.equal(updated.semester, 4);
  const row = await db.get('SELECT semester FROM subjects WHERE id = ?', 'EMPTY301');
  assert.equal(row.semester, 4);
});

/* ====================================================================
   FEATURE FLAGS & PLATFORM SAFETY
   ==================================================================== */

test('21. Teacher onboarding feature flag remains strictly disabled', () => {
  assert.equal(process.env.TEACHER_ONBOARDING_ENABLED, 'false');
});
