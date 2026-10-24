'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const testDbPath = path.join(
  os.tmpdir(),
  `attendance_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`
);
process.env.NODE_ENV = 'test';
process.env.DB_PATH = testDbPath;
process.env.SEMESTER_DB_SKIP_INIT = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const bcrypt = require('bcryptjs');
const { PGlite } = require('@electric-sql/pglite');

const app = require('../server');
const db = require('../db');
const { createTransactionAdapter } = require('../lib/db-transaction');
const {
  ensureAcademicCohortSchema,
  createCohort,
  promoteCohort
} = require('../lib/academic-context');
const {
  ensureTeacherSchema,
  seedCanonicalSubjects
} = require('../lib/teacher-service');
const { ensureAuditSchema } = require('../lib/audit-service');
const {
  ensureAttendanceSchema,
  saveAttendanceSession,
  editAttendanceSessionById,
  adminCorrectAttendanceSession,
  getStudentAttendanceSummary,
  getEligibilityThresholdConfig,
  updateEligibilityThresholdConfig,
  getAttendanceRoster,
  listAttendanceSessions,
  getAttendanceSessionAuditLogs
} = require('../lib/attendance-service');
const { formatNepalDate } = require('../lib/nepali-dates');

const { PassThrough } = require('stream');

let server;
let baseUrl = 'http://127.0.0.1';
let useInProcessExpress = false;

/**
 * Dispatches an HTTP request either over a local TCP socket (when permitted)
 * or directly through the Express application pipeline using genuine Node
 * http.IncomingMessage and http.ServerResponse streams (when sandboxed).
 */
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
      : Buffer.from(typeof options.body === 'string' ? options.body : JSON.stringify(options.body), 'utf8');
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
        resChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), encoding || 'utf8'));
      }
      return origWrite(chunk, encoding, cb);
    };

    res.end = (chunk, encoding, cb) => {
      if (chunk && typeof chunk !== 'function') {
        resChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), encoding || 'utf8'));
      }
      origEnd(chunk, encoding, cb);
      const rawText = Buffer.concat(resChunks).toString('utf8');
      resolve({
        status: res.statusCode || 200,
        ok: (res.statusCode || 200) >= 200 && (res.statusCode || 200) < 300,
        headers: {
          get: (name) => res.getHeader(name.toLowerCase()) || null
        },
        text: async () => rawText,
        json: async () => (rawText ? JSON.parse(rawText) : null)
      });
    };

    try {
      app(req, res);
      if (bodyBuf) {
        req.push(bodyBuf);
      }
      req.push(null);
    } catch (err) {
      reject(err);
    }
  });
}

const fetch = appFetch;

// Passwords & tokens
const PASSWORD = 'Test_Password123!';
let adminToken = '';
let teacherAToken = '';
let teacherBToken = '';
let student1Token = '';
let student2Token = '';
let cr1Token = '';
let studentVenusToken = '';
let unassignedStudentToken = '';

let cohortMercury = null; // Semester 1
let cohortVenus = null;   // Semester 3

const TODAY_NEPAL = formatNepalDate(new Date());
const YESTERDAY_NEPAL = formatNepalDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
const TWO_DAYS_AGO_NEPAL = formatNepalDate(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000));
const THREE_DAYS_AGO_NEPAL = formatNepalDate(new Date(Date.now() - 3 * 24 * 60 * 60 * 1000));
const FOUR_DAYS_AGO_NEPAL = formatNepalDate(new Date(Date.now() - 4 * 24 * 60 * 60 * 1000));
const TOMORROW_NEPAL = formatNepalDate(new Date(Date.now() + 24 * 60 * 60 * 1000));

