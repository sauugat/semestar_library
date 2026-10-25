
const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { PassThrough } = require('stream');

const testDbPath = path.join(
  os.tmpdir(),
  `teacher_att_ui_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`
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
  saveAttendanceSession
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
    reqSocket.destroy = () => { };

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
let teacherAToken = '';
let student1Token = '';
let cohortMercury = null;
let cohortNeptune = null;
const TODAY_NEPAL = formatNepalDate(new Date());
const TWO_DAYS_AGO_NEPAL = formatNepalDate(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000));

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
        try { server.close(); } catch (_) { }
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
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, department, account_status)
     VALUES ('tea_ui_a', 'prof_ui_a', 'Prof. UI Alice', 'uia@gandaki.edu.np', 'teacher', ?, NULL, 'BIT', 'active')`,
    passwordHash
  );
  await db.run(
    `INSERT INTO teachers (id, user_id, designation, status)
     VALUES ('tea_ui_id_a', 'tea_ui_a', 'Professor', 'active')`
  );
  await db.run(
    `INSERT INTO teacher_subjects (id, teacher_id, subject_id) VALUES ('ts_ui_1', 'tea_ui_id_a', 'CIT111')`
  );

  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, cohort_id, account_status)
     VALUES ('stu_ui_1', 'stu_ui_1', 'Student One', 'su1@gandaki.edu.np', 'student', ?, 'Semester 1', ?, 'active')`,
    passwordHash,
    cohortMercury.id
  );
  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, cohort_id, account_status)
     VALUES ('stu_ui_2', 'stu_ui_2', 'Student Two', 'su2@gandaki.edu.np', 'student', ?, 'Semester 1', ?, 'active')`,
    passwordHash,
    cohortMercury.id
  );

  const tLogin = await appFetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: 'tea_ui_a', password: PASSWORD })
  });
  teacherAToken = (await tLogin.json()).token;

  const sLogin = await appFetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: 'stu_ui_1', password: PASSWORD })
  });
  student1Token = (await sLogin.json()).token;
});

test.after(async () => {
  if (server && server.listening) {
    await new Promise(resolve => server.close(resolve));
  }
  await db.close().catch(() => { });
  try {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  } catch (_) { }
});

test('Step 3 Verification 1: Web Teacher Attendance module & Teacher Dashboard entry points exist and consume exact Step 2 API paths', () => {
  const webModulePath = path.join(__dirname, '..', 'public', 'js', 'teacher-attendance.js');
  const teacherDashPath = path.join(__dirname, '..', 'public', 'teacher-dashboard.html');
  assert.ok(fs.existsSync(webModulePath), 'public/js/teacher-attendance.js must exist');

  const webJs = fs.readFileSync(webModulePath, 'utf8');
  const dashHtml = fs.readFileSync(teacherDashPath, 'utf8');

  // Verify exact API contracts consumed
  assert.ok(webJs.includes('/api/attendance/teacher/context'));
  assert.ok(webJs.includes('/api/attendance/roster?'));
  assert.ok(webJs.includes('/api/attendance/sessions'));
  assert.ok(webJs.includes('/api/attendance/sessions/'));
  assert.ok(webJs.includes('/audit'));

  // Verify no admin-only controls are exposed in teacher module
  assert.ok(!webJs.includes('/api/attendance/admin/'));

  // Verify teacher-dashboard.html includes Attendance tab, Take Attendance button, and mounts TeacherAttendanceWorkspace
  assert.ok(dashHtml.includes('id="tabAttendanceBtn"'));
  assert.ok(dashHtml.includes('id="viewAttendance"'));
  assert.ok(dashHtml.includes('id="teacherAttendanceMount"'));
  assert.ok(dashHtml.includes('Take Attendance'));
  assert.ok(dashHtml.includes('/js/teacher-attendance.js'));
});

test('Step 3 Verification 2: Mobile Teacher Attendance route, navigation entry points, and role guards are wired properly', () => {
  const layoutPath = path.join(__dirname, '..', 'mobile', 'app', '_layout.tsx');
  const routePath = path.join(__dirname, '..', 'mobile', 'app', 'attendance.tsx');
  const viewPath = path.join(__dirname, '..', 'mobile', 'components', 'teacher', 'TeacherAttendanceView.tsx');
  const materialsPath = path.join(__dirname, '..', 'mobile', 'components', 'teacher', 'TeacherMaterialsView.tsx');

  assert.ok(fs.existsSync(routePath), 'mobile/app/attendance.tsx must exist');
  assert.ok(fs.existsSync(viewPath), 'mobile/components/teacher/TeacherAttendanceView.tsx must exist');

  const layoutCode = fs.readFileSync(layoutPath, 'utf8');
  const viewCode = fs.readFileSync(viewPath, 'utf8');
  const materialsCode = fs.readFileSync(materialsPath, 'utf8');

  // Registered in Root Stack
  assert.ok(layoutCode.includes('<Stack.Screen name="attendance"'));

  // Entry points in TeacherMaterialsView
  assert.ok(materialsCode.includes("pathname: '/attendance'"));
  assert.ok(materialsCode.includes("router.push('/attendance'"));

  // Verified API paths in TeacherAttendanceView
  assert.ok(viewCode.includes('/api/attendance/teacher/context'));
  assert.ok(viewCode.includes('/api/attendance/roster?'));
  assert.ok(viewCode.includes('/api/attendance/sessions'));
  assert.ok(!viewCode.includes('/api/attendance/admin/'));

  // Role guard for students attempting direct route entry
  assert.ok(viewCode.includes('resolveAppRole(user)'));
  assert.ok(viewCode.includes('Faculty Access Required'));

  // Unsaved changes guard & double-tap protection
  assert.ok(viewCode.includes('Discard Unsaved Attendance?'));
  assert.ok(viewCode.includes('isSubmittingRef'));
});

test('Step 3 Verification 3: Interactive Web Teacher Attendance state machine (Marking, Back/Next navigation, Unmarked guard, Review counts, Save, Failed save preservation, Editable vs Expired Read-Only session)', async () => {
  // Execute the Web TeacherAttendanceWorkspace module in an isolated JSDOM-like minimal DOM harness
  // backed by the real Express backend via appFetch!
  const elementsById = new Map();
  const makeEl = (tag = 'div') => {
    const el = {
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
      appendChild() { },
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      }
    };
    return el;
  };

  const mountEl = makeEl('div');
  mountEl.id = 'teacherAttendanceMount';
  elementsById.set('teacherAttendanceMount', mountEl);

  let failNextSave = false;

  const sandboxWindow = {
    URLSearchParams,
    confirm: () => true,
    setInterval: () => 1,
    clearInterval: () => { },
    document: {
      head: { appendChild() { } },
      getElementById(id) {
        return elementsById.get(id) || null;
      },
      createElement(tag) {
        const el = makeEl(tag);
        return el;
      },
      querySelector(sel) {
        if (sel === '#teacherAttendanceMount') return mountEl;
        return null;
      }
    },
    SemesterAuth: {
      authFetch: async (url, opts = {}) => {
        if (failNextSave && (opts.method === 'POST' || opts.method === 'PUT')) {
          return {
            ok: false,
            status: 503,
            json: async () => ({ message: 'Simulated network save failure' })
          };
        }
        const headers = {
          ...(opts.headers || {}),
          Authorization: `Bearer ${teacherAToken}`
        };
        return appFetch(`${baseUrl}${url}`, { ...opts, headers });
      }
    }
  };
  sandboxWindow.window = sandboxWindow;

  const vm = require('vm');
  const scriptCode = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'teacher-attendance.js'),
    'utf8'
  );
  vm.runInNewContext(scriptCode, sandboxWindow);

  const ws = sandboxWindow.TeacherAttendanceWorkspace;
  assert.ok(ws, 'TeacherAttendanceWorkspace must attach to window');

  // 1 & 2: Mount workspace without subjectKey -> lands on Subject-Selection Landing Page first (no register shown yet)
  await ws.mount(mountEl);
  const st = ws.getState();

  assert.equal(st.subjects.length, 1);
  assert.equal(st.subjects[0].code, 'CIT111');
  assert.equal(st.selectedSubjectId, '', 'Must start on Subject-Selection Landing Page before a subject is selected');
  assert.ok(mountEl.innerHTML.includes('id="slAttSubjectLanding"'), 'Must render subject selection landing view');
  assert.ok(mountEl.innerHTML.includes('data-att-select-subject="CIT111"'), 'Must render assigned subject card');
  assert.ok(!mountEl.innerHTML.includes('id="slAttStudentRegisterSection"'), 'Must NOT show attendance-taking interface before a subject is selected');

  // Teacher clicks / selects assigned subject CIT111 -> opens student attendance register and monthly matrix
  await ws.selectSubject('CIT111');
  assert.equal(st.selectedSubjectId, 'CIT111');
  assert.equal(st.selectedCohortId, cohortMercury.id);
  assert.equal(st.selectedDate, TODAY_NEPAL);
  assert.equal(st.roster.length, 2);
  assert.ok(mountEl.innerHTML.includes('id="slAttStudentRegisterSection"'), 'Must render student attendance register after selecting subject');
  assert.ok(mountEl.innerHTML.includes('id="slAttMonthlyMatrixTable"'), 'Must render monthly attendance matrix table after selecting subject');

  // Initially unmarked (never auto-marked Present or Absent)
  assert.equal(Object.keys(st.marksByStudentId).length, 0);
  assert.equal(st.currentStudentIndex, 0);

  // 4: Unmarked students prevent submission
  await ws.submitAttendance();
  assert.match(st.saveError, /unmarked/i);
  assert.equal(st.existingSession, null);

  // 3: Mark Student 1 as Present -> auto-advances focus to Student 2 (index 1)
  ws.markStudent('stu_ui_1', 'present', true);
  assert.equal(st.marksByStudentId['stu_ui_1'], 'present');
  assert.equal(st.currentStudentIndex, 1);

  // Navigate back to Student 1 and change answer to Absent -> preserves answer
  st.currentStudentIndex = 0;
  ws.markStudent('stu_ui_1', 'absent', true);
  assert.equal(st.marksByStudentId['stu_ui_1'], 'absent');
  assert.equal(st.currentStudentIndex, 1);

  // Mark Student 2 as Present
  ws.markStudent('stu_ui_2', 'present', true);
  assert.equal(st.marksByStudentId['stu_ui_2'], 'present');

  // 5: Register HTML displays accurate counts (Total: 2, Marked: 2, Present: 1, Absent: 1, Unmarked: 0)
  st.stage = 'review';
  await ws.mount(mountEl);
  assert.ok(mountEl.innerHTML.includes('All 2 students marked (1 Present, 1 Absent)'));

  // 7: Failed save preserves all selections
  failNextSave = true;
  await ws.submitAttendance();
  assert.match(st.saveError, /Simulated network save failure/);
  assert.equal(st.marksByStudentId['stu_ui_1'], 'absent', 'Failed save must preserve Student 1 selection');
  assert.equal(st.marksByStudentId['stu_ui_2'], 'present', 'Failed save must preserve Student 2 selection');

  // 6: Successful save refreshes server-backed state
  failNextSave = false;
  await ws.submitAttendance();
  assert.equal(st.saveError, null);
  assert.ok(st.saveSuccessMessage.includes('Attendance submitted'));
  assert.ok(st.existingSession && st.existingSession.id, 'Server-backed session must be loaded after save');

  // 8: Existing editable session loads correctly and can be edited within 24h
  assert.ok(mountEl.innerHTML.includes('data-att-save-state="saved"'));
  ws.markStudent('stu_ui_1', 'present', false);
  await ws.submitAttendance();
  assert.ok(st.saveSuccessMessage.includes('Attendance updated'));
  assert.equal(st.marksByStudentId['stu_ui_1'], 'present');

  // 9: Expired session (>24h old) loads as read-only and displays explanation
  const expiredSubmittedAt = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
  await saveAttendanceSession(db, {
    actorUserId: 'tea_ui_a',
    subjectId: 'CIT111',
    cohortId: cohortMercury.id,
    sessionDate: TWO_DAYS_AGO_NEPAL,
    now: new Date(expiredSubmittedAt),
    records: [
      { studentId: 'stu_ui_1', status: 'present' },
      { studentId: 'stu_ui_2', status: 'absent' }
    ]
  });

  st.selectedDate = TWO_DAYS_AGO_NEPAL;
  await ws.loadRoster();
  assert.ok(st.existingSession);
  assert.ok(mountEl.innerHTML.includes('This session is locked for teacher edits because the 24-hour window has elapsed.'));

  // Attempting to mark or submit on an expired session is blocked
  ws.markStudent('stu_ui_2', 'present', false);
  assert.equal(st.marksByStudentId['stu_ui_2'], 'absent', 'Read-only expired session must not allow changing marks');

  // Verify unmount() and discardUnsavedChanges() exist and clean up state
  assert.equal(typeof ws.unmount, 'function');
  assert.equal(typeof ws.discardUnsavedChanges, 'function');
  ws.unmount();
  assert.equal(st.countdownTimerId, null);
});

test('Step 3.5 Audit Verification: /api/admin/attendance mount route collision fix, complete roster enforcement on 24h edits, and mobile initialSubjectId one-time sync', async () => {
  const passwordHash = bcrypt.hashSync(PASSWORD, 8);
  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, account_status)
     VALUES ('admin_ui_1', 'admin_ui_1', 'Audit Admin', 'audit_admin@gandaki.edu.np', 'admin', ?, NULL, 'active')
     ON CONFLICT (studentId) DO NOTHING`,
    passwordHash
  );
  const adminLogin = await appFetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: 'admin_ui_1', password: PASSWORD })
  });
  const adminToken = (await adminLogin.json()).token;

  // 1. Non-admin teacher is rejected on ANY route under /api/admin/attendance/*
  const teacherOnAdminMount = await appFetch(`${baseUrl}/api/admin/attendance/teacher/context`, {
    headers: { Authorization: `Bearer ${teacherAToken}` }
  });
  assert.equal(teacherOnAdminMount.status, 403, 'Non-admin teacher must be rejected on /api/admin/attendance/*');

  // 2. Partial roster on 24h teacher edit (PUT /api/attendance/sessions/:id) is rejected with 400 INCOMPLETE_ROSTER
  const todaySessionRow = await db.get(
    `SELECT id FROM attendance_sessions WHERE cohort_id = ? AND subject_id = 'CIT111' AND session_date = ?`,
    cohortMercury.id,
    TODAY_NEPAL
  );
  assert.ok(todaySessionRow && todaySessionRow.id);

  const partialEditRes = await appFetch(`${baseUrl}/api/attendance/sessions/${todaySessionRow.id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      records: [{ studentId: 'stu_ui_1', status: 'present' }]
    })
  });
  assert.equal(partialEditRes.status, 400, 'Partial roster edit must be rejected with 400');
  const partialEditData = await partialEditRes.json();
  assert.equal(partialEditData.code, 'INCOMPLETE_ROSTER');

  // 3. Clean admin mount paths (/api/admin/attendance/sessions/:id/correct and PUT /api/admin/attendance/sessions/:id) work on expired sessions
  const expiredSessionRow = await db.get(
    `SELECT id FROM attendance_sessions WHERE cohort_id = ? AND subject_id = 'CIT111' AND session_date = ?`,
    cohortMercury.id,
    TWO_DAYS_AGO_NEPAL
  );
  assert.ok(expiredSessionRow && expiredSessionRow.id);

  const adminPutOnAdminMount = await appFetch(`${baseUrl}/api/admin/attendance/sessions/${expiredSessionRow.id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      reason: 'Admin correction via PUT /api/admin/attendance/sessions/:id',
      records: [
        { studentId: 'stu_ui_1', status: 'present' },
        { studentId: 'stu_ui_2', status: 'present' }
      ]
    })
  });
  assert.equal(adminPutOnAdminMount.status, 200);
  const adminPutData = await adminPutOnAdminMount.json();
  assert.equal(adminPutData.corrected, true);

  const adminPostCorrectOnAdminMount = await appFetch(
    `${baseUrl}/api/admin/attendance/sessions/${expiredSessionRow.id}/correct`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        reason: 'Admin correction via POST /api/admin/attendance/sessions/:id/correct',
        records: [
          { studentId: 'stu_ui_1', status: 'present' },
          { studentId: 'stu_ui_2', status: 'absent' }
        ]
      })
    }
  );
  assert.equal(adminPostCorrectOnAdminMount.status, 200);
  const adminPostData = await adminPostCorrectOnAdminMount.json();
  assert.equal(adminPostData.corrected, true);

  // 4. Verify mobile TeacherAttendanceView.tsx uses didApplyInitialSubjectRef so subject switching is not reverted
  const viewCode = fs.readFileSync(
    path.join(__dirname, '..', 'mobile', 'components', 'teacher', 'TeacherAttendanceView.tsx'),
    'utf8'
  );
  assert.ok(viewCode.includes('didApplyInitialSubjectRef'), 'Mobile view must guard initialSubjectId with didApplyInitialSubjectRef');
});

