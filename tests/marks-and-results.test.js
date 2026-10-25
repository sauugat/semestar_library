'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');
const vm = require('vm');
const { PassThrough } = require('stream');

const testDbPath = path.join(
  os.tmpdir(),
  `marks_results_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`
);
process.env.NODE_ENV = 'test';
process.env.DB_PATH = testDbPath;
process.env.SEMESTER_DB_SKIP_INIT = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

const app = require('../server');
const db = require('../db');
const {
  ensureAcademicCohortSchema,
  createCohort
} = require('../lib/academic-context');
const {
  ensureTeacherSchema,
  seedCanonicalSubjects
} = require('../lib/teacher-service');
const { ensureAuditSchema } = require('../lib/audit-service');
const { ensureAttendanceSchema } = require('../lib/attendance-service');
const { ensureMarksSchema } = require('../lib/marks-service');

let server;
let baseUrl = 'http://127.0.0.1';
let useInProcessExpress = false;

async function appFetch(urlOrPath, options = {}) {
  if (!useInProcessExpress && server && server.listening) {
    return global.fetch(urlOrPath, options);
  }

  const parsedUrl = new URL(urlOrPath, 'http://127.0.0.1');
  const method = (options.method || 'GET').toUpperCase();
  const rawHeaders = options.headers || {};
  const headers = {};
  for (const [k, v] of Object.entries(rawHeaders)) {
    headers[k.toLowerCase()] = String(v);
  }

  let bodyBuf = null;
  if (options.body !== undefined && options.body !== null) {
    bodyBuf = Buffer.isBuffer(options.body)
      ? options.body
      : Buffer.from(
          typeof options.body === 'string' ? options.body : JSON.stringify(options.body),
          'utf8'
        );
    if (!headers['content-length']) {
      headers['content-length'] = String(bodyBuf.length);
    }
  }

  return new Promise((resolve, reject) => {
    const reqSocket = new PassThrough();
    reqSocket.remoteAddress = '127.0.0.1';
    reqSocket.destroy = () => {};

    const req = new http.IncomingMessage(reqSocket);
    req.method = method;
    req.url = parsedUrl.pathname + parsedUrl.search;
    req.headers = headers;
    req.connection = reqSocket;
    req.socket = reqSocket;

    const res = new http.ServerResponse(req);
    const resChunks = [];

    const origWrite = res.write.bind(res);
    const origEnd = res.end.bind(res);

    res.write = (chunk, encoding, cb) => {
      if (chunk) {
        resChunks.push(
          Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), encoding || 'utf8')
        );
      }
      return origWrite(chunk, encoding, cb);
    };

    res.end = (chunk, encoding, cb) => {
      if (chunk && typeof chunk !== 'function') {
        resChunks.push(
          Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), encoding || 'utf8')
        );
      }
      origEnd(chunk, encoding, cb);
      const rawBuffer = Buffer.concat(resChunks);
      const rawText = rawBuffer.toString('utf8');
      resolve({
        status: res.statusCode || 200,
        ok: (res.statusCode || 200) >= 200 && (res.statusCode || 200) < 300,
        headers: {
          get: (name) => res.getHeader(name.toLowerCase()) || null
        },
        buffer: async () => rawBuffer,
        arrayBuffer: async () => rawBuffer.buffer.slice(rawBuffer.byteOffset, rawBuffer.byteOffset + rawBuffer.byteLength),
        text: async () => rawText,
        json: async () => (rawText ? JSON.parse(rawText) : null)
      });
    };

    try {
      app(req, res);
      if (bodyBuf) req.push(bodyBuf);
      req.push(null);
    } catch (err) {
      reject(err);
    }
  });
}

const PASSWORD = 'Test_Password123!';
let adminToken = '';
let teacherAToken = '';
let teacherBToken = '';
let student1Token = '';
let student2Token = '';
let studentSem2Token = '';
let cohortMercury = null;
let cohortVenus = null;