async function loginMobile(studentId, password = PASSWORD) {
  const res = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId, password })
  });
  const data = await res.json();
  return data.token;
}

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
  await seedCanonicalSubjects(db);

  // Clear default seeded students so cohort rosters are deterministic
  await db.run('DELETE FROM students');

  // Create HTTP server (falls back cleanly to in-process Express dispatch if sandboxed)
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

  // 1. Create active cohorts: Mercury (Semester 1) and Venus (Semester 3)
  cohortMercury = await createCohort(db, {
    slotCode: 'mercury',
    displayName: 'Mercury',
    currentSemester: 1,
    intakeYear: 2026
  });

  cohortVenus = await createCohort(db, {
    slotCode: 'venus',
    displayName: 'Venus',
    currentSemester: 3,
    intakeYear: 2025
  });

  // 2. Seed Admin
  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, account_status)
     VALUES (?, ?, ?, ?, 'admin', ?, NULL, 'active')`,
    'admin_att', 'admin_att', 'Attendance Admin', 'admin_att@gandaki.edu.np', passwordHash
  );

  // 3. Seed Teacher A: assigned to CIT111 (Semester 1), BSM111 (Semester 1), and CIT214 (Semester 3)
  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, department, account_status)
     VALUES (?, ?, ?, ?, 'teacher', ?, NULL, 'BIT', 'active')`,
    'tea_user_a', 'prof_sharma', 'Prof. Ram Sharma', 'sharma@gandaki.edu.np', passwordHash
  );
  await db.run(
    `INSERT INTO teachers (id, user_id, designation, status)
     VALUES (?, ?, 'Associate Professor', 'active')`,
    'tea_id_a', 'tea_user_a'
  );
  await db.run(
    `INSERT INTO teacher_subjects (id, teacher_id, subject_id) VALUES (?, ?, ?)`,
    'ts_att_1', 'tea_id_a', 'CIT111'
  );
  await db.run(
    `INSERT INTO teacher_subjects (id, teacher_id, subject_id) VALUES (?, ?, ?)`,
    'ts_att_2', 'tea_id_a', 'BSM111'
  );
  await db.run(
    `INSERT INTO teacher_subjects (id, teacher_id, subject_id) VALUES (?, ?, ?)`,
    'ts_att_3', 'tea_id_a', 'CIT214'
  );

  // 4. Seed Teacher B: assigned ONLY to ELX111 (Semester 1)
  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, department, account_status)
     VALUES (?, ?, ?, ?, 'teacher', ?, NULL, 'BIT', 'active')`,
    'tea_user_b', 'prof_joshi', 'Prof. Hari Joshi', 'joshi@gandaki.edu.np', passwordHash
  );
  await db.run(
    `INSERT INTO teachers (id, user_id, designation, status)
     VALUES (?, ?, 'Lecturer', 'active')`,
    'tea_id_b', 'tea_user_b'
  );
  await db.run(
    `INSERT INTO teacher_subjects (id, teacher_id, subject_id) VALUES (?, ?, ?)`,
    'ts_att_4', 'tea_id_b', 'ELX111'
  );

  // 5. Seed Mercury Cohort (Semester 1) Students & CR
  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, cohort_id, account_status)
     VALUES (?, ?, ?, ?, 'student', ?, 'Semester 1', ?, 'active')`,
    'stu_m1', 'stu_m1', 'Aashrita Mercury', 'm1@gandaki.edu.np', passwordHash, cohortMercury.id
  );
  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, cohort_id, account_status)
     VALUES (?, ?, ?, ?, 'student', ?, 'Semester 1', ?, 'active')`,
    'stu_m2', 'stu_m2', 'Ankit Mercury', 'm2@gandaki.edu.np', passwordHash, cohortMercury.id
  );
  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, cohort_id, account_status)
     VALUES (?, ?, ?, ?, 'cr', ?, 'Semester 1', ?, 'active')`,
    'cr_m1', 'cr_m1', 'Sujan CR Mercury', 'crm1@gandaki.edu.np', passwordHash, cohortMercury.id
  );

  // 6. Seed Suspended Student in Mercury Cohort (must be excluded from roster)
  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, cohort_id, account_status)
     VALUES (?, ?, ?, ?, 'student', ?, 'Semester 1', ?, 'suspended')`,
    'stu_m_suspended', 'stu_m_susp', 'Suspended Mercury', 'susp@gandaki.edu.np', passwordHash, cohortMercury.id
  );

  // 7. Seed Unassigned Student with semester = 'Semester 1' (cohort_id IS NULL, must be excluded from roster)
  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, cohort_id, account_status)
     VALUES (?, ?, ?, ?, 'student', ?, 'Semester 1', NULL, 'active')`,
    'stu_unassigned_s1', 'stu_unassigned', 'Unassigned Sem1 Student', 'unassigned@gandaki.edu.np', passwordHash
  );

  // 8. Seed Venus Cohort (Semester 3) Student
  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, cohort_id, account_status)
     VALUES (?, ?, ?, ?, 'student', ?, 'Semester 3', ?, 'active')`,
    'stu_v1', 'stu_v1', 'Manish Venus', 'v1@gandaki.edu.np', passwordHash, cohortVenus.id
  );

  // Obtain mobile auth tokens
  adminToken = await loginMobile('admin_att');
  teacherAToken = await loginMobile('tea_user_a');
  teacherBToken = await loginMobile('tea_user_b');
  student1Token = await loginMobile('stu_m1');
  student2Token = await loginMobile('stu_m2');
  cr1Token = await loginMobile('cr_m1');
  studentVenusToken = await loginMobile('stu_v1');
  unassignedStudentToken = await loginMobile('stu_unassigned_s1');
});

test.after(async () => {
  if (server && server.listening) {
    await new Promise(resolve => server.close(resolve));
  }
  await db.close().catch(() => {});
  try {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  } catch (_) {}
});

// ============================================================================
// AUTHORIZATION & ROSTER INTEGRITY TESTS (Scenarios 1–10)
// ============================================================================

test('Scenario 1, 8, 9, 10: Assigned teacher can load authorized subject roster; only active cohort student/CR accounts included (suspended & unassigned excluded)', async () => {
  const ctxRes = await fetch(`${baseUrl}/api/attendance/teacher/context`, {
    headers: { Authorization: `Bearer ${teacherAToken}` }
  });
  assert.equal(ctxRes.status, 200);
  const ctxData = await ctxRes.json();
  assert.equal(ctxData.role, 'teacher');
  const assignedCodes = ctxData.subjects.map(s => s.code).sort();
  assert.deepEqual(assignedCodes, ['BSM111', 'CIT111', 'CIT214']);

  const rosterRes = await fetch(
    `${baseUrl}/api/attendance/roster?subjectId=CIT111&cohortId=${cohortMercury.id}&date=${TODAY_NEPAL}`,
    { headers: { Authorization: `Bearer ${teacherAToken}` } }
  );
  assert.equal(rosterRes.status, 200);
  const rosterData = await rosterRes.json();

  assert.equal(rosterData.subject.code, 'CIT111');
  assert.equal(rosterData.cohort.id, cohortMercury.id);

  const rosterIds = rosterData.roster.map(r => r.studentId).sort();
  // Active student/CR accounts in Mercury: cr_m1, stu_m1, stu_m2
  assert.deepEqual(rosterIds, ['cr_m1', 'stu_m1', 'stu_m2']);

  // Scenario 9: Suspended student in Mercury must be excluded
  assert.ok(!rosterIds.includes('stu_m_suspended'), 'Suspended student must be excluded');
  // Scenario 10: Unassigned student with Semester 1 text must be excluded
  assert.ok(!rosterIds.includes('stu_unassigned_s1'), 'Unassigned student must be excluded');
  // Student from Venus must be excluded
  assert.ok(!rosterIds.includes('stu_v1'), 'Other cohort student must be excluded');
});

test('Scenario 2: Teacher cannot access roster or sessions for an unassigned subject', async () => {
  // Teacher A is not assigned to ELX111
  const rosterRes = await fetch(
    `${baseUrl}/api/attendance/roster?subjectId=ELX111&cohortId=${cohortMercury.id}&date=${TODAY_NEPAL}`,
    { headers: { Authorization: `Bearer ${teacherAToken}` } }
  );
  assert.equal(rosterRes.status, 403);

  const postRes = await fetch(`${baseUrl}/api/attendance/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      subjectId: 'ELX111',
      cohortId: cohortMercury.id,
      sessionDate: TODAY_NEPAL,
      records: [
        { studentId: 'stu_m1', status: 'present' },
        { studentId: 'stu_m2', status: 'present' },
        { studentId: 'cr_m1', status: 'present' }
      ]
    })
  });
  assert.equal(postRes.status, 403);

  const sessionsRes = await fetch(`${baseUrl}/api/attendance/sessions?subjectId=ELX111`, {
    headers: { Authorization: `Bearer ${teacherAToken}` }
  });
  assert.equal(sessionsRes.status, 403);
});

