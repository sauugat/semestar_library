'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');

const testDbPath = path.join(os.tmpdir(), `admin_assignments_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
process.env.NODE_ENV = 'test';
process.env.DB_PATH = testDbPath;
process.env.SEMESTER_DB_SKIP_INIT = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const bcrypt = require('bcryptjs');

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
const adminPassword = 'Admin_Pass123!';
const studentPassword = 'Student_Pass123!';
const crPassword = 'CR_Pass123!';
const teacherAPassword = 'TeacherA_Pass123!';
const teacherBPassword = 'TeacherB_Pass123!';

let adminToken = '';
let studentToken = '';
let crToken = '';
let teacherAToken = '';
let teacherBToken = '';

let adminCookie = '';
let studentCookie = '';
let crCookie = '';
let teacherACookie = '';

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
  const hashTeachA = bcrypt.hashSync(teacherAPassword, 10);
  const hashTeachB = bcrypt.hashSync(teacherBPassword, 10);

  // 1. Seed Admin
  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    'admin_sl', 'admin_boss', 'System Administrator', 'admin@gandaki.edu.np', 'admin', hashAdmin, null
  );

  // 2. Seed Student (Semester 3)
  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    'stu_sem3', 'stu_three', 'Student Three', 'stu3@gandaki.edu.np', 'student', hashStudent, 'Semester 3'
  );

  // 3. Seed CR (Semester 3)
  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    'cr_sem3', 'cr_three', 'Class Rep Three', 'cr3@gandaki.edu.np', 'cr', hashCR, 'Semester 3'
  );

  // 4. Seed Teacher Alpha (Initial: BCT111 [Sem 1], CIT111 [Sem 1], BCT211 [Sem 3])
  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, department)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    't_prof_a', 'prof_alice', 'Professor Alice', 'alice@gandaki.edu.np', 'teacher', hashTeachA, null, 'BIT'
  );
  await db.run(
    `INSERT INTO teachers (id, user_id, designation, status)
     VALUES (?, ?, ?, ?)`,
    'T_UUID_A', 't_prof_a', 'Associate Professor', 'active'
  );
  await db.run(
    `INSERT INTO teacher_subjects (id, teacher_id, subject_id)
     VALUES (?, ?, ?)`,
    'ts_a_1', 'T_UUID_A', 'BCT111'
  );
  await db.run(
    `INSERT INTO teacher_subjects (id, teacher_id, subject_id)
     VALUES (?, ?, ?)`,
    'ts_a_2', 'T_UUID_A', 'CIT111'
  );
  await db.run(
    `INSERT INTO teacher_subjects (id, teacher_id, subject_id)
     VALUES (?, ?, ?)`,
    'ts_a_3', 'T_UUID_A', 'BCT211'
  );

  // 5. Seed Teacher Beta (Initial: ELX111 [Sem 1])
  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, department)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    't_prof_b', 'prof_bob', 'Professor Bob', 'bob@gandaki.edu.np', 'teacher', hashTeachB, null, 'BIT'
  );
  await db.run(
    `INSERT INTO teachers (id, user_id, designation, status)
     VALUES (?, ?, ?, ?)`,
    'T_UUID_B', 't_prof_b', 'Assistant Professor', 'active'
  );
  await db.run(
    `INSERT INTO teacher_subjects (id, teacher_id, subject_id)
     VALUES (?, ?, ?)`,
    'ts_b_1', 'T_UUID_B', 'ELX111'
  );

  // Seed Student Posts for feed tests
  // Student post in Semester 3
  const p3 = await db.run(
    `INSERT INTO posts (user_id, content, type, category, target_all_semesters, audience_scope, semester_no, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    'stu_sem3', 'Question about Semester 3 algorithm complexity', 'status', 'question', 0, 'all_students', 3, new Date().toISOString()
  );
  await db.run(`INSERT INTO post_target_semesters (post_id, semester) VALUES (?, ?)`, p3.lastInsertRowid, 3);

  // Student post in Semester 7
  const p7 = await db.run(
    `INSERT INTO posts (user_id, content, type, category, target_all_semesters, audience_scope, semester_no, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    'stu_sem3', 'Final year Semester 7 project guidelines discussion', 'status', 'question', 0, 'all_students', 7, new Date().toISOString()
  );
  await db.run(`INSERT INTO post_target_semesters (post_id, semester) VALUES (?, ?)`, p7.lastInsertRowid, 7);

  // Authenticate mobile & web sessions
  // Admin mobile & web
  const adminMob = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: 'admin_sl', password: adminPassword })
  });
  adminToken = (await adminMob.json()).token;

  const adminWeb = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: 'admin_sl', password: adminPassword })
  });
  adminCookie = adminWeb.headers.get('set-cookie') || '';

  // Student mobile & web
  const stuMob = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: 'stu_sem3', password: studentPassword })
  });
  studentToken = (await stuMob.json()).token;

  // CR mobile & web
  const crMob = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: 'cr_sem3', password: crPassword })
  });
  crToken = (await crMob.json()).token;

  // Teacher Alpha mobile & web
  const tAMob = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: 't_prof_a', password: teacherAPassword })
  });
  teacherAToken = (await tAMob.json()).token;

  const tAWeb = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: 't_prof_a', password: teacherAPassword })
  });
  teacherACookie = tAWeb.headers.get('set-cookie') || '';

  // Teacher Beta mobile
  const tBMob = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: 't_prof_b', password: teacherBPassword })
  });
  teacherBToken = (await tBMob.json()).token;
});

test.after(async () => {
  if (server) {
    await new Promise(resolve => server.close(resolve));
  }
  try {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  } catch (_) {}
});

test('Step 7.1: Admin views assigned subjects for an active teacher', async () => {
  const res = await fetch(`${baseUrl}/api/admin/teachers/T_UUID_A/subjects`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert.equal(res.status, 200);

  const data = await res.json();
  assert.ok(data.teacher);
  assert.equal(data.teacher.id, 'T_UUID_A');
  assert.equal(data.teacher.name, 'Professor Alice');
  assert.ok(Array.isArray(data.subjects));
  assert.equal(data.subjects.length, 3);

  // Derived semesters should be [1, 3] from BCT111 (Sem 1), CIT111 (Sem 1), BCT211 (Sem 3)
  assert.deepEqual(data.derivedSemesters, [1, 3]);
});

test('Step 7.2: Admin adds an existing canonical subject to a teacher', async () => {
  // Add CIT411 (Semester 7) to Teacher Alpha
  const res = await fetch(`${baseUrl}/api/admin/teachers/T_UUID_A/subjects`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`
    },
    body: JSON.stringify({ subjectId: 'CIT411' })
  });

  assert.equal(res.status, 201);
  const data = await res.json();
  assert.equal(data.message, 'Subject assigned successfully.');
  assert.equal(data.subjects.length, 4);

  const codes = data.subjects.map(s => s.code);
  assert.ok(codes.includes('CIT411'));

  // Derived semesters now includes 7: [1, 3, 7]
  assert.deepEqual(data.derivedSemesters, [1, 3, 7]);
});

