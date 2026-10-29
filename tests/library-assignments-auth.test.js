'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');

const testDbPath = path.join(os.tmpdir(), `lib_assign_auth_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
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
} = require('../lib/teacher-service');

let server;
let baseUrl;

const adminPassword = 'Admin_Pass123!';
const studentPassword = 'Student_Pass123!';
const teacherAPassword = 'TeacherA_Pass123!';
const teacherBPassword = 'TeacherB_Pass123!';

let adminToken = '';
let studentToken = '';
let teacherAToken = '';
let teacherBToken = '';

let adminCookie = '';
let studentCookie = '';
let teacherACookie = '';
let teacherBCookie = '';

test.before(async () => {
  await db.initSchema();
  await ensureTeacherSchema({ exec: db.exec, isPostgres: db.isPostgres });
  await seedCanonicalSubjects(db);

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
  const hashTeachA = bcrypt.hashSync(teacherAPassword, 10);
  const hashTeachB = bcrypt.hashSync(teacherBPassword, 10);

  // 1. Seed Admin
  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    'admin_usr', 'admin_boss', 'Admin Boss', 'admin@gandaki.edu.np', 'admin', hashAdmin, null
  );

  // 2. Seed Student (Semester 3)
  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    'stu_usr', 'stu_charlie', 'Student Charlie', 'charlie@gandaki.edu.np', 'student', hashStudent, 'Semester 3'
  );

  // 3. Seed Teacher Alpha (Assigned: BCT111 [Sem 1], BCT211 [Sem 3])
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
    'ts_a_2', 'T_UUID_A', 'BCT211'
  );

  // 4. Seed Teacher Beta (Assigned: ELX111 [Sem 1])
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

  // Logins - Admin
  const adminMob = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: 'admin_usr', password: adminPassword })
  });
  adminToken = (await adminMob.json()).token;

  const adminWeb = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: 'admin_usr', password: adminPassword })
  });
  adminCookie = adminWeb.headers.get('set-cookie') || '';

  // Logins - Student
  const stuMob = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: 'stu_usr', password: studentPassword })
  });
  studentToken = (await stuMob.json()).token;

  const stuWeb = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: 'stu_usr', password: studentPassword })
  });
  studentCookie = stuWeb.headers.get('set-cookie') || '';

  // Logins - Teacher Alpha
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

  // Logins - Teacher Beta
  const tBMob = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: 't_prof_b', password: teacherBPassword })
  });
  teacherBToken = (await tBMob.json()).token;

  const tBWeb = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: 't_prof_b', password: teacherBPassword })
  });
  teacherBCookie = tBWeb.headers.get('set-cookie') || '';
});

test.after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  try {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  } catch (_) {}
});

test('Scenario 1: Student note upload UI is hidden on website and mobile', async () => {
  const libraryHtml = fs.readFileSync(path.join(__dirname, '../public/library.html'), 'utf8');
  const libraryMobile = fs.readFileSync(path.join(__dirname, '../mobile/app/(tabs)/library.tsx'), 'utf8');
  const indexMobile = fs.readFileSync(path.join(__dirname, '../mobile/app/(tabs)/index.tsx'), 'utf8');

  // Website: upload button is hidden for students
  assert.match(libraryHtml, /id="uploadNotesBtn"\s+style="display:none;"/, 'Website upload button must default to display:none');
  assert.match(libraryHtml, /if\s*\(academicCtx\.isStudent\)\s*\{[\s\S]*uploadBtn\.style\.display\s*=\s*'none'/, 'Website init() must hide upload button for students');
  assert.match(libraryHtml, /let\s+canManageThisCourse\s*=\s*false;/, 'Drawer upload actions must default to false for students');

  // Mobile library: Add note button and EmptyState upload action are guarded with isStaff
  assert.match(libraryMobile, /\{isStaff\s*&&\s*\(\s*<TouchableOpacity[\s\S]*accessibilityLabel="Add note"/, 'Mobile library Add note (+) button must be wrapped in isStaff');
  assert.match(libraryMobile, /actionTitle=\{isStaff\s*\?\s*"Upload Note"\s*:\s*undefined\}/, 'Mobile EmptyState must hide Upload Note action for students');

  // Mobile home: quick action Upload button is guarded with isStaff
  assert.match(indexMobile, /\{isStaff\s*&&\s*\(\s*<TouchableOpacity[\s\S]*Upload[\s\S]*<\/TouchableOpacity>\s*\)\}/, 'Mobile home quick action Upload must be wrapped in isStaff');
});

test('Scenario 2: Student note upload API rejects with 403 Forbidden', async () => {
  // 1. /api/files/authorize-upload
  const authRes = await fetch(`${baseUrl}/api/files/authorize-upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${studentToken}`
    },
    body: JSON.stringify({ filename: 'test_note.pdf', subject: 'Data Structures' })
  });
  assert.equal(authRes.status, 403, 'Student authorize-upload must return 403');

  // 2. /api/files/record-upload
  const recRes = await fetch(`${baseUrl}/api/files/record-upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${studentToken}`
    },
    body: JSON.stringify({
      filename: 'test_note.pdf',
      subject: 'Data Structures',
      semester: 'Semester 3'
    })
  });
  assert.equal(recRes.status, 403, 'Student record-upload must return 403');

  // 3. /api/files/upload with FormData
  const form = new FormData();
  form.append('files', new Blob(['fake content'], { type: 'application/pdf' }), 'stu_note.pdf');
  form.append('subject', 'BCT111');
  form.append('semester', 'Semester 1');
  const upRes = await fetch(`${baseUrl}/api/files/upload`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${studentToken}`
    },
    body: form
  });
  assert.equal(upRes.status, 403, 'Student upload must return 403');

  // 4. /api/code-lab/assignments (assignment creation)
  const assignRes = await fetch(`${baseUrl}/api/code-lab/assignments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${studentToken}`
    },
    body: JSON.stringify({
      title: 'Student Attempt Assignment',
      subject: 'Data Structures',
      semester: '3',
      questions: [{ title: 'Q1', description: 'Desc' }]
    })
  });
  assert.equal(assignRes.status, 403, 'Student assignment creation must return 403');
});