test('Scenario 3: Teacher cannot submit attendance for another cohort whose semester does not match the subject', async () => {
  // Teacher A teaches CIT111 (Semester 1), tries to submit for Cohort Venus (Semester 3)
  const postRes = await fetch(`${baseUrl}/api/attendance/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      subjectId: 'CIT111',
      cohortId: cohortVenus.id,
      sessionDate: TODAY_NEPAL,
      records: [{ studentId: 'stu_v1', status: 'present' }]
    })
  });
  assert.equal(postRes.status, 403);
  const data = await postRes.json();
  assert.match(data.message, /semester mismatch/i);
});

test('Scenario 4: Student and CR cannot use teacher-only attendance routes', async () => {
  const ctxRes = await fetch(`${baseUrl}/api/attendance/teacher/context`, {
    headers: { Authorization: `Bearer ${student1Token}` }
  });
  assert.equal(ctxRes.status, 403);

  const rosterRes = await fetch(
    `${baseUrl}/api/attendance/roster?subjectId=CIT111&cohortId=${cohortMercury.id}`,
    { headers: { Authorization: `Bearer ${cr1Token}` } }
  );
  assert.equal(rosterRes.status, 403);

  const postRes = await fetch(`${baseUrl}/api/attendance/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${student1Token}`
    },
    body: JSON.stringify({
      subjectId: 'CIT111',
      cohortId: cohortMercury.id,
      sessionDate: TODAY_NEPAL,
      records: [
        { studentId: 'stu_m1', status: 'present' },
        { studentId: 'stu_m2', status: 'present' },
        { studentId: 'cr_m1', status: 'present' }
      ]
    })
  });
  assert.equal(postRes.status, 403);

  const listRes = await fetch(`${baseUrl}/api/attendance/sessions`, {
    headers: { Authorization: `Bearer ${student1Token}` }
  });
  assert.equal(listRes.status, 403);
});

// ============================================================================
// SESSION CREATION & DUPLICATE PREVENTION TESTS (Scenarios 12–20)
// ============================================================================

let createdSessionId = '';
let originalSubmittedAt = '';

test('Scenario 13, 14, 15, 16: Invalid statuses, duplicate student IDs, outside-cohort students, and future dates are rejected', async () => {
  // Scenario 13: Invalid status ('late' or 'excused' must be rejected)
  const badStatusRes = await fetch(`${baseUrl}/api/attendance/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      subjectId: 'CIT111',
      cohortId: cohortMercury.id,
      sessionDate: TODAY_NEPAL,
      records: [
        { studentId: 'stu_m1', status: 'late' },
        { studentId: 'stu_m2', status: 'present' },
        { studentId: 'cr_m1', status: 'absent' }
      ]
    })
  });
  assert.equal(badStatusRes.status, 400);
  const badStatusData = await badStatusRes.json();
  assert.equal(badStatusData.code, 'INVALID_ATTENDANCE_STATUS');

  // Scenario 14: Duplicate student IDs in request
  const dupStudentRes = await fetch(`${baseUrl}/api/attendance/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      subjectId: 'CIT111',
      cohortId: cohortMercury.id,
      sessionDate: TODAY_NEPAL,
      records: [
        { studentId: 'stu_m1', status: 'present' },
        { studentId: 'stu_m1', status: 'absent' },
        { studentId: 'cr_m1', status: 'present' }
      ]
    })
  });
  assert.equal(dupStudentRes.status, 400);
  const dupStudentData = await dupStudentRes.json();
  assert.equal(dupStudentData.code, 'DUPLICATE_STUDENT_ID');

  // Scenario 15: Student outside the cohort (stu_v1 from Venus or stu_unassigned_s1)
  const outsideStudentRes = await fetch(`${baseUrl}/api/attendance/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      subjectId: 'CIT111',
      cohortId: cohortMercury.id,
      sessionDate: TODAY_NEPAL,
      records: [
        { studentId: 'stu_m1', status: 'present' },
        { studentId: 'stu_m2', status: 'present' },
        { studentId: 'stu_v1', status: 'present' }
      ]
    })
  });
  assert.equal(outsideStudentRes.status, 403);
  const outsideData = await outsideStudentRes.json();
  assert.equal(outsideData.code, 'STUDENT_NOT_IN_COHORT');

  // Scenario 16: Future date is rejected
  const futureDateRes = await fetch(`${baseUrl}/api/attendance/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      subjectId: 'CIT111',
      cohortId: cohortMercury.id,
      sessionDate: TOMORROW_NEPAL,
      records: [
        { studentId: 'stu_m1', status: 'present' },
        { studentId: 'stu_m2', status: 'present' },
        { studentId: 'cr_m1', status: 'present' }
      ]
    })
  });
  assert.equal(futureDateRes.status, 400);
  const futureData = await futureDateRes.json();
  assert.equal(futureData.code, 'FUTURE_DATE_NOT_ALLOWED');
});

test('Scenario 12: Valid attendance saves successfully and populates session and records', async () => {
  const res = await fetch(`${baseUrl}/api/attendance/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      subjectId: 'CIT111',
      cohortId: cohortMercury.id,
      sessionDate: TODAY_NEPAL,
      records: [
        { studentId: 'stu_m1', status: 'present' },
        { studentId: 'stu_m2', status: 'absent' },
        { studentId: 'cr_m1', status: 'present' }
      ]
    })
  });

  assert.equal(res.status, 201);
  const data = await res.json();
  assert.equal(data.created, true);
  assert.equal(data.updated, false);
  assert.ok(data.session.id);
  assert.equal(data.session.subjectId, 'CIT111');
  assert.equal(data.session.cohortId, cohortMercury.id);
  assert.equal(data.session.semesterNo, 1);
  assert.equal(data.session.sessionDate, TODAY_NEPAL);
  assert.equal(data.session.status, 'submitted');
  assert.equal(data.records.length, 3);

  createdSessionId = data.session.id;
  originalSubmittedAt = data.session.submittedAt;
});

