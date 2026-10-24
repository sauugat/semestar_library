
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

  // 1 & 2: Mount workspace -> loads authorized subjects (CIT111), active cohort (Mercury), and roster (stu_ui_1, stu_ui_2)
  await ws.mount(mountEl);
  const st = ws.getState();

  assert.equal(st.subjects.length, 1);
  assert.equal(st.subjects[0].code, 'CIT111');
  assert.equal(st.selectedSubjectId, 'CIT111');
  assert.equal(st.selectedCohortId, cohortMercury.id);
  assert.equal(st.selectedDate, TODAY_NEPAL);
  assert.equal(st.roster.length, 2);

  // Initially unmarked (never auto-marked Present or Absent)
  assert.equal(Object.keys(st.marksByStudentId).length, 0);
  assert.equal(st.currentStudentIndex, 0);

  // 4: Unmarked students prevent submission
  await ws.submitAttendance();
  assert.match(st.saveError, /unmarked/i);
  assert.equal(st.existingSession, null);

  // 3: Mark Student 1 as Present -> auto-advances to Student 2 (index 1)
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

  // 5: Review stage HTML displays accurate counts (Total: 2, Marked: 2, Present: 1, Absent: 1, Unmarked: 0)
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
  assert.ok(mountEl.innerHTML.includes('Editable for'));
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
  assert.ok(mountEl.innerHTML.includes('Locked / Read-Only Session'));
  assert.ok(mountEl.innerHTML.includes('24h edit window expired (Read-Only)'));

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