test('Phase 3B Verification: Teacher Web Google Drive Attendance Backup Card states (Not Configured, Not Connected, Connected, Sync Now, Partial Failure + Retry, Reconnect Required, Disconnect with Confirmation)', async () => {
  const dashHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'teacher-dashboard.html'), 'utf8');
  assert.ok(dashHtml.includes('/js/attendance-drive-sync.js'), 'teacher-dashboard.html must load /js/attendance-drive-sync.js');
  assert.ok(dashHtml.includes('/js/teacher-attendance.js'), 'teacher-dashboard.html must load /js/teacher-attendance.js');

  const WebDriveSync = require('../public/js/attendance-drive-sync');
  const crypto = require('crypto');

  // Minimal mock Google Drive v3 API for Phase 3B UI test
  const validToken = 'ya29.a0AfH6SMBx_phase3b_ui_mock_token_123456';
  const filesById = new Map();
  let fileIdCounter = 1;
  let forceFailDailyWorkbook = false;
  let forceAuthExpired401 = false;

  async function mockDriveFetch(urlStr, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const headers = options.headers || {};
    const authHeader = headers.Authorization || headers.authorization || '';

    if (urlStr.startsWith('https://oauth2.googleapis.com/revoke')) {
      return { status: 200, ok: true, json: async () => ({ revoked: true }) };
    }

    if (forceAuthExpired401 && urlStr.includes('/upload/drive/v3/files')) {
      forceAuthExpired401 = false;
      return {
        status: 401,
        ok: false,
        json: async () => ({
          error: {
            code: 401,
            message: 'Invalid Credentials',
            errors: [{ reason: 'authError' }]
          }
        })
      };
    }

    if (authHeader !== `Bearer ${validToken}`) {
      return {
        status: 401,
        ok: false,
        json: async () => ({
          error: { code: 401, message: 'Unauthorized', errors: [{ reason: 'authError' }] }
        })
      };
    }

    const parsed = new URL(urlStr);
    const pathname = parsed.pathname;

    if (method === 'GET' && pathname === '/drive/v3/about') {
      return {
        status: 200,
        ok: true,
        json: async () => ({ user: { emailAddress: 'prof.alice@gmail.com' } })
      };
    }

    if (method === 'GET' && pathname.startsWith('/drive/v3/files/')) {
      const fId = decodeURIComponent(pathname.slice('/drive/v3/files/'.length));
      const f = filesById.get(fId);
      if (!f) return { status: 404, ok: false, json: async () => ({ error: { code: 404 } }) };
      return { status: 200, ok: true, json: async () => ({ ...f }) };
    }

    if (method === 'GET' && pathname === '/drive/v3/files') {
      return { status: 200, ok: true, json: async () => ({ files: [] }) };
    }

    if (method === 'POST' && pathname === '/drive/v3/files') {
      const meta = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
      const id = `p3b_folder_${fileIdCounter++}`;
      const rec = {
        id,
        name: meta.name,
        mimeType: meta.mimeType,
        parents: meta.parents || [],
        appProperties: meta.appProperties || {},
        trashed: false,
        createdTime: new Date().toISOString()
      };
      filesById.set(id, rec);
      return { status: 200, ok: true, json: async () => ({ ...rec }) };
    }

    if ((method === 'POST' || method === 'PATCH') && pathname.startsWith('/upload/drive/v3/files')) {
      const bodyStr = String(options.body || '');
      if (forceFailDailyWorkbook && bodyStr.includes('"slArtifactType":"daily_workbook"')) {
        return {
          status: 503,
          ok: false,
          json: async () => ({
            error: {
              code: 503,
              message: `Temporary Drive outage while uploading with ${validToken}`
            }
          })
        };
      }
      const id = `p3b_file_${fileIdCounter++}`;
      const sha256Checksum = crypto.createHash('sha256').update(bodyStr).digest('hex');
      const rec = {
        id,
        name: 'uploaded_artifact',
        sha256Checksum,
        trashed: false,
        createdTime: new Date().toISOString()
      };
      filesById.set(id, rec);
      return { status: 200, ok: true, json: async () => ({ ...rec }) };
    }

    return { status: 404, ok: false, json: async () => ({}) };
  }

  const elementsById = new Map();
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
    appendChild() { },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    }
  });

  const mountEl = makeEl('div');
  mountEl.id = 'teacherAttendanceMount';
  elementsById.set('teacherAttendanceMount', mountEl);

  let confirmResult = true;
  let simulatedGisResponse = {
    access_token: validToken,
    expires_in: 3600,
    scope: 'https://www.googleapis.com/auth/drive.file'
  };

  const mockGisOAuth2 = {
    initTokenClient(cfg) {
      return {
        requestAccessToken() {
          cfg.callback(simulatedGisResponse);
        }
      };
    },
    hasGrantedAllScopes(resp, requiredScope) {
      return String(resp.scope || '').includes(requiredScope);
    }
  };

  const backendAuthFetch = async (url, opts = {}) => {
    const headers = {
      ...(opts.headers || {}),
      Authorization: `Bearer ${teacherAToken}`
    };
    return appFetch(`${baseUrl}${url}`, { ...opts, headers });
  };

  const sandboxWindow = {
    URLSearchParams,
    confirm: () => confirmResult,
    setInterval: () => 1,
    clearInterval: () => { },
    google: { accounts: { oauth2: mockGisOAuth2 } },
    document: {
      head: { appendChild() { } },
      getElementById(id) {
        return elementsById.get(id) || null;
      },
      createElement(tag) {
        return makeEl(tag);
      },
      querySelector(sel) {
        if (sel === '#teacherAttendanceMount') return mountEl;
        return null;
      }
    },
    SemesterAuth: {
      authFetch: backendAuthFetch
    },
    AttendanceDriveBackup: WebDriveSync
  };
  sandboxWindow.window = sandboxWindow;

  const customDriveClient = WebDriveSync.createAttendanceDriveSyncClient({
    window: sandboxWindow,
    backendFetch: backendAuthFetch,
    driveFetch: mockDriveFetch
  });

  const vm = require('vm');
  const scriptCode = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'teacher-attendance.js'),
    'utf8'
  );
  vm.runInNewContext(scriptCode, sandboxWindow);

  const ws = sandboxWindow.TeacherAttendanceWorkspace;

  // 1. Not Configured state: GOOGLE_DRIVE_WEB_CLIENT_ID is unset
  delete process.env.GOOGLE_DRIVE_WEB_CLIENT_ID;
  delete process.env.EXPO_PUBLIC_GOOGLE_DRIVE_WEB_CLIENT_ID;

  await ws.mount(mountEl, { driveClient: customDriveClient });
  assert.ok(mountEl.innerHTML.includes('id="slAttDriveBackupCard"'), 'Attendance Backup card must render');
  assert.ok(mountEl.innerHTML.includes('Not Configured'), 'Must display Not Configured badge');
  assert.ok(
    mountEl.innerHTML.includes('Google Drive backup integration has not been configured yet'),
    'Must explain unconfigured state clearly'
  );
  assert.ok(
    mountEl.innerHTML.includes('data-att-backup-action="connect"') && mountEl.innerHTML.includes('disabled'),
    'Connect button must be disabled when not configured'
  );

  // 2. Not Connected state: configure GOOGLE_DRIVE_WEB_CLIENT_ID and reload backup status
  process.env.GOOGLE_DRIVE_WEB_CLIENT_ID = '1234567890-phase3bweb.apps.googleusercontent.com';
  await ws.loadBackupStatus();

  assert.ok(mountEl.innerHTML.includes('Not Connected'), 'Must display Not Connected badge when configured but disconnected');
  assert.ok(mountEl.innerHTML.includes('Connect Google Drive'), 'Must display Connect Google Drive action');
  assert.ok(mountEl.innerHTML.includes('Pending Backups:'), 'Must display Pending Backups metric');

  // 3. Connect Google Drive: provisions folders, saves metadata, and refreshes UI to Connected state
  await ws.connectDriveBackup();
  assert.ok(mountEl.innerHTML.includes('Connected'), 'Must display Connected badge after connecting');
  assert.ok(mountEl.innerHTML.includes('prof.alice@gmail.com'), 'Must display connected Google account email');
  assert.ok(mountEl.innerHTML.includes('Sync Now'), 'Must display Sync Now button');
  assert.ok(mountEl.innerHTML.includes('Disconnect Google Drive'), 'Must display Disconnect Google Drive button');

  // 4. Sync Failure / Partial Success: simulate failure on daily_workbook while snapshot and annual_workbook succeed
  forceFailDailyWorkbook = true;
  await ws.syncDriveBackup({ forceRetry: true });
  forceFailDailyWorkbook = false;

  assert.ok(
    mountEl.innerHTML.includes('Partial backup sync:') || mountEl.innerHTML.includes('Sync Attention Needed'),
    'Must report partial backup sync accurately without claiming full success'
  );
  assert.ok(
    mountEl.innerHTML.includes('Snapshot: backed_up') && mountEl.innerHTML.includes('Daily XLSX: failed'),
    'Must preserve completed artifacts and show per-artifact statuses'
  );
  assert.ok(!mountEl.innerHTML.includes(validToken), 'Must never expose OAuth token in UI error message');
  assert.ok(mountEl.innerHTML.includes('Retry Sync'), 'Must display Retry Sync button after partial failure');

  // 5. Reconnection Required: simulate 401 token expiry on retry
  forceAuthExpired401 = true;
  await ws.syncDriveBackup({ forceRetry: true });
  assert.ok(mountEl.innerHTML.includes('Reconnection Required'), 'Must display Reconnection Required badge on 401 expiry');
  assert.ok(mountEl.innerHTML.includes('Reconnect Google Drive'), 'Must display Reconnect Google Drive button');

  // 6. Reconnect and finish syncing remaining pending work -> "Everything is up to date"
  await ws.connectDriveBackup();
  await ws.syncDriveBackup({ forceRetry: true });
  assert.ok(
    mountEl.innerHTML.includes('Everything is up to date') || mountEl.innerHTML.includes('Google Drive backup complete'),
    'Must report completion when all pending artifacts finish syncing'
  );
  assert.equal(ws.getState().backupPendingRuns.length, 0, 'Pending backup runs queue must be empty after full sync');

  // Empty queue Sync Now check
  await ws.syncDriveBackup({ forceRetry: false });
  assert.ok(
    mountEl.innerHTML.includes('Everything is up to date'),
    'Sync Now on an empty queue must gracefully report Everything is up to date'
  );

  // 7. Disconnect Google Drive: cancelling confirmation leaves connection active; confirming disconnects after server response
  confirmResult = false;
  await ws.disconnectDriveBackup();
  assert.equal(
    ws.getState().backupStatusData.connection.connectionStatus,
    'connected',
    'Cancelling disconnect confirmation must keep Drive connected'
  );

  confirmResult = true;
  await ws.disconnectDriveBackup();
  assert.equal(
    ws.getState().backupStatusData.connection.connectionStatus,
    'disconnected',
    'Confirming disconnect must update status to disconnected after server confirmation'
  );
  assert.ok(mountEl.innerHTML.includes('Not Connected'), 'UI must reflect Not Connected state after disconnect');

  ws.unmount();
});