test('Scenario 17, 20, 21, 26: Re-saving / editing within 24 hours updates existing session without creating duplicates or changing original submitted_at', async () => {
  // Wait 25ms so current time differs from originalSubmittedAt
  await new Promise(r => setTimeout(r, 25));

  const res = await fetch(`${baseUrl}/api/attendance/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      subjectId: 'CIT111',
      cohortId: cohortMercury.id,
      sessionDate: TODAY_NEPAL,
      reason: 'Ankit arrived on time, correcting mark',
      records: [
        { studentId: 'stu_m1', status: 'present' },
        { studentId: 'stu_m2', status: 'present' }, // changed from absent -> present
        { studentId: 'cr_m1', status: 'present' }
      ]
    })
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.created, false);
  assert.equal(data.updated, true);
  assert.equal(data.session.id, createdSessionId, 'Must reuse existing session ID');
  assert.equal(data.session.submittedAt, originalSubmittedAt, 'Original submitted_at must NEVER be reset');
  assert.notEqual(data.session.updatedAt, originalSubmittedAt, 'updated_at should advance');

  // Verify database contains strictly 1 session for (cohortMercury, CIT111, TODAY_NEPAL)
  const countRow = await db.get(
    `SELECT COUNT(*) AS c FROM attendance_sessions WHERE cohort_id = ? AND subject_id = 'CIT111' AND session_date = ?`,
    cohortMercury.id,
    TODAY_NEPAL
  );
  assert.equal(Number(countRow.c), 1);

  // Also test PUT /api/attendance/sessions/:id within 24h window (Scenario 21 & 26)
  await new Promise(r => setTimeout(r, 20));
  const putRes = await fetch(`${baseUrl}/api/attendance/sessions/${createdSessionId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      reason: 'Second edit within window',
      records: [
        { studentId: 'stu_m1', status: 'present' },
        { studentId: 'stu_m2', status: 'absent' }, // changed back to absent
        { studentId: 'cr_m1', status: 'present' }
      ]
    })
  });
  assert.equal(putRes.status, 200);
  const putData = await putRes.json();
  assert.equal(putData.session.submittedAt, originalSubmittedAt, 'Repeated edits must not extend or reset original submitted_at');
});