test.before(async () => {
  await db.initSchema();
  await ensureAcademicCohortSchema({
    exec: db.exec,
    run: db.run,
    all: db.all,
    isPostgres: db.isPostgres
  });
  await ensureTeacherSchema({ exec: db.exec, isPostgres: db.isPostgres });
  await ensureAuditSchema(db);
  await ensureAttendanceSchema(db);
  await ensureMarksSchema(db);
  await seedCanonicalSubjects(db);

  await db.run('DELETE FROM marks_audit_logs');
  await db.run('DELETE FROM student_marks');
  await db.run('DELETE FROM exam_configurations');
  await db.run('DELETE FROM students');

  await new Promise((resolve) => {
    let settled = false;
    const finish = (inProc) => {
      if (settled) return;
      settled = true;
      useInProcessExpress = inProc;
      resolve();
    };
    try {
      server = http.createServer(app);
      server.unref?.();
      server.once('error', () => finish(true));
      const timer = setTimeout(() => {
        try { server.close(); } catch (_) {}
        finish(true);
      }, 250);
      server.listen(0, '127.0.0.1', () => {
        clearTimeout(timer);
        const addr = server.address();
        if (addr && addr.port) {
          baseUrl = `http://127.0.0.1:${addr.port}`;
          finish(false);
        } else {
          finish(true);
        }
      });
    } catch (_) {
      finish(true);
    }
  });

  const passwordHash = bcrypt.hashSync(PASSWORD, 8);

  cohortMercury = await createCohort(db, {
    slotCode: 'mercury',
    displayName: 'Mercury',
    currentSemester: 1,
    intakeYear: 2026
  });

  cohortVenus = await createCohort(db, {
    slotCode: 'venus',
    displayName: 'Venus',
    currentSemester: 2,
    intakeYear: 2025
  });

  // Admin
  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, account_status)
     VALUES ('adm_mr_1', 'adm_mr_1', 'Admin Marks', 'adm_mr@gandaki.edu.np', 'admin', ?, NULL, 'active')`,
    passwordHash
  );

  // Teacher A: authorized for CIT111 (Semester 1) and BSM111 (Semester 1)
  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, department, account_status)
     VALUES ('tea_mr_a', 'prof_mr_a', 'Prof. Alice Marks', 'alice_mr@gandaki.edu.np', 'teacher', ?, NULL, 'BIT', 'active')`,
    passwordHash
  );
  await db.run(
    `INSERT INTO teachers (id, user_id, designation, status)
     VALUES ('tea_id_mr_a', 'tea_mr_a', 'Associate Professor', 'active')`
  );
  await db.run(
    `INSERT INTO teacher_subjects (id, teacher_id, subject_id) VALUES ('ts_mr_a1', 'tea_id_mr_a', 'CIT111')`
  );
  await db.run(
    `INSERT INTO teacher_subjects (id, teacher_id, subject_id) VALUES ('ts_mr_a2', 'tea_id_mr_a', 'BSM111')`
  );

  // Teacher B: authorized only for CIT121 (Semester 2)
  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, department, account_status)
     VALUES ('tea_mr_b', 'prof_mr_b', 'Prof. Bob Marks', 'bob_mr@gandaki.edu.np', 'teacher', ?, NULL, 'BIT', 'active')`,
    passwordHash
  );
  await db.run(
    `INSERT INTO teachers (id, user_id, designation, status)
     VALUES ('tea_id_mr_b', 'tea_mr_b', 'Lecturer', 'active')`
  );
  await db.run(
    `INSERT INTO teacher_subjects (id, teacher_id, subject_id) VALUES ('ts_mr_b1', 'tea_id_mr_b', 'CIT121')`
  );

  // Students in Semester 1 (Mercury Cohort)
  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, cohort_id, account_status)
     VALUES ('26020301', 'stu_mr_1', 'Aashrita Lamichhane', 'stu301@gandaki.edu.np', 'student', ?, 'Semester 1', ?, 'active')`,
    passwordHash,
    cohortMercury.id
  );
  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, cohort_id, account_status)
     VALUES ('26020302', 'stu_mr_2', 'Ankit Bhandari', 'stu302@gandaki.edu.np', 'student', ?, 'Semester 1', ?, 'active')`,
    passwordHash,
    cohortMercury.id
  );

  // Student in Semester 2 (Venus Cohort)
  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, cohort_id, account_status)
     VALUES ('25020101', 'stu_mr_sem2', 'Sujan SemTwo', 'stu101@gandaki.edu.np', 'student', ?, 'Semester 2', ?, 'active')`,
    passwordHash,
    cohortVenus.id
  );

  const login = async (id) => {
    const r = await appFetch(`${baseUrl}/api/mobile/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: id, password: PASSWORD })
    });
    return (await r.json()).token;
  };

  adminToken = await login('adm_mr_1');
  teacherAToken = await login('tea_mr_a');
  teacherBToken = await login('tea_mr_b');
  student1Token = await login('26020301');
  student2Token = await login('26020302');
  studentSem2Token = await login('25020101');
});

test.after(async () => {
  if (server && server.listening) {
    await new Promise((resolve) => server.close(resolve));
  }
  await db.close().catch(() => {});
  try {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  } catch (_) {}
});

test('1. Navigation, Pages, and Separation from Attendance: Marks Entry (Teacher) and Results (Student) are standalone pages with desktop & mobile navigation', async () => {
  const marksHtmlPath = path.join(__dirname, '..', 'public', 'marks-entry.html');
  const resultsHtmlPath = path.join(__dirname, '..', 'public', 'results.html');
  const attendanceHtmlPath = path.join(__dirname, '..', 'public', 'attendance.html');
  const teacherDashPath = path.join(__dirname, '..', 'public', 'teacher-dashboard.html');
  const dashboardHtmlPath = path.join(__dirname, '..', 'public', 'dashboard.html');
  const authJsPath = path.join(__dirname, '..', 'public', 'auth.js');

  assert.ok(fs.existsSync(marksHtmlPath), 'public/marks-entry.html must exist');
  assert.ok(fs.existsSync(resultsHtmlPath), 'public/results.html must exist');

  const marksHtml = fs.readFileSync(marksHtmlPath, 'utf8');
  const resultsHtml = fs.readFileSync(resultsHtmlPath, 'utf8');
  const attendanceHtml = fs.readFileSync(attendanceHtmlPath, 'utf8');
  const teacherDashHtml = fs.readFileSync(teacherDashPath, 'utf8');
  const dashboardHtml = fs.readFileSync(dashboardHtmlPath, 'utf8');
  const authJs = fs.readFileSync(authJsPath, 'utf8');

  // Verify Attendance page does NOT embed exam types as tabs/options
  assert.ok(!attendanceHtml.includes('Mid-Term Exam'));
  assert.ok(!attendanceHtml.includes('Pre-Board Exam'));
  assert.ok(!attendanceHtml.includes('Final Exam'));

  // Verify Teacher header navigation includes Marks Entry
  assert.ok(teacherDashHtml.includes('Marks Entry'));
  assert.ok(teacherDashHtml.includes('href="/marks-entry.html"'));
  assert.ok(dashboardHtml.includes('data-role-nav="teacher"'));
  assert.ok(dashboardHtml.includes('Marks Entry'));

  // Verify Student header navigation includes Results
  assert.ok(dashboardHtml.includes('data-role-nav="student"'));
  assert.ok(dashboardHtml.includes('Results'));

  // Verify auth.js initHeader toggles Marks Entry for teacher and Results for student across desktop/mobile nav
  assert.ok(authJs.includes('data-role-nav'));
  assert.ok(authJs.includes('marks-entry.html'));
  assert.ok(authJs.includes('results.html'));

  // Verify HTTP routes serve the standalone pages
  const marksPageRes = await appFetch(`${baseUrl}/marks-entry.html`);
  assert.equal(marksPageRes.status, 200);
  const marksPageText = await marksPageRes.text();
  assert.ok(marksPageText.includes('teacherMarksEntryMount'));

  const resultsPageRes = await appFetch(`${baseUrl}/results.html`);
  assert.equal(resultsPageRes.status, 200);
  const resultsPageText = await resultsPageRes.text();
  assert.ok(resultsPageText.includes('studentResultsMount'));
});

test('2. Teacher Authorization: Teacher sees only assigned subjects and is blocked from unauthorized subjects and students outside enrollment', async () => {
  // Teacher A context: only CIT111 and BSM111
  const ctxRes = await appFetch(`${baseUrl}/api/marks/teacher/context`, {
    headers: { Authorization: `Bearer ${teacherAToken}` }
  });
  assert.equal(ctxRes.status, 200);
  const ctxData = await ctxRes.json();
  assert.deepEqual(
    ctxData.subjects.map((s) => s.code).sort(),
    ['BSM111', 'CIT111']
  );
  assert.deepEqual(ctxData.examTypes, ['Mid-Term Exam', 'Pre-Board Exam', 'Final Exam']);

  // Teacher A attempting to access CIT121 (assigned to Teacher B) -> 403 UNAUTHORIZED_SUBJECT
  const unauthRosterRes = await appFetch(
    `${baseUrl}/api/marks/roster?subjectId=CIT121&examType=${encodeURIComponent('Mid-Term Exam')}`,
    { headers: { Authorization: `Bearer ${teacherAToken}` } }
  );
  assert.equal(unauthRosterRes.status, 403);
  const unauthRosterData = await unauthRosterRes.json();
  assert.equal(unauthRosterData.code, 'UNAUTHORIZED_SUBJECT');

  // Teacher A attempting to configure max marks for CIT121 -> 403
  const unauthConfigRes = await appFetch(`${baseUrl}/api/marks/config`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      subjectId: 'CIT121',
      examType: 'Mid-Term Exam',
      maxMarks: 50
    })
  });
  assert.equal(unauthConfigRes.status, 403);

  // Teacher A attempting to enter marks for a Semester 2 student (25020101) in Semester 1 subject CIT111 -> 403 STUDENT_NOT_ENROLLED
  const outOfEnrollmentRes = await appFetch(`${baseUrl}/api/marks/draft`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      subjectId: 'CIT111',
      examType: 'Mid-Term Exam',
      maxMarks: 30,
      records: [{ studentId: '25020101', obtainedMarks: 25 }]
    })
  });
  assert.equal(outOfEnrollmentRes.status, 403);
  const outOfEnrollmentData = await outOfEnrollmentRes.json();
  assert.equal(outOfEnrollmentData.code, 'STUDENT_NOT_ENROLLED');

  // Student attempting to access teacher context or save marks -> 403 FORBIDDEN
  const studentCtxRes = await appFetch(`${baseUrl}/api/marks/teacher/context`, {
    headers: { Authorization: `Bearer ${student1Token}` }
  });
  assert.equal(studentCtxRes.status, 403);

  const studentWriteRes = await appFetch(`${baseUrl}/api/marks/draft`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${student1Token}`
    },
    body: JSON.stringify({
      subjectId: 'CIT111',
      examType: 'Mid-Term Exam',
      maxMarks: 30,
      records: [{ studentId: '26020301', obtainedMarks: 30 }]
    })
  });
  assert.equal(studentWriteRes.status, 403);
});