test('Phase 3C Verification: Mobile Teacher Google Drive Attendance Backup UI integration, state model, and actions (Not Configured, Not Connected, Connecting/Syncing, Connected, Partial Failure + Retry, Reconnect Required, Disconnect)', async () => {
  const viewPath = path.join(__dirname, '..', 'mobile', 'components', 'teacher', 'TeacherAttendanceView.tsx');
  const viewCode = fs.readFileSync(viewPath, 'utf8');

  // 1. Verify TeacherAttendanceView.tsx integrates mobileAttendanceDriveSync, deriveDriveBackupUiModel, and all required testIDs & guards
  assert.ok(viewCode.includes("from '@/services/attendance-drive-sync'"), 'Must import from @/services/attendance-drive-sync');
  assert.ok(viewCode.includes('deriveDriveBackupUiModel'), 'Must use deriveDriveBackupUiModel for mobile backup state');
  assert.ok(viewCode.includes('testID="teacher-drive-backup-card"'), 'Must render teacher-drive-backup-card section');
  assert.ok(viewCode.includes('testID="btn-connect-drive-backup"'), 'Must render Connect Google Drive button');
  assert.ok(viewCode.includes('btn-sync-drive-backup'), 'Must render Sync Now button');
  assert.ok(viewCode.includes('btn-retry-drive-backup'), 'Must render Retry Sync button');
  assert.ok(viewCode.includes('testID="btn-reconnect-drive-backup"'), 'Must render Reconnect Google Drive button');
  assert.ok(viewCode.includes('testID="btn-disconnect-drive-backup"'), 'Must render Disconnect Google Drive button');
  assert.ok(viewCode.includes("'Disconnect Google Drive?'"), 'Must confirm teacher intent before disconnecting');
  assert.ok(viewCode.includes('isMountedRef'), 'Must guard async updates against unmounted component state');
  assert.ok(viewCode.includes('isBackupActionInFlightRef'), 'Must block duplicate concurrent connect/sync/disconnect taps');

  // 2. Execute the real TypeScript mobile sync service + deriveDriveBackupUiModel across all Phase 3C states
  const MobileDriveSync = await import('../mobile/services/attendance-drive-sync-core.ts');
  const crypto = require('crypto');

  const validToken = 'ya29.a0AfH6SMBx_phase3c_mobile_ui_token_654321';
  const filesById = new Map();
  let fileIdCounter = 1;
  let forceFailDailyWorkbook = false;
  let forceAuthExpired401 = false;

  async function mockMobileDriveFetch(urlStr, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const headers = options.headers || {};
    const authHeader = headers.Authorization || headers.authorization || '';

    if (urlStr.startsWith('https://oauth2.googleapis.com/revoke')) {
      return { status: 200, ok: true, json: async () => ({ revoked: true }) };
    }

    if (urlStr.startsWith('https://oauth2.googleapis.com/token')) {
      return {
        status: 200,
        ok: true,
        json: async () => ({
          access_token: validToken,
          refresh_token: '1//0g_phase3c_refresh_token',
          expires_in: 3600,
          scope: 'https://www.googleapis.com/auth/drive.file',
          token_type: 'Bearer'
        })
      };
    }

    if (forceAuthExpired401 && urlStr.includes('/upload/drive/v3/files')) {
      forceAuthExpired401 = false;
      return {
        status: 401,
        ok: false,
        json: async () => ({
          error: { code: 401, message: 'Invalid Credentials', errors: [{ reason: 'authError' }] }
        })
      };
    }

    if (authHeader !== `Bearer ${validToken}`) {
      return {
        status: 401,
        ok: false,
        json: async () => ({
          error: { code: 401, message: 'Unauthorized', errors: [{ reason: 'authError' }] }
        })
      };
    }

    const parsed = new URL(urlStr);
    const pathname = parsed.pathname;

    if (method === 'GET' && pathname === '/drive/v3/about') {
      return {
        status: 200,
        ok: true,
        json: async () => ({ user: { emailAddress: 'prof.alice.mobile@gmail.com' } })
      };
    }

    if (method === 'GET' && pathname.startsWith('/drive/v3/files/')) {
      const fId = decodeURIComponent(pathname.slice('/drive/v3/files/'.length));
      const f = filesById.get(fId);
      if (!f) return { status: 404, ok: false, json: async () => ({ error: { code: 404 } }) };
      return { status: 200, ok: true, json: async () => ({ ...f }) };
    }

    if (method === 'GET' && pathname === '/drive/v3/files') {
      return { status: 200, ok: true, json: async () => ({ files: [] }) };
    }

    if (method === 'POST' && pathname === '/drive/v3/files') {
      const meta = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
      const id = `p3c_folder_${fileIdCounter++}`;
      const rec = {
        id,
        name: meta.name,
        mimeType: meta.mimeType,
        parents: meta.parents || [],
        appProperties: meta.appProperties || {},
        trashed: false,
        createdTime: new Date().toISOString()
      };
      filesById.set(id, rec);
      return { status: 200, ok: true, json: async () => ({ ...rec }) };
    }

    if ((method === 'POST' || method === 'PATCH') && pathname.startsWith('/upload/drive/v3/files')) {
      const bodyStr = String(options.body || '');
      if (forceFailDailyWorkbook && bodyStr.includes('"slArtifactType":"daily_workbook"')) {
        return {
          status: 503,
          ok: false,
          json: async () => ({
            error: {
              code: 503,
              message: `Mobile Drive outage with token ${validToken}`
            }
          })
        };
      }
      const id = `p3c_file_${fileIdCounter++}`;
      const sha256Checksum = crypto.createHash('sha256').update(bodyStr).digest('hex');
      const rec = {
        id,
        name: 'mobile_uploaded_artifact',
        sha256Checksum,
        trashed: false,
        createdTime: new Date().toISOString()
      };
      filesById.set(id, rec);
      return { status: 200, ok: true, json: async () => ({ ...rec }) };
    }

    return { status: 404, ok: false, json: async () => ({}) };
  }

  const backendAuthFetch = async (url, opts = {}) => {
    const headers = {
      ...(opts.headers || {}),
      Authorization: `Bearer ${teacherAToken}`
    };
    return appFetch(`${baseUrl}${url}`, { ...opts, headers });
  };

  // A. Not Configured State on Mobile (no iOS client ID)
  delete process.env.GOOGLE_DRIVE_IOS_CLIENT_ID;
  delete process.env.EXPO_PUBLIC_GOOGLE_DRIVE_IOS_CLIENT_ID;

  const unconfiguredMobileClient = MobileDriveSync.createMobileAttendanceDriveSyncCore({
    platform: 'ios',
    iosClientId: null,
    backendFetch: backendAuthFetch,
    driveFetch: mockMobileDriveFetch
  });

  const uncfgStatus = await unconfiguredMobileClient.getStatus();
  const uncfgModel = MobileDriveSync.deriveDriveBackupUiModel({
    statusData: uncfgStatus,
    pendingRuns: []
  });
  assert.equal(uncfgModel.uiState, 'not_configured');
  assert.equal(uncfgModel.badgeLabel, 'NOT CONFIGURED');
  assert.equal(uncfgModel.canConnect, false, 'Must not show an active Connect button when unconfigured');

  // B. Not Connected State on Mobile (iOS Client ID configured)
  const iosClientId = '1122334455-phase3cios.apps.googleusercontent.com';
  const configuredMobileClient = MobileDriveSync.createMobileAttendanceDriveSyncCore({
    platform: 'ios',
    iosClientId,
    backendFetch: backendAuthFetch,
    driveFetch: mockMobileDriveFetch,
    openAuthSessionAsync: async (authUrl, redirectUri) => {
      const parsed = new URL(authUrl);
      const state = parsed.searchParams.get('state');
      return {
        type: 'success',
        url: `${redirectUri}?code=4/mock_p3c_code&state=${encodeURIComponent(state)}&scope=${encodeURIComponent(MobileDriveSync.DRIVE_FILE_SCOPE)}`
      };
    }
  });

  // Create a new attendance session on threeDaysAgoNepal so there is pending backup work
  const threeDaysAgoNepal = formatNepalDate(new Date(Date.now() - 3 * 24 * 60 * 60 * 1000));
  await saveAttendanceSession(db, {
    actorUserId: 'tea_ui_a',
    subjectId: 'CIT111',
    cohortId: cohortMercury.id,
    sessionDate: threeDaysAgoNepal,
    records: [
      { studentId: 'stu_ui_1', status: 'present' },
      { studentId: 'stu_ui_2', status: 'present' }
    ]
  });

  const [notConnStatus, notConnPending] = await Promise.all([
    configuredMobileClient.getStatus(),
    configuredMobileClient.listPendingWork()
  ]);
  const notConnModel = MobileDriveSync.deriveDriveBackupUiModel({
    statusData: notConnStatus,
    pendingRuns: notConnPending.runs
  });
  assert.equal(notConnModel.uiState, 'not_connected');
  assert.equal(notConnModel.badgeLabel, 'NOT CONNECTED');
  assert.equal(notConnModel.canConnect, true);
  assert.ok(notConnModel.actionableCount >= 1);

  // C. Connecting / Syncing busy states disable duplicate actions
  const connectingModel = MobileDriveSync.deriveDriveBackupUiModel({
    statusData: notConnStatus,
    pendingRuns: notConnPending.runs,
    isConnecting: true
  });
  assert.equal(connectingModel.uiState, 'connecting');
  assert.equal(connectingModel.isBusy, true);
  assert.equal(connectingModel.canConnect, false);
  assert.equal(connectingModel.canSync, false);

  // D. Connect Google Drive on Mobile -> Connected state
  await configuredMobileClient.connectGoogleDrive();
  const [connStatus, connPending] = await Promise.all([
    configuredMobileClient.getStatus(),
    configuredMobileClient.listPendingWork()
  ]);
  const connModel = MobileDriveSync.deriveDriveBackupUiModel({
    statusData: connStatus,
    pendingRuns: connPending.runs
  });
  assert.equal(connModel.uiState, 'connected');
  assert.equal(connModel.badgeLabel, 'CONNECTED');
  assert.ok(connModel.googleEmail && connModel.googleEmail.includes('@gmail.com'));
  assert.equal(connModel.canSync, true);
  assert.equal(connModel.canDisconnect, true);

  // E. Partial Sync Failure + Retry Sync (with token scrubbing)
  forceFailDailyWorkbook = true;
  const partialSyncRes = await configuredMobileClient.syncPendingWork({ forceRetry: true });
  forceFailDailyWorkbook = false;
  assert.equal(partialSyncRes.synced, false);
  assert.equal(partialSyncRes.completedArtifacts, 2);
  assert.equal(partialSyncRes.failedArtifacts, 1);

  const [failedStatus, failedPending] = await Promise.all([
    configuredMobileClient.getStatus(),
    configuredMobileClient.listPendingWork()
  ]);
  const failedModel = MobileDriveSync.deriveDriveBackupUiModel({
    statusData: failedStatus,
    pendingRuns: failedPending.runs,
    errorMessage: `Partial failure with ${validToken}`
  });
  assert.equal(failedModel.uiState, 'attention_needed');
  assert.equal(failedModel.canRetry, true);
  assert.ok(!String(failedModel.effectiveErrorMessage).includes(validToken), 'Mobile UI model must scrub OAuth tokens');
  assert.equal(failedModel.attentionRuns[0].snapshotStatus, 'backed_up');
  assert.equal(failedModel.attentionRuns[0].dailyWorkbookStatus, 'failed');
  assert.equal(failedModel.attentionRuns[0].annualWorkbookStatus, 'backed_up');

  // F. 401 Expiry -> Reconnect Required State
  await configuredMobileClient.clearTokens({ deleteRefreshToken: true });
  forceAuthExpired401 = true;
  const expiredSyncRes = await configuredMobileClient.syncPendingWork({ forceRetry: true });
  assert.equal(expiredSyncRes.reconnectRequired, true);

  const reconnectModel = MobileDriveSync.deriveDriveBackupUiModel({
    statusData: await configuredMobileClient.getStatus(),
    pendingRuns: (await configuredMobileClient.listPendingWork()).runs,
    reconnectRequiredFlag: true
  });
  assert.equal(reconnectModel.uiState, 'reconnect_required');
  assert.equal(reconnectModel.badgeLabel, 'RECONNECT REQUIRED');
  assert.equal(reconnectModel.canReconnect, true);
  assert.equal(reconnectModel.canDisconnect, true);

  // G. Reconnect & Retry Sync -> Everything is up to date
  forceAuthExpired401 = false;
  await configuredMobileClient.connectGoogleDrive();
  const fullSyncRes = await configuredMobileClient.syncPendingWork({ forceRetry: true });
  assert.equal(fullSyncRes.synced, true);

  const [upToDateStatus, upToDatePending] = await Promise.all([
    configuredMobileClient.getStatus(),
    configuredMobileClient.listPendingWork()
  ]);
  const upToDateModel = MobileDriveSync.deriveDriveBackupUiModel({
    statusData: upToDateStatus,
    pendingRuns: upToDatePending.runs
  });
  assert.equal(upToDateModel.uiState, 'connected');
  assert.equal(upToDateModel.actionableCount, 0);
  assert.ok(upToDateModel.descriptionText.includes('Everything is up to date'));

  // H. Disconnect on Mobile -> Disconnected state
  const discRes = await configuredMobileClient.disconnectGoogleDrive();
  assert.equal(discRes.disconnected, true);
  const afterDiscModel = MobileDriveSync.deriveDriveBackupUiModel({
    statusData: await configuredMobileClient.getStatus(),
    pendingRuns: []
  });
  assert.equal(afterDiscModel.uiState, 'not_connected');
  assert.equal(afterDiscModel.canConnect, true);
});