test('Scenario 18: Concurrent duplicate requests cannot create duplicate sessions or duplicate records', async () => {
  const payload = {
    subjectId: 'BSM111',
    cohortId: cohortMercury.id,
    sessionDate: YESTERDAY_NEPAL,
    records: [
      { studentId: 'stu_m1', status: 'present' },
      { studentId: 'stu_m2', status: 'present' },
      { studentId: 'cr_m1', status: 'absent' }
    ]
  };

  const [res1, res2] = await Promise.all([
    fetch(`${baseUrl}/api/attendance/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherAToken}`
      },
      body: JSON.stringify(payload)
    }),
    fetch(`${baseUrl}/api/attendance/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherAToken}`
      },
      body: JSON.stringify(payload)
    })
  ]);

  assert.ok([200, 201].includes(res1.status));
  assert.ok([200, 201].includes(res2.status));

  const sessionsInDb = await db.all(
    `SELECT * FROM attendance_sessions WHERE cohort_id = ? AND subject_id = 'BSM111' AND session_date = ?`,
    cohortMercury.id,
    YESTERDAY_NEPAL
  );
  assert.equal(sessionsInDb.length, 1, 'Strictly one session row must exist after concurrent requests');

  const recordsInDb = await db.all(
    `SELECT * FROM attendance_records WHERE session_id = ?`,
    sessionsInDb[0].id
  );
  assert.equal(recordsInDb.length, 3, 'Strictly 3 student record rows must exist');
});

test('Scenario 19: A failed bulk write inside a transaction leaves no partial attendance session or records', async () => {
  // Simulate a mid-transaction failure by wrapping db.withTransaction to throw on the 3rd record insert
  let insertCount = 0;
  const failingDb = {
    ...db,
    withTransaction: async (fn) => {
      return await db.withTransaction(async (tx) => {
        const wrappedTx = {
          ...tx,
          run: async (sql, ...args) => {
            if (/INSERT\s+INTO\s+attendance_records/i.test(sql)) {
              insertCount += 1;
              if (insertCount === 2) {
                throw new Error('SIMULATED_BULK_WRITE_CRASH');
              }
            }
            return await tx.run(sql, ...args);
          }
        };
        return await fn(wrappedTx);
      });
    }
  };

  await assert.rejects(
    async () => {
      await saveAttendanceSession(failingDb, {
        actorUserId: 'tea_user_a',
        subjectId: 'CIT111',
        cohortId: cohortMercury.id,
        sessionDate: FOUR_DAYS_AGO_NEPAL,
        records: [
          { studentId: 'stu_m1', status: 'present' },
          { studentId: 'stu_m2', status: 'present' },
          { studentId: 'cr_m1', status: 'present' }
        ]
      });
    },
    /SIMULATED_BULK_WRITE_CRASH/
  );

  // Verify zero partial sessions or records were committed for FOUR_DAYS_AGO_NEPAL
  const orphanSession = await db.get(
    `SELECT * FROM attendance_sessions WHERE cohort_id = ? AND subject_id = 'CIT111' AND session_date = ?`,
    cohortMercury.id,
    FOUR_DAYS_AGO_NEPAL
  );
  assert.equal(orphanSession, null, 'Rolled back transaction must leave no session row');
});

// ============================================================================
// 24-HOUR EDITING WINDOW, ADMIN CORRECTIONS & AUDIT TESTS (Scenarios 7, 22–25)
// ============================================================================

let expiredSessionId = '';
const EXPIRED_SUBMITTED_AT = new Date(Date.now() - (25 * 60 * 60 * 1000)).toISOString(); // 25 hours ago

test('Scenario 22 & 25: Teacher cannot edit a session after the 24-hour deadline, and unauthorized edit attempts leave DB unchanged', async () => {
  // Create a session dated 2 days ago with submitted_at = 25 hours ago
  const created = await saveAttendanceSession(db, {
    actorUserId: 'tea_user_a',
    subjectId: 'CIT111',
    cohortId: cohortMercury.id,
    sessionDate: TWO_DAYS_AGO_NEPAL,
    now: new Date(EXPIRED_SUBMITTED_AT),
    records: [
      { studentId: 'stu_m1', status: 'absent' },
      { studentId: 'stu_m2', status: 'present' },
      { studentId: 'cr_m1', status: 'present' }
    ]
  });
  expiredSessionId = created.session.id;

  // Teacher A attempts to re-submit / edit via POST /api/attendance/sessions now (>24h later)
  const postEditRes = await fetch(`${baseUrl}/api/attendance/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      subjectId: 'CIT111',
      cohortId: cohortMercury.id,
      sessionDate: TWO_DAYS_AGO_NEPAL,
      records: [
        { studentId: 'stu_m1', status: 'present' }, // trying to flip absent -> present after 24h
        { studentId: 'stu_m2', status: 'present' },
        { studentId: 'cr_m1', status: 'present' }
      ]
    })
  });
  assert.equal(postEditRes.status, 403);
  const postEditData = await postEditRes.json();
  assert.equal(postEditData.code, 'EDIT_WINDOW_EXPIRED');

  // Teacher A attempts to edit via PUT /api/attendance/sessions/:id
  const putEditRes = await fetch(`${baseUrl}/api/attendance/sessions/${expiredSessionId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      records: [
        { studentId: 'stu_m1', status: 'present' },
        { studentId: 'stu_m2', status: 'present' },
        { studentId: 'cr_m1', status: 'present' }
      ]
    })
  });
  assert.equal(putEditRes.status, 403);

  // Scenario 25: Verify stu_m1 record in DB is still 'absent' (unchanged)
  const recRow = await db.get(
    `SELECT status FROM attendance_records WHERE session_id = ? AND student_id = 'stu_m1'`,
    expiredSessionId
  );
  assert.equal(recRow.status, 'absent', 'Unauthorized edit attempt must leave database unchanged');
});

