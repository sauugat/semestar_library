'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const bcrypt = require('bcryptjs');
const app = require('../server');
const db = require('../db');
const { ensureTeacherSchema } = require('../lib/teacher-service');

let server;
let baseUrl;

// Test Accounts Credentials & Data
const teacherAPassword = 'TeacherA_Pass123!';
const teacherBPassword = 'TeacherB_Pass123!';
const student1Password = 'Student1_Pass123!';
const student2Password = 'Student2_Pass123!';
const adminPassword = 'Admin_Pass123!';
const crPassword = 'CR_Pass123!';
const disabledTeacherPassword = 'Disabled_Pass123!';

let teacherAToken = '';
let teacherBToken = '';
let student1Token = '';
let student2Token = '';
let adminToken = '';
let crToken = '';
let disabledTeacherToken = '';

let teacherACookie = '';
let student1Cookie = '';
let adminCookie = '';
let crCookie = '';

test.before(async () => {
  await db.initSchema();
  await ensureTeacherSchema({ exec: db.exec, isPostgres: db.isPostgres });

  // Start HTTP server on ephemeral port
  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  const hashTeachA = bcrypt.hashSync(teacherAPassword, 10);
  const hashTeachB = bcrypt.hashSync(teacherBPassword, 10);
  const hashStu1 = bcrypt.hashSync(student1Password, 10);
  const hashStu2 = bcrypt.hashSync(student2Password, 10);
  const hashAdmin = bcrypt.hashSync(adminPassword, 10);
  const hashCR = bcrypt.hashSync(crPassword, 10);
  const hashTeachDis = bcrypt.hashSync(disabledTeacherPassword, 10);

  // Clean test fixtures in proper dependency order
  const testIds = ['t_prof_a', 't_prof_b', 'stu_sem3', 'stu_sem1', 'admin_sl', 'cr_user', 't_disabled'];
  const testEmails = ['alice@gandaki.edu.np', 'bob@gandaki.edu.np', 'stu3@gandaki.edu.np', 'stu1@gandaki.edu.np', 'admin@gandaki.edu.np', 'cr@gandaki.edu.np', 'disabled@gandaki.edu.np'];
  const inIds = testIds.map(id => `'${id}'`).join(',');
  const inEmails = testEmails.map(e => `'${e.toLowerCase()}'`).join(',');

  await db.run(`DELETE FROM notification_recipients WHERE user_id IN (${inIds})`).catch(() => {});
  await db.run(`DELETE FROM notifications WHERE recipientStudentId IN (${inIds})`).catch(() => {});
  await db.run(`DELETE FROM assignment_questions WHERE assignmentId IN (SELECT id FROM assignments WHERE createdBy IN (${inIds}))`).catch(() => {});
  await db.run(`DELETE FROM assignments WHERE createdBy IN (${inIds})`).catch(() => {});
  await db.run(`DELETE FROM file_likes WHERE studentId IN (${inIds})`).catch(() => {});
  await db.run(`DELETE FROM file_comments WHERE studentId IN (${inIds})`).catch(() => {});
  await db.run(`DELETE FROM files WHERE uploadedBy IN (${inIds})`).catch(() => {});
  await db.run(`DELETE FROM post_target_semesters WHERE post_id IN (SELECT id FROM posts WHERE user_id IN (${inIds}))`).catch(() => {});
  await db.run(`DELETE FROM post_comments WHERE user_id IN (${inIds})`).catch(() => {});
  await db.run(`DELETE FROM post_likes WHERE user_id IN (${inIds})`).catch(() => {});
  await db.run(`DELETE FROM posts WHERE user_id IN (${inIds})`).catch(() => {});
  await db.run(`DELETE FROM follows WHERE followerId IN (${inIds}) OR followingId IN (${inIds})`).catch(() => {});
  await db.run(`DELETE FROM mobile_tokens WHERE studentId IN (${inIds})`).catch(() => {});
  await db.run("DELETE FROM teacher_subjects WHERE teacher_id IN ('t_prof_a', 't_prof_b', 'T_UUID_A', 'T_UUID_B', 'T_UUID_DIS')").catch(() => {});
  await db.run("DELETE FROM teachers WHERE id IN ('t_prof_a', 't_prof_b', 'T_UUID_A', 'T_UUID_B', 'T_UUID_DIS') OR user_id IN ('t_prof_a', 't_prof_b', 't_disabled')").catch(() => {});
  await db.run(`DELETE FROM students WHERE studentId IN (${inIds}) OR LOWER(email) IN (${inEmails})`).catch(() => {});
  await db.run("DELETE FROM subjects WHERE id IN ('sub_cs301', 'sub_cs501', 'sub_cs101')").catch(() => {});

  // Seed Students & Teachers in students table
  // Teacher A: teaches Semester 3 (sub_cs301) AND Semester 5 (sub_cs501)
  await db.run(
    `INSERT INTO students (studentId, name, email, role, passwordHash, semester)
     VALUES (?, ?, ?, ?, ?, ?)`,
    't_prof_a', 'Professor Alice', 'alice@gandaki.edu.np', 'teacher', hashTeachA, 'Semester 3'
  );
  await db.run(
    `INSERT INTO teachers (id, user_id, designation, status)
     VALUES (?, ?, ?, ?)`,
    'T_UUID_A', 't_prof_a', 'Associate Professor', 'active'
  );

  // Teacher B: teaches Semester 1 (sub_cs101) only
  await db.run(
    `INSERT INTO students (studentId, name, email, role, passwordHash, semester)
     VALUES (?, ?, ?, ?, ?, ?)`,
    't_prof_b', 'Professor Bob', 'bob@gandaki.edu.np', 'teacher', hashTeachB, 'Semester 1'
  );
  await db.run(
    `INSERT INTO teachers (id, user_id, designation, status)
     VALUES (?, ?, ?, ?)`,
    'T_UUID_B', 't_prof_b', 'Assistant Professor', 'active'
  );

  // Student 1: in Semester 3
  await db.run(
    `INSERT INTO students (studentId, name, email, role, passwordHash, semester)
     VALUES (?, ?, ?, ?, ?, ?)`,
    'stu_sem3', 'Student Three', 'stu3@gandaki.edu.np', 'student', hashStu1, 'Semester 3'
  );

  // Student 2: in Semester 1
  await db.run(
    `INSERT INTO students (studentId, name, email, role, passwordHash, semester)
     VALUES (?, ?, ?, ?, ?, ?)`,
    'stu_sem1', 'Student One', 'stu1@gandaki.edu.np', 'student', hashStu2, 'Semester 1'
  );

  // Admin user
  await db.run(
    `INSERT INTO students (studentId, name, email, role, passwordHash, semester)
     VALUES (?, ?, ?, ?, ?, ?)`,
    'admin_sl', 'University Admin', 'admin@gandaki.edu.np', 'admin', hashAdmin, 'Semester 1'
  );

  // CR user in Semester 3
  await db.run(
    `INSERT INTO students (studentId, name, email, role, passwordHash, semester)
     VALUES (?, ?, ?, ?, ?, ?)`,
    'cr_user', 'Class Rep Charlie', 'cr@gandaki.edu.np', 'cr', hashCR, 'Semester 3'
  );

  // Disabled Teacher (seeded as inactive in teachers table)
  await db.run(
    `INSERT INTO students (studentId, name, email, role, passwordHash, semester)
     VALUES (?, ?, ?, ?, ?, ?)`,
    't_disabled', 'Professor Disabled', 'disabled@gandaki.edu.np', 'teacher', hashTeachDis, 'Semester 3'
  );
  await db.run(
    `INSERT INTO teachers (id, user_id, designation, status)
     VALUES (?, ?, ?, ?)`,
    'T_UUID_DIS', 't_disabled', 'Former Faculty', 'disabled'
  );

  // Seed Subjects
  await db.run(
    `INSERT INTO subjects (id, code, name, semester, department, credit_hours)
     VALUES (?, ?, ?, ?, ?, ?)`,
    'sub_cs301', 'CS-301', 'Data Structures & Algorithms', 3, 'BIT', 3.0
  );
  await db.run(
    `INSERT INTO subjects (id, code, name, semester, department, credit_hours)
     VALUES (?, ?, ?, ?, ?, ?)`,
    'sub_cs501', 'CS-501', 'Operating Systems Internals', 5, 'BIT', 3.0
  );
  await db.run(
    `INSERT INTO subjects (id, code, name, semester, department, credit_hours)
     VALUES (?, ?, ?, ?, ?, ?)`,
    'sub_cs101', 'CS-101', 'Intro to Programming', 1, 'BIT', 3.0
  );

  // Seed Teacher Subject Allocations
  // Teacher A -> sub_cs301 (Sem 3) and sub_cs501 (Sem 5)
  await db.run(
    `INSERT INTO teacher_subjects (id, teacher_id, subject_id)
     VALUES (?, ?, ?)`,
    'ts_a_1', 'T_UUID_A', 'sub_cs301'
  );
  await db.run(
    `INSERT INTO teacher_subjects (id, teacher_id, subject_id)
     VALUES (?, ?, ?)`,
    'ts_a_2', 'T_UUID_A', 'sub_cs501'
  );

  // Teacher B -> sub_cs101 (Sem 1)
  await db.run(
    `INSERT INTO teacher_subjects (id, teacher_id, subject_id)
     VALUES (?, ?, ?)`,
    'ts_b_1', 'T_UUID_B', 'sub_cs101'
  );

  // Disabled Teacher -> sub_cs301 (Sem 3)
  await db.run(
    `INSERT INTO teacher_subjects (id, teacher_id, subject_id)
     VALUES (?, ?, ?)`,
    'ts_dis_1', 'T_UUID_DIS', 'sub_cs301'
  );

  // Seed Notes / Files
  // Note by Teacher A for CS-301
  await db.run(
    `INSERT INTO files (storedName, originalName, title, subject, semester, uploadedBy, sizeBytes, uploadedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    'stored_note_a.pdf', 'dsa_lecture_1.pdf', 'DSA Lecture 1 Slides', 'Data Structures & Algorithms', 'Semester 3', 't_prof_a', 2048576, new Date().toISOString()
  );
  // Note by Teacher B for CS-101
  await db.run(
    `INSERT INTO files (storedName, originalName, title, subject, semester, uploadedBy, sizeBytes, uploadedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    'stored_note_b.pdf', 'c_prog_intro.pdf', 'C Programming Intro', 'Intro to Programming', 'Semester 1', 't_prof_b', 1024000, new Date().toISOString()
  );

  // Seed Code Lab Assignments
  // Assignment by Teacher A
  await db.run(
    `INSERT INTO assignments (title, description, language, subject, semester, createdBy, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    'DSA Lab 1: Binary Search Trees', 'Implement AVL Tree Rotations', 'cpp', 'CS-301', '3', 't_prof_a', new Date().toISOString()
  );
  // Assignment by Teacher B
  await db.run(
    `INSERT INTO assignments (title, description, language, subject, semester, createdBy, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    'C Lab 1: Hello Pointers', 'Basic Pointer Arithmetic', 'c', 'CS-101', '1', 't_prof_b', new Date().toISOString()
  );

  // Seed Posts / Feed
  // 1. Post authored by Teacher A
  await db.run(
    `INSERT INTO posts (user_id, content, type, category, target_all_semesters, audience_scope, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    't_prof_a', 'Welcome to DSA! Lab hours on Thursdays.', 'status', 'announcement', 1, 'all_students', new Date().toISOString()
  );
  // 2. Student post in Semester 3 (Teacher A teaches Sem 3)
  const r2 = await db.run(
    `INSERT INTO posts (user_id, content, type, category, target_all_semesters, audience_scope, semester_no, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    'stu_sem3', 'Anyone has doubts on question 4 of DSA?', 'status', 'question', 0, 'all_students', 3, new Date().toISOString()
  );
  await db.run(`INSERT INTO post_target_semesters (post_id, semester) VALUES (?, ?)`, r2.lastInsertRowid, 3);

  // 3. Student post in Semester 1 (Teacher A does NOT teach Sem 1; Teacher B DOES)
  const r3 = await db.run(
    `INSERT INTO posts (user_id, content, type, category, target_all_semesters, audience_scope, semester_no, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    'stu_sem1', 'Intro to C quiz date announcement?', 'status', 'question', 0, 'all_students', 1, new Date().toISOString()
  );
  await db.run(`INSERT INTO post_target_semesters (post_id, semester) VALUES (?, ?)`, r3.lastInsertRowid, 1);

  // 4. Student-only post in Semester 3 (Teacher must NOT see this)
  const r4 = await db.run(
    `INSERT INTO posts (user_id, content, type, category, visibility, target_all_semesters, audience_scope, semester_no, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'stu_sem3', 'Unofficial study session for students only', 'status', 'discussion', 'students_only', 0, 'students_only', 3, new Date().toISOString()
  );
  await db.run(`INSERT INTO post_target_semesters (post_id, semester) VALUES (?, ?)`, r4.lastInsertRowid, 3);

  // 5. Official University Notice
  await db.run(
    `INSERT INTO posts (user_id, content, type, category, target_all_semesters, audience_scope, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    'admin_sl', 'Official notice: Mid-term examination schedule released.', 'notice', 'notice', 1, 'all_students', new Date().toISOString()
  );

  // 6. Teacher B ordinary post (Teacher A must not see other teacher ordinary posts)
  const r6 = await db.run(
    `INSERT INTO posts (user_id, content, type, category, target_all_semesters, audience_scope, semester_no, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    't_prof_b', 'Office hours for C programming updated.', 'status', 'general', 0, 'all_students', 1, new Date().toISOString()
  );
  await db.run(`INSERT INTO post_target_semesters (post_id, semester) VALUES (?, ?)`, r6.lastInsertRowid, 1);

  // Authenticate test sessions
  // Teacher A mobile token
  const tALogin = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: 't_prof_a', password: teacherAPassword }),
  });
  teacherAToken = (await tALogin.json()).token;

  // Teacher B mobile token
  const tBLogin = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: 't_prof_b', password: teacherBPassword }),
  });
  teacherBToken = (await tBLogin.json()).token;

  // Student 1 mobile token
  const s1Login = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: 'stu_sem3', password: student1Password }),
  });
  student1Token = (await s1Login.json()).token;

  // Student 2 mobile token
  const s2Login = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: 'stu_sem1', password: student2Password }),
  });
  student2Token = (await s2Login.json()).token;

  // Admin mobile token
  const admLogin = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: 'admin_sl', password: adminPassword }),
  });
  adminToken = (await admLogin.json()).token;

  // CR mobile token
  const crMobileRes = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: 'cr_user', password: crPassword }),
  });
  crToken = (await crMobileRes.json()).token;

  // Disabled teacher mobile token
  const disMobileRes = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: 't_disabled', password: disabledTeacherPassword }),
  });
  disabledTeacherToken = (await disMobileRes.json()).token;

  // Web Login to capture session cookies
  const tAWeb = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: 't_prof_a', password: teacherAPassword }),
  });
  teacherACookie = tAWeb.headers.get('set-cookie') || '';

  const s1Web = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: 'stu_sem3', password: student1Password }),
  });
  student1Cookie = s1Web.headers.get('set-cookie') || '';

  const admWeb = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: 'admin_sl', password: adminPassword }),
  });
  adminCookie = admWeb.headers.get('set-cookie') || '';

  const crWeb = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: 'cr_user', password: crPassword }),
  });
  crCookie = crWeb.headers.get('set-cookie') || '';
});