test('3. Validation Rules: Maximum marks (> 0, non-assumed), negative marks, marks exceeding max, and malformed inputs', async () => {
  // 1. Maximum marks <= 0 or malformed must be rejected
  for (const invalidMax of [0, -10, 'abc', '', null]) {
    const res = await appFetch(`${baseUrl}/api/marks/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherAToken}`
      },
      body: JSON.stringify({
        subjectId: 'CIT111',
        examType: 'Mid-Term Exam',
        maxMarks: invalidMax
      })
    });
    assert.equal(res.status, 400, `maxMarks=${invalidMax} must be rejected with 400`);
  }

  // 2. Configure custom non-standard maxMarks (e.g., 40 for Mid-Term Exam, not assuming 25/50/100)
  const validConfigRes = await appFetch(`${baseUrl}/api/marks/config`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      subjectId: 'CIT111',
      examType: 'Mid-Term Exam',
      maxMarks: 40
    })
  });
  assert.equal(validConfigRes.status, 201);
  const validConfigData = await validConfigRes.json();
  assert.equal(validConfigData.config.maxMarks, 40);

  // 3. Negative obtained marks rejected
  const negRes = await appFetch(`${baseUrl}/api/marks/draft`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      subjectId: 'CIT111',
      examType: 'Mid-Term Exam',
      records: [{ studentId: '26020301', obtainedMarks: -1 }]
    })
  });
  assert.equal(negRes.status, 400);
  assert.equal((await negRes.json()).code, 'NEGATIVE_MARKS');

  // 4. Obtained marks exceeding configured maxMarks (45 > 40) rejected
  const exceedRes = await appFetch(`${baseUrl}/api/marks/draft`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      subjectId: 'CIT111',
      examType: 'Mid-Term Exam',
      records: [{ studentId: '26020301', obtainedMarks: 45 }]
    })
  });
  assert.equal(exceedRes.status, 400);
  assert.equal((await exceedRes.json()).code, 'MARKS_EXCEED_MAXIMUM');

  // 5. Malformed obtained marks rejected
  const malformedRes = await appFetch(`${baseUrl}/api/marks/draft`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      subjectId: 'CIT111',
      examType: 'Mid-Term Exam',
      records: [{ studentId: '26020301', obtainedMarks: 'thirty' }]
    })
  });
  assert.equal(malformedRes.status, 400);
  assert.equal((await malformedRes.json()).code, 'INVALID_MARKS');

  // 6. Invalid exam type rejected
  const badExamRes = await appFetch(`${baseUrl}/api/marks/draft`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      subjectId: 'CIT111',
      examType: 'Surprise Quiz',
      records: [{ studentId: '26020301', obtainedMarks: 20 }]
    })
  });
  assert.equal(badExamRes.status, 400);
  assert.equal((await badExamRes.json()).code, 'INVALID_EXAM_TYPE');
});

test('4. Draft Workflow, Missing Marks State, Reopening Drafts, Unpublished Student Isolation, and Publishing Results', async () => {
  // 1. Before any results are published, Student 1 sees empty results state
  const emptyRes = await appFetch(`${baseUrl}/api/results/my-results`, {
    headers: { Authorization: `Bearer ${student1Token}` }
  });
  assert.equal(emptyRes.status, 200);
  const emptyData = await emptyRes.json();
  assert.equal(emptyData.hasPublishedResults, false);
  assert.equal(emptyData.results.length, 0);

  // 2. Teacher A saves draft marks for CIT111 Mid-Term Exam (maxMarks = 40):
  //    Student 1 (26020301) = 34 (85%), Student 2 (26020302) = null (missing marks)
  const draftRes = await appFetch(`${baseUrl}/api/marks/draft`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      subjectId: 'CIT111',
      examType: 'Mid-Term Exam',
      records: [
        { studentId: '26020301', obtainedMarks: 34 },
        { studentId: '26020302', obtainedMarks: null }
      ]
    })
  });
  assert.equal(draftRes.status, 200);
  const draftData = await draftRes.json();
  assert.equal(draftData.summary.enteredCount, 1);
  assert.equal(draftData.summary.missingCount, 1);
  assert.equal(draftData.summary.draftCount, 1);
  assert.equal(draftData.summary.publishedCount, 0);

  const stu1Row = draftData.students.find((s) => s.studentId === '26020301');
  const stu2Row = draftData.students.find((s) => s.studentId === '26020302');
  assert.equal(stu1Row.obtainedMarks, 34);
  assert.equal(stu1Row.maxMarks, 40);
  assert.equal(stu1Row.percentage, 85);
  assert.equal(stu1Row.entryStatus, 'draft');

  // Missing marks must NOT be treated as 0
  assert.equal(stu2Row.obtainedMarks, null);
  assert.equal(stu2Row.percentage, null);
  assert.equal(stu2Row.entryStatus, 'missing');
  assert.equal(stu2Row.isMissing, true);

  // 3. CRITICAL: Unpublished draft marks must NOT be visible to Student 1
  const unpublishedCheckRes = await appFetch(`${baseUrl}/api/results/my-results`, {
    headers: { Authorization: `Bearer ${student1Token}` }
  });
  assert.equal(unpublishedCheckRes.status, 200);
  const unpublishedCheckData = await unpublishedCheckRes.json();
  assert.equal(unpublishedCheckData.hasPublishedResults, false);
  assert.equal(unpublishedCheckData.results.length, 0);

  // 4. Teacher reopens draft later, edits Student 1 to 36/40 (90%) and enters Student 2 as 30/40 (75%)
  const reopenRes = await appFetch(
    `${baseUrl}/api/marks/roster?subjectId=CIT111&examType=${encodeURIComponent('Mid-Term Exam')}`,
    { headers: { Authorization: `Bearer ${teacherAToken}` } }
  );
  assert.equal(reopenRes.status, 200);
  const reopenData = await reopenRes.json();
  assert.equal(reopenData.students.find((s) => s.studentId === '26020301').obtainedMarks, 34);

  const updateDraftRes = await appFetch(`${baseUrl}/api/marks/draft`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      subjectId: 'CIT111',
      examType: 'Mid-Term Exam',
      records: [
        { studentId: '26020301', obtainedMarks: 36 },
        { studentId: '26020302', obtainedMarks: 30 }
      ]
    })
  });
  assert.equal(updateDraftRes.status, 200);
  const updateDraftData = await updateDraftRes.json();
  assert.equal(updateDraftData.summary.draftCount, 2);
  assert.equal(updateDraftData.summary.missingCount, 0);

  // 5. Publish CIT111 Mid-Term Exam results
  const publishRes = await appFetch(`${baseUrl}/api/marks/publish`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      subjectId: 'CIT111',
      examType: 'Mid-Term Exam'
    })
  });
  assert.equal(publishRes.status, 200);
  const publishData = await publishRes.json();
  assert.equal(publishData.published, true);
  assert.equal(publishData.summary.publishedCount, 2);
  assert.equal(publishData.summary.draftCount, 0);
  assert.equal(publishData.summary.isPublished, true);

  // 6. Also configure and publish Pre-Board Exam (out of 60) and save Final Exam as DRAFT (out of 100) for CIT111
  await appFetch(`${baseUrl}/api/marks/publish`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      subjectId: 'CIT111',
      examType: 'Pre-Board Exam',
      maxMarks: 60,
      records: [
        { studentId: '26020301', obtainedMarks: 45 }, // 75%
        { studentId: '26020302', obtainedMarks: 54 }  // 90%
      ]
    })
  });

  // Final Exam saved ONLY as draft (must remain invisible to students)
  await appFetch(`${baseUrl}/api/marks/draft`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      subjectId: 'CIT111',
      examType: 'Final Exam',
      maxMarks: 100,
      records: [
        { studentId: '26020301', obtainedMarks: 88 },
        { studentId: '26020302', obtainedMarks: 79 }
      ]
    })
  });
});