test('Scenario 7: Admin correction endpoints reject non-admin users (teachers, students, CRs)', async () => {
  for (const token of [teacherAToken, student1Token, cr1Token]) {
    const res = await fetch(`${baseUrl}/api/attendance/admin/sessions/${expiredSessionId}/correct`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        reason: 'Attempted non-admin correction',
        records: [{ studentId: 'stu_m1', status: 'present' }]
      })
    });
    assert.equal(res.status, 403);
  }
});

test('Scenario 23 & 24: Admin can correct after the 24-hour deadline with a valid reason, preserving submitted_at and auditing actor, timestamp, reason, and old/new values', async () => {
  // Admin correction without reason must be rejected with 400
  const noReasonRes = await fetch(`${baseUrl}/api/attendance/admin/sessions/${expiredSessionId}/correct`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      reason: '',
      records: [{ studentId: 'stu_m1', status: 'present' }]
    })
  });
  assert.equal(noReasonRes.status, 400);

  // Admin correction with valid reason succeeds
  const correctRes = await fetch(`${baseUrl}/api/attendance/admin/sessions/${expiredSessionId}/correct`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      reason: 'Approved medical certificate for Aashrita',
      records: [
        { studentId: 'stu_m1', status: 'present' },
        { studentId: 'stu_m2', status: 'present' },
        { studentId: 'cr_m1', status: 'present' }
      ]
    })
  });
  assert.equal(correctRes.status, 200);
  const correctData = await correctRes.json();
  assert.equal(correctData.corrected, true);
  assert.equal(correctData.session.submittedAt, EXPIRED_SUBMITTED_AT, 'Admin correction must preserve original submitted_at');

  // Verify stu_m1 is now 'present'
  const recRow = await db.get(
    `SELECT status, marked_by FROM attendance_records WHERE session_id = ? AND student_id = 'stu_m1'`,
    expiredSessionId
  );
  assert.equal(recRow.status, 'present');
  assert.equal(recRow.markedBy || recRow.marked_by, 'admin_att');

  // Scenario 24: Verify audit trail via GET /api/attendance/sessions/:id/audit
  const auditRes = await fetch(`${baseUrl}/api/attendance/sessions/${expiredSessionId}/audit`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert.equal(auditRes.status, 200);
  const auditData = await auditRes.json();
  assert.ok(Array.isArray(auditData.logs));

  const adminAudit = auditData.logs.find(l => l.action === 'admin_correction');
  assert.ok(adminAudit, 'Admin correction audit log must exist');
  assert.equal(adminAudit.actorUserId, 'admin_att');
  assert.equal(adminAudit.actorRole, 'admin');
  assert.equal(adminAudit.reason, 'Approved medical certificate for Aashrita');
  assert.ok(adminAudit.createdAt);
  assert.equal(adminAudit.beforeState.records.stu_m1, 'absent');
  assert.equal(adminAudit.afterState.records.stu_m1, 'present');
  assert.deepEqual(adminAudit.metadata.changedRecords.stu_m1, { from: 'absent', to: 'present' });
});

// ============================================================================
// STUDENT STATISTICS, THRESHOLD CONFIGURATION & COHORT ISOLATION (Scenarios 5, 6, 11, 27–32)
// ============================================================================