test('Step 7.3: Admin cannot create a duplicate assignment for the same teacher and subject', async () => {
  // Attempt to assign CIT411 again to Teacher Alpha
  const res = await fetch(`${baseUrl}/api/admin/teachers/T_UUID_A/subjects`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`
    },
    body: JSON.stringify({ subjectId: 'CIT411' })
  });

  assert.equal(res.status, 409);
  const data = await res.json();
  assert.ok(data.message.includes('already assigned'));
});

test('Step 7.4: Admin removes an assigned subject', async () => {
  // Remove CIT411 from Teacher Alpha
  const res = await fetch(`${baseUrl}/api/admin/teachers/T_UUID_A/subjects/CIT411`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminToken}` }
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.message, 'Subject assignment removed successfully.');
  assert.equal(data.subjects.length, 3);

  const codes = data.subjects.map(s => s.code);
  assert.ok(!codes.includes('CIT411'));

  // Derived semesters should be back to [1, 3]
  assert.deepEqual(data.derivedSemesters, [1, 3]);
});

test('Step 7.5: Teacher cannot add own subjects (enforces requireAdminRole)', async () => {
  const res = await fetch(`${baseUrl}/api/admin/teachers/T_UUID_A/subjects`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({ subjectId: 'CIT411' })
  });

  assert.equal(res.status, 403);
  const data = await res.json();
  assert.ok(data.message.includes('Administrator access required'));
});

test('Step 7.6: Student cannot manage assignments', async () => {
  // POST attempt
  const postRes = await fetch(`${baseUrl}/api/admin/teachers/T_UUID_A/subjects`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${studentToken}`
    },
    body: JSON.stringify({ subjectId: 'CIT411' })
  });
  assert.equal(postRes.status, 403);

  // DELETE attempt
  const delRes = await fetch(`${baseUrl}/api/admin/teachers/T_UUID_A/subjects/BCT111`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${studentToken}` }
  });
  assert.equal(delRes.status, 403);
});