test.after(async () => {
  const testIds = ['t_prof_a', 't_prof_b', 'stu_sem3', 'stu_sem1', 'admin_sl', 'cr_user', 't_disabled'];
  const testEmails = ['alice@gandaki.edu.np', 'bob@gandaki.edu.np', 'stu3@gandaki.edu.np', 'stu1@gandaki.edu.np', 'admin@gandaki.edu.np', 'cr@gandaki.edu.np', 'disabled@gandaki.edu.np'];
  const inIds = testIds.map(id => `'${id}'`).join(',');
  const inEmails = testEmails.map(e => `'${e.toLowerCase()}'`).join(',');

  await db.run(`DELETE FROM notification_recipients WHERE user_id IN (${inIds})`).catch(() => {});
  await db.run(`DELETE FROM notifications WHERE recipientStudentId IN (${inIds})`).catch(() => {});
  await db.run(`DELETE FROM assignment_questions WHERE assignmentId IN (SELECT id FROM assignments WHERE createdBy IN (${inIds}))`).catch(() => {});
  await db.run(`DELETE FROM assignments WHERE createdBy IN (${inIds})`).catch(() => {});
  await db.run(`DELETE FROM file_likes WHERE studentId IN (${inIds})`).catch(() => {});
  await db.run(`DELETE FROM file_comments WHERE studentId IN (${inIds})`).catch(() => {});
  await db.run(`DELETE FROM files WHERE uploadedBy IN (${inIds})`).catch(() => {});
  await db.run(`DELETE FROM post_target_semesters WHERE post_id IN (SELECT id FROM posts WHERE user_id IN (${inIds}))`).catch(() => {});
  await db.run(`DELETE FROM post_comments WHERE user_id IN (${inIds})`).catch(() => {});
  await db.run(`DELETE FROM post_likes WHERE user_id IN (${inIds})`).catch(() => {});
  await db.run(`DELETE FROM posts WHERE user_id IN (${inIds})`).catch(() => {});
  await db.run(`DELETE FROM follows WHERE followerId IN (${inIds}) OR followingId IN (${inIds})`).catch(() => {});
  await db.run(`DELETE FROM mobile_tokens WHERE studentId IN (${inIds})`).catch(() => {});
  await db.run("DELETE FROM teacher_subjects WHERE teacher_id IN ('t_prof_a', 't_prof_b', 'T_UUID_A', 'T_UUID_B', 'T_UUID_DIS')").catch(() => {});
  await db.run("DELETE FROM teachers WHERE id IN ('t_prof_a', 't_prof_b', 'T_UUID_A', 'T_UUID_B', 'T_UUID_DIS') OR user_id IN ('t_prof_a', 't_prof_b', 't_disabled')").catch(() => {});
  await db.run(`DELETE FROM students WHERE studentId IN (${inIds}) OR LOWER(email) IN (${inEmails})`).catch(() => {});
  await db.run("DELETE FROM subjects WHERE id IN ('sub_cs301', 'sub_cs501', 'sub_cs101')").catch(() => {});

  if (server) {
    await new Promise((res) => server.close(res));
  }
});