test('Scenario 5, 6, 27, 28, 29, 30: Student accesses own summary; cross-student access rejected; unconfigured threshold, zero-session subjects, and draft exclusion verified', async () => {
  // Add one more CIT111 session (THREE_DAYS_AGO_NEPAL) where stu_m1 is absent and stu_m2 isabsent
  await saveAttendanceSession(db, {
    actorUserId: 'tea_user_a',
    subjectId: 'CIT111',
    cohortId: cohortMercury.id,
    sessionDate: THREE_DAYS_AGO_NEPAL,
    records: [
      { studentId: 'stu_m1', status: 'absent' },
      { studentId: 'stu_m2', status: 'absent' },
      { studentId: 'cr_m1', status: 'present' }
    ]
  });

  // Scenario 28: Insert a 'draft' session directly into DB to verify draft/non-finalized sessions are excluded
  const draftSessionId = crypto.randomUUID();
  await db.run(
    `INSERT INTO attendance_sessions (
      id, subject_id, cohort_id, semester_no, teacher_id, recorded_by_user_id,
      session_date, status, submitted_at, created_at, updated_at
    ) VALUES (?, 'CIT111', ?, 1, 'tea_id_a', 'tea_user_a', '2026-01-01', 'draft', ?, ?, ?)`,
    draftSessionId,
    cohortMercury.id,
    new Date().toISOString(),
    new Date().toISOString(),
    new Date().toISOString()
  );
  await db.run(
    `INSERT INTO attendance_records (id, session_id, student_id, status, marked_by, created_at, updated_at)
     VALUES (?, ?, 'stu_m1', 'present', 'tea_user_a', ?, ?)`,
    crypto.randomUUID(),
    draftSessionId,
    new Date().toISOString(),
    new Date().toISOString()
  );

  // Scenario 32: Create a session in Cohort Venus (Semester 3, CIT214) to verify it never leaks into Mercury student summary
  await saveAttendanceSession(db, {
    actorUserId: 'tea_user_a',
    subjectId: 'CIT214',
    cohortId: cohortVenus.id,
    sessionDate: TODAY_NEPAL,
    records: [{ studentId: 'stu_v1', status: 'present' }]
  });

  // Scenario 6: Student 1 cannot access Student 2's summary via query parameter
  const crossRes = await fetch(`${baseUrl}/api/attendance/my-summary?studentId=stu_m2`, {
    headers: { Authorization: `Bearer ${student1Token}` }
  });
  assert.equal(crossRes.status, 403);
  const crossData = await crossRes.json();
  assert.equal(crossData.code, 'CROSS_STUDENT_ACCESS_DENIED');

  // Scenario 5, 27, 28, 29, 30: Student 1 fetches their own summary while threshold is UNCONFIGURED
  const sumRes = await fetch(`${baseUrl}/api/attendance/my-summary`, {
    headers: { Authorization: `Bearer ${student1Token}` }
  });
  assert.equal(sumRes.status, 200);
  const summary = await sumRes.json();

  assert.equal(summary.studentId, 'stu_m1');
  assert.equal(summary.cohort.id, cohortMercury.id);
  assert.equal(summary.semesterNo, 1);

  // Scenario 30: Unconfigured threshold returns explicit unconfigured state
  assert.equal(summary.eligibilityThreshold.configured, false);
  assert.equal(summary.configuredThreshold, null);
  assert.equal(summary.eligibilityStatus, 'unconfigured');

  // Scenario 27 & 28: Check CIT111 stats for stu_m1:
  // Finalized sessions for CIT111: TODAY_NEPAL (present), TWO_DAYS_AGO_NEPAL (corrected to present), THREE_DAYS_AGO_NEPAL (absent)
  // Draft session ('2026-01-01') must be excluded!
  // Total = 3, Present = 2, Absent = 1 -> 66.67%
  const cit111 = summary.subjects.find(s => s.code === 'CIT111');
  assert.ok(cit111);
  assert.equal(cit111.totalSessions, 3, 'Draft session must be excluded from totalSessions');
  assert.equal(cit111.presentCount, 2);
  assert.equal(cit111.absentCount, 1);
  assert.equal(cit111.attendancePercentage, 66.67);
  assert.equal(cit111.eligibilityStatus, 'unconfigured');
  assert.equal(cit111.isEligible, null);

  // Check BSM111 stats for stu_m1: 1 session (YESTERDAY_NEPAL, present) -> 100%
  const bsm111 = summary.subjects.find(s => s.code === 'BSM111');
  assert.ok(bsm111);
  assert.equal(bsm111.totalSessions, 1);
  assert.equal(bsm111.presentCount, 1);
  assert.equal(bsm111.absentCount, 0);
  assert.equal(bsm111.attendancePercentage, 100);
  assert.equal(bsm111.eligibilityStatus, 'unconfigured');

  // Scenario 29: Zero-session subject (ELX111) does not divide by zero
  const elx111 = summary.subjects.find(s => s.code === 'ELX111');
  assert.ok(elx111);
  assert.equal(elx111.totalSessions, 0);
  assert.equal(elx111.presentCount, 0);
  assert.equal(elx111.absentCount, 0);
  assert.equal(elx111.attendancePercentage, 0);
  assert.equal(elx111.percentageAvailable, false);
});

test('Scenario 31: Updating the admin-configurable eligibility threshold dynamically updates eligibility status without rewriting attendance history', async () => {
  // Non-admin cannot update threshold
  const nonAdminRes = await fetch(`${baseUrl}/api/attendance/admin/threshold`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({ threshold: 75 })
  });
  assert.equal(nonAdminRes.status, 403);

  // Admin sets threshold to 60%
  const set60Res = await fetch(`${baseUrl}/api/attendance/admin/threshold`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`
    },
    body: JSON.stringify({ threshold: 60, reason: 'Set baseline 60% threshold' })
  });
  assert.equal(set60Res.status, 200);
  const set60Data = await set60Res.json();
  assert.equal(set60Data.configured, true);
  assert.equal(set60Data.threshold, 60);

  // At 60% threshold, stu_m1 in CIT111 (2/3 = 66.666...%) is ELIGIBLE
  const sumAt60 = await (
    await fetch(`${baseUrl}/api/attendance/my-summary`, {
      headers: { Authorization: `Bearer ${student1Token}` }
    })
  ).json();
  const citAt60 = sumAt60.subjects.find(s => s.code === 'CIT111');
  assert.equal(citAt60.configuredThreshold, 60);
  assert.equal(citAt60.eligibilityStatus, 'eligible');
  assert.equal(citAt60.isEligible, true);

  // Admin updates threshold to 80%
  const set80Res = await fetch(`${baseUrl}/api/attendance/admin/threshold`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`
    },
    body: JSON.stringify({ threshold: 80, reason: 'Raise university attendance requirement to 80%' })
  });
  assert.equal(set80Res.status, 200);

  // At 80% threshold, stu_m1 in CIT111 (66.67%) becomes INELIGIBLE, while BSM111 (100%) remains ELIGIBLE, and ELX111 (0 sessions) is 'not_applicable'
  const sumAt80 = await (
    await fetch(`${baseUrl}/api/attendance/my-summary`, {
      headers: { Authorization: `Bearer ${student1Token}` }
    })
  ).json();
  const citAt80 = sumAt80.subjects.find(s => s.code === 'CIT111');
  assert.equal(citAt80.configuredThreshold, 80);
  assert.equal(citAt80.eligibilityStatus, 'ineligible');
  assert.equal(citAt80.isEligible, false);
  assert.equal(citAt80.presentCount, 2, 'Historical present count must be untouched');
  assert.equal(citAt80.totalSessions, 3, 'Historical session count must be untouched');

  const bsmAt80 = sumAt80.subjects.find(s => s.code === 'BSM111');
  assert.equal(bsmAt80.eligibilityStatus, 'eligible');
  assert.equal(bsmAt80.isEligible, true);

  const elxAt80 = sumAt80.subjects.find(s => s.code === 'ELX111');
  assert.equal(elxAt80.eligibilityStatus, 'not_applicable');
  assert.equal(elxAt80.isEligible, null);
});