test('5. Student Isolation, Published Results Calculation, and Editing Published Results with Audit Tracking', async () => {
  // 1. Student 1 retrieves own published results
  const s1Res = await appFetch(`${baseUrl}/api/results/my-results`, {
    headers: { Authorization: `Bearer ${student1Token}` }
  });
  assert.equal(s1Res.status, 200);
  const s1Data = await s1Res.json();

  assert.equal(s1Data.studentId, '26020301');
  assert.equal(s1Data.hasPublishedResults, true);
  // Only Mid-Term Exam and Pre-Board Exam are published; Final Exam is draft and must NOT appear
  assert.equal(s1Data.results.length, 2);
  assert.ok(s1Data.results.every((r) => r.studentId === '26020301'));
  assert.ok(s1Data.results.every((r) => r.status === 'published'));
  assert.ok(!s1Data.results.some((r) => r.examType === 'Final Exam'), 'Draft Final Exam must not leak to student');

  const midTerm = s1Data.results.find((r) => r.examType === 'Mid-Term Exam');
  const preBoard = s1Data.results.find((r) => r.examType === 'Pre-Board Exam');
  assert.equal(midTerm.obtainedMarks, 36);
  assert.equal(midTerm.maxMarks, 40);
  assert.equal(midTerm.percentage, 90);

  assert.equal(preBoard.obtainedMarks, 45);
  assert.equal(preBoard.maxMarks, 60);
  assert.equal(preBoard.percentage, 75);

  // 2. Student 1 attempting to access Student 2's results via query or URL parameter -> 403 CROSS_STUDENT_ACCESS_DENIED
  for (const url of [
    `${baseUrl}/api/results/my-results?studentId=26020302`,
    `${baseUrl}/api/results/my-results?student_id=26020302`,
    `${baseUrl}/api/results/my-results?userId=26020302`,
    `${baseUrl}/api/results/student/26020302`
  ]) {
    const crossRes = await appFetch(url, {
      headers: { Authorization: `Bearer ${student1Token}` }
    });
    assert.equal(crossRes.status, 403, `Cross-student access to ${url} must return 403`);
    const crossData = await crossRes.json();
    assert.equal(crossData.code, 'CROSS_STUDENT_ACCESS_DENIED');
  }

  // 3. Authorized teacher edits published Mid-Term Exam marks for Student 1 (from 36 to 38 out of 40 -> 95%)
  const editPubRes = await appFetch(`${baseUrl}/api/marks/published`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      subjectId: 'CIT111',
      examType: 'Mid-Term Exam',
      reason: 'Re-totalling correction on question 4',
      records: [
        { studentId: '26020301', obtainedMarks: 38 },
        { studentId: '26020302', obtainedMarks: 30 }
      ]
    })
  });
  assert.equal(editPubRes.status, 200);

  // Verify audit log recorded the published_marks_edited action with reason
  const auditRes = await appFetch(
    `${baseUrl}/api/marks/audit?subjectId=CIT111&examType=${encodeURIComponent('Mid-Term Exam')}`,
    { headers: { Authorization: `Bearer ${teacherAToken}` } }
  );
  assert.equal(auditRes.status, 200);
  const auditData = await auditRes.json();
  const editAudit = auditData.logs.find((l) => l.action === 'published_marks_edited');
  assert.ok(editAudit, 'Audit log must record published_marks_edited');
  assert.equal(editAudit.reason, 'Re-totalling correction on question 4');

  // Verify Student 1 now sees updated published mark 38/40 (95%)
  const s1AfterEdit = await (
    await appFetch(`${baseUrl}/api/results/my-results`, {
      headers: { Authorization: `Bearer ${student1Token}` }
    })
  ).json();
  const updatedMidTerm = s1AfterEdit.results.find((r) => r.examType === 'Mid-Term Exam');
  assert.equal(updatedMidTerm.obtainedMarks, 38);
  assert.equal(updatedMidTerm.percentage, 95);
});

test('6. Frontend Modules Verification: TeacherMarksEntryWorkspace and StudentResultsDashboard interactive state machines', async () => {
  const makeEl = (tag = 'div') => ({
    tagName: tag.toUpperCase(),
    id: '',
    className: '',
    textContent: '',
    value: '',
    style: {},
    attributes: {},
    listeners: {},
    _innerHTML: '',
    set innerHTML(val) {
      this._innerHTML = String(val);
    },
    get innerHTML() {
      return this._innerHTML;
    },
    setAttribute(k, v) {
      this.attributes[k] = String(v);
    },
    getAttribute(k) {
      return this.attributes[k] || null;
    },
    addEventListener(evt, fn) {
      this.listeners[evt] = fn;
    },
    appendChild() {},
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    }
  });

  // 1. Test TeacherMarksEntryWorkspace
  const teacherMount = makeEl('div');
  const teacherWindow = {
    URLSearchParams,
    confirm: () => true,
    addEventListener() {},
    document: {
      head: { appendChild() {} },
      getElementById: () => null,
      createElement: (tag) => makeEl(tag),
      querySelector: () => teacherMount
    },
    SemesterAuth: {
      authFetch: (url, opts = {}) =>
        appFetch(`${baseUrl}${url}`, {
          ...opts,
          headers: { ...(opts.headers || {}), Authorization: `Bearer ${teacherAToken}` }
        })
    }
  };
  teacherWindow.window = teacherWindow;

  const teacherScript = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'teacher-marks-entry.js'),
    'utf8'
  );
  vm.runInNewContext(teacherScript, teacherWindow);

  const tWorkspace = teacherWindow.TeacherMarksEntryWorkspace;
  await tWorkspace.mount(teacherMount);
  assert.ok(teacherMount.innerHTML.includes('Select a Subject for Marks Entry'));
  assert.ok(teacherMount.innerHTML.includes('CIT111'));
  assert.ok(teacherMount.innerHTML.includes('BSM111'));
  assert.ok(!teacherMount.innerHTML.includes('CIT121'));

  await tWorkspace.selectSubject('BSM111', 'Final Exam');
  assert.ok(teacherMount.innerHTML.includes('Mid-Term Exam'));
  assert.ok(teacherMount.innerHTML.includes('Pre-Board Exam'));
  assert.ok(teacherMount.innerHTML.includes('Final Exam'));

  tWorkspace.setMaxMarksInput('50');
  tWorkspace.setStudentMark('26020301', '42');
  tWorkspace.setStudentMark('26020302', '38');
  assert.equal(tWorkspace.hasUnsavedChanges(), true);

  await tWorkspace.publishResults();
  assert.equal(tWorkspace.hasUnsavedChanges(), false);
  assert.ok(teacherMount.innerHTML.includes('Published'));

  // 2. Test StudentResultsDashboard
  const studentMount = makeEl('div');
  const studentWindow = {
    URLSearchParams,
    document: {
      head: { appendChild() {} },
      getElementById: () => null,
      createElement: (tag) => makeEl(tag),
      querySelector: () => studentMount
    },
    SemesterAuth: {
      authFetch: (url, opts = {}) =>
        appFetch(`${baseUrl}${url}`, {
          ...opts,
          headers: { ...(opts.headers || {}), Authorization: `Bearer ${student1Token}` }
        })
    }
  };
  studentWindow.window = studentWindow;

  const studentScript = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'student-results.js'),
    'utf8'
  );
  vm.runInNewContext(studentScript, studentWindow);

  const sDashboard = studentWindow.StudentResultsDashboard;
  await sDashboard.mount(studentMount);
  assert.ok(studentMount.innerHTML.includes('Published Results Summary'));
  assert.ok(studentMount.innerHTML.includes('CIT111'));
  assert.ok(studentMount.innerHTML.includes('BSM111'));
  assert.ok(studentMount.innerHTML.includes('95%'));
  assert.ok(studentMount.innerHTML.includes('84%')); // 42/50 = 84%
});