test('Redesign Verification (Tests 1–11): Subject-selection landing page, case-insensitive alphabetical ordering, keyboard marking (P/A/Arrows + input guard), independent consecutive monthly numbering, ABS non-increment, monthly reset, percentage & zero-session handling, chronological session order, student detail modal, permissions, and historical/export integrity', async () => {
  const passwordHash = bcrypt.hashSync(PASSWORD, 8);

  // Create a dedicated cohort for Semester 2 and assign BSM121 (Semester 2) to Teacher A
  cohortNeptune = await createCohort(db, {
    slotCode: 'venus',
    displayName: 'Venus',
    currentSemester: 2,
    intakeYear: 2026
  });

  await db.run(
    `INSERT INTO subjects (id, code, name, semester, department, credit_hours, active)
     VALUES ('BSM121', 'BSM121', 'Discrete Mathematics', 2, 'BIT', 3, 1)
     ON CONFLICT (id) DO NOTHING`
  );
  await db.run(
    `INSERT INTO teacher_subjects (id, teacher_id, subject_id)
     VALUES ('ts_ui_bsm121', 'tea_ui_id_a', 'BSM121')
     ON CONFLICT (id) DO NOTHING`
  );

  // Seed students in deliberately unsorted order with mixed case names to test case-insensitive alphabetical sorting:
  // Zubin, binita, Aahish Rana, Aabin Thapa
  const neptuneStudents = [
    { id: 'stu_nep_z', username: 'zubin_n', name: 'Zubin KC', role: 'student' },
    { id: 'stu_nep_b', username: 'binita_n', name: 'binita Gurung', role: 'cr' },
    { id: 'stu_nep_2', username: 'aahish_n', name: 'Aahish Rana', role: 'student' },
    { id: 'stu_nep_1', username: 'aabin_n', name: 'Aabin Thapa', role: 'student' }
  ];

  for (const s of neptuneStudents) {
    await db.run(
      `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, cohort_id, account_status)
       VALUES (?, ?, ?, ?, ?, ?, 'Semester 2', ?, 'active')`,
      s.id,
      s.username,
      s.name,
      `${s.id}@gandaki.edu.np`,
      s.role,
      passwordHash,
      cohortNeptune.id
    );
  }

  // 1. Test Case-Insensitive Alphabetical Student Ordering in GET /api/attendance/roster and GET /api/attendance/monthly
  const rosterRes = await appFetch(
    `${baseUrl}/api/attendance/roster?subjectId=BSM121&cohortId=${cohortNeptune.id}&date=2026-09-01`,
    { headers: { Authorization: `Bearer ${teacherAToken}` } }
  );
  assert.equal(rosterRes.status, 200);
  const rosterJson = await rosterRes.json();
  assert.deepEqual(
    rosterJson.roster.map((s) => s.name),
    ['Aabin Thapa', 'Aahish Rana', 'binita Gurung', 'Zubin KC'],
    'Students must be sorted alphabetically by displayed name, case-insensitively'
  );

  // 7a. Test Zero-Session Handling in GET /api/attendance/monthly (no division by zero, all 31 August calendar dates display '-')
  const zeroMonthRes = await appFetch(
    `${baseUrl}/api/attendance/monthly?subjectId=BSM121&cohortId=${cohortNeptune.id}&month=2025-08`,
    { headers: { Authorization: `Bearer ${teacherAToken}` } }
  );
  assert.equal(zeroMonthRes.status, 200);
  const zeroMonthJson = await zeroMonthRes.json();
  assert.equal(zeroMonthJson.totalSessions, 0);
  assert.equal(zeroMonthJson.sessions.length, 0);
  assert.equal(zeroMonthJson.calendarDates.length, 31);
  assert.deepEqual(
    zeroMonthJson.rows.map((r) => r.name),
    ['Aabin Thapa', 'Aahish Rana', 'binita Gurung', 'Zubin KC']
  );
  for (const row of zeroMonthJson.rows) {
    assert.equal(row.totalSessions, 0);
    assert.equal(row.presentCount, 0);
    assert.equal(row.absentCount, 0);
    assert.equal(row.attendancePercentage, 0);
    assert.equal(row.formattedPercentage, '0.0%');
    assert.deepEqual(row.sessionCells, []);
    assert.equal(row.cells.length, 31);
    assert.ok(row.cells.every((c) => c.display === '-' && c.status === 'no_session'));
  }

  // 4, 5, 7b, 8. Record 7 actual class sessions in September 2025 (including out-of-order insertion to verify chronological column ordering)
  // Prompt illustrative pattern:
  // Aabin Thapa:  1 | 2 | ABS | 3 | 4 | ABS | 5 -> 5/7 = 71.4%
  // Aahish Rana:  ABS | 1 | 2 | ABS | 3 | ABS | 4 -> 4/7 = 57.1%
  const septSessionsSpec = [
    { date: '2025-09-02', aabin: 'present', aahish: 'absent', binita: 'present', zubin: 'absent' },
    { date: '2025-09-05', aabin: 'present', aahish: 'present', binita: 'present', zubin: 'absent' },
    { date: '2025-09-09', aabin: 'absent',  aahish: 'present', binita: 'present', zubin: 'absent' },
    { date: '2025-09-12', aabin: 'present', aahish: 'absent',  binita: 'present', zubin: 'absent' },
    { date: '2025-09-16', aabin: 'present', aahish: 'present', binita: 'present', zubin: 'absent' },
    { date: '2025-09-20', aabin: 'absent',  aahish: 'absent',  binita: 'present', zubin: 'absent' },
    { date: '2025-09-25', aabin: 'present', aahish: 'present', binita: 'present', zubin: 'absent' }
  ];

  // Insert sessions (insert session 2 before session 1 to test chronological sorting)
  const insertionOrder = [1, 0, 2, 3, 4, 5, 6];
  for (const idx of insertionOrder) {
    const spec = septSessionsSpec[idx];
    await saveAttendanceSession(db, {
      actorUserId: 'tea_ui_a',
      subjectId: 'BSM121',
      cohortId: cohortNeptune.id,
      sessionDate: spec.date,
      records: [
        { studentId: 'stu_nep_1', status: spec.aabin },
        { studentId: 'stu_nep_2', status: spec.aahish },
        { studentId: 'stu_nep_b', status: spec.binita },
        { studentId: 'stu_nep_z', status: spec.zubin }
      ]
    });
  }

  const septMatrixRes = await appFetch(
    `${baseUrl}/api/attendance/monthly?subjectId=BSM121&cohortId=${cohortNeptune.id}&month=2025-09`,
    { headers: { Authorization: `Bearer ${teacherAToken}` } }
  );
  assert.equal(septMatrixRes.status, 200);
  const septMatrix = await septMatrixRes.json();

  // Verify chronological session ordering (1..7) and real session dates retained separately
  assert.equal(septMatrix.totalSessions, 7);
  assert.equal(septMatrix.calendarDates.length, 30, 'Past month September must include all 30 calendar days');
  assert.deepEqual(
    septMatrix.sessions.map((s) => s.sessionNumber),
    [1, 2, 3, 4, 5, 6, 7]
  );
  assert.deepEqual(
    septMatrix.sessions.map((s) => s.sessionDate),
    ['2025-09-02', '2025-09-05', '2025-09-09', '2025-09-12', '2025-09-16', '2025-09-20', '2025-09-25']
  );

  // Verify Aabin Thapa row: 1 | 2 | ABS | 3 | 4 | ABS | 5 -> 71.4% (with '-' on non-session calendar dates)
  const aabinRow = septMatrix.rows.find((r) => r.studentId === 'stu_nep_1');
  assert.ok(aabinRow);
  assert.deepEqual(
    aabinRow.sessionCells.map((c) => c.display),
    ['1', '2', 'ABS', '3', '4', 'ABS', '5'],
    'Aabin Thapa sessionCells must display exact consecutive attendance count and ABS for absences'
  );
  assert.equal(aabinRow.cells.length, 30);
  assert.equal(aabinRow.cells[0].display, '-', 'Sept 1 (no session) must display -');
  assert.equal(aabinRow.cells[1].display, '1', 'Sept 2 (Session 1) must display 1');
  assert.equal(aabinRow.cells[2].display, '-', 'Sept 3 (no session) must display -');
  assert.equal(aabinRow.cells[4].display, '2', 'Sept 5 (Session 2) must display 2');
  assert.equal(aabinRow.cells[8].display, 'ABS', 'Sept 9 (Session 3) must display ABS');
  assert.equal(aabinRow.presentCount, 5);
  assert.equal(aabinRow.absentCount, 2);
  assert.equal(aabinRow.totalSessions, 7);
  assert.equal(aabinRow.attendancePercentage, 71.4);
  assert.equal(aabinRow.formattedPercentage, '71.4%');

  // Verify Aahish Rana row: ABS | 1 | 2 | ABS | 3 | ABS | 4 -> 57.1%
  const aahishRow = septMatrix.rows.find((r) => r.studentId === 'stu_nep_2');
  assert.ok(aahishRow);
  assert.deepEqual(
    aahishRow.sessionCells.map((c) => c.display),
    ['ABS', '1', '2', 'ABS', '3', 'ABS', '4'],
    'Aahish Rana row must display independent consecutive attendance count starting at 1 on session 2'
  );
  assert.equal(aahishRow.presentCount, 4);
  assert.equal(aahishRow.absentCount, 3);
  assert.equal(aahishRow.totalSessions, 7);
  assert.equal(aahishRow.attendancePercentage, 57.1);
  assert.equal(aahishRow.formattedPercentage, '57.1%');

  // Verify binita Gurung (all 7 present -> 1..7, 100.0%) and Zubin KC (all 7 absent -> ABS..ABS, 0.0%)
  const binitaRow = septMatrix.rows.find((r) => r.studentId === 'stu_nep_b');
  assert.deepEqual(binitaRow.sessionCells.map((c) => c.display), ['1', '2', '3', '4', '5', '6', '7']);
  assert.equal(binitaRow.formattedPercentage, '100.0%');

  const zubinRow = septMatrix.rows.find((r) => r.studentId === 'stu_nep_z');
  assert.deepEqual(zubinRow.sessionCells.map((c) => c.display), ['ABS', 'ABS', 'ABS', 'ABS', 'ABS', 'ABS', 'ABS']);
  assert.equal(zubinRow.formattedPercentage, '0.0%');

  // 6. Test Monthly Numbering Reset at the Beginning of a New Month (October 2025)
  await saveAttendanceSession(db, {
    actorUserId: 'tea_ui_a',
    subjectId: 'BSM121',
    cohortId: cohortNeptune.id,
    sessionDate: '2025-10-03',
    records: [
      { studentId: 'stu_nep_1', status: 'present' },
      { studentId: 'stu_nep_2', status: 'absent' },
      { studentId: 'stu_nep_b', status: 'present' },
      { studentId: 'stu_nep_z', status: 'present' }
    ]
  });

  const octMatrixRes = await appFetch(
    `${baseUrl}/api/attendance/monthly?subjectId=BSM121&cohortId=${cohortNeptune.id}&month=2025-10`,
    { headers: { Authorization: `Bearer ${teacherAToken}` } }
  );
  assert.equal(octMatrixRes.status, 200);
  const octMatrix = await octMatrixRes.json();
  assert.equal(octMatrix.totalSessions, 1);
  assert.equal(octMatrix.sessions[0].sessionNumber, 1);
  assert.equal(octMatrix.sessions[0].sessionDate, '2025-10-03');

  const octAabin = octMatrix.rows.find((r) => r.studentId === 'stu_nep_1');
  assert.deepEqual(
    octAabin.sessionCells.map((c) => c.display),
    ['1'],
    'Consecutive attendance count must reset to 1 at the start of a new month (not continue at 6)'
  );
  assert.equal(octAabin.cells[0].display, '-');
  assert.equal(octAabin.cells[1].display, '-');
  assert.equal(octAabin.cells[2].display, '1');
  assert.equal(octAabin.formattedPercentage, '100.0%');

  // 8. When a new submitted session is added in October, append the next session column in chronological order
  const octSession2 = await saveAttendanceSession(db, {
    actorUserId: 'tea_ui_a',
    subjectId: 'BSM121',
    cohortId: cohortNeptune.id,
    sessionDate: '2025-10-10',
    records: [
      { studentId: 'stu_nep_1', status: 'absent' },
      { studentId: 'stu_nep_2', status: 'present' },
      { studentId: 'stu_nep_b', status: 'present' },
      { studentId: 'stu_nep_z', status: 'absent' }
    ]
  });

  const octMatrixAfterAddRes = await appFetch(
    `${baseUrl}/api/attendance/monthly?subjectId=BSM121&cohortId=${cohortNeptune.id}&month=2025-10`,
    { headers: { Authorization: `Bearer ${teacherAToken}` } }
  );
  const octMatrixAfterAdd = await octMatrixAfterAddRes.json();
  assert.equal(octMatrixAfterAdd.totalSessions, 2);
  assert.deepEqual(octMatrixAfterAdd.sessions.map((s) => s.sessionNumber), [1, 2]);
  assert.deepEqual(octMatrixAfterAdd.sessions.map((s) => s.sessionDate), ['2025-10-03', '2025-10-10']);

  const octAabinAfter2 = octMatrixAfterAdd.rows.find((r) => r.studentId === 'stu_nep_1');
  assert.deepEqual(octAabinAfter2.sessionCells.map((c) => c.display), ['1', 'ABS']);
  assert.equal(octAabinAfter2.formattedPercentage, '50.0%');

  // Legitimate update within 24h window recalculates consecutive numbers and percentage
  await saveAttendanceSession(db, {
    actorUserId: 'tea_ui_a',
    subjectId: 'BSM121',
    cohortId: cohortNeptune.id,
    sessionDate: '2025-10-10',
    reason: 'Aabin was present in lab',
    records: [
      { studentId: 'stu_nep_1', status: 'present' },
      { studentId: 'stu_nep_2', status: 'present' },
      { studentId: 'stu_nep_b', status: 'present' },
      { studentId: 'stu_nep_z', status: 'absent' }
    ]
  });

  const octMatrixUpdated = await (
    await appFetch(
      `${baseUrl}/api/attendance/monthly?subjectId=BSM121&cohortId=${cohortNeptune.id}&month=2025-10`,
      { headers: { Authorization: `Bearer ${teacherAToken}` } }
    )
  ).json();
  const octAabinUpdated = octMatrixUpdated.rows.find((r) => r.studentId === 'stu_nep_1');
  assert.deepEqual(octAabinUpdated.sessionCells.map((c) => c.display), ['1', '2']);
  assert.equal(octAabinUpdated.formattedPercentage, '100.0%');
  assert.ok(octSession2.session.id);

  // 11. Verify underlying attendance_records in database still store 'present'/'absent' (never renumbered or modified)
  // and CSV export uses underlying records for accurate totals and percentages
  const rawDbRecords = await db.all(
    `SELECT DISTINCT status FROM attendance_records WHERE session_id = ?`,
    octSession2.session.id
  );
  const rawStatuses = rawDbRecords.map((r) => r.status).sort();
  assert.deepEqual(rawStatuses, ['absent', 'present'], 'Stored database records must remain strictly present/absent');

  const csvRes = await appFetch(
    `${baseUrl}/api/attendance/monthly?subjectId=BSM121&cohortId=${cohortNeptune.id}&month=2025-09&format=csv`,
    { headers: { Authorization: `Bearer ${teacherAToken}` } }
  );
  assert.equal(csvRes.status, 200);
  const csvText = await csvRes.text();
  assert.ok(
    csvText.includes('stu_nep_1,Aabin Thapa,1,2,ABS,3,4,ABS,5,5,2,7,71.4%'),
    'CSV export must include consecutive display cells and accurate underlying totals (5 attended, 2 absent, 7 total, 71.4%)'
  );
  assert.ok(
    csvText.includes('stu_nep_2,Aahish Rana,ABS,1,2,ABS,3,ABS,4,4,3,7,57.1%'),
    'CSV export must include accurate underlying totals for Aahish Rana (4 attended, 3 absent, 7 total, 57.1%)'
  );

  // 10. Verify permissions on /api/attendance/monthly:
  // - Student token is rejected with 403
  const stuMonthlyRes = await appFetch(
    `${baseUrl}/api/attendance/monthly?subjectId=BSM121&cohortId=${cohortNeptune.id}&month=2025-09`,
    { headers: { Authorization: `Bearer ${student1Token}` } }
  );
  assert.equal(stuMonthlyRes.status, 403, 'Students must not access teacher monthly register endpoint');

  // - Teacher A requesting unassigned subject (ELX111) is rejected with 403
  const unauthSubjRes = await appFetch(
    `${baseUrl}/api/attendance/monthly?subjectId=ELX111&cohortId=${cohortMercury.id}&month=2025-09`,
    { headers: { Authorization: `Bearer ${teacherAToken}` } }
  );
  assert.equal(unauthSubjRes.status, 403, 'Teacher must not access monthly register for unassigned subject');

  // 2, 3, 5 (UI): Test Keyboard Shortcuts (P, A, ArrowDown, ArrowUp), Input Guard, Monthly Matrix DOM, and Student Detail Modal
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
    removeEventListener(evt) {
      delete this.listeners[evt];
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
  mountEl.id = 'teacherAttendanceMount';

  const sandboxWindow = {
    URLSearchParams,
    confirm: () => true,
    setInterval: () => 1,
    clearInterval: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    document: {
      activeElement: null,
      head: { appendChild() {} },
      getElementById(id) {
        return id === 'teacherAttendanceMount' ? mountEl : null;
      },
      createElement(tag) {
        return makeEl(tag);
      },
      querySelector(sel) {
        if (sel === '#teacherAttendanceMount') return mountEl;
        return null;
      }
    },
    SemesterAuth: {
      authFetch: async (url, opts = {}) => {
        const headers = {
          ...(opts.headers || {}),
          Authorization: `Bearer ${teacherAToken}`
        };
        return appFetch(`${baseUrl}${url}`, { ...opts, headers });
      }
    }
  };
  sandboxWindow.window = sandboxWindow;

  const vm = require('vm');
  const scriptCode = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'teacher-attendance.js'),
    'utf8'
  );
  vm.runInNewContext(scriptCode, sandboxWindow);

  const ws = sandboxWindow.TeacherAttendanceWorkspace;
  await ws.mount(mountEl);

  // Verify landing page shows both assigned subjects (CIT111 and BSM121) and no attendance register yet
  assert.equal(ws.getState().selectedSubjectId, '');
  assert.ok(mountEl.innerHTML.includes('data-att-select-subject="CIT111"'));
  assert.ok(mountEl.innerHTML.includes('data-att-select-subject="BSM121"'));
  assert.ok(!mountEl.innerHTML.includes('id="slAttMonthlyMatrixTable"'));

  // Select BSM121 and switch to September 2025 to inspect the rendered monthly matrix
  await ws.selectSubject('BSM121');
  await ws.loadMonthlyMatrix('2025-09');
  assert.ok(mountEl.innerHTML.includes('71.4%'), 'Matrix DOM must display 71.4% for Aabin Thapa');
  assert.ok(mountEl.innerHTML.includes('57.1%'), 'Matrix DOM must display 57.1% for Aahish Rana');
  assert.ok(mountEl.innerHTML.includes('>ABS<'), 'Matrix DOM must display ABS for absences');
  assert.ok(mountEl.innerHTML.includes('>-<'), 'Matrix DOM must display - for calendar dates without a submitted session');
  assert.ok(mountEl.innerHTML.includes('Download SVG'), 'Matrix DOM must include Download SVG action');

  // Test Keyboard Shortcuts on a fresh session date (2025-10-15)
  await ws.openSessionByDate('2025-10-15');
  const st = ws.getState();
  assert.equal(st.currentStudentIndex, 0);
  assert.deepEqual(
    Array.from(st.roster, (s) => s.name),
    ['Aabin Thapa', 'Aahish Rana', 'binita Gurung', 'Zubin KC']
  );

  // Guard: Pressing 'P' or 'A' while focused inside a search <input> must NOT mark any student
  const searchInputTarget = { tagName: 'INPUT', getAttribute: () => null };
  const ignoredKeyResult = ws.handleKeyDown({ key: 'P', target: searchInputTarget, preventDefault() {} });
  assert.equal(ignoredKeyResult, false, 'Keyboard shortcut must not trigger while typing in an input');
  assert.equal(st.marksByStudentId['stu_nep_1'], undefined);
  assert.equal(st.currentStudentIndex, 0);

  // Pressing 'P' outside input marks student 0 (Aabin Thapa) Present and auto-advances focus to student 1 (Aahish Rana)
  const pResult = ws.handleKeyDown({ key: 'P', target: { tagName: 'DIV' }, preventDefault() {} });
  assert.equal(pResult, true);
  assert.equal(st.marksByStudentId['stu_nep_1'], 'present');
  assert.equal(st.currentStudentIndex, 1, 'Focus must auto-advance to index 1 after pressing P');

  // Pressing 'A' marks student 1 (Aahish Rana) Absent and auto-advances focus to student 2 (binita Gurung)
  const aResult = ws.handleKeyDown({ key: 'a', target: { tagName: 'DIV' }, preventDefault() {} });
  assert.equal(aResult, true);
  assert.equal(st.marksByStudentId['stu_nep_2'], 'absent');
  assert.equal(st.currentStudentIndex, 2, 'Focus must auto-advance to index 2 after pressing A');

  // Pressing ArrowUp moves focus back to index 1; ArrowDown moves focus back to index 2
  ws.handleKeyDown({ key: 'ArrowUp', target: { tagName: 'DIV' }, preventDefault() {} });
  assert.equal(st.currentStudentIndex, 1);
  ws.handleKeyDown({ key: 'ArrowDown', target: { tagName: 'DIV' }, preventDefault() {} });
  assert.equal(st.currentStudentIndex, 2);

  // Clicking a student's name opens their detailed attendance history modal
  ws.openStudentDetail('stu_nep_1');
  assert.equal(st.selectedStudentDetailId, 'stu_nep_1');
  assert.ok(mountEl.innerHTML.includes('id="slAttStudentDetailModal"'), 'Student detail modal must open');
  assert.ok(mountEl.innerHTML.includes('Aabin Thapa'), 'Student detail modal must show student name');
  assert.ok(mountEl.innerHTML.includes('Chronological Session History'), 'Student detail modal must show session history');
  ws.closeStudentDetail();
  assert.equal(st.selectedStudentDetailId, null);

  ws.unmount();
});