test('Scenario 11 & 32: Cohort promotion preserves historical semester attendance and does not mix attendance across semesters or cohorts', async () => {
  // Promote Cohort Mercury from Semester 1 -> Semester 2
  const promo = await promoteCohort(db, {
    cohortId: cohortMercury.id,
    actorId: 'admin_att',
    expectedSemester: 1
  });
  assert.equal(promo.previousSemester, 1);
  assert.equal(promo.currentSemester, 2);

  // Verify historical Semester 1 sessions for Cohort Mercury still have semester_no = 1
  const histSessions = await db.all(
    `SELECT semester_no FROM attendance_sessions WHERE cohort_id = ?`,
    cohortMercury.id
  );
  assert.ok(histSessions.length >= 4);
  for (const s of histSessions) {
    assert.equal(Number(s.semesterNo || s.semester_no), 1, 'Historical session semester_no must remain 1 after promotion');
  }

  // Now Student 1 (in Cohort Mercury, now Semester 2) fetches my-summary:
  // Their current semester is 2, with 0 Semester 2 sessions so far (Semester 1 sessions are not mixed into Semester 2)
  const sumSem2 = await (
    await fetch(`${baseUrl}/api/attendance/my-summary`, {
      headers: { Authorization: `Bearer ${student1Token}` }
    })
  ).json();
  assert.equal(sumSem2.semesterNo, 2);
  assert.equal(sumSem2.overall.totalSessions, 0, 'Semester 1 sessions must not bleed into Semester 2 summary');
  assert.ok(sumSem2.subjects.every(s => s.semester === 2), 'Only Semester 2 subjects should appear in Semester 2 summary');
});

// ============================================================================
// POSTGRESQL (PGLITE) MIGRATION & DUAL-ENGINE PARITY TEST
// ============================================================================

test('PostgreSQL Engine (PGlite): Migration SQL file, constraints, ON DELETE RESTRICT, and full service flow pass on PostgreSQL', async () => {
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

  // 1. Initialize base PostgreSQL tables
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

  // 2. Apply the actual SQL migration file migrations/20261024_attendance_schema.sql
  const migrationSql = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '20261024_attendance_schema.sql'),
    'utf8'
  );
  await pgDb.exec(migrationSql);

  // Verify idempotent re-run via ensureAttendanceSchema
  await ensureAttendanceSchema(pgDb);

  // 3. Seed subjects, cohort, teacher, admin, and students in PostgreSQL
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
    `INSERT INTO students (studentId, name, role, account_status) VALUES ('pg_admin', 'PG Admin', 'admin', 'active')`
  );
  await pgDb.run(
    `INSERT INTO students (studentId, name, role, account_status) VALUES ('pg_tea_user', 'PG Teacher', 'teacher', 'active')`
  );
  await pgDb.run(
    `INSERT INTO teachers (id, user_id, designation, status) VALUES ('pg_tea_id', 'pg_tea_user', 'Professor', 'active')`
  );
  await pgDb.run(
    `INSERT INTO teacher_subjects (id, teacher_id, subject_id) VALUES ('pg_ts_1', 'pg_tea_id', 'CIT111')`
  );
  await pgDb.run(
    `INSERT INTO students (studentId, name, role, cohort_id, semester, account_status)
     VALUES ('pg_stu_1', 'PG Student 1', 'student', ?, 'Semester 1', 'active')`,
    pgCohort.id
  );

  // 4. Create attendance session on PostgreSQL
  const saved = await saveAttendanceSession(pgDb, {
    actorUserId: 'pg_tea_user',
    subjectId: 'CIT111',
    cohortId: pgCohort.id,
    sessionDate: TODAY_NEPAL,
    records: [{ studentId: 'pg_stu_1', status: 'present' }]
  });
  assert.equal(saved.created, true);

  // 5. Verify ON DELETE RESTRICT prevents deleting a student or cohort that has finalized attendance
  await assert.rejects(async () => {
    await pgDb.run(`DELETE FROM students WHERE studentId = 'pg_stu_1'`);
  });
  await assert.rejects(async () => {
    await pgDb.run(`DELETE FROM cohorts WHERE id = ?`, pgCohort.id);
  });

  // 6. Verify threshold update & student summary on PostgreSQL
  await updateEligibilityThresholdConfig(pgDb, {
    adminUserId: 'pg_admin',
    threshold: 75,
    reason: 'PG test threshold'
  });
  const pgSummary = await getStudentAttendanceSummary(pgDb, { studentUserId: 'pg_stu_1' });
  assert.equal(pgSummary.configuredThreshold, 75);
  assert.equal(pgSummary.subjects[0].attendancePercentage, 100);
  assert.equal(pgSummary.subjects[0].eligibilityStatus, 'eligible');

  await pg.close();
});
