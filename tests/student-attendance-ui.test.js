'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');
const vm = require('vm');
const { PassThrough } = require('stream');

const testDbPath = path.join(
  os.tmpdir(),
  `student_att_ui_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`
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
const {
  ensureAttendanceSchema,
  saveAttendanceSession,
  updateEligibilityThresholdConfig
} = require('../lib/attendance-service');
const { formatNepalDate } = require('../lib/nepali-dates');

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
      if (bodyBuf) req.push(bodyBuf);
      req.push(null);
    } catch (err) {
      reject(err);
    }
  });
}

const PASSWORD = 'Test_Password123!';
let adminToken = '';
let teacherToken = '';
let student1Token = '';
let student2Token = '';
let unassignedStudentToken = '';
let cohortMercury = null;

const TODAY_NEPAL = formatNepalDate(new Date());
const YESTERDAY_NEPAL = formatNepalDate(new Date(Date.now() - 24 * 60 * 60 * 1000));

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

  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, account_status)
     VALUES ('adm_s4', 'adm_s4', 'Admin Step4', 'adm4@gandaki.edu.np', 'admin', ?, NULL, 'active')`,
    passwordHash
  );

  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, department, account_status)
     VALUES ('tea_s4', 'tea_s4', 'Prof. Step4', 'tea4@gandaki.edu.np', 'teacher', ?, NULL, 'BIT', 'active')`,
    passwordHash
  );
  await db.run(
    `INSERT INTO teachers (id, user_id, designation, status)
     VALUES ('tea_id_s4', 'tea_s4', 'Professor', 'active')`
  );
  await db.run(
    `INSERT INTO teacher_subjects (id, teacher_id, subject_id) VALUES ('ts_s4_1', 'tea_id_s4', 'CIT111')`
  );
  await db.run(
    `INSERT INTO teacher_subjects (id, teacher_id, subject_id) VALUES ('ts_s4_2', 'tea_id_s4', 'BSM111')`
  );

  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, cohort_id, account_status)
     VALUES ('stu_s4_1', 'stu_s4_1', 'Aashrita Student', 's4_1@gandaki.edu.np', 'student', ?, 'Semester 1', ?, 'active')`,
    passwordHash,
    cohortMercury.id
  );
  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, cohort_id, account_status)
     VALUES ('stu_s4_2', 'stu_s4_2', 'Ankit Student', 's4_2@gandaki.edu.np', 'student', ?, 'Semester 1', ?, 'active')`,
    passwordHash,
    cohortMercury.id
  );
  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, cohort_id, account_status)
     VALUES ('stu_s4_unassigned', 'stu_s4_un', 'Unassigned Student', 's4_un@gandaki.edu.np', 'student', ?, 'Semester 1', NULL, 'active')`,
    passwordHash
  );

  const login = async (id) => {
    const r = await appFetch(`${baseUrl}/api/mobile/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: id, password: PASSWORD })
    });
    return (await r.json()).token;
  };

  adminToken = await login('adm_s4');
  teacherToken = await login('tea_s4');
  student1Token = await login('stu_s4_1');
  student2Token = await login('stu_s4_2');
  unassignedStudentToken = await login('stu_s4_unassigned');
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