test('7. PostgreSQL (PGlite) Migration Compatibility, Uniqueness Constraints, and Role-Based Desktop/Mobile Header Navigation', async () => {
  const { PGlite } = require('@electric-sql/pglite');
  const { createTransactionAdapter } = require('../lib/db-transaction');
  const {
    upsertExamConfiguration,
    saveStudentMarks,
    publishSubjectResults,
    getStudentPublishedResults
  } = require('../lib/marks-service');

  const pg = new PGlite();
  const formatRow = (r) => db.formatRow(r);
  const formatRows = (rs) => db.formatRows(rs);

  function createPgAdapter(client) {
    const adapter = createTransactionAdapter(
      {
        query: async (sql, args) => {
          const res = args && args.length > 0 ? await client.query(sql, args) : await client.query(sql);
          return { rows: res.rows, rowCount: res.affectedRows };
        }
      },
      true,
      formatRow,
      formatRows
    );
    adapter.isPostgres = true;
    adapter.exec = async (sql) => {
      if (client.exec) return await client.exec(sql);
      return await client.query(sql);
    };
    return adapter;
  }

  const pgDb = createPgAdapter(pg);
  pgDb.withTransaction = async (fn) => {
    return await pg.transaction(async (tx) => {
      return await fn(createPgAdapter(tx));
    });
  };

  await pgDb.exec(`
    CREATE TABLE students (
      studentId TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      username TEXT,
      email TEXT,
      role TEXT DEFAULT 'student',
      department TEXT DEFAULT 'BIT',
      semester TEXT DEFAULT 'Semester 1',
      cohort_id TEXT,
      avatarUrl TEXT,
      account_status VARCHAR(32) NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE posts (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES students(studentId),
      content TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'status',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE files (
      id SERIAL PRIMARY KEY,
      storedName TEXT NOT NULL,
      originalName TEXT NOT NULL,
      title TEXT,
      subject TEXT,
      semester TEXT,
      uploadedBy TEXT NOT NULL REFERENCES students(studentId),
      uploadedAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE assignments (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      subject TEXT,
      semester TEXT,
      deadline TIMESTAMPTZ,
      createdBy TEXT NOT NULL REFERENCES students(studentId),
      createdAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await ensureAcademicCohortSchema({
    exec: pgDb.exec,
    run: pgDb.run,
    all: pgDb.all,
    isPostgres: true
  });
  await ensureTeacherSchema({ exec: pgDb.exec, isPostgres: true });
  await ensureAuditSchema(pgDb);

  // Apply actual SQL migration file migrations/20261028_marks_results_schema.sql
  const migrationSql = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '20261028_marks_results_schema.sql'),
    'utf8'
  );
  await pgDb.exec(migrationSql);

  // Verify idempotent re-run via ensureMarksSchema
  await ensureMarksSchema(pgDb);

  await pgDb.run(
    `INSERT INTO subjects (id, code, name, semester, department, credit_hours, nature, active)
     VALUES ('CIT111', 'CIT111', 'Computer Programming I (C)', 1, 'BIT', 3.0, 'TH + PR', TRUE)`
  );
  const pgCohort = await createCohort(pgDb, {
    slotCode: 'earth',
    displayName: 'Earth',
    currentSemester: 1,
    intakeYear: 2026
  });

  await pgDb.run(
    `INSERT INTO students (studentId, name, role, account_status) VALUES ('pg_tea_1', 'PG Teacher', 'teacher', 'active')`
  );
  await pgDb.run(
    `INSERT INTO teachers (id, user_id, designation, status) VALUES ('pg_tea_id_1', 'pg_tea_1', 'Professor', 'active')`
  );
  await pgDb.run(
    `INSERT INTO teacher_subjects (id, teacher_id, subject_id) VALUES ('pg_ts_1', 'pg_tea_id_1', 'CIT111')`
  );
  await pgDb.run(
    `INSERT INTO students (studentId, name, role, cohort_id, semester, account_status)
     VALUES ('pg_stu_1', 'PG Student 1', 'student', ?, 'Semester 1', 'active')`,
    pgCohort.id
  );

  await upsertExamConfiguration(pgDb, {
    actorUserId: 'pg_tea_1',
    subjectId: 'CIT111',
    examType: 'Mid-Term Exam',
    maxMarks: 25
  });

  await saveStudentMarks(pgDb, {
    actorUserId: 'pg_tea_1',
    subjectId: 'CIT111',
    examType: 'Mid-Term Exam',
    records: [{ studentId: 'pg_stu_1', obtainedMarks: 20 }]
  });

  // Re-saving updates the existing record rather than creating duplicates
  await saveStudentMarks(pgDb, {
    actorUserId: 'pg_tea_1',
    subjectId: 'CIT111',
    examType: 'Mid-Term Exam',
    records: [{ studentId: 'pg_stu_1', obtainedMarks: 22 }]
  });

  const rowCountCheck = await pgDb.get(
    `SELECT COUNT(*) AS cnt FROM student_marks WHERE student_id = 'pg_stu_1' AND subject_id = 'CIT111' AND exam_type = 'Mid-Term Exam'`
  );
  assert.equal(Number(rowCountCheck.cnt || rowCountCheck.count), 1, 'Must prevent duplicate records for same student, subject, semester, and exam');

  await publishSubjectResults(pgDb, {
    actorUserId: 'pg_tea_1',
    subjectId: 'CIT111',
    examType: 'Mid-Term Exam'
  });

  const pgRes = await getStudentPublishedResults(pgDb, { studentUserId: 'pg_stu_1' });
  assert.equal(pgRes.results.length, 1);
  assert.equal(pgRes.results[0].obtainedMarks, 22);
  assert.equal(pgRes.results[0].maxMarks, 25);
  assert.equal(pgRes.results[0].percentage, 88);

  await pg.close();

  // Verify responsive mobile CSS rules in style.v4.css keep .dash-header-nav visible on mobile & desktop
  const cssText = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.v4.css'), 'utf8');
  assert.ok(cssText.includes('.dash-header-nav'), 'style.v4.css must style .dash-header-nav for desktop and mobile');
  assert.ok(cssText.includes('@media (max-width:480px)'), 'style.v4.css must include mobile media query for .dash-header-nav');
});

test('8. Regression: CIT214 (Semester 3) & CIT223 (Semester 4) Roster Loading when Exam Max Marks are Unconfigured, Empty Roster, and Lazy Schema Self-Healing', async () => {
  const { PGlite } = require('@electric-sql/pglite');
  const { createTransactionAdapter } = require('../lib/db-transaction');
  const {
    getTeacherMarksContext,
    getSubjectMarksRoster,
    saveStudentMarks
  } = require('../lib/marks-service');

  // 1. Simulate the exact production scenario where Postgres fast-check skipped initSchema()
  //    so students, subjects, teachers, teacher_subjects exist, but exam_configurations / student_marks
  //    were not yet created when the teacher opens Marks Entry and selects CIT214 or CIT223.
  const pg = new PGlite();
  const formatRow = (r) => db.formatRow(r);
  const formatRows = (rs) => db.formatRows(rs);

  function createPgAdapter(client) {
    const adapter = createTransactionAdapter(
      {
        query: async (sql, args) => {
          const res = args && args.length > 0 ? await client.query(sql, args) : await client.query(sql);
          return { rows: res.rows, rowCount: res.affectedRows };
        }
      },
      true,
      formatRow,
      formatRows
    );
    adapter.isPostgres = true;
    adapter.exec = async (sql) => {
      if (client.exec) return await client.exec(sql);
      return await client.query(sql);
    };
    return adapter;
  }

  const pgDb = createPgAdapter(pg);
  pgDb.withTransaction = async (fn) => {
    return await pg.transaction(async (tx) => {
      return await fn(createPgAdapter(tx));
    });
  };

  await pgDb.exec(`
    CREATE TABLE students (
      studentId TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      username TEXT,
      email TEXT,
      role TEXT DEFAULT 'student',
      department TEXT DEFAULT 'BIT',
      semester TEXT DEFAULT 'Semester 1',
      cohort_id TEXT,
      avatarUrl TEXT,
      account_status VARCHAR(32) NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE posts (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES students(studentId),
      content TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'status',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE files (
      id SERIAL PRIMARY KEY,
      storedName TEXT NOT NULL,
      originalName TEXT NOT NULL,
      title TEXT,
      subject TEXT,
      semester TEXT,
      uploadedBy TEXT NOT NULL REFERENCES students(studentId),
      uploadedAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE assignments (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      subject TEXT,
      semester TEXT,
      deadline TIMESTAMPTZ,
      createdBy TEXT NOT NULL REFERENCES students(studentId),
      createdAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await ensureAcademicCohortSchema({
    exec: pgDb.exec,
    run: pgDb.run,
    all: pgDb.all,
    isPostgres: true
  });
  await ensureTeacherSchema({ exec: pgDb.exec, isPostgres: true });
  await ensureAuditSchema(pgDb);
  await seedCanonicalSubjects(pgDb);

  const cohortSem3 = await createCohort(pgDb, {
    slotCode: 'mars',
    displayName: 'Mars',
    currentSemester: 3,
    intakeYear: 2025
  });

  // Create teacher assigned to CIT214 (Semester 3, Data Structure and Algorithms)
  // and CIT223 (Semester 4, Data Communication and Computer Networks)
  await pgDb.run(
    `INSERT INTO students (studentId, username, name, role, department, account_status)
     VALUES ('tea_cit_1', 'tea_cit_1', 'Prof. CIT Teacher', 'teacher', 'BIT', 'active')`
  );
  await pgDb.run(
    `INSERT INTO teachers (id, user_id, designation, status)
     VALUES ('tea_rec_cit_1', 'tea_cit_1', 'Lecturer', 'active')`
  );
  await pgDb.run(
    `INSERT INTO teacher_subjects (id, teacher_id, subject_id) VALUES ('ts_cit_214', 'tea_rec_cit_1', 'CIT214')`
  );
  await pgDb.run(
    `INSERT INTO teacher_subjects (id, teacher_id, subject_id) VALUES ('ts_cit_223', 'tea_rec_cit_1', 'CIT223')`
  );

  // Enroll 2 students in Semester 3 (for CIT214) and 0 students in Semester 4 (for CIT223 empty roster check)
  await pgDb.run(
    `INSERT INTO students (studentId, username, name, role, semester, cohort_id, account_status)
     VALUES ('25030001', 'stu_s3_1', 'Sagar SemThree', 'student', 'Semester 3', ?, 'active')`,
    cohortSem3.id
  );
  await pgDb.run(
    `INSERT INTO students (studentId, username, name, role, semester, cohort_id, account_status)
     VALUES ('25030002', 'stu_s3_2', 'Salina SemThree', 'student', 'Semester 3', ?, 'active')`,
    cohortSem3.id
  );

  // Notice: ensureMarksSchema(pgDb) was NOT called upfront!
  // Calling getTeacherMarksContext and getSubjectMarksRoster must auto-initialize the marks schema and succeed!
  const teacherCtx = await getTeacherMarksContext(pgDb, { actorUserId: 'tea_cit_1' });
  assert.deepEqual(
    teacherCtx.subjects.map((s) => s.code).sort(),
    ['CIT214', 'CIT223']
  );

  // Selecting CIT214 (Semester 3, Data Structure and Algorithms) when Max Marks are NOT configured:
  const cit214Roster = await getSubjectMarksRoster(pgDb, {
    actorUserId: 'tea_cit_1',
    subjectId: 'CIT214',
    examType: 'Mid-Term Exam'
  });
  assert.equal(cit214Roster.subject.code, 'CIT214');
  assert.equal(cit214Roster.subject.semester, 3);
  assert.equal(cit214Roster.examConfig.configured, false);
  assert.equal(cit214Roster.examConfig.maxMarks, null);
  assert.equal(cit214Roster.students.length, 2);
  assert.equal(cit214Roster.students[0].studentId, '25030001');
  assert.equal(cit214Roster.students[1].studentId, '25030002');
  assert.equal(cit214Roster.summary.missingCount, 2);

  // Selecting CIT223 (Semester 4, Data Communication and Computer Networks) with an EMPTY student roster and unconfigured Max Marks:
  const cit223Roster = await getSubjectMarksRoster(pgDb, {
    actorUserId: 'tea_cit_1',
    subjectId: 'CIT223',
    examType: 'Mid-Term Exam'
  });
  assert.equal(cit223Roster.subject.code, 'CIT223');
  assert.equal(cit223Roster.subject.semester, 4);
  assert.equal(cit223Roster.examConfig.configured, false);
  assert.equal(cit223Roster.students.length, 0);
  assert.equal(cit223Roster.summary.totalStudents, 0);

  // Saving draft marks on CIT214 with maxMarks supplied inline
  const savedCit214 = await saveStudentMarks(pgDb, {
    actorUserId: 'tea_cit_1',
    subjectId: 'CIT214',
    examType: 'Mid-Term Exam',
    maxMarks: 30,
    records: [
      { studentId: '25030001', obtainedMarks: 27 },
      { studentId: '25030002', obtainedMarks: 24 }
    ]
  });
  assert.equal(savedCit214.examConfig.configured, true);
  assert.equal(savedCit214.examConfig.maxMarks, 30);
  assert.equal(savedCit214.summary.draftCount, 2);

  await pg.close();

  // 2. Also verify via HTTP route & TeacherMarksEntryWorkspace UI that selecting an unconfigured subject
  //    displays the non-blocking configuration prompt ("Maximum Marks Not Configured Yet") while keeping the student register table accessible
  await db.run(
    `INSERT INTO teacher_subjects (id, teacher_id, subject_id) VALUES ('ts_mr_a_cit214', 'tea_id_mr_a', 'CIT214')`
  );
  await db.run(
    `INSERT INTO teacher_subjects (id, teacher_id, subject_id) VALUES ('ts_mr_a_cit223', 'tea_id_mr_a', 'CIT223')`
  );

  const unconfigHttpRes = await appFetch(
    `${baseUrl}/api/marks/roster?subjectId=CIT214&examType=${encodeURIComponent('Mid-Term Exam')}`,
    { headers: { Authorization: `Bearer ${teacherAToken}` } }
  );
  assert.equal(unconfigHttpRes.status, 200);
  const unconfigHttpData = await unconfigHttpRes.json();
  assert.equal(unconfigHttpData.subject.code, 'CIT214');
  assert.equal(unconfigHttpData.examConfig.configured, false);

  const emptyCit223Res = await appFetch(
    `${baseUrl}/api/marks/roster?subjectId=CIT223&examType=${encodeURIComponent('Mid-Term Exam')}`,
    { headers: { Authorization: `Bearer ${teacherAToken}` } }
  );
  assert.equal(emptyCit223Res.status, 200);
  const emptyCit223Data = await emptyCit223Res.json();
  assert.equal(emptyCit223Data.subject.code, 'CIT223');
  assert.equal(emptyCit223Data.students.length, 0);
});

test('9. University Results Portal: Semester Filtering, Exam-Type Filtering, Academic Summary Accuracy, Unpublished Exam Slots, and Empty/Error States', async () => {
  const resultsHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'results.html'), 'utf8');
  assert.ok(resultsHtml.includes('Academic Results'), 'results.html must display Academic Results title');
  assert.ok(
    resultsHtml.includes('Published examination results'),
    'results.html must explain that the page contains published examination results'
  );
  assert.ok(resultsHtml.includes('class="dash-header-nav"'), 'results.html must preserve shared header navigation');

  await appFetch(`${baseUrl}/api/marks/publish`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherBToken}`
    },
    body: JSON.stringify({
      subjectId: 'CIT121',
      examType: 'Mid-Term Exam',
      maxMarks: 50,
      records: [{ studentId: '25020101', obtainedMarks: 44 }]
    })
  });

  const sem1Res = await appFetch(`${baseUrl}/api/results/my-results?semester=1`, {
    headers: { Authorization: `Bearer ${student1Token}` }
  });
  assert.equal(sem1Res.status, 200);
  const sem1Data = await sem1Res.json();
  assert.equal(sem1Data.semesters.length, 1);
  const sem1 = sem1Data.semesters[0];
  assert.equal(sem1.semesterNo, 1);
  assert.equal(sem1.summary.publishedSubjectsCount, 2);
  assert.equal(sem1.summary.publishedExamsCount, 3);
  assert.equal(sem1.summary.totalObtainedMarks, 125);
  assert.equal(sem1.summary.totalMaxMarks, 150);
  assert.equal(sem1.summary.overallPercentage, 83.33);
  assert.equal(sem1.summary.isPartiallyPublished, true);

  const cit111Subj = sem1.subjects.find((s) => s.code === 'CIT111');
  assert.ok(cit111Subj);
  assert.equal(cit111Subj.examSlots.length, 3);
  const finalSlot = cit111Subj.examSlots.find((s) => s.examType === 'Final Exam');
  assert.equal(finalSlot.isPublished, false);
  assert.equal(finalSlot.obtainedMarks, null, 'Unpublished exam must not expose draft marks or imply zero');
  assert.equal(finalSlot.publicationStatus, 'Not Yet Available');

  const makeEl = (tag = 'div') => ({
    tagName: tag.toUpperCase(),
    id: '',
    className: '',
    textContent: '',
    value: '',
    style: {},
    attributes: {},
    listeners: {},
    _innerHTML: '',
    set innerHTML(val) {
      this._innerHTML = String(val);
    },
    get innerHTML() {
      return this._innerHTML;
    },
    setAttribute(k, v) {
      this.attributes[k] = String(v);
    },
    getAttribute(k) {
      return this.attributes[k] || null;
    },
    addEventListener(evt, fn) {
      this.listeners[evt] = fn;
    },
    appendChild() {},
    removeChild() {},
    click() {},
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    }
  });

  let shouldFailFetch = false;
  const studentMount = makeEl('div');
  const studentWindow = {
    URLSearchParams,
    Blob: global.Blob,
    URL: {
      createObjectURL: () => 'blob:mock-pdf-url',
      revokeObjectURL: () => {}
    },
    document: {
      head: { appendChild() {} },
      body: { appendChild() {}, removeChild() {} },
      getElementById: () => null,
      createElement: (tag) => makeEl(tag),
      querySelector: () => studentMount
    },
    SemesterAuth: {
      authFetch: async (url, opts = {}) => {
        if (shouldFailFetch) {
          throw new Error('Network connection interrupted. Please check your connection.');
        }
        return appFetch(`${baseUrl}${url}`, {
          ...opts,
          headers: { ...(opts.headers || {}), Authorization: `Bearer ${student1Token}` }
        });
      }
    }
  };
  studentWindow.window = studentWindow;

  const studentScript = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'student-results.js'),
    'utf8'
  );
  vm.runInNewContext(studentScript, studentWindow);
  const sDashboard = studentWindow.StudentResultsDashboard;

  await sDashboard.mount(studentMount);
  assert.ok(studentMount.innerHTML.includes('Published Results Summary'));
  assert.ok(studentMount.innerHTML.includes('125 / 150'), 'Must display aggregated published marks 125 / 150');
  assert.ok(studentMount.innerHTML.includes('83.33%'), 'Must display overall percentage 83.33%');
  assert.ok(studentMount.innerHTML.includes('Not Yet Available'), 'Must indicate unpublished exam is Not Yet Available');
  assert.ok(!studentMount.innerHTML.includes('>88<'), 'Must never display draft Final Exam score 88');
  assert.ok(studentMount.innerHTML.includes('Download Report Card (Sem 1)'));

  sDashboard.selectExamType('Pre-Board Exam');
  assert.ok(studentMount.innerHTML.includes('CIT111'));
  assert.ok(studentMount.innerHTML.includes('75%'));
  assert.ok(!studentMount.innerHTML.includes('BSM111'));

  sDashboard.selectExamType('ALL');
  assert.ok(studentMount.innerHTML.includes('CIT111'));
  assert.ok(studentMount.innerHTML.includes('BSM111'));

  sDashboard.selectSemester('2');
  assert.ok(studentMount.innerHTML.includes('No Published Results for Semester 2'));
  const pdfAttemptEmptySem = await sDashboard.downloadReportCard();
  assert.equal(pdfAttemptEmptySem, false);
  assert.ok(studentMount.innerHTML.includes('No published examination results are available for Semester 2'));

  sDashboard.selectSemester('1');
  const pdfSuccess = await sDashboard.downloadReportCard();
  assert.equal(pdfSuccess, true);
  assert.ok(studentMount.innerHTML.includes('Report card for Semester 1 downloaded'));

  shouldFailFetch = true;
  await sDashboard.loadResults();
  assert.ok(studentMount.innerHTML.includes('Could Not Load Academic Results'));
  assert.ok(studentMount.innerHTML.includes('Network connection interrupted'));

  shouldFailFetch = false;
  await sDashboard.loadResults();
  assert.ok(studentMount.innerHTML.includes('125 / 150'));
});

test('10. Downloadable A4 PDF Report Card: Binary PDF Validity, pdfjs-dist Parsing, Long Subject Wrapping, and Security Isolation', async () => {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { generateStudentReportCardPdf, wrapTextLines, A4_WIDTH, A4_HEIGHT } = require('../lib/results-pdf');

  const pdfRes = await appFetch(`${baseUrl}/api/results/report-card?semester=1`, {
    headers: { Authorization: `Bearer ${student1Token}` }
  });
  assert.equal(pdfRes.status, 200);
  assert.equal(pdfRes.headers.get('content-type'), 'application/pdf');
  const disposition = pdfRes.headers.get('content-disposition') || '';
  assert.ok(
    disposition.includes('Gandaki_University_Academic_Result_Report_Semester_1_26020301.pdf'),
    `Expected semester-specific filename in Content-Disposition, got: ${disposition}`
  );

  const ab = await pdfRes.arrayBuffer();
  const pdfBuffer = Buffer.from(ab);
  assert.ok(pdfBuffer.length > 1000, 'PDF buffer must be non-trivial');
  assert.equal(pdfBuffer.slice(0, 8).toString('utf8'), '%PDF-1.4', 'Must begin with %PDF-1.4 header');
  assert.ok(pdfBuffer.toString('utf8').trimEnd().endsWith('%%EOF'), 'Must end with %%EOF trailer');

  const pdfDoc = await getDocument({ data: new Uint8Array(pdfBuffer), useSystemFonts: true }).promise;
  assert.equal(pdfDoc.numPages, 1);
  const page1 = await pdfDoc.getPage(1);
  const viewport = page1.getViewport({ scale: 1 });
  assert.ok(Math.abs(viewport.width - A4_WIDTH) < 1, 'Page width must match A4 portrait width');
  assert.ok(Math.abs(viewport.height - A4_HEIGHT) < 1, 'Page height must match A4 portrait height');

  const textContent = await page1.getTextContent();
  const extractedText = textContent.items.map((item) => item.str).join(' ');

  assert.ok(extractedText.includes('GANDAKI UNIVERSITY'));
  assert.ok(extractedText.includes('SEMESTER LIBRARY'));
  assert.ok(extractedText.includes('ACADEMIC RESULT REPORT'));
  assert.ok(extractedText.includes('Aashrita Lamichhane'));
  assert.ok(extractedText.includes('26020301'));
  assert.ok(extractedText.includes('Semester 1'));
  assert.ok(extractedText.includes('CIT111'));
  assert.ok(extractedText.includes('BSM111'));
  assert.ok(extractedText.includes('95%'));
  assert.ok(extractedText.includes('75%'));
  assert.ok(extractedText.includes('84%'));
  assert.ok(extractedText.includes('125 / 150'));
  assert.ok(extractedText.includes('83.33%'));
  assert.ok(extractedText.includes('Unpublished or draft examination marks are excluded'));
  assert.ok(extractedText.includes('not an official university transcript'));
  assert.ok(!extractedText.includes('Ankit Bhandari'));
  assert.ok(!extractedText.includes('Sujan SemTwo'));

  const wrappedLines = wrapTextLines(
    'Advanced Data Communication, Distributed Computer Networks, and Cloud Infrastructure Engineering',
    160,
    8.5,
    true
  );
  assert.ok(wrappedLines.length >= 2, 'Long subject names must wrap across multiple lines');

  const manySubjects = Array.from({ length: 12 }, (_, idx) => ({
    subjectId: `SUBJ${idx + 1}`,
    code: `CIT3${String(idx + 1).padStart(2, '0')}`,
    name: `Advanced University Subject ${idx + 1} with Extended Curriculum Title for A4 Wrapping Verification`,
    semesterNo: 3,
    exams: [
      { examType: 'Mid-Term Exam', obtainedMarks: 20, maxMarks: 25, percentage: 80, percentageAvailable: true, status: 'published' },
      { examType: 'Pre-Board Exam', obtainedMarks: 40, maxMarks: 50, percentage: 80, percentageAvailable: true, status: 'published' },
      { examType: 'Final Exam', obtainedMarks: 80, maxMarks: 100, percentage: 80, percentageAvailable: true, status: 'published' }
    ]
  }));
  const multiPageBuf = generateStudentReportCardPdf({
    student: { studentId: '26020301', rollNumber: '26020301', name: 'Aashrita Lamichhane', department: 'BIT' },
    semesterData: { semesterNo: 3, semesterLabel: 'Semester 3', subjects: manySubjects }
  });
  const multiPageDoc = await getDocument({ data: new Uint8Array(multiPageBuf), useSystemFonts: true }).promise;
  assert.ok(multiPageDoc.numPages >= 2, '12 subjects (36 exam rows) must paginate cleanly across 2+ A4 pages');

  for (const forbiddenUrl of [
    `${baseUrl}/api/results/report-card?semester=1&studentId=26020302`,
    `${baseUrl}/api/results/report-card?semester=1&userId=26020302`,
    `${baseUrl}/api/results/student/26020302/report-card?semester=1`
  ]) {
    const crossPdfRes = await appFetch(forbiddenUrl, {
      headers: { Authorization: `Bearer ${student1Token}` }
    });
    assert.equal(crossPdfRes.status, 403);
    const crossPdfData = await crossPdfRes.json();
    assert.equal(crossPdfData.code, 'CROSS_STUDENT_ACCESS_DENIED');
  }

  const teacherPdfRes = await appFetch(`${baseUrl}/api/results/report-card?semester=1`, {
    headers: { Authorization: `Bearer ${teacherAToken}` }
  });
  assert.equal(teacherPdfRes.status, 403);

  const emptySemPdfRes = await appFetch(`${baseUrl}/api/results/report-card?semester=8`, {
    headers: { Authorization: `Bearer ${student1Token}` }
  });
  assert.equal(emptySemPdfRes.status, 404);
  assert.equal((await emptySemPdfRes.json()).code, 'NO_PUBLISHED_RESULTS_FOR_SEMESTER');

  const badSemPdfRes = await appFetch(`${baseUrl}/api/results/report-card?semester=99`, {
    headers: { Authorization: `Bearer ${student1Token}` }
  });
  assert.equal(badSemPdfRes.status, 400);
  assert.equal((await badSemPdfRes.json()).code, 'INVALID_SEMESTER');
});