// =========================================================================
// TEST SUITE: TEACHER DASHBOARD & MY MATERIALS WORKSPACE (PHASE 3A)
// =========================================================================

test('Phase 3A — Step 5: Account-Specific Routing & Authorization', async (t) => {

  await t.test('1. Student cannot open teacher dashboard (redirected to /dashboard.html)', async () => {
    const res = await fetch(`${baseUrl}/teacher-dashboard.html`, {
      headers: { Cookie: student1Cookie },
      redirect: 'manual'
    });
    assert.equal(res.status, 302, 'Student must receive 302 redirect');
    assert.equal(res.headers.get('location'), '/dashboard.html', 'Student must be redirected to /dashboard.html');
  });

  await t.test('2. Student cannot access /teacher-dashboard clean route (redirected to /dashboard.html)', async () => {
    const res = await fetch(`${baseUrl}/teacher-dashboard`, {
      headers: { Cookie: student1Cookie },
      redirect: 'manual'
    });
    assert.equal(res.status, 302, 'Student must receive 302 redirect');
    assert.equal(res.headers.get('location'), '/dashboard.html');
  });

  await t.test('2b. CR cannot access /teacher-dashboard or /teacher-dashboard.html (redirected to /dashboard.html at server level)', async () => {
    const resHtml = await fetch(`${baseUrl}/teacher-dashboard.html`, {
      headers: { Cookie: crCookie },
      redirect: 'manual'
    });
    assert.equal(resHtml.status, 302, 'CR must receive 302 redirect from teacher-dashboard.html');
    assert.equal(resHtml.headers.get('location'), '/dashboard.html', 'CR must be redirected to /dashboard.html');

    const resClean = await fetch(`${baseUrl}/teacher-dashboard`, {
      headers: { Cookie: crCookie },
      redirect: 'manual'
    });
    assert.equal(resClean.status, 302, 'CR must receive 302 redirect from /teacher-dashboard');
    assert.equal(resClean.headers.get('location'), '/dashboard.html', 'CR must be redirected to /dashboard.html');
  });

  await t.test('3. Student receives 403 Forbidden on teacher API endpoints', async () => {
    const endpoints = [
      '/api/teacher/dashboard-init',
      '/api/teacher/subjects',
      '/api/teacher/notes',
      '/api/teacher/assignments'
    ];

    for (const ep of endpoints) {
      const res = await fetch(`${baseUrl}${ep}`, {
        headers: { Authorization: `Bearer ${student1Token}` }
      });
      assert.equal(res.status, 403, `Student calling ${ep} must receive 403 Forbidden`);
      const body = await res.json();
      const msg = (body.message || '').toLowerCase();
      assert.ok(
        msg.includes('teacher') || msg.includes('admin') || msg.includes('faculty'),
        'Must state teacher or admin access required'
      );
    }
  });

  await t.test('4. Teacher can open their dashboard (/teacher-dashboard.html serves 200 OK)', async () => {
    const res = await fetch(`${baseUrl}/teacher-dashboard.html`, {
      headers: { Cookie: teacherACookie }
    });
    assert.equal(res.status, 200, 'Teacher must successfully load teacher dashboard');
    const html = await res.text();
    assert.ok(html.includes('Faculty Workspace'), 'Must contain Faculty Workspace header');
    assert.ok(html.includes('My Materials Workspace'), 'Must contain My Materials Workspace');
  });

  await t.test('5. Teacher accessing /dashboard or /dashboard.html is redirected to /teacher-dashboard.html', async () => {
    const res = await fetch(`${baseUrl}/dashboard.html`, {
      headers: { Cookie: teacherACookie },
      redirect: 'manual'
    });
    assert.equal(res.status, 302, 'Teacher must receive 302 redirect from student dashboard');
    assert.equal(res.headers.get('location'), '/teacher-dashboard.html', 'Teacher must be redirected to /teacher-dashboard.html');
  });

  await t.test('6. Admin routing remains unchanged (admin is not redirected to teacher dashboard)', async () => {
    const res = await fetch(`${baseUrl}/dashboard.html`, {
      headers: { Cookie: adminCookie },
      redirect: 'manual'
    });
    assert.equal(res.status, 200, 'Admin accessing student dashboard must receive 200 OK');
    const html = await res.text();
    assert.ok(html.includes('Semester Library'), 'Must serve standard dashboard');
  });

  await t.test('7. Existing Student Dashboard still works for students', async () => {
    const res = await fetch(`${baseUrl}/dashboard.html`, {
      headers: { Cookie: student1Cookie },
      redirect: 'manual'
    });
    assert.equal(res.status, 200, 'Student accessing /dashboard.html must receive 200 OK');
  });

});