function createStudentDashboardHarness(tokenProvider, customResponder = null) {
  const makeEl = (tag = 'div') => ({
    tagName: tag.toUpperCase(),
    id: '',
    className: '',
    textContent: '',
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

  const mountEl = makeEl('div');
  mountEl.id = 'studentAttendanceMount';

  const sandboxWindow = {
    URLSearchParams,
    document: {
      head: { appendChild() {} },
      getElementById(id) {
        return id === 'studentAttendanceMount' ? mountEl : null;
      },
      createElement(tag) {
        return makeEl(tag);
      },
      querySelector(sel) {
        return sel === '#studentAttendanceMount' ? mountEl : null;
      }
    },
    SemesterAuth: {
      authFetch: async (url, opts = {}) => {
        if (customResponder) {
          const custom = await customResponder(url, opts);
          if (custom) return custom;
        }
        const token = typeof tokenProvider === 'function' ? tokenProvider() : tokenProvider;
        const headers = {
          ...(opts.headers || {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        };
        return appFetch(`${baseUrl}${url}`, { ...opts, headers });
      }
    }
  };
  sandboxWindow.window = sandboxWindow;

  const scriptCode = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'student-attendance.js'),
    'utf8'
  );
  vm.runInNewContext(scriptCode, sandboxWindow);

  return {
    mountEl,
    dashboard: sandboxWindow.StudentAttendanceDashboard
  };
}

test('Step 4 Verification 1, 9, 10: Web & Mobile student attendance entry points, role-aware routing, and absence of teacher/admin controls', () => {
  const webPagePath = path.join(__dirname, '..', 'public', 'attendance.html');
  const webModulePath = path.join(__dirname, '..', 'public', 'js', 'student-attendance.js');
  const libraryHtmlPath = path.join(__dirname, '..', 'public', 'library.html');
  const dashboardHtmlPath = path.join(__dirname, '..', 'public', 'dashboard.html');
  const mobileRoutePath = path.join(__dirname, '..', 'mobile', 'app', 'attendance.tsx');
  const mobileStudentViewPath = path.join(
    __dirname,
    '..',
    'mobile',
    'components',
    'student',
    'StudentAttendanceView.tsx'
  );
  const mobileTeacherViewPath = path.join(
    __dirname,
    '..',
    'mobile',
    'components',
    'teacher',
    'TeacherAttendanceView.tsx'
  );
  const mobileIndexTabPath = path.join(__dirname, '..', 'mobile', 'app', '(tabs)', 'index.tsx');
  const mobileLibraryTabPath = path.join(__dirname, '..', 'mobile', 'app', '(tabs)', 'library.tsx');

  assert.ok(fs.existsSync(webPagePath), 'public/attendance.html must exist');
  assert.ok(fs.existsSync(webModulePath), 'public/js/student-attendance.js must exist');
  assert.ok(fs.existsSync(mobileStudentViewPath), 'StudentAttendanceView.tsx must exist');
  assert.ok(fs.existsSync(mobileTeacherViewPath), 'TeacherAttendanceView.tsx must remain intact');

  const webHtml = fs.readFileSync(webPagePath, 'utf8');
  const webJs = fs.readFileSync(webModulePath, 'utf8');
  const libHtml = fs.readFileSync(libraryHtmlPath, 'utf8');
  const dashHtml = fs.readFileSync(dashboardHtmlPath, 'utf8');
  const mobileRoute = fs.readFileSync(mobileRoutePath, 'utf8');
  const mobileStudentView = fs.readFileSync(mobileStudentViewPath, 'utf8');
  const mobileIndexTab = fs.readFileSync(mobileIndexTabPath, 'utf8');
  const mobileLibraryTab = fs.readFileSync(mobileLibraryTabPath, 'utf8');

  // Verify web & mobile entry points
  assert.ok(libHtml.includes('id="studentAttendanceBtn"'));
  assert.ok(libHtml.includes('href="attendance.html"'));
  assert.ok(dashHtml.includes('href="attendance.html"'));
  assert.ok(mobileIndexTab.includes("router.push('/attendance'"));
  assert.ok(mobileLibraryTab.includes("router.push('/attendance'"));

  // Verify role-aware routing in mobile/app/attendance.tsx
  assert.ok(mobileRoute.includes('StudentAttendanceView'));
  assert.ok(mobileRoute.includes('TeacherAttendanceView'));
  assert.ok(mobileRoute.includes("appRole === 'student'"));

  // Verify student dashboard consumes ONLY GET /api/attendance/my-summary and never exposes teacher/admin endpoints
  assert.ok(webJs.includes("'/api/attendance/my-summary'"));
  assert.ok(!webJs.includes('/api/attendance/roster'));
  assert.ok(!webJs.includes('/api/attendance/sessions'));
  assert.ok(!webJs.includes('/api/attendance/admin'));
  assert.ok(!webJs.includes('/api/admin/attendance'));

  assert.ok(mobileStudentView.includes("'/api/attendance/my-summary'"));
  assert.ok(!mobileStudentView.includes('/api/attendance/roster'));
  assert.ok(!mobileStudentView.includes('/api/attendance/sessions'));
  assert.ok(!mobileStudentView.includes('/api/attendance/admin'));
  assert.ok(!mobileStudentView.includes('/api/admin/attendance'));

  // Verify role-aware mounting in public/attendance.html mounts TeacherAttendanceWorkspace directly on /attendance.html for teachers
  assert.ok(webHtml.includes('TeacherAttendanceWorkspace'));
  assert.ok(webHtml.includes('/js/teacher-attendance.js'));
});

test('Step 4 Verification 2: Cross-student query attempts and non-student role calls to GET /api/attendance/my-summary are rejected', async () => {
  // Student 1 attempting to query Student 2's summary via ?studentId=, ?student_id=, ?userId=
  for (const param of ['studentId=stu_s4_2', 'student_id=stu_s4_2', 'userId=stu_s4_2']) {
    const crossRes = await appFetch(`${baseUrl}/api/attendance/my-summary?${param}`, {
      headers: { Authorization: `Bearer ${student1Token}` }
    });
    assert.equal(crossRes.status, 403);
    const crossData = await crossRes.json();
    assert.equal(crossData.code, 'CROSS_STUDENT_ACCESS_DENIED');
  }

  // Teacher and Admin calling student-only summary endpoint receive 403
  const teacherRes = await appFetch(`${baseUrl}/api/attendance/my-summary`, {
    headers: { Authorization: `Bearer ${teacherToken}` }
  });
  assert.equal(teacherRes.status, 403);

  const adminRes = await appFetch(`${baseUrl}/api/attendance/my-summary`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert.equal(adminRes.status, 403);
});

test('Step 4 Verification 5 & 6: Zero-session, unassigned cohort, and unconfigured threshold states render accurately without hardcoding thresholds or 0% failure', async () => {
  // Unassigned student state
  const unassignedHarness = createStudentDashboardHarness(unassignedStudentToken);
  await unassignedHarness.dashboard.mount(unassignedHarness.mountEl);
  assert.ok(unassignedHarness.mountEl.innerHTML.includes('Class Cohort Not Assigned Yet'));

  // Assigned student with zero recorded sessions and unconfigured threshold
  const studentHarness = createStudentDashboardHarness(student1Token);
  await studentHarness.dashboard.mount(studentHarness.mountEl);
  const st = studentHarness.dashboard.getState();

  assert.equal(st.summary.studentId, 'stu_s4_1');
  assert.equal(st.summary.overall.totalSessions, 0);
  assert.equal(st.summary.overall.percentageAvailable, false);
  assert.equal(st.summary.overall.eligibilityStatus, 'unconfigured');
  assert.equal(st.summary.overall.configuredThreshold, null);

  const html = studentHarness.mountEl.innerHTML;
  assert.ok(html.includes('No attendance has been recorded yet'));
  assert.ok(html.includes('Overall Eligibility: Threshold Unconfigured'));
  assert.ok(html.includes('No sessions recorded'));
  assert.ok(!html.includes('75%'), 'Must not hardcode 75% when threshold is unconfigured');
  assert.ok(!html.includes('80%'), 'Must not hardcode 80% when threshold is unconfigured');
});

test('Step 4 Verification 1, 3, 4, 7: Populated subject totals, overall totals, recent history, and eligible/ineligible states follow backend response', async () => {
  // Record 2 sessions for CIT111 (Student 1: Present, Absent -> 50%; Student 2: Present, Present -> 100%)
  // and 1 session for BSM111 (Student 1: Present -> 100%; Student 2: Absent -> 0%)
  await saveAttendanceSession(db, {
    actorUserId: 'tea_s4',
    subjectId: 'CIT111',
    cohortId: cohortMercury.id,
    sessionDate: YESTERDAY_NEPAL,
    records: [
      { studentId: 'stu_s4_1', status: 'present' },
      { studentId: 'stu_s4_2', status: 'present' }
    ]
  });

  await saveAttendanceSession(db, {
    actorUserId: 'tea_s4',
    subjectId: 'CIT111',
    cohortId: cohortMercury.id,
    sessionDate: TODAY_NEPAL,
    records: [
      { studentId: 'stu_s4_1', status: 'absent' },
      { studentId: 'stu_s4_2', status: 'present' }
    ]
  });

  await saveAttendanceSession(db, {
    actorUserId: 'tea_s4',
    subjectId: 'BSM111',
    cohortId: cohortMercury.id,
    sessionDate: TODAY_NEPAL,
    records: [
      { studentId: 'stu_s4_1', status: 'present' },
      { studentId: 'stu_s4_2', status: 'absent' }
    ]
  });

  // Before threshold is configured: Student 1 has 2/3 overall (66.67%), eligibility is still 'unconfigured'
  const harness = createStudentDashboardHarness(student1Token);
  await harness.dashboard.mount(harness.mountEl);
  let html = harness.mountEl.innerHTML;

  assert.ok(html.includes('66.67%'), 'Overall percentage 66.67% must render');
  assert.ok(html.includes('50%'), 'CIT111 percentage 50% must render');
  assert.ok(html.includes('100%'), 'BSM111 percentage 100% must render');
  assert.ok(html.includes('No sessions recorded'), 'Subjects with 0 sessions must still show No sessions recorded');
  assert.ok(html.includes('Overall Eligibility: Threshold Unconfigured'));
  assert.ok(html.includes(TODAY_NEPAL), 'Recent history must render Nepal session date');
  assert.ok(!html.includes('stu_s4_2'), 'Student 1 dashboard must never contain Student 2 records');

  // Configure threshold to 60%:
  // Student 1 overall (66.67%) -> 'eligible'
  // Student 1 CIT111 (50%) -> 'ineligible'
  // Student 1 BSM111 (100%) -> 'eligible'
  // Student 1 other subjects (0 sessions) -> 'not_applicable'
  await updateEligibilityThresholdConfig(db, {
    adminUserId: 'adm_s4',
    threshold: 60,
    reason: 'Set 60% threshold for Step 4 verification'
  });

  await harness.dashboard.loadSummary();
  html = harness.mountEl.innerHTML;

  assert.ok(html.includes('Overall Eligibility: Eligible'));
  assert.ok(html.includes('Meets configured minimum requirement (60%)'));
  assert.ok(html.includes('Below Threshold'));
  assert.ok(html.includes('Below configured minimum requirement (60%)'));
  assert.ok(html.includes('No Sessions Recorded'));

  // Configure threshold to 80%:
  // Student 1 overall (66.67%) -> 'ineligible'
  await updateEligibilityThresholdConfig(db, {
    adminUserId: 'adm_s4',
    threshold: 80,
    reason: 'Raise threshold to 80% for Step 4 verification'
  });

  await harness.dashboard.loadSummary();
  html = harness.dashboard.getState() && harness.mountEl.innerHTML;
  assert.ok(html.includes('Overall Eligibility: Below Threshold'));
  assert.ok(html.includes('Below configured minimum requirement (80%)'));
});

test('Step 4 Verification 8: Loading, API error, retry, and authentication-expiry states work cleanly', async () => {
  let mode = 'error_500';
  const harness = createStudentDashboardHarness(student1Token, async () => {
    if (mode === 'error_500') {
      return {
        ok: false,
        status: 503,
        json: async () => ({ message: 'Temporary attendance service outage' })
      };
    }
    if (mode === 'error_401') {
      return {
        ok: false,
        status: 401,
        json: async () => ({ message: 'Authentication expired. Please sign in.' })
      };
    }
    return null; // Fall through to real server
  });

  // 1. API 503 error state renders error message and Retry button
  await harness.dashboard.mount(harness.mountEl);
  assert.ok(harness.mountEl.innerHTML.includes('Could Not Load Attendance'));
  assert.ok(harness.mountEl.innerHTML.includes('Temporary attendance service outage'));
  assert.ok(harness.mountEl.innerHTML.includes('data-stu-att-action="retry"'));

  // 2. Auth expiry (401) state renders Sign In Required and link to /login.html
  mode = 'error_401';
  await harness.dashboard.loadSummary();
  assert.ok(harness.mountEl.innerHTML.includes('Sign In Required'));
  assert.ok(harness.mountEl.innerHTML.includes('href="/login.html"'));

  // 3. Retry after recovery loads real student summary from backend
  mode = 'live';
  await harness.dashboard.loadSummary();
  assert.equal(harness.dashboard.getState().error, null);
  assert.ok(harness.mountEl.innerHTML.includes('Overall Attendance Summary'));
  assert.ok(harness.mountEl.innerHTML.includes('66.67%'));
});

test('Step 4.5 Audit Verification: CR role access, >50 sessions aggregate accuracy vs 50-item recentHistory cap, subject filter reset, and unauthenticated 401 rejection', async () => {
  // 1. Unauthenticated request to GET /api/attendance/my-summary returns 401
  const unauthRes = await appFetch(`${baseUrl}/api/attendance/my-summary`);
  assert.equal(unauthRes.status, 401);

  // 2. Seed a CR user in Mercury cohort and verify CR role can access own summary
  const passwordHash = bcrypt.hashSync(PASSWORD, 8);
  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, cohort_id, account_status)
     VALUES ('cr_s4_1', 'cr_s4_1', 'Sujan CR', 'crs4@gandaki.edu.np', 'cr', ?, 'Semester 1', ?, 'active')`,
    passwordHash,
    cohortMercury.id
  );
  const crLogin = await appFetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: 'cr_s4_1', password: PASSWORD })
  });
  const crToken = (await crLogin.json()).token;

  const crSummaryRes = await appFetch(`${baseUrl}/api/attendance/my-summary`, {
    headers: { Authorization: `Bearer ${crToken}` }
  });
  assert.equal(crSummaryRes.status, 200);
  const crSummary = await crSummaryRes.json();
  assert.equal(crSummary.studentId, 'cr_s4_1');
  assert.equal(crSummary.role, 'cr');

  // 3. Seed 52 additional historical sessions for CIT111 (total 55 finalized sessions across CIT111 + BSM111)
  // Verify recentHistory is capped at 50 while overall.totalSessions and subjects[].totalSessions reflect all 55 sessions!
  for (let i = 2; i <= 53; i++) {
    const pastDate = formatNepalDate(new Date(Date.now() - i * 24 * 60 * 60 * 1000));
    await saveAttendanceSession(db, {
      actorUserId: 'tea_s4',
      subjectId: 'CIT111',
      cohortId: cohortMercury.id,
      sessionDate: pastDate,
      records: [
        { studentId: 'stu_s4_1', status: 'present' },
        { studentId: 'stu_s4_2', status: 'present' },
        { studentId: 'cr_s4_1', status: 'present' }
      ]
    });
  }

  const harness = createStudentDashboardHarness(student1Token);
  await harness.dashboard.mount(harness.mountEl);
  const st = harness.dashboard.getState();

  assert.equal(st.summary.recentHistory.length, 50, 'recentHistory must be capped at 50 items');
  assert.equal(st.summary.overall.totalSessions, 55, 'Overall totalSessions must use full backend aggregate (55), not 50');
  assert.equal(st.summary.overall.presentCount, 54, 'Overall presentCount must reflect all 54 present marks');
  assert.equal(st.summary.overall.absentCount, 1, 'Overall absentCount must reflect 1 absent mark');

  const citSubj = st.summary.subjects.find((s) => s.code === 'CIT111');
  assert.equal(citSubj.totalSessions, 54, 'CIT111 totalSessions must be 54');
  assert.equal(citSubj.presentCount, 53, 'CIT111 presentCount must be 53');

  // 4. Verify invalid selectedSubjectFilter automatically resets to 'ALL' on loadSummary
  st.selectedSubjectFilter = 'NON_EXISTENT_SUBJECT';
  await harness.dashboard.loadSummary();
  assert.equal(st.selectedSubjectFilter, 'ALL');
});