test('Scenario 3: Teacher note upload succeeds for assigned subject', async () => {
  // Teacher Alpha is assigned BCT111
  const form = new FormData();
  form.append('files', new Blob(['lecture 1 pdf content'], { type: 'application/pdf' }), 'alice_lecture_1.pdf');
  form.append('subject', 'BCT111');
  form.append('semester', 'Semester 1');
  form.append('chapter', 'Unit 1: Introduction');

  const uploadRes = await fetch(`${baseUrl}/api/files/upload`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${teacherAToken}`
    },
    body: form
  });
  assert.equal(uploadRes.status, 200, 'Teacher note upload on assigned subject must return 200');
  const data = await uploadRes.json();
  assert.ok(data.files && data.files.length > 0, 'Must return created file record');
});

test('Scenario 4: Teacher note upload/delete rejected with 403 for unassigned subject', async () => {
  // Teacher Alpha attempts upload for ELX111 (assigned only to Teacher Beta)
  const formA = new FormData();
  formA.append('files', new Blob(['unauthorized pdf content'], { type: 'application/pdf' }), 'unauthorized_note.pdf');
  formA.append('subject', 'ELX111');
  formA.append('semester', 'Semester 1');

  const unauthUploadRes = await fetch(`${baseUrl}/api/files/upload`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${teacherAToken}`
    },
    body: formA
  });
  assert.equal(unauthUploadRes.status, 403, 'Teacher note upload on unassigned subject must return 403');

  // Teacher Beta uploads a note under ELX111
  const formB = new FormData();
  formB.append('files', new Blob(['bob pdf content'], { type: 'application/pdf' }), 'bob_note.pdf');
  formB.append('subject', 'ELX111');
  formB.append('semester', 'Semester 1');

  const bUploadRes = await fetch(`${baseUrl}/api/files/upload`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${teacherBToken}`
    },
    body: formB
  });
  assert.equal(bUploadRes.status, 200);
  const betaFileId = (await bUploadRes.json()).files[0].id;

  // Teacher Alpha attempts to delete Teacher Beta's file
  const delRes = await fetch(`${baseUrl}/api/files/${betaFileId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${teacherAToken}`
    }
  });
  assert.equal(delRes.status, 403, 'Teacher note delete on unassigned subject must return 403');
});

test('Scenario 5: Teacher assignment creation succeeds for assigned subject', async () => {
  // Teacher Alpha is assigned BCT211
  const res = await fetch(`${baseUrl}/api/code-lab/assignments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      title: 'Lab 1 - Algorithmic Complexity',
      description: 'Implement asymptotic analysis tests',
      subject: 'BCT211',
      semester: '3',
      dueDate: '2026-12-31',
      questions: [
        {
          title: 'Implement Merge Sort',
          description: 'Sort an array of n integers in O(n log n)',
          marks: 10,
          starterCode: '# write code here\n',
          solutionCode: 'print(1)\n',
          testCases: [{ input: '5', expectedOutput: '5', isHidden: false }]
        }
      ]
    })
  });

  assert.ok(res.status === 200 || res.status === 201, 'Teacher assignment creation on assigned subject must return 200/201');
  const body = await res.json();
  assert.ok(body.id, 'Must return created assignment ID');
});