test('Step 7.7: CR cannot manage assignments', async () => {
  // POST attempt
  const postRes = await fetch(`${baseUrl}/api/admin/teachers/T_UUID_A/subjects`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${crToken}`
    },
    body: JSON.stringify({ subjectId: 'CIT411' })
  });
  assert.equal(postRes.status, 403);

  // DELETE attempt
  const delRes = await fetch(`${baseUrl}/api/admin/teachers/T_UUID_A/subjects/BCT111`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${crToken}` }
  });
  assert.equal(delRes.status, 403);
});

test('Step 7.8: Assigned subjects match Teacher Dashboard API (/api/teacher/subjects)', async () => {
  const res = await fetch(`${baseUrl}/api/teacher/subjects`, {
    headers: { Authorization: `Bearer ${teacherAToken}` }
  });
  assert.equal(res.status, 200);

  const data = await res.json();
  assert.ok(Array.isArray(data.subjects));
  assert.equal(data.subjects.length, 3);

  const codes = data.subjects.map(s => s.code).sort();
  assert.deepEqual(codes, ['BCT111', 'BCT211', 'CIT111']);
});

test('Step 7.9: Publishing permissions update dynamically upon assignment addition & removal', async () => {
  // A. Initially, Teacher Alpha is NOT assigned to CIT411 (Semester 7). Upload must be DENIED (403).
  const formInit = new FormData();
  formInit.append('subject', 'CIT411');
  formInit.append('semester', 'Semester 7');
  formInit.append('title', 'Advanced Systems Notes');
  formInit.append('file', new Blob(['test note content'], { type: 'text/plain' }), 'adv_notes.txt');

  const resDenied = await fetch(`${baseUrl}/api/files/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${teacherAToken}` },
    body: formInit
  });
  assert.equal(resDenied.status, 403);

  // B. Admin assigns CIT411 to Teacher Alpha
  const assignRes = await fetch(`${baseUrl}/api/admin/teachers/T_UUID_A/subjects`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`
    },
    body: JSON.stringify({ subjectId: 'CIT411' })
  });
  assert.equal(assignRes.status, 201);

  // C. Teacher Alpha now uploads note for CIT411 -> ALLOWED (200 OK)
  const formAllowed = new FormData();
  formAllowed.append('subject', 'CIT411');
  formAllowed.append('semester', 'Semester 7');
  formAllowed.append('title', 'Advanced Systems Official Lecture 1');
  formAllowed.append('file', new Blob(['advanced systems official lecture note content'], { type: 'text/plain' }), 'adv_lecture1.txt');

  const resAllowed = await fetch(`${baseUrl}/api/files/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${teacherAToken}` },
    body: formAllowed
  });
  assert.equal(resAllowed.status, 200);

  // D. Admin removes CIT411 from Teacher Alpha
  const removeRes = await fetch(`${baseUrl}/api/admin/teachers/T_UUID_A/subjects/CIT411`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert.equal(removeRes.status, 200);

  // E. Teacher Alpha attempts another upload for CIT411 -> DENIED immediately (403)
  const formDeniedAgain = new FormData();
  formDeniedAgain.append('subject', 'CIT411');
  formDeniedAgain.append('semester', 'Semester 7');
  formDeniedAgain.append('title', 'Advanced Systems Lecture 2');
  formDeniedAgain.append('file', new Blob(['second note content'], { type: 'text/plain' }), 'adv_lecture2.txt');

  const resDeniedAgain = await fetch(`${baseUrl}/api/files/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${teacherAToken}` },
    body: formDeniedAgain
  });
  assert.equal(resDeniedAgain.status, 403);
});

test('Step 7.10: Teacher feed permissions update dynamically', async () => {
  // Initially (Teacher Alpha teaches Sem 1 & 3):
  // Post p7 (Semester 7 student post) is NOT visible to Teacher Alpha
  const feedInit = await fetch(`${baseUrl}/api/posts`, {
    headers: { Authorization: `Bearer ${teacherAToken}` }
  });
  assert.equal(feedInit.status, 200);
  const dataInit = await feedInit.json();
  const initPosts = dataInit.posts || [];
  const foundP7Init = initPosts.find(p => p.content.includes('Semester 7 project guidelines'));
  assert.equal(foundP7Init, undefined, 'Sem 7 student post must not be visible to Teacher Alpha initially');

  // Admin assigns CIT411 (Sem 7) to Teacher Alpha
  await fetch(`${baseUrl}/api/admin/teachers/T_UUID_A/subjects`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`
    },
    body: JSON.stringify({ subjectId: 'CIT411' })
  });

  // Now Teacher Alpha's feed includes Semester 7 student post
  const feedWithSem7 = await fetch(`${baseUrl}/api/posts`, {
    headers: { Authorization: `Bearer ${teacherAToken}` }
  });
  assert.equal(feedWithSem7.status, 200);
  const dataSem7 = await feedWithSem7.json();
  const foundP7After = (dataSem7.posts || []).find(p => p.content.includes('Semester 7 project guidelines'));
  assert.ok(foundP7After, 'Sem 7 student post must become visible after CIT411 is assigned');

  // Admin removes CIT411 from Teacher Alpha
  await fetch(`${baseUrl}/api/admin/teachers/T_UUID_A/subjects/CIT411`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminToken}` }
  });

  // Now Teacher Alpha's feed loses Semester 7 student post
  const feedAfterRemove = await fetch(`${baseUrl}/api/posts`, {
    headers: { Authorization: `Bearer ${teacherAToken}` }
  });
  assert.equal(feedAfterRemove.status, 200);
  const dataAfterRemove = await feedAfterRemove.json();
  const foundP7Removed = (dataAfterRemove.posts || []).find(p => p.content.includes('Semester 7 project guidelines'));
  assert.equal(foundP7Removed, undefined, 'Sem 7 student post must no longer be visible after CIT411 is removed');
});

test('Step 7.11: Removing one subject does not remove access to semester if another assigned subject remains there', async () => {
  // Teacher Alpha has BCT111 (Sem 1) and CIT111 (Sem 1).
  // Admin removes BCT111
  const removeRes = await fetch(`${baseUrl}/api/admin/teachers/T_UUID_A/subjects/BCT111`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert.equal(removeRes.status, 200);

  const data = await removeRes.json();
  // Derived semesters should STILL contain 1 because CIT111 (Sem 1) remains assigned!
  assert.ok(data.derivedSemesters.includes(1), 'Semester 1 must remain derived while CIT111 is assigned');

  // Teacher Alpha can still publish for CIT111
  const formCIT111 = new FormData();
  formCIT111.append('subject', 'CIT111');
  formCIT111.append('semester', 'Semester 1');
  formCIT111.append('title', 'CIT111 Remaining Coursework');
  formCIT111.append('file', new Blob(['cit111 notes'], { type: 'text/plain' }), 'cit111.txt');

  const res111 = await fetch(`${baseUrl}/api/files/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${teacherAToken}` },
    body: formCIT111
  });
  assert.equal(res111.status, 200, 'Publishing for remaining assigned subject in same semester must succeed');
});

test('Step 7.12: Historical materials remain intact after subject removal', async () => {
  // Query files table for note uploaded during Step 7.9 when CIT411 was temporarily assigned
  const historicalFile = await db.get(
    `SELECT * FROM files WHERE uploadedBy = ? AND title = ?`,
    't_prof_a', 'Advanced Systems Official Lecture 1'
  );
  assert.ok(historicalFile, 'Historical file record must exist in database');
  assert.equal(historicalFile.uploadedBy, 't_prof_a');
  assert.equal(historicalFile.title, 'Advanced Systems Official Lecture 1');

  // Verify historical note is retrievable via teacher notes API
  const notesRes = await fetch(`${baseUrl}/api/teacher/notes`, {
    headers: { Authorization: `Bearer ${teacherAToken}` }
  });
  assert.equal(notesRes.status, 200);
  const notesData = await notesRes.json();
  const found = (notesData.notes || []).find(n => n.title === 'Advanced Systems Official Lecture 1');
  assert.ok(found, 'Historical note must remain present in teacher My Notes workspace');
});

test('Step 7.13: Teacher onboarding flag can be disabled via TEACHER_ONBOARDING_ENABLED=0', async () => {
  const prevFlag = process.env.TEACHER_ONBOARDING_ENABLED;
  process.env.TEACHER_ONBOARDING_ENABLED = '0';
  try {
    assert.equal(isTeacherOnboardingEnabled(), false);

    const res = await fetch(`${baseUrl}/api/teacher/onboarding/validate-credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'teacher001', password: 'TempPassword!' })
    });
    assert.equal(res.status, 503);
    const data = await res.json();
    assert.ok(data.message.includes('disabled'));
  } finally {
    if (prevFlag === undefined) {
      delete process.env.TEACHER_ONBOARDING_ENABLED;
    } else {
      process.env.TEACHER_ONBOARDING_ENABLED = prevFlag;
    }
  }
});