test('Phase 3A — Step 2 & 7: Teacher Identity & Assigned Subjects', async (t) => {

  await t.test('1. Teacher loads /api/teacher/dashboard-init with profile and stats', async () => {
    const res = await fetch(`${baseUrl}/api/teacher/dashboard-init`, {
      headers: { Authorization: `Bearer ${teacherAToken}` }
    });
    assert.equal(res.status, 200, 'Init must succeed');
    const data = await res.json();
    assert.equal(data.user.studentId, 't_prof_a');
    assert.equal(data.user.role, 'teacher');
    assert.equal(data.user.name, 'Professor Alice');
    assert.equal(data.teacher.designation, 'Associate Professor');
    assert.ok(data.stats, 'Must return stats');
    assert.equal(data.stats.assignedSubjectsCount, 2);
    assert.equal(data.stats.uploadedNotesCount, 1);
    assert.equal(data.stats.createdAssignmentsCount, 1);
  });

  await t.test('2. Teacher assigned to multiple subjects across multiple semesters sees all', async () => {
    const res = await fetch(`${baseUrl}/api/teacher/subjects`, {
      headers: { Authorization: `Bearer ${teacherAToken}` }
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.subjects.length, 2, 'Teacher A must have 2 subjects assigned');

    const codes = data.subjects.map(s => s.code).sort();
    assert.deepEqual(codes, ['CS-301', 'CS-501'], 'Must match assigned subject codes');

    const semesters = data.subjects.map(s => s.semester).sort();
    assert.deepEqual(semesters, [3, 5], 'Must span Semester 3 and Semester 5');
  });

  await t.test('3. Teacher with single subject sees their single assigned subject', async () => {
    const res = await fetch(`${baseUrl}/api/teacher/subjects`, {
      headers: { Authorization: `Bearer ${teacherBToken}` }
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.subjects.length, 1);
    assert.equal(data.subjects[0].code, 'CS-101');
    assert.equal(data.subjects[0].semester, 1);
  });

});

test('Phase 3A — Step 4: "My Materials" Isolation (Notes & Assignments)', async (t) => {

  await t.test('1. Teacher sees their own uploaded notes in /api/teacher/notes', async () => {
    const res = await fetch(`${baseUrl}/api/teacher/notes`, {
      headers: { Authorization: `Bearer ${teacherAToken}` }
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.notes.length, 1);
    assert.equal(data.notes[0].title, 'DSA Lecture 1 Slides');
    assert.equal(data.notes[0].uploadedBy, 't_prof_a');
  });

  await t.test('2. Teacher cannot retrieve another teacher\'s notes through My Materials APIs', async () => {
    // Teacher B checks their notes
    const resB = await fetch(`${baseUrl}/api/teacher/notes`, {
      headers: { Authorization: `Bearer ${teacherBToken}` }
    });
    const dataB = await resB.json();
    assert.equal(dataB.notes.length, 1);
    assert.equal(dataB.notes[0].title, 'C Programming Intro');
    assert.equal(dataB.notes[0].uploadedBy, 't_prof_b');

    // Ensure Teacher A does NOT see Teacher B's notes
    const resA = await fetch(`${baseUrl}/api/teacher/notes`, {
      headers: { Authorization: `Bearer ${teacherAToken}` }
    });
    const dataA = await resA.json();
    const hasTeacherBNote = dataA.notes.some(n => n.uploadedBy === 't_prof_b' || n.title === 'C Programming Intro');
    assert.equal(hasTeacherBNote, false, 'Teacher A must NEVER see Teacher B\'s notes in My Notes');

    // Attempt spoofing with query parameters like ?teacherId=t_prof_b
    const resSpoof = await fetch(`${baseUrl}/api/teacher/notes?teacherId=t_prof_b&uploadedBy=t_prof_b`, {
      headers: { Authorization: `Bearer ${teacherAToken}` }
    });
    const dataSpoof = await resSpoof.json();
    const spoofBNote = dataSpoof.notes.some(n => n.uploadedBy === 't_prof_b');
    assert.equal(spoofBNote, false, 'Spoofing ?teacherId or ?uploadedBy must be ignored; ownership is server-authoritative');
  });

  await t.test('3. Teacher sees their own assignments in /api/teacher/assignments', async () => {
    const res = await fetch(`${baseUrl}/api/teacher/assignments`, {
      headers: { Authorization: `Bearer ${teacherAToken}` }
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.assignments.length, 1);
    assert.equal(data.assignments[0].title, 'DSA Lab 1: Binary Search Trees');
    assert.equal(data.assignments[0].created_by, 't_prof_a');
  });

  await t.test('4. Teacher cannot retrieve another teacher\'s assignments through My Materials APIs', async () => {
    // Teacher B assignments
    const resB = await fetch(`${baseUrl}/api/teacher/assignments`, {
      headers: { Authorization: `Bearer ${teacherBToken}` }
    });
    const dataB = await resB.json();
    assert.equal(dataB.assignments.length, 1);
    assert.equal(dataB.assignments[0].title, 'C Lab 1: Hello Pointers');
    assert.equal(dataB.assignments[0].created_by, 't_prof_b');

    // Teacher A must NOT see Teacher B's assignments
    const resA = await fetch(`${baseUrl}/api/teacher/assignments`, {
      headers: { Authorization: `Bearer ${teacherAToken}` }
    });
    const dataA = await resA.json();
    const hasTeacherBAssignment = dataA.assignments.some(a => a.created_by === 't_prof_b');
    assert.equal(hasTeacherBAssignment, false, 'Teacher A must NEVER see Teacher B\'s assignments');

    // Attempt spoofing query parameter
    const resSpoof = await fetch(`${baseUrl}/api/teacher/assignments?teacherId=t_prof_b&createdBy=t_prof_b`, {
      headers: { Authorization: `Bearer ${teacherAToken}` }
    });
    const dataSpoof = await resSpoof.json();
    const spoofBAssignment = dataSpoof.assignments.some(a => a.created_by === 't_prof_b');
    assert.equal(spoofBAssignment, false, 'Spoofing query parameter must not bypass server ownership filter');
  });

});

test('Phase 3A — Step 3: Teacher Feed Scoping & Visibility', async (t) => {

  await t.test('1. Teacher sees student posts from assigned semesters and self-authored posts and notices', async () => {
    const res = await fetch(`${baseUrl}/api/posts`, {
      headers: { Authorization: `Bearer ${teacherAToken}` }
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    const posts = Array.isArray(data) ? data : data.posts;

    const contents = posts.map(p => p.content);

    // 1. Posts authored by the teacher
    assert.ok(
      contents.includes('Welcome to DSA! Lab hours on Thursdays.'),
      'Teacher A must see their own authored post'
    );

    // 2. Student posts from semesters where the teacher has assigned subjects (Sem 3)
    assert.ok(
      contents.includes('Anyone has doubts on question 4 of DSA?'),
      'Teacher A must see student posts from Semester 3'
    );

    // 3. Official university notices
    assert.ok(
      contents.includes('Official notice: Mid-term examination schedule released.'),
      'Teacher A must see official notices'
    );
  });

  await t.test('2. Teacher CANNOT see unrelated student posts (from semesters where they do not teach)', async () => {
    const res = await fetch(`${baseUrl}/api/posts`, {
      headers: { Authorization: `Bearer ${teacherAToken}` }
    });
    const data = await res.json();
    const posts = Array.isArray(data) ? data : data.posts;
    const contents = posts.map(p => p.content);

    // Student post from Semester 1 (Teacher A only teaches Sem 3 and Sem 5)
    assert.equal(
      contents.includes('Intro to C quiz date announcement?'),
      false,
      'Teacher A must NOT see student posts from Semester 1'
    );
  });

  await t.test('3. Teacher CANNOT see student-only restricted posts even in their teaching semester', async () => {
    const res = await fetch(`${baseUrl}/api/posts`, {
      headers: { Authorization: `Bearer ${teacherAToken}` }
    });
    const data = await res.json();
    const posts = Array.isArray(data) ? data : data.posts;
    const contents = posts.map(p => p.content);

    assert.equal(
      contents.includes('Unofficial study session for students only'),
      false,
      'Teacher must NOT see students-only posts'
    );
  });

  await t.test('4. Teacher CANNOT see other teachers\' ordinary posts', async () => {
    const res = await fetch(`${baseUrl}/api/posts`, {
      headers: { Authorization: `Bearer ${teacherAToken}` }
    });
    const data = await res.json();
    const posts = Array.isArray(data) ? data : data.posts;
    const contents = posts.map(p => p.content);

    assert.equal(
      contents.includes('Office hours for C programming updated.'),
      false,
      'Teacher A must NOT see Teacher B\'s ordinary post'
    );
  });

});

// =========================================================================
// TEST SUITE: PHASE 3A.1 — TEACHER PUBLISHING PERMISSIONS & SECURITY PATCH
// =========================================================================

test('Phase 3A.1 — Teacher Publishing Permissions & Security Suite', async (t) => {

  await t.test('1. Teacher uploads notes to officially assigned subject: ALLOWED (200 OK)', async () => {
    const fd = new FormData();
    fd.append('file', new Blob(['// DSA Binary Search Tree Lecture Notes\nclass BST {}'], { type: 'text/javascript' }), 'bst_notes.js');
    fd.append('title', 'Authoritative BST Notes');
    fd.append('subject', 'CS-301');
    fd.append('semester', 'Semester 3');
    fd.append('chapter', 'Trees');

    const res = await fetch(`${baseUrl}/api/files/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${teacherAToken}` },
      body: fd
    });
    assert.equal(res.status, 200, 'Teacher A uploading to assigned subject CS-301 must succeed');
    const data = await res.json();
    assert.ok(data.successfulFiles && data.successfulFiles.length > 0);

    // Verify database record has canonical subject name and canonical semester
    const fileRow = await db.get('SELECT * FROM files WHERE title = ?', 'Authoritative BST Notes');
    assert.ok(fileRow, 'File record must be persisted');
    assert.equal(fileRow.uploadedBy, 't_prof_a');
    assert.equal(fileRow.subject, 'Data Structures & Algorithms');
    assert.equal(fileRow.semester, 'Semester 3');
    assert.equal(fileRow.semesterNo || fileRow.semester_no, 3);
  });

  await t.test('2. Teacher uploads notes to unassigned subject: DENIED (403 Forbidden)', async () => {
    const fd = new FormData();
    fd.append('file', new Blob(['// C pointers\nvoid main() {}'], { type: 'text/plain' }), 'c_pointers.txt');
    fd.append('title', 'Unauthorized C Pointers');
    fd.append('subject', 'CS-101'); // CS-101 is assigned to Teacher B, NOT Teacher A
    fd.append('semester', 'Semester 1');

    const res = await fetch(`${baseUrl}/api/files/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${teacherAToken}` },
      body: fd
    });
    assert.equal(res.status, 403, 'Teacher A uploading to unassigned subject CS-101 must receive 403 Forbidden');
    const data = await res.json();
    assert.ok(data.message.includes('not authorized'));

    // Verify nothing inserted into database
    const fileRow = await db.get('SELECT * FROM files WHERE title = ?', 'Unauthorized C Pointers');
    assert.equal(fileRow, null, 'Unassigned file must NOT be stored in database');
  });

  await t.test('3. Teacher creates assignment for assigned subject: ALLOWED (200 OK)', async () => {
    const res = await fetch(`${baseUrl}/api/code-lab/assignments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherAToken}`
      },
      body: JSON.stringify({
        title: 'Assigned DSA Trees Lab Assignment',
        subject: 'CS-301',
        semester: 'Semester 3',
        deadline: new Date(Date.now() + 86400000).toISOString(),
        questions: [
          {
            title: 'BST Insert Question',
            description: 'Implement node insertion',
            language: 'c',
            maxPoints: 10
          }
        ]
      })
    });
    assert.equal(res.status, 200, 'Teacher A creating assignment for assigned subject CS-301 must succeed');
    const data = await res.json();
    assert.ok(data.id || data.assignmentId, 'Must return assignmentId');

    // Verify database record has canonical subject name and canonical semester
    const assignRow = await db.get('SELECT * FROM assignments WHERE title = ?', 'Assigned DSA Trees Lab Assignment');
    assert.ok(assignRow, 'Assignment record must be persisted');
    assert.equal(assignRow.createdBy, 't_prof_a');
    assert.equal(assignRow.subject, 'Data Structures & Algorithms');
    assert.equal(assignRow.semester, 'Semester 3');
    assert.equal(assignRow.semesterNo || assignRow.semester_no, 3);
  });

  await t.test('4. Teacher creates assignment for unassigned subject: DENIED (403 Forbidden)', async () => {
    const res = await fetch(`${baseUrl}/api/code-lab/assignments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherAToken}`
      },
      body: JSON.stringify({
        title: 'Unassigned C Programming Lab',
        subject: 'CS-101', // Teacher A teaches 3 and 5, NOT 1
        semester: 'Semester 1',
        questions: [
          { title: 'Hello World', description: 'Write hello world', language: 'c', maxPoints: 10 }
        ]
      })
    });
    assert.equal(res.status, 403, 'Teacher A creating assignment for unassigned CS-101 must receive 403 Forbidden');
    const data = await res.json();
    assert.ok(data.message.includes('not authorized'));

    const assignRow = await db.get('SELECT * FROM assignments WHERE title = ?', 'Unassigned C Programming Lab');
    assert.equal(assignRow, null, 'Unassigned assignment must NOT be stored in database');
  });

  await t.test('5. Teacher cannot spoof semester values (403 Forbidden)', async () => {
    // Teacher A tries to assign CS-301 to Semester 7
    const res = await fetch(`${baseUrl}/api/code-lab/assignments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherAToken}`
      },
      body: JSON.stringify({
        title: 'Spoofed Semester Assignment',
        subject: 'CS-301',
        semester: 'Semester 7', // CS-301 is Semester 3!
        questions: [
          { title: 'Tree Balancing', description: 'Write AVL rotations', language: 'c', maxPoints: 10 }
        ]
      })
    });
    assert.equal(res.status, 403, 'Teacher spoofing semester value must receive 403 Forbidden');
    const data = await res.json();
    assert.ok(data.message.toLowerCase().includes('mismatch') || data.message.toLowerCase().includes('semester'));

    const assignRow = await db.get('SELECT * FROM assignments WHERE title = ?', 'Spoofed Semester Assignment');
    assert.equal(assignRow, null, 'Spoofed semester assignment must NOT be created');
  });

  await t.test('6. Teacher cannot spoof subject IDs or use unassigned alias (403 Forbidden)', async () => {
    const fd = new FormData();
    fd.append('file', new Blob(['fake content'], { type: 'text/plain' }), 'fake.txt');
    fd.append('title', 'Spoofed Subject Note');
    fd.append('subject', 'sub_fake_not_assigned_999');
    fd.append('semester', 'Semester 3');

    const res = await fetch(`${baseUrl}/api/files/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${teacherAToken}` },
      body: fd
    });
    assert.equal(res.status, 403, 'Spoofed subject ID must receive 403 Forbidden');
  });

  await t.test('7. Teacher cannot spoof another teacher ID in upload or assignment body', async () => {
    // Teacher A sends createdBy: 't_prof_b' and attempts to create for CS-101 (Teacher B's subject)
    const res = await fetch(`${baseUrl}/api/code-lab/assignments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherAToken}`
      },
      body: JSON.stringify({
        title: 'Impersonation Attempt Assignment',
        subject: 'CS-101',
        semester: 'Semester 1',
        teacherId: 't_prof_b',
        createdBy: 't_prof_b',
        questions: [
          { title: 'Pointer Lab', description: 'Pointers', language: 'c', maxPoints: 10 }
        ]
      })
    });
    assert.equal(res.status, 403, 'Impersonation attempt must be rejected based on authenticated token identity');
  });

  await t.test('8. Admin publishing remains fully functional for any subject & semester', async () => {
    // Admin uploads note for CS-101
    const fd = new FormData();
    fd.append('file', new Blob(['admin note content'], { type: 'text/plain' }), 'admin_note.txt');
    fd.append('title', 'Admin Master Lecture Note');
    fd.append('subject', 'CS-101');
    fd.append('semester', 'Semester 1');

    const resNote = await fetch(`${baseUrl}/api/files/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: fd
    });
    assert.equal(resNote.status, 200, 'Admin note upload must succeed');

    // Admin creates assignment for CS-101
    const resAssign = await fetch(`${baseUrl}/api/code-lab/assignments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        title: 'Admin Master Assignment',
        subject: 'Intro to Programming',
        semester: 'Semester 1',
        questions: [
          { title: 'Admin Question', description: 'Admin problem', language: 'c', maxPoints: 10 }
        ]
      })
    });
    assert.equal(resAssign.status, 200, 'Admin assignment creation must succeed');
  });

  await t.test('9. Student cannot access assignment creation endpoint (403 Forbidden)', async () => {
    const res = await fetch(`${baseUrl}/api/code-lab/assignments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${student1Token}`
      },
      body: JSON.stringify({
        title: 'Student Rogue Assignment',
        subject: 'CS-301',
        semester: 'Semester 3',
        questions: [
          { title: 'Question', description: 'test', language: 'c', maxPoints: 10 }
        ]
      })
    });
    assert.equal(res.status, 403, 'Student cannot create assignments');
  });

  await t.test('10. Inactive / disabled teacher cannot publish materials (403 Forbidden)', async () => {
    const fd = new FormData();
    fd.append('file', new Blob(['disabled teacher note'], { type: 'text/plain' }), 'disabled.txt');
    fd.append('title', 'Disabled Teacher Note');
    fd.append('subject', 'CS-301');
    fd.append('semester', 'Semester 3');

    const res = await fetch(`${baseUrl}/api/files/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${disabledTeacherToken}` },
      body: fd
    });
    assert.equal(res.status, 403, 'Disabled teacher must receive 403 Forbidden');
    const data = await res.json();
    assert.ok(data.message.toLowerCase().includes('inactive') || data.message.toLowerCase().includes('disabled') || data.message.toLowerCase().includes('not authorized'));
  });

  await t.test('11. Direct storage record-upload endpoint enforces teacher subject authorization', async () => {
    // Record-upload for unassigned subject CS-101 by Teacher A
    const resUnauth = await fetch(`${baseUrl}/api/files/record-upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherAToken}`
      },
      body: JSON.stringify({
        title: 'Direct Storage Note Unauth',
        subject: 'CS-101',
        semester: 'Semester 1',
        files: [
          { storedName: 'fake_rec_note.pdf', originalName: 'rec_note.pdf', size: 5000 }
        ]
      })
    });
    assert.equal(resUnauth.status, 403, 'Record upload for unassigned subject must receive 403 Forbidden');

    // Record-upload for assigned subject CS-301 with spoofed semester (Semester 7)
    const resSpoofSem = await fetch(`${baseUrl}/api/files/record-upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherAToken}`
      },
      body: JSON.stringify({
        title: 'Direct Storage Note Spoof Sem',
        subject: 'CS-301',
        semester: 'Semester 7',
        files: [
          { storedName: 'fake_rec_note_spoof.pdf', originalName: 'rec_note_spoof.pdf', size: 5000 }
        ]
      })
    });
    assert.equal(resSpoofSem.status, 403, 'Record upload for spoofed semester must receive 403 Forbidden');
  });

});