test('Scenario 6: Teacher assignment creation/delete rejected with 403 for unassigned subject', async () => {
  // Teacher Alpha attempts assignment creation for ELX111 (assigned only to Teacher Beta)
  const res = await fetch(`${baseUrl}/api/code-lab/assignments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      title: 'Unauthorized Assignment',
      subject: 'ELX111',
      semester: '1',
      questions: [{ title: 'Q1', description: 'Desc' }]
    })
  });
  assert.equal(res.status, 403, 'Teacher assignment creation on unassigned subject must return 403');

  // Teacher Beta creates assignment under ELX111
  const betaAssignRes = await fetch(`${baseUrl}/api/code-lab/assignments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${teacherBToken}`
    },
    body: JSON.stringify({
      title: 'Electronics Lab 1',
      subject: 'ELX111',
      semester: '1',
      questions: [{ title: 'Q1', description: 'Desc' }]
    })
  });
  assert.ok(betaAssignRes.status === 200 || betaAssignRes.status === 201);
  const betaAssignId = (await betaAssignRes.json()).id;

  // Teacher Alpha attempts to delete Teacher Beta's assignment
  const delRes = await fetch(`${baseUrl}/api/code-lab/assignments/${betaAssignId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${teacherAToken}`
    }
  });
  assert.equal(delRes.status, 403, 'Teacher assignment delete on unassigned subject must return 403');
});

test('Scenario 7: Unauthenticated visitor gets login prompt on Library and Assignments', async () => {
  const libraryHtml = fs.readFileSync(path.join(__dirname, '../public/library.html'), 'utf8');
  const subjectsHtml = fs.readFileSync(path.join(__dirname, '../public/code-lab/subjects.html'), 'utf8');

  // Both pages have auth-gate-card styles
  assert.match(libraryHtml, /\.auth-gate-card/, 'library.html must include .auth-gate-card');
  assert.match(subjectsHtml, /\.auth-gate-card/, 'subjects.html must include .auth-gate-card');

  // Both pages check authentication in init() and render the gate prompt
  assert.match(libraryHtml, /if\s*\(!academicCtx\s*\|\|\s*!academicCtx\.authenticated\)/, 'library.html must gate unauthenticated visitors');
  assert.match(libraryHtml, /You're not logged in\./, 'library.html must show "You\'re not logged in."');

  assert.match(subjectsHtml, /if\s*\(!academicContext\s*\|\|\s*!academicContext\.authenticated\)/, 'subjects.html must gate unauthenticated visitors');
  assert.match(subjectsHtml, /You're not logged in\./, 'subjects.html must show "You\'re not logged in."');

  // Both pages prevent flash of content
  assert.match(libraryHtml, /id="uploadNotesBtn"\s+style="display:none;"/, 'library.html upload button must be hidden initially');
  assert.match(subjectsHtml, /id="dashCreateAssignBtn"[\s\S]*style="display:none;"/, 'subjects.html create button must be hidden initially');
});

test('Scenario 8: Authenticated student on website sees only assigned semester/cohort', async () => {
  const libraryHtml = fs.readFileSync(path.join(__dirname, '../public/library.html'), 'utf8');
  const subjectsHtml = fs.readFileSync(path.join(__dirname, '../public/code-lab/subjects.html'), 'utf8');

  assert.match(libraryHtml, /if\s*\(academicCtx\.isStudent\)\s*\{[\s\S]*ACTIVE_SEM\s*=\s*academicCtx\.semesterRoman;/, 'library.html sets ACTIVE_SEM for student');
  assert.match(subjectsHtml, /if\s*\(!isStaff\)\s*\{[\s\S]*currentSemesterFilter\s*=\s*String\(academicContext\.currentSemester\);/, 'subjects.html sets currentSemesterFilter for student');
  assert.match(subjectsHtml, /semWrap\.style\.display\s*=\s*'none'/, 'subjects.html hides semester dropdown for student');
});

test('Scenario 9: Authenticated teacher sees assigned subjects and management controls', async () => {
  // GET /api/code-lab/subjects returns only assigned subjects for teacher
  const resA = await fetch(`${baseUrl}/api/code-lab/subjects`, {
    headers: { 'Authorization': `Bearer ${teacherAToken}` }
  });
  assert.equal(resA.status, 200);
  const dataA = await resA.json();
  const allTeacherACourses = (dataA.semesters || []).flatMap(s => s.courses || []);
  const teacherACourseTitles = allTeacherACourses.map(c => c.title || c.name);

  // Teacher Alpha teaches BCT111 and BCT211, NOT ELX111
  assert.ok(teacherACourseTitles.includes('BCT111') || allTeacherACourses.some(c => c.code === 'BCT111'));
  assert.ok(teacherACourseTitles.includes('BCT211') || allTeacherACourses.some(c => c.code === 'BCT211'));
  assert.ok(!teacherACourseTitles.includes('ELX111') && !allTeacherACourses.some(c => c.code === 'ELX111'));

  // Website library: setupUploadModalControls filters modalSemesterSelect and modalSubjectSelect for teacher
  const libraryHtml = fs.readFileSync(path.join(__dirname, '../public/library.html'), 'utf8');
  assert.match(libraryHtml, /const\s+isTeacher\s*=\s*academicCtx\s*&&\s*academicCtx\.role\s*===\s*'teacher';/, 'library.html checks isTeacher in modal');
  assert.match(libraryHtml, /teacherSubsForSem\.forEach/, 'library.html restricts courses for teacher');

  // Website assignments: create.html guards against student and loads teacher subjects
  const createHtml = fs.readFileSync(path.join(__dirname, '../public/code-lab/create.html'), 'utf8');
  assert.match(createHtml, /academicCtx\.isStudent\s*\|\|\s*\(!academicCtx\.isStaff/, 'create.html redirects non-staff users');
  assert.match(createHtml, /if\s*\(isTeacher\)\s*\{[\s\S]*fetch\('\/api\/code-lab\/subjects'\)/, 'create.html fetches teacher subjects');
});

test('Scenario 10: Mobile student Library header has no redundant badges or add button', async () => {
  const libraryMobile = fs.readFileSync(path.join(__dirname, '../mobile/app/(tabs)/library.tsx'), 'utf8');

  // header displayLabel badge guarded by isStaff
  assert.match(libraryMobile, /\{isStaff\s*&&\s*Boolean\(displayLabel\)\s*&&\s*\(/, 'displayLabel badge must only render for isStaff');

  // header add note button guarded by isStaff
  assert.match(libraryMobile, /\{isStaff\s*&&\s*\(\s*<TouchableOpacity[\s\S]*accessibilityLabel="Add note"/, 'Add note button must only render for isStaff');
});

test('Scenario 11: Mobile student Library section header has no redundant subtitle/counts', async () => {
  const libraryMobile = fs.readFileSync(path.join(__dirname, '../mobile/app/(tabs)/library.tsx'), 'utf8');

  // section row displayLabel caption guarded by isStaff
  assert.match(libraryMobile, /<Subheading>Subjects & Curriculum<\/Subheading>\s*\{isStaff\s*&&\s*Boolean\(displayLabel\)/, 'Section displayLabel must only render for isStaff');

  // section row available subjects count guarded by isStaff
  assert.match(libraryMobile, /\{isStaff\s*&&\s*<Caption color="muted">\{subjects\.length\}\s*Available<\/Caption>\}/, 'Available subjects count must only render for isStaff');
});

test('Scenario 12: Mobile student Library subject cards have no "View Syllabus" button, but chapter view retains syllabus button', async () => {
  const libraryMobile = fs.readFileSync(path.join(__dirname, '../mobile/app/(tabs)/library.tsx'), 'utf8');

  // Inside subjects.map, View Syllabus must NOT appear
  const subjectsMapIdx = libraryMobile.indexOf('{subjects.map((subject)');
  assert.ok(subjectsMapIdx !== -1, 'subjects.map must exist in library.tsx');
  const subjectsMapChunk = libraryMobile.slice(subjectsMapIdx, subjectsMapIdx + 1600);
  assert.doesNotMatch(subjectsMapChunk, /View Syllabus/, 'Subject card bottom row must NOT have "View Syllabus" button');

  // Inside LEVEL 2: CHAPTERS VIEW, View Syllabus MUST appear
  assert.match(libraryMobile, /LEVEL 2: CHAPTERS VIEW[\s\S]*View Syllabus/, 'Chapter view must retain "View Syllabus" button');
});

test('Scenario 13: Regressions checked (student submissions, browsing, admin access)', async () => {
  // 1. Student can list library files, receives canDelete: false
  const filesRes = await fetch(`${baseUrl}/api/files`, {
    headers: { 'Authorization': `Bearer ${studentToken}` }
  });
  assert.equal(filesRes.status, 200, 'Student can list files');
  const files = await filesRes.json();
  assert.ok(Array.isArray(files));
  files.forEach(f => {
    assert.equal(f.canDelete, false, 'Student must receive canDelete: false for all files');
  });

  // 2. Student can list assignments
  const assignRes = await fetch(`${baseUrl}/api/code-lab/assignments`, {
    headers: { 'Authorization': `Bearer ${studentToken}` }
  });
  assert.equal(assignRes.status, 200, 'Student can list assignments');

  // 3. Admin can upload any note and create assignments
  const adminForm = new FormData();
  adminForm.append('files', new Blob(['admin note content'], { type: 'application/pdf' }), 'admin_overview.pdf');
  adminForm.append('subject', 'BCT111');
  adminForm.append('semester', 'Semester 1');
  adminForm.append('chapter', 'General');

  const adminNote = await fetch(`${baseUrl}/api/files/upload`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${adminToken}`
    },
    body: adminForm
  });
  assert.equal(adminNote.status, 200, 'Admin can upload note');

  const adminAssign = await fetch(`${baseUrl}/api/code-lab/assignments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      title: 'Admin Universal Assignment',
      subject: 'ELX111',
      semester: '1',
      questions: [{ title: 'Admin Q', description: 'Admin Desc' }]
    })
  });
  assert.ok(adminAssign.status === 200 || adminAssign.status === 201, 'Admin can create assignment for any subject');
});

test('Scenario 14: Student can add questions to PDF assignment and submit code with custom question title', async () => {
  // 1. Teacher Alpha creates a PDF assignment for Semester 3 subject BCT211
  const createPdfAssignRes = await fetch(`${baseUrl}/api/code-lab/assignments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      title: 'Lab Sheet 1 - PDF Assignment',
      subject: 'BCT211',
      semester: '3',
      pdfUrl: '/api/code-lab/pdf/lab_sheet_1.pdf',
      pdfName: 'lab_sheet_1.pdf'
    })
  });
  assert.ok(createPdfAssignRes.status === 200 || createPdfAssignRes.status === 201, 'Teacher creates PDF assignment');
  const assignData = await createPdfAssignRes.json();
  const assignmentId = assignData.id || assignData.assignmentId;
  assert.ok(assignmentId, 'Assignment ID must be returned');

  // Verify initial question 1 was generated
  const getAssignRes = await fetch(`${baseUrl}/api/code-lab/assignments/${assignmentId}`, {
    headers: { 'Authorization': `Bearer ${studentToken}` }
  });
  assert.equal(getAssignRes.status, 200);
  const getAssignData = await getAssignRes.json();
  assert.equal(getAssignData.questions.length, 1);
  const q1 = getAssignData.questions[0];

  // 2. Student adds question slot (POST /student-questions)
  const addQRes = await fetch(`${baseUrl}/api/code-lab/assignments/${assignmentId}/student-questions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${studentToken}`
    },
    body: JSON.stringify({ language: 'c', title: 'Problem 2: Matrix Multiplication' })
  });
  assert.equal(addQRes.status, 200, 'Student should be allowed to add question slot for PDF assignment');
  const addQData = await addQRes.json();
  assert.equal(addQData.success, true);
  assert.ok(addQData.question && addQData.question.id);
  assert.equal(addQData.question.questionNumber, 2);
  const q2 = addQData.question;

  // 3. Student submits code for Question 1 with custom question title (POST /questions/:id/submissions)
  const subQ1Res = await fetch(`${baseUrl}/api/code-lab/questions/${q1.id}/submissions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${studentToken}`
    },
    body: JSON.stringify({
      code: '#include <stdio.h>\nint main() { printf("Hello Q1\\n"); return 0; }',
      stdout: 'Hello Q1\n',
      stderr: '',
      questionTitle: 'Q1: Pointer Basics'
    })
  });
  assert.equal(subQ1Res.status, 200, 'Student code submission for Q1 must succeed without ReferenceError');
  const subQ1Data = await subQ1Res.json();
  assert.equal(subQ1Data.message, 'Submitted successfully');
  assert.equal(subQ1Data.questionTitle, 'Q1: Pointer Basics');

  // 4. Student submits code for newly added Question 2
  const subQ2Res = await fetch(`${baseUrl}/api/code-lab/questions/${q2.id}/submissions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${studentToken}`
    },
    body: JSON.stringify({
      code: '#include <stdio.h>\nint main() { printf("Hello Q2\\n"); return 0; }',
      stdout: 'Hello Q2\n',
      stderr: '',
      questionTitle: 'Problem 2: Matrix Multiplication'
    })
  });
  assert.equal(subQ2Res.status, 200, 'Student code submission for Q2 must succeed');
  const subQ2Data = await subQ2Res.json();
  assert.equal(subQ2Data.message, 'Submitted successfully');
  assert.equal(subQ2Data.questionTitle, 'Problem 2: Matrix Multiplication');

  // 5. Verify assignment details return both questions and both student submissions with custom titles
  const reGetAssignRes = await fetch(`${baseUrl}/api/code-lab/assignments/${assignmentId}`, {
    headers: { 'Authorization': `Bearer ${studentToken}` }
  });
  assert.equal(reGetAssignRes.status, 200);
  const reGetData = await reGetAssignRes.json();
  assert.equal(reGetData.questions.length, 2);

  const reQ1 = reGetData.questions.find(q => q.id === q1.id);
  assert.ok(reQ1 && reQ1.userSubmission);
  assert.equal(reQ1.userSubmission.questionTitle, 'Q1: Pointer Basics');
  assert.ok(reQ1.userSubmission.code.includes('Hello Q1'));

  const reQ2 = reGetData.questions.find(q => q.id === q2.id);
  assert.ok(reQ2 && reQ2.userSubmission);
  assert.equal(reQ2.userSubmission.questionTitle, 'Problem 2: Matrix Multiplication');
  assert.ok(reQ2.userSubmission.code.includes('Hello Q2'));
});