test('Monthly Calendar Matrix & Official Printable SVG Verification (Tests 1–10): Calendar date range generation (current month through today in Nepal time, past months full length, future months empty), "-" on non-session dates, consecutive numbering & ABS, percentage from submitted sessions only, SVG structure/metadata/columns/remarks/signatures, XML escaping & Nepali Unicode safety, and multi-page large cohort pagination without truncation', async () => {
  const {
    buildApplicableCalendarDatesForMonth,
    buildMonthlyAttendanceMatrix,
    exportMonthlyAttendanceSvg
  } = require('../lib/attendance-service');

  // 1. Current-month date column generation stopping at today's date in Nepal local time
  // e.g., when today in Nepal time is October 25, 2026 ('2026-10-25'), October 2026 has Oct 1 .. Oct 25
  const octCurrentDates = buildApplicableCalendarDatesForMonth('2026-10', {
    currentNepalDate: '2026-10-25'
  });
  assert.equal(octCurrentDates.length, 25, 'Current month on Oct 25 must contain exactly 25 calendar date columns');
  assert.equal(octCurrentDates[0].date, '2026-10-01');
  assert.equal(octCurrentDates[0].label, 'Oct 1');
  assert.equal(octCurrentDates[24].date, '2026-10-25');
  assert.equal(octCurrentDates[24].label, 'Oct 25');

  // Future month relative to current Nepal date must not generate future attendance dates
  const novFutureDates = buildApplicableCalendarDatesForMonth('2026-11', {
    currentNepalDate: '2026-10-25'
  });
  assert.equal(novFutureDates.length, 0, 'Future month must not display future dates as if they have occurred');

  // 2. Past-month date column generation including all calendar days (28, 29, 30, 31)
  const feb2026Dates = buildApplicableCalendarDatesForMonth('2026-02', { currentNepalDate: '2026-10-25' });
  assert.equal(feb2026Dates.length, 28, 'Past non-leap February must have 28 days');
  const feb2024Dates = buildApplicableCalendarDatesForMonth('2024-02', { currentNepalDate: '2026-10-25' });
  assert.equal(feb2024Dates.length, 29, 'Past leap February must have 29 days');
  const sept2026Dates = buildApplicableCalendarDatesForMonth('2026-09', { currentNepalDate: '2026-10-25' });
  assert.equal(sept2026Dates.length, 30, 'Past September must have 30 days');
  const aug2026Dates = buildApplicableCalendarDatesForMonth('2026-08', { currentNepalDate: '2026-10-25' });
  assert.equal(aug2026Dates.length, 31, 'Past August must have 31 days');

  // 3, 4, 6, 7. Verify exact illustrative scenario from prompt:
  // Oct 1 .. Oct 6 (with today = 2026-10-06)
  // Sessions held on Oct 1, Oct 2, Oct 3, Oct 5, Oct 6 (NO session on Oct 4 -> '-')
  // Aabin Thapa: Oct 1 (P->1), Oct 2 (P->2), Oct 3 (A->ABS), Oct 4 (-), Oct 5 (P->3), Oct 6 (P->4) -> 4/5 = 80.0%
  // Aahish Rana: Oct 1 (A->ABS), Oct 2 (P->1), Oct 3 (P->2), Oct 4 (-), Oct 5 (A->ABS), Oct 6 (P->3) -> 3/5 = 60.0%
  const sampleStudents = [
    { studentId: 'stu_2', name: 'Aahish Rana' },
    { studentId: 'stu_1', name: 'Aabin Thapa' }
  ];
  const sampleSessions = [
    { id: 's1', sessionDate: '2026-10-01', status: 'submitted' },
    { id: 's2', sessionDate: '2026-10-02', status: 'submitted' },
    { id: 's3', sessionDate: '2026-10-03', status: 'submitted' },
    { id: 's5', sessionDate: '2026-10-05', status: 'submitted' },
    { id: 's6', sessionDate: '2026-10-06', status: 'submitted' }
  ];
  const sampleRecords = new Map([
    ['s1', new Map([['stu_1', 'present'], ['stu_2', 'absent']])],
    ['s2', new Map([['stu_1', 'present'], ['stu_2', 'present']])],
    ['s3', new Map([['stu_1', 'absent'],  ['stu_2', 'present']])],
    ['s5', new Map([['stu_1', 'present'], ['stu_2', 'absent']])],
    ['s6', new Map([['stu_1', 'present'], ['stu_2', 'present']])]
  ]);

  const oct6Matrix = buildMonthlyAttendanceMatrix({
    students: sampleStudents,
    sessions: sampleSessions,
    recordsBySessionId: sampleRecords,
    month: '2026-10',
    currentNepalDate: '2026-10-06'
  });

  assert.deepEqual(
    oct6Matrix.calendarDates.map((d) => d.label),
    ['Oct 1', 'Oct 2', 'Oct 3', 'Oct 4', 'Oct 5', 'Oct 6']
  );
  assert.equal(oct6Matrix.calendarDates[3].hasSession, false, 'Oct 4 must be marked hasSession: false');
  assert.deepEqual(
    oct6Matrix.rows.map((r) => r.name),
    ['Aabin Thapa', 'Aahish Rana'],
    'Students must be sorted alphabetically'
  );
  assert.deepEqual(
    oct6Matrix.rows[0].cells.map((c) => c.display),
    ['1', '2', 'ABS', '-', '3', '4'],
    'Aabin Thapa must display 1 | 2 | ABS | - | 3 | 4 across Oct 1..Oct 6'
  );
  assert.equal(
    oct6Matrix.rows[0].formattedPercentage,
    '80.0%',
    'Aabin Thapa percentage must be 4/5 = 80.0% (excluding Oct 4 which had no session)'
  );
  assert.deepEqual(
    oct6Matrix.rows[1].cells.map((c) => c.display),
    ['ABS', '1', '2', '-', 'ABS', '3'],
    'Aahish Rana must display ABS | 1 | 2 | - | ABS | 3 across Oct 1..Oct 6'
  );
  assert.equal(oct6Matrix.rows[1].formattedPercentage, '60.0%');

  // 8. End-to-end API SVG Export verification (GET /api/attendance/monthly?format=svg)
  const svgRes = await appFetch(
    `${baseUrl}/api/attendance/monthly?subjectId=BSM121&cohortId=${cohortNeptune.id}&month=2025-09&format=svg`,
    { headers: { Authorization: `Bearer ${teacherAToken}` } }
  );
  assert.equal(svgRes.status, 200);
  assert.match(String(svgRes.headers.get('content-type') || ''), /image\/svg\+xml/i);
  const svgText = await svgRes.text();

  // Verify standalone SVG root, A4 landscape attributes, and monochrome vector structure
  assert.ok(svgText.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg '));
  assert.ok(svgText.includes('xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(svgText.includes('width="297mm"'));
  assert.ok(svgText.includes('viewBox="0 0 1684 1190"'));

  // Verify exact header structure & real metadata
  assert.ok(svgText.includes('>Gandaki University</text>'), 'SVG must contain centered Gandaki University header');
  assert.ok(svgText.includes('>MONTHLY ATTENDANCE</text>'), 'SVG must contain MONTHLY ATTENDANCE title');
  assert.ok(svgText.includes('>Month:</tspan> September 2025</text>'), 'SVG must show real Month value');
  assert.ok(svgText.includes('>Semester:</tspan> Semester 2</text>'), 'SVG must show real Semester value');
  assert.ok(svgText.includes('>Subject:</tspan> BSM121 — '), 'SVG must show real Subject value');
  assert.ok(svgText.includes('>Teacher Name:</tspan> Prof. UI Alice</text>'), 'SVG must show real assigned Teacher Name');

  // Verify all 30 September date headings (Sep 1 .. Sep 30), Attendance %, and Remark column
  assert.ok(svgText.includes('>Name</text>'));
  for (let d = 1; d <= 30; d += 1) {
    assert.ok(svgText.includes(`>Sep ${d}</text>`), `SVG must include date column header Sep ${d}`);
  }
  assert.ok(svgText.includes('>Attendance %</text>'));
  assert.ok(svgText.includes('>Remark</text>'));

  // Verify alphabetical student rows and percentages in SVG
  const idxAabin = svgText.indexOf('>Aabin Thapa</text>');
  const idxAahish = svgText.indexOf('>Aahish Rana</text>');
  const idxBinita = svgText.indexOf('>binita Gurung</text>');
  const idxZubin = svgText.indexOf('>Zubin KC</text>');
  assert.ok(idxAabin > 0 && idxAabin < idxAahish && idxAahish < idxBinita && idxBinita < idxZubin, 'Students must appear in alphabetical order in SVG');
  assert.ok(svgText.includes('>71.4%</text>'));
  assert.ok(svgText.includes('>57.1%</text>'));

  // Verify signature section on the SVG sheet
  assert.ok(svgText.includes('Prepared by / Subject Teacher: ____________________'));
  assert.ok(svgText.includes('Verified by: ____________________'));
  assert.ok(svgText.includes('Signature: ____________________'));
  assert.ok(svgText.includes('Date: ____________________'));

  // 9 & 10. Verify XML escaping, Nepali/Unicode names, and multi-page pagination (32 students across a 31-day month = 2 pages, 0 truncation)
  const largeStudents = [];
  for (let i = 1; i <= 30; i += 1) {
    largeStudents.push({
      studentId: `stu_lg_${String(i).padStart(2, '0')}`,
      name: `Student ${String(i).padStart(2, '0')} & <Group "${i}">`
    });
  }
  largeStudents.push({
    studentId: 'stu_lg_nepali',
    name: 'आरम्भ थापा (Aarambha)'
  });
  largeStudents.push({
    studentId: 'stu_lg_quote',
    name: "O'Connor & Sons <Lab>"
  });

  const largeMatrix = buildMonthlyAttendanceMatrix({
    students: largeStudents,
    sessions: [
      { id: 'lg_s1', sessionDate: '2026-10-01', status: 'submitted' },
      { id: 'lg_s2', sessionDate: '2026-10-25', status: 'submitted' }
    ],
    recordsBySessionId: new Map([
      ['lg_s1', new Map(largeStudents.map((s) => [s.studentId, 'present']))],
      ['lg_s2', new Map(largeStudents.map((s, idx) => [s.studentId, idx % 2 === 0 ? 'present' : 'absent']))]
    ]),
    month: '2026-10',
    referenceDate: new Date('2026-10-31T00:00:00Z'),
    currentNepalDate: '2026-10-31'
  });

  const multiPageSvg = exportMonthlyAttendanceSvg({
    ...largeMatrix,
    monthLabel: 'October 2026',
    semesterLabel: 'Semester 3',
    subjectLabel: 'CIT214 — Data Structure & Algorithms',
    teacherName: 'Prof. Ram Prasad <Sharma> & Co.'
  });

  // 32 students at 25 rows/page -> 2 pages (210 * 2 = 420mm, viewBox height = 1190 * 2 = 2380)
  assert.ok(multiPageSvg.includes('height="420mm"'), '32 students must paginate cleanly across 2 A4 landscape pages');
  assert.ok(multiPageSvg.includes('viewBox="0 0 1684 2380"'));
  assert.ok(multiPageSvg.includes('data-page="1"'));
  assert.ok(multiPageSvg.includes('data-page="2"'));
  assert.ok(multiPageSvg.includes('Page 1 of 2'));
  assert.ok(multiPageSvg.includes('Page 2 of 2'));

  // Verify XML special characters are escaped properly and Nepali Unicode is preserved
  assert.ok(multiPageSvg.includes('Prof. Ram Prasad &lt;Sharma&gt; &amp; Co.'), 'Teacher name XML characters must be escaped');
  assert.ok(multiPageSvg.includes('CIT214 — Data Structure &amp; Algorithms'), 'Subject XML characters must be escaped');
  assert.ok(multiPageSvg.includes('O&apos;Connor &amp; Sons &lt;Lab&gt;'), 'Student name XML characters must be escaped');
  assert.ok(multiPageSvg.includes('आरम्भ थापा (Aarambha)'), 'Nepali Devanagari student name must be preserved in UTF-8 SVG');
  assert.ok(multiPageSvg.includes('Noto Sans Devanagari'), 'SVG font stack must include Devanagari-safe font fallback');

  // Verify all 31 October date columns and all 32 student rows are present in the SVG without truncation
  for (let d = 1; d <= 31; d += 1) {
    assert.ok(multiPageSvg.includes(`>Oct ${d}</text>`), `Multi-page SVG must include Oct ${d}`);
  }
  for (let i = 1; i <= 30; i += 1) {
    const escapedName = `Student ${String(i).padStart(2, '0')} &amp; &lt;Group &quot;${i}&quot;&gt;`;
    assert.ok(
      multiPageSvg.includes(`>${escapedName}</text>`),
      `Multi-page SVG must include student row for ${escapedName} without truncation`
    );
  }
});

test('Subject-Scoped Google Drive Folder & Daily/Monthly XLSX Verification: Attendance (<Subject Name>) with only 2 subfolders (Daily Attendance & Monthly Attendance), <YYYY-MM-DD>.xlsx with Present/Absent, and <MonthName>.xlsx with 1..end-of-month columns (1, 2, ABS, -)', async () => {
  const { parseXlsxWorkbookBuffer } = require('../lib/attendance-xlsx');
  const WebDriveSync = require('../public/js/attendance-drive-sync');
  const crypto = require('crypto');

  const venusRow = await db.get(`SELECT id FROM cohorts WHERE slot_code = 'venus'`);
  assert.ok(venusRow && venusRow.id);

  // 1. Verify Subject Daily Attendance XLSX (e.g., 2025-10-03.xlsx)
  const dailyRes = await appFetch(
    `${baseUrl}/api/attendance/backup/workbooks/subject-daily?subjectId=BSM121&cohortId=${venusRow.id}&date=2025-10-03&format=json`,
    { headers: { Authorization: `Bearer ${teacherAToken}` } }
  );
  assert.equal(dailyRes.status, 200);
  const dailyJson = await dailyRes.json();
  assert.equal(dailyJson.filename, '2025-10-03.xlsx');
  assert.ok(dailyJson.subjectFolderName.startsWith('Attendance ('));

  const dailyParsed = parseXlsxWorkbookBuffer(Buffer.from(dailyJson.base64, 'base64'));
  assert.deepEqual(dailyParsed.sheetNames, ['Daily Attendance']);
  const dailyRows = dailyParsed.sheets[0].rows;
  assert.equal(dailyRows[0][0], 'Gandaki University');
  assert.equal(dailyRows[1][0], 'Daily Attendance');
  assert.equal(dailyRows[2][0], 'Subject');
  assert.equal(dailyRows[3][0], 'Semester');
  assert.equal(dailyRows[3][1], 'Semester 2');
  assert.equal(dailyRows[4][0], 'Date');
  assert.equal(dailyRows[4][1], '2025-10-03');
  assert.equal(dailyRows[5][0], 'Teacher Name');
  assert.equal(dailyRows[5][1], 'Prof. UI Alice');
  assert.deepEqual(dailyRows[7], ['SN', 'Student Name', 'Attendance', 'Remarks']);

  // On 2025-10-03: Aabin Thapa (Present), Aahish Rana (Absent), binita Gurung (Present), Zubin KC (Present)
  assert.deepEqual(dailyRows[8], [1, 'Aabin Thapa', 'Present']);
  assert.deepEqual(dailyRows[9], [2, 'Aahish Rana', 'Absent']);
  assert.deepEqual(dailyRows[10], [3, 'binita Gurung', 'Present']);
  assert.deepEqual(dailyRows[11], [4, 'Zubin KC', 'Present']);

  // 2. Verify Subject Monthly Attendance XLSX (e.g., September.xlsx for 2025-09)
  const monthlyRes = await appFetch(
    `${baseUrl}/api/attendance/backup/workbooks/monthly?subjectId=BSM121&cohortId=${venusRow.id}&month=2025-09&format=json`,
    { headers: { Authorization: `Bearer ${teacherAToken}` } }
  );
  assert.equal(monthlyRes.status, 200);
  const monthlyJson = await monthlyRes.json();
  assert.equal(monthlyJson.filename, 'September.xlsx');
  assert.equal(monthlyJson.daysInMonth, 30);

  const monthlyParsed = parseXlsxWorkbookBuffer(Buffer.from(monthlyJson.base64, 'base64'));
  assert.deepEqual(monthlyParsed.sheetNames, ['September']);
  const mRows = monthlyParsed.sheets[0].rows;
  assert.equal(mRows[0][0], 'Gandaki University');
  assert.equal(mRows[1][0], 'Monthly Attendance');
  assert.equal(mRows[2][0], 'Subject');
  assert.equal(mRows[3][0], 'Semester');
  assert.equal(mRows[3][1], 'Semester 2');
  assert.equal(mRows[4][0], 'Month');
  assert.equal(mRows[4][1], 'September 2025');
  assert.equal(mRows[5][0], 'Teacher Name');
  assert.equal(mRows[5][1], 'Prof. UI Alice');

  // Table header: SN | Student Name | 1 | 2 | ... | 30 | Percentage | Remark
  const expectedHeader = [
    'SN',
    'Student Name',
    ...Array.from({ length: 30 }, (_, i) => String(i + 1)),
    'Percentage',
    'Remark'
  ];
  assert.deepEqual(mRows[7], expectedHeader);

  // Verify Aabin Thapa row in September.xlsx:
  // Sessions on Sep 2 (1), Sep 5 (2), Sep 9 (ABS), Sep 12 (3), Sep 16 (4), Sep 20 (ABS), Sep 25 (5), all other days '-' -> 71.4%
  const aabinMonthlyRow = mRows[8];
  assert.equal(aabinMonthlyRow[0], 1);
  assert.equal(aabinMonthlyRow[1], 'Aabin Thapa');
  assert.equal(aabinMonthlyRow[2], '-'); // Day 1
  assert.equal(aabinMonthlyRow[3], 1);   // Day 2
  assert.equal(aabinMonthlyRow[4], '-'); // Day 3
  assert.equal(aabinMonthlyRow[6], 2);   // Day 5
  assert.equal(aabinMonthlyRow[10], 'ABS'); // Day 9
  assert.equal(aabinMonthlyRow[13], 3);  // Day 12
  assert.equal(aabinMonthlyRow[17], 4);  // Day 16
  assert.equal(aabinMonthlyRow[21], 'ABS'); // Day 20
  assert.equal(aabinMonthlyRow[26], 5);  // Day 25
  assert.equal(aabinMonthlyRow[31], '-'); // Day 30
  assert.equal(aabinMonthlyRow[32], '71.4%'); // Percentage

  // 3. Verify Google Drive Subject Folder Hierarchy & Sync creates ONLY 2 subfolders inside Attendance (<Subject Name>):
  //    - Daily Attendance -> 2025-10-10.xlsx
  //    - Monthly Attendance -> October.xlsx
  const validToken = 'ya29.a0AfH6SMBx_subject_drive_test_token_999';
  const driveFilesById = new Map();
  let nextId = 1;

  async function mockSubjectDriveFetch(urlStr, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const parsed = new URL(urlStr);
    const pathname = parsed.pathname;

    if (method === 'GET' && pathname === '/drive/v3/files') {
      const q = parsed.searchParams.get('q') || '';
      const matched = [...driveFilesById.values()].filter((f) => {
        if (f.trashed) return false;
        const nameMatch = /name\s*=\s*'([^']+)'/.exec(q);
        if (nameMatch && f.name !== nameMatch[1]) return false;
        const parentMatch = /'([^']+)'\s+in\s+parents/.exec(q);
        if (parentMatch && (!Array.isArray(f.parents) || !f.parents.includes(parentMatch[1]))) return false;
        return true;
      });
      return { status: 200, ok: true, json: async () => ({ files: matched }) };
    }

    if (method === 'POST' && pathname === '/drive/v3/files') {
      const meta = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
      const id = `subj_folder_${nextId++}`;
      const rec = {
        id,
        name: meta.name,
        mimeType: meta.mimeType,
        parents: meta.parents || [],
        appProperties: meta.appProperties || {},
        trashed: false,
        createdTime: new Date().toISOString()
      };
      driveFilesById.set(id, rec);
      return { status: 200, ok: true, json: async () => ({ ...rec }) };
    }

    if ((method === 'POST' || method === 'PATCH') && pathname.startsWith('/upload/drive/v3/files')) {
      const bodyStr = String(options.body || '');
      const nameMatch = /"name"\s*:\s*"([^"]+)"/.exec(bodyStr);
      const parentsMatch = /"parents"\s*:\s*\[\s*"([^"]+)"\s*\]/.exec(bodyStr);
      const id = pathname.includes('/files/')
        ? decodeURIComponent(pathname.slice('/upload/drive/v3/files/'.length))
        : `subj_file_${nextId++}`;
      const sha256Checksum = crypto.createHash('sha256').update(bodyStr).digest('hex');
      const existing = driveFilesById.get(id) || {};
      const rec = {
        ...existing,
        id,
        name: nameMatch ? nameMatch[1] : existing.name || 'workbook.xlsx',
        parents: parentsMatch ? [parentsMatch[1]] : existing.parents || [],
        sha256Checksum,
        trashed: false,
        createdTime: existing.createdTime || new Date().toISOString()
      };
      driveFilesById.set(id, rec);
      return { status: 200, ok: true, json: async () => ({ ...rec }) };
    }

    return { status: 200, ok: true, json: async () => ({}) };
  }

  const driveClient = WebDriveSync.createAttendanceDriveSyncClient({
    backendFetch: async (pathStr, opts = {}) => {
      const headers = {
        ...(opts.headers || {}),
        Authorization: `Bearer ${teacherAToken}`
      };
      return appFetch(`${baseUrl}${pathStr}`, { ...opts, headers });
    },
    driveFetch: mockSubjectDriveFetch
  });
  driveClient.setAccessTokenForSession({ accessToken: validToken, expiresInSeconds: 3600 });

  const syncRes = await driveClient.syncSubjectAttendanceToDrive({
    subjectId: 'BSM121',
    cohortId: venusRow.id,
    date: '2025-10-10',
    month: '2025-10'
  });

  assert.equal(syncRes.synced, true);
  assert.ok(syncRes.subjectFolderName.startsWith('Attendance ('));

  // Verify folders created in Drive: 1 subject root folder + strictly 2 subfolders (Daily Attendance and Monthly Attendance)
  const createdFolders = [...driveFilesById.values()].filter(
    (f) => f.mimeType === 'application/vnd.google-apps.folder'
  );
  assert.equal(createdFolders.length, 3, 'Must create 1 subject root folder and strictly 2 subfolders');
  const rootFolder = createdFolders.find((f) => f.id === syncRes.folders.rootFolderId);
  const childFolders = createdFolders.filter((f) => Array.isArray(f.parents) && f.parents.includes(rootFolder.id));
  assert.equal(childFolders.length, 2, 'Inside Attendance (<Subject Name>) there must be only 2 folders');
  assert.deepEqual(
    childFolders.map((f) => f.name).sort(),
    ['Daily Attendance', 'Monthly Attendance']
  );

  // Verify files uploaded inside Daily Attendance and Monthly Attendance
  assert.equal(syncRes.dailyFile.driveFileName, '2025-10-10.xlsx');
  assert.equal(syncRes.monthlyFile.driveFileName, 'October.xlsx');
});



