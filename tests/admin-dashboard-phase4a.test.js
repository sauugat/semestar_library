'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

const testDbPath = path.join(os.tmpdir(), `admin_phase4a_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
process.env.NODE_ENV = 'test';
process.env.DB_PATH = testDbPath;
process.env.SEMESTER_DB_SKIP_INIT = '1';

const app = require('../server');
const db = require('../db');
const {
  ensureTeacherSchema,
  seedCanonicalSubjects,
  isTeacherOnboardingEnabled
} = require('../lib/teacher-service');

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

let adminToken = '';
let studentToken = '';
let teacherToken = '';
let crToken = '';

test.before(async () => {
  await db.initSchema();
  await ensureTeacherSchema({ exec: db.exec, isPostgres: db.isPostgres });
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
  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, department, cohort_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'stu_p4_2', 'stu_two', 'Student Bob', 'stu2@gandaki.edu.np', 'student', hashStudent, '2', 'BIT', 'cohort_mercury'
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

  // 6. Seed Materials & Assignments
  await db.run(
    `INSERT INTO files (title, originalName, storedName, subject, chapter, semester, uploadedBy, sizeBytes, uploadedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'Calculus Lecture 1 Notes', 'calc1.pdf', 'calc1_store.pdf', 'Engineering Mathematics I', 'Limits', '1', 'tea_p4', 1048576, new Date().toISOString()
  );

  await db.run(
    `INSERT INTO assignments (title, description, language, subject, semester, deadline, createdBy, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    'Limits Problem Set', 'Solve problems 1-10', 'math', 'Engineering Mathematics I', '1', '2026-11-01', 'tea_p4', new Date().toISOString()
  );

  // 7. Seed Posts (Discussion, Notice, and Student-Only Cohort post)
  await db.run(
    `INSERT INTO posts (user_id, content, type, category, target_all_semesters, audience_scope, semester_no, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    'tea_p4', 'Welcome to Engineering Mathematics I class forum', 'notice', 'notice', 1, 'public', 1, new Date().toISOString()
  );

  await db.run(
    `INSERT INTO posts (user_id, content, type, category, target_all_semesters, audience_scope, semester_no, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    'stu_p4_1', 'Anyone want to form a study group for Calc?', 'status', 'general', 0, 'student_only', 1, new Date().toISOString()
  );

  // 8. Authenticate sessions via Web (/api/login)
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

  // Mobile tokens
  const mobAdmin = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: 'admin_p4', password: adminPassword })
  });
  adminToken = (await mobAdmin.json()).token;

  const mobStu = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: 'stu_p4_1', password: studentPassword })
  });
  studentToken = (await mobStu.json()).token;

  const mobTea = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: 'tea_p4', password: teacherPassword })
  });
  teacherToken = (await mobTea.json()).token;

  const mobCR = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: 'cr_p4', password: crPassword })
  });
  crToken = (await mobCR.json()).token;
});

test.after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  try {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  } catch (e) {}
});

// ==============================================================================
// 1. Admin can access dashboard
// ==============================================================================
test('1. Admin can access dashboard website and API', async () => {
  // Page access with admin cookie
  const pageRes = await fetch(`${baseUrl}/admin-dashboard.html`, {
    headers: { Cookie: adminCookie },
    redirect: 'manual'
  });
  assert.equal(pageRes.status, 200, 'Admin page should return 200');
  const text = await pageRes.text();
  assert.ok(text.includes('Admin Control Center'), 'Page contains admin header');
  assert.ok(text.includes('data-tab="overview"'), 'Page contains tabs');

  // API access
  const apiRes = await fetch(`${baseUrl}/api/admin/overview`, {
    headers: { Cookie: adminCookie }
  });
  assert.equal(apiRes.status, 200, 'Admin API should return 200');
  const body = await apiRes.json();
  assert.ok(body.counts, 'Admin API returns counts object');
  assert.equal(body.admin.role, 'admin', 'Returned admin role matches');
});

// ==============================================================================
// 2. Student cannot access dashboard
// ==============================================================================
test('2. Student cannot access dashboard page or API (403 / redirect)', async () => {
  // Direct page URL redirects student
  const pageRes = await fetch(`${baseUrl}/admin-dashboard.html`, {
    headers: { Cookie: studentCookie },
    redirect: 'manual'
  });
  assert.equal(pageRes.status, 302, 'Student accessing admin page should be redirected');
  assert.ok(pageRes.headers.get('location').includes('dashboard.html'), 'Redirects to student dashboard');

  // API returns 403 Forbidden
  const apiRes = await fetch(`${baseUrl}/api/admin/overview`, {
    headers: { Cookie: studentCookie }
  });
  assert.equal(apiRes.status, 403, 'Student accessing admin API gets 403 Forbidden');
});

// ==============================================================================
// 3. Teacher cannot access dashboard
// ==============================================================================
test('3. Teacher cannot access dashboard page or API (403 / redirect)', async () => {
  const pageRes = await fetch(`${baseUrl}/admin-dashboard.html`, {
    headers: { Cookie: teacherCookie },
    redirect: 'manual'
  });
  assert.equal(pageRes.status, 302, 'Teacher accessing admin page should be redirected');
  assert.ok(pageRes.headers.get('location').includes('teacher-dashboard.html'), 'Redirects to teacher dashboard');

  const apiRes = await fetch(`${baseUrl}/api/admin/overview`, {
    headers: { Cookie: teacherCookie }
  });
  assert.equal(apiRes.status, 403, 'Teacher accessing admin API gets 403 Forbidden');
});

// ==============================================================================
// 4. CR cannot access dashboard
// ==============================================================================
test('4. CR cannot access dashboard page or API (403 / redirect)', async () => {
  const pageRes = await fetch(`${baseUrl}/admin-dashboard.html`, {
    headers: { Cookie: crCookie },
    redirect: 'manual'
  });
  assert.equal(pageRes.status, 302, 'CR accessing admin page should be redirected');
  assert.ok(pageRes.headers.get('location').includes('dashboard.html'), 'Redirects to student dashboard');

  const apiRes = await fetch(`${baseUrl}/api/admin/overview`, {
    headers: { Cookie: crCookie }
  });
  assert.equal(apiRes.status, 403, 'CR accessing admin API gets 403 Forbidden');
});

// ==============================================================================
// 5. Overview statistics are accurate
// ==============================================================================
test('5. Overview statistics are accurate real queries', async () => {
  const res = await fetch(`${baseUrl}/api/admin/overview`, {
    headers: { Cookie: adminCookie }
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  const c = data.counts;

  const expectedStudentsRow = await db.get("SELECT COUNT(*) AS count FROM students WHERE COALESCE(role, 'student') = 'student'");
  const expectedTeachersRow = await db.get("SELECT COUNT(*) AS count FROM students WHERE role = 'teacher'");
  const expectedCRsRow = await db.get("SELECT COUNT(*) AS count FROM students WHERE role = 'cr'");
  const expectedAdminsRow = await db.get("SELECT COUNT(*) AS count FROM students WHERE role = 'admin'");

  assert.equal(c.students, Number(expectedStudentsRow.count), 'Total students count matches real DB query');
  assert.equal(c.teachers, Number(expectedTeachersRow.count), 'Total teachers count matches real DB query');
  assert.equal(c.crs, Number(expectedCRsRow.count), 'Total CRs count matches real DB query');
  assert.equal(c.admins, Number(expectedAdminsRow.count), 'Total admins count matches real DB query');
  assert.equal(c.posts, 2, 'Total posts matches seeded 2');
  assert.equal(c.notices, 1, 'Total notices matches seeded 1');
  assert.equal(c.materials, 1, 'Total materials matches seeded 1');
  assert.equal(c.assignments, 1, 'Total assignments matches seeded 1');
  assert.equal(c.activeCohorts, 1, 'Active cohorts count matches seeded 1');
});

// ==============================================================================
// 6. User listings are paginated
// ==============================================================================
test('6. User listings are paginated and exclude sensitive password/tokens', async () => {
  const res = await fetch(`${baseUrl}/api/admin/users?page=1&limit=2`, {
    headers: { Cookie: adminCookie }
  });
  assert.equal(res.status, 200);
  const data = await res.json();

  assert.equal(data.users.length, 2, 'Limit of 2 respected');
  assert.equal(data.pagination.limit, 2);
  assert.equal(data.pagination.page, 1);
  assert.ok(data.pagination.total >= 5, 'Total users reflect all seeded accounts');
  assert.equal(data.pagination.hasNextPage, true, 'Has next page is true');

  // Verify safe projection: NO password hashes, NO auth tokens
  for (const user of data.users) {
    assert.equal(user.passwordHash, undefined, 'passwordHash must never be exposed');
    assert.equal(user.supabase_uid, undefined, 'supabase_uid must not be exposed');
    assert.ok(user.studentId, 'studentId is present');
    assert.ok(user.name, 'name is present');
    assert.ok(user.role, 'role is present');
  }
});

// ==============================================================================
// 7. Existing teacher management works
// ==============================================================================
test('7. Existing teacher management APIs remain functional', async () => {
  // Check admin teacher-invites endpoint
  const res = await fetch(`${baseUrl}/api/admin/teacher-invites`, {
    headers: { Cookie: adminCookie }
  });
  assert.equal(res.status, 200, 'Existing teacher invites endpoint returns 200');

  // Check subject assignment list for teacher
  const tRes = await fetch(`${baseUrl}/api/admin/teachers/T_UUID_P4/subjects`, {
    headers: { Cookie: adminCookie }
  });
  assert.equal(tRes.status, 200, 'Existing teacher subjects endpoint returns 200');
  const tBody = await tRes.json();
  assert.ok(Array.isArray(tBody.subjects), 'Assigned subjects is an array');
  assert.equal(tBody.subjects.length, 1);
  assert.ok(tBody.subjects[0].id === 'BCT111' || tBody.subjects[0].code === 'BCT111');
});

// ==============================================================================
// 8. Existing cohort management works
// ==============================================================================
test('8. Existing cohort management APIs remain functional', async () => {
  const res = await fetch(`${baseUrl}/api/admin/cohorts`, {
    headers: { Cookie: adminCookie }
  });
  assert.equal(res.status, 200, 'Existing cohorts endpoint returns 200');
  const body = await res.json();
  assert.ok(Array.isArray(body.cohorts), 'Cohorts is an array');
  assert.ok(body.cohorts.some(c => c.slotCode === 'mercury' || c.slot_code === 'mercury'), 'Contains mercury cohort');
});

// ==============================================================================
// 9. Academic overview respects authorization
// ==============================================================================
test('9. Academic overview respects authorization and returns semesters 1-8 breakdown', async () => {
  // Admin access
  const res = await fetch(`${baseUrl}/api/admin/academics`, {
    headers: { Cookie: adminCookie }
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.semesters.length, 8, 'Covers 8 semesters');
  assert.equal(data.semesters[0].materialsCount, 1, 'Semester 1 has 1 material');
  assert.equal(data.semesters[0].assignmentsCount, 1, 'Semester 1 has 1 assignment');

  // Student forbidden
  const stuRes = await fetch(`${baseUrl}/api/admin/academics`, {
    headers: { Cookie: studentCookie }
  });
  assert.equal(stuRes.status, 403);
});

// ==============================================================================
// 10. Content overview respects permissions
// ==============================================================================
test('10. Content overview respects permissions', async () => {
  // Admin access
  const res = await fetch(`${baseUrl}/api/admin/content`, {
    headers: { Cookie: adminCookie }
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.posts.length, 2);

  // Teacher forbidden
  const teaRes = await fetch(`${baseUrl}/api/admin/content`, {
    headers: { Cookie: teacherCookie }
  });
  assert.equal(teaRes.status, 403);
});

// ==============================================================================
// 11. Student-only posts remain separate
// ==============================================================================
test('11. Student-only posts remain separate with audience scope tracking', async () => {
  // Query content filtered by audience=student_only
  const res = await fetch(`${baseUrl}/api/admin/content?audience=student_only`, {
    headers: { Cookie: adminCookie }
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.posts.length, 1);
  assert.equal(data.posts[0].audience_scope, 'student_only');
  assert.ok(data.posts[0].content.includes('study group'));

  // Public filter
  const pubRes = await fetch(`${baseUrl}/api/admin/content?audience=public`, {
    headers: { Cookie: adminCookie }
  });
  assert.equal(pubRes.status, 200);
  const pubData = await pubRes.json();
  assert.equal(pubData.posts.length, 1);
  assert.equal(pubData.posts[0].audience_scope, 'public');
});

// ==============================================================================
// 12. Existing student dashboard works
// ==============================================================================
test('12. Existing student dashboard works and serves student dashboard shell', async () => {
  const res = await fetch(`${baseUrl}/dashboard.html`, {
    headers: { Cookie: studentCookie }
  });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(text.length > 500, 'Returns dashboard html shell');
});

// ==============================================================================
// 13. Existing teacher dashboard works
// ==============================================================================
test('13. Existing teacher dashboard works and serves teacher dashboard shell', async () => {
  const res = await fetch(`${baseUrl}/teacher-dashboard.html`, {
    headers: { Cookie: teacherCookie }
  });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(text.length > 500, 'Returns teacher dashboard html shell');
});

// ==============================================================================
// 14. No destructive database changes
// ==============================================================================
test('14. No destructive database changes: critical tables intact', async () => {
  const tables = ['students', 'teachers', 'teacher_subjects', 'teacher_invites', 'cohorts', 'posts', 'files', 'assignments'];
  for (const tbl of tables) {
    const row = await db.get(`SELECT COUNT(*) AS count FROM ${tbl}`);
    assert.ok(row !== undefined, `Table ${tbl} must exist and be readable`);
  }
});

// ==============================================================================
// 15. Teacher onboarding remains disabled
// ==============================================================================
test('15. Teacher onboarding remains disabled', async () => {
  assert.equal(isTeacherOnboardingEnabled(), false, 'isTeacherOnboardingEnabled() returns false');

  const res = await fetch(`${baseUrl}/api/teacher/onboarding/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'intruder@teacher.edu', name: 'Dr Fake' })
  });
  assert.equal(res.status, 503, 'Teacher onboarding endpoint returns 503 Service Unavailable when disabled');
  const body = await res.json();
  assert.ok(body.error || body.message, 'Returns onboarding disabled message');
  assert.ok((body.message || '').includes('disabled'), 'Message indicates onboarding disabled');
});
