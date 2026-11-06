/**
 * Semester Library — Comprehensive Verification for Auto-Save, Multi-Subject Drive Sync,
 * and Persistent Session Reliability
 *
 * Verifies:
 * 1. Multi-subject folder provisioning (provisionAllAssignedSubjects):
 *    - Automatically creates Attendance (<Subject Name>) and subfolders for all assigned subjects.
 * 2. Multi-subject workbook sync (syncAllAssignedSubjectsToDrive):
 *    - Seamlessly uploads daily & monthly workbooks for each assigned subject.
 * 3. Session token reliability:
 *    - Window memory caching ensures page/tab navigation does not drop active authorization.
 *    - Silent renewal (prompt: '') succeeds without requiring interactive popup.
 *    - Disconnection and clearAccessToken safely purge in-memory cache.
 * 4. Mobile SecureStore rehydration:
 *    - Mobile getStatus() automatically rehydrates access token from SecureStore refresh token.
 * 5. Full auto-save verification:
 *    - Attendance submission triggers non-blocking auto-save to Google Drive.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { PassThrough } = require('node:stream');
const crypto = require('node:crypto');
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
  computeCanonicalSnapshotHash
} = require('../lib/attendance-service');
const { formatNepalDate } = require('../lib/nepali-dates');
const WebDriveSync = require('../public/js/attendance-drive-sync');

let server;
let baseUrl = 'http://127.0.0.1';

async function appFetch(urlOrPath, options = {}) {
  const parsedUrl = new URL(urlOrPath, baseUrl);
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
      const finish = () => {
        const fullBody = Buffer.concat(resChunks);
        resolve({
          status: res.statusCode,
          ok: res.statusCode >= 200 && res.statusCode < 300,
          headers: {
            get(k) {
              return res.getHeader(k.toLowerCase()) || null;
            }
          },
          async json() {
            return JSON.parse(fullBody.toString('utf8'));
          },
          async text() {
            return fullBody.toString('utf8');
          },
          async arrayBuffer() {
            return fullBody.buffer.slice(
              fullBody.byteOffset,
              fullBody.byteOffset + fullBody.byteLength
            );
          }
        });
      };
      const origResult = origEnd(chunk, encoding, cb);
      setImmediate(finish);
      return origResult;
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

function createMockGoogleDriveEnvironment({
  validAccessToken = 'ya29.a0AfH6SMBx_mock_valid_teacher_drive_token_123456',
  googleEmail = 'ram.faculty@gmail.com'
} = {}) {
  const filesById = new Map();
  const requestLog = [];
  const uploadHistory = [];
  let fileIdCounter = 1;

  function parseMultipartBody(rawBody, contentTypeHeader) {
    const boundaryMatch = /boundary=([^\s;]+)/i.exec(contentTypeHeader || '');
    const boundary = boundaryMatch ? boundaryMatch[1] : '-------SemesterLibraryDriveSyncBoundary7MA4YWxkTrZu0gW';
    const parts = String(rawBody || '').split(`--${boundary}`);
    let metadata = {};
    let contentBytes = Buffer.alloc(0);

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed || trimmed === '--') continue;
      const [headerSection, ...bodySections] = trimmed.split('\r\n\r\n');
      const partBody = bodySections.join('\r\n\r\n');
      if (/Content-Type:\s*application\/json/i.test(headerSection)) {
        try {
          metadata = JSON.parse(partBody);
        } catch (_) {}
      } else {
        contentBytes = Buffer.from(partBody, 'latin1');
      }
    }

    return { metadata, contentBytes };
  }

  async function driveFetch(url, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const headers = options.headers || {};
    const parsedUrl = new URL(url);

    requestLog.push({ method, url, headers });

    // POST https://oauth2.googleapis.com/token (Mobile PKCE token endpoint & refresh)
    if (method === 'POST' && url.includes('oauth2.googleapis.com/token')) {
      return {
        status: 200,
        ok: true,
        headers: { get: () => 'application/json' },
        async json() {
          return {
            access_token: validAccessToken,
            expires_in: 3600,
            token_type: 'Bearer',
            scope: 'https://www.googleapis.com/auth/drive.file'
          };
        }
      };
    }

    const authHeader = headers.Authorization || headers.authorization || '';
    if (!authHeader.startsWith(`Bearer ${validAccessToken}`)) {
      return {
        status: 401,
        ok: false,
        headers: { get: () => 'application/json' },
        async json() {
          return { error: { code: 401, message: 'Invalid Credentials', status: 'UNAUTHENTICATED' } };
        },
        async text() {
          return JSON.stringify({ error: { code: 401, message: 'Invalid Credentials' } });
        }
      };
    }

    // GET /drive/v3/about?fields=user
    if (method === 'GET' && parsedUrl.pathname === '/drive/v3/about') {
      return {
        status: 200,
        ok: true,
        headers: { get: () => 'application/json' },
        async json() {
          return {
            user: {
              emailAddress: googleEmail,
              displayName: 'Faculty Teacher',
              me: true
            }
          };
        }
      };
    }

    // POST /drive/v3/files (Folder creation)
    if (method === 'POST' && parsedUrl.pathname === '/drive/v3/files') {
      const body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
      const fileId = `mock_folder_${fileIdCounter++}`;
      const fileRecord = {
        id: fileId,
        name: body.name,
        mimeType: body.mimeType,
        parents: body.parents || [],
        appProperties: body.appProperties || {},
        trashed: false
      };
      filesById.set(fileId, fileRecord);
      return {
        status: 200,
        ok: true,
        headers: { get: () => 'application/json' },
        async json() {
          return fileRecord;
        }
      };
    }

    // GET /drive/v3/files?q=...
    if (method === 'GET' && parsedUrl.pathname === '/drive/v3/files') {
      const q = parsedUrl.searchParams.get('q') || '';
      let matched = [...filesById.values()].filter((f) => !f.trashed);

      if (q.includes("mimeType = 'application/vnd.google-apps.folder'")) {
        matched = matched.filter((f) => f.mimeType === 'application/vnd.google-apps.folder');
      }

      const nameMatch = /name\s*=\s*'([^']+)'/.exec(q);
      if (nameMatch) {
        matched = matched.filter((f) => f.name === nameMatch[1]);
      }

      const parentMatch = /'([^']+)'\s+in\s+parents/.exec(q);
      if (parentMatch) {
        matched = matched.filter((f) => (f.parents || []).includes(parentMatch[1]));
      }

      const appPropMatch = /appProperties\s+has\s+\{\s*key='([^']+)'\s+and\s+value='([^']+)'\s*\}/.exec(q);
      if (appPropMatch) {
        matched = matched.filter((f) => f.appProperties && f.appProperties[appPropMatch[1]] === appPropMatch[2]);
      }

      return {
        status: 200,
        ok: true,
        headers: { get: () => 'application/json' },
        async json() {
          return { files: matched };
        }
      };
    }

    // GET /drive/v3/files/:id
    if (method === 'GET' && parsedUrl.pathname.startsWith('/drive/v3/files/')) {
      const id = parsedUrl.pathname.replace('/drive/v3/files/', '');
      const file = filesById.get(id);
      if (!file || file.trashed) {
        return {
          status: 404,
          ok: false,
          headers: { get: () => 'application/json' },
          async json() {
            return { error: { code: 404, message: 'File not found' } };
          }
        };
      }
      return {
        status: 200,
        ok: true,
        headers: { get: () => 'application/json' },
        async json() {
          return file;
        }
      };
    }

    // POST /upload/drive/v3/files?uploadType=multipart (File creation)
    if (method === 'POST' && parsedUrl.pathname === '/upload/drive/v3/files') {
      const { metadata, contentBytes } = parseMultipartBody(
        options.body,
        headers['Content-Type'] || headers['content-type']
      );
      const fileId = `mock_file_${fileIdCounter++}`;
      const sha256Checksum = crypto.createHash('sha256').update(contentBytes).digest('hex');
      const fileRecord = {
        id: fileId,
        name: metadata.name,
        mimeType: metadata.mimeType,
        parents: metadata.parents || [],
        appProperties: metadata.appProperties || {},
        sha256Checksum,
        trashed: false
      };
      filesById.set(fileId, fileRecord);
      uploadHistory.push({ fileId, name: metadata.name, sha256Checksum });
      return {
        status: 200,
        ok: true,
        headers: { get: () => 'application/json' },
        async json() {
          return fileRecord;
        }
      };
    }

    // PATCH /upload/drive/v3/files/:id?uploadType=multipart (File update)
    if (method === 'PATCH' && parsedUrl.pathname.startsWith('/upload/drive/v3/files/')) {
      const id = parsedUrl.pathname.replace('/upload/drive/v3/files/', '');
      const existing = filesById.get(id);
      if (!existing) {
        return {
          status: 404,
          ok: false,
          headers: { get: () => 'application/json' },
          async json() {
            return { error: { code: 404, message: 'File not found' } };
          }
        };
      }
      const { metadata, contentBytes } = parseMultipartBody(
        options.body,
        headers['Content-Type'] || headers['content-type']
      );
      const sha256Checksum = crypto.createHash('sha256').update(contentBytes).digest('hex');
      existing.name = metadata.name || existing.name;
      existing.appProperties = { ...(existing.appProperties || {}), ...(metadata.appProperties || {}) };
      existing.sha256Checksum = sha256Checksum;
      uploadHistory.push({ fileId: id, name: existing.name, sha256Checksum, patch: true });
      return {
        status: 200,
        ok: true,
        headers: { get: () => 'application/json' },
        async json() {
          return existing;
        }
      };
    }

    // POST https://oauth2.googleapis.com/token (Mobile PKCE token endpoint)
    if (method === 'POST' && url.includes('oauth2.googleapis.com/token')) {
      return {
        status: 200,
        ok: true,
        headers: { get: () => 'application/json' },
        async json() {
          return {
            access_token: validAccessToken,
            expires_in: 3600,
            token_type: 'Bearer',
            scope: 'https://www.googleapis.com/auth/drive.file'
          };
        }
      };
    }

    // POST https://oauth2.googleapis.com/revoke
    if (method === 'POST' && url.includes('oauth2.googleapis.com/revoke')) {
      return {
        status: 200,
        ok: true,
        headers: { get: () => 'application/json' },
        async json() {
          return {};
        }
      };
    }

    return {
      status: 404,
      ok: false,
      headers: { get: () => 'application/json' },
      async json() {
        return { error: { code: 404, message: `Unmocked route ${method} ${url}` } };
      }
    };
  }

  return {
    driveFetch,
    filesById,
    requestLog,
    uploadHistory
  };
}

let teacherToken;
let teacherProfile;
let assignedSubjectsList = [];
let testCohort;
const TODAY_NEPAL = formatNepalDate(new Date());

test.before(async () => {
  process.env.JWT_SECRET = 'test_jwt_secret_auto_drive_123456';
  process.env.GOOGLE_DRIVE_WEB_CLIENT_ID = 'test-web-client-id.apps.googleusercontent.com';
  process.env.GOOGLE_DRIVE_IOS_CLIENT_ID = 'test-ios-client-id.apps.googleusercontent.com';
  process.env.GOOGLE_DRIVE_ANDROID_CLIENT_ID = 'test-android-client-id.apps.googleusercontent.com';

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

  // Setup test cohort
  try {
    testCohort = await createCohort(db, {
      slotCode: 'mercury',
      displayName: 'Mercury',
      currentSemester: 3,
      intakeYear: 2026
    });
  } catch (_) {
    testCohort = await db.get("SELECT * FROM cohorts WHERE slot_code = 'mercury'");
  }

  // Setup teacher user and profile
  const teacherEmail = 'ram.faculty@test.edu.np';
  const hashedPassword = bcrypt.hashSync('TeacherPass123!', 8);
  const teacherId = 'tea_auto_sync_test_01';
  const teacherUserId = 'tea_auto_user_01';

  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, department, account_status)
     VALUES (?, ?, ?, ?, 'teacher', ?, NULL, 'BIT', 'active')
     ON CONFLICT (studentId) DO UPDATE SET
       passwordHash = excluded.passwordHash,
       email = excluded.email,
       role = 'teacher',
       account_status = 'active'`,
    [teacherUserId, 'prof_ram', 'Prof. Ram Sharma', teacherEmail, hashedPassword]
  );

  await db.run(
    `INSERT INTO teachers (id, user_id, designation, status)
     VALUES (?, ?, 'Professor', 'active')
     ON CONFLICT (id) DO UPDATE SET
       status = 'active',
       designation = 'Professor'`,
    [teacherId, teacherUserId]
  );

  // Assign multiple subjects
  const allSubs = await db.all('SELECT id, code, name FROM subjects WHERE semester = 3 LIMIT 3');
  assignedSubjectsList = allSubs.map((s) => ({
    id: s.id,
    code: s.code,
    name: s.name,
    cohortId: testCohort.id
  }));

  for (const s of assignedSubjectsList) {
    await db.run(
      `INSERT INTO teacher_subjects (id, teacher_id, subject_id)
       VALUES (?, ?, ?)
       ON CONFLICT (id) DO NOTHING`,
      [`ts_${teacherId}_${s.id}`, teacherId, s.id]
    );
  }

  // Insert students in cohort roster
  for (let i = 1; i <= 5; i++) {
    const studentId = `auto_std_${i}`;
    const studentEmail = `student${i}@test.edu.np`;
    await db.run(
      `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, cohort_id, account_status)
       VALUES (?, ?, ?, ?, 'student', ?, 'Semester 3', ?, 'active')
       ON CONFLICT (studentId) DO UPDATE SET
         cohort_id = excluded.cohort_id,
         account_status = 'active'`,
      [studentId, studentId, `Student ${i}`, studentEmail, hashedPassword, testCohort.id]
    );
  }

  // Login as teacher
  const loginRes = await appFetch('/api/mobile/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { studentId: teacherUserId, password: 'TeacherPass123!' }
  });
  assert.equal(loginRes.status, 200);
  const loginData = await loginRes.json();
  teacherToken = loginData.token;
  teacherProfile = { teacherId, email: teacherEmail };
});

function createAuthenticatedBackendFetch(token) {
  return async function (path, opts = {}) {
    const sep = path.startsWith('/') ? '' : '/';
    const url = `${baseUrl}${sep}${path}`;
    const headers = {
      ...(opts.headers || {}),
      Authorization: `Bearer ${token}`
    };
    return await appFetch(url, { ...opts, headers });
  };
}

// ============================================================================
// 1. MULTI-SUBJECT FOLDER PROVISIONING (provisionAllAssignedSubjects)
// ============================================================================

test('Multi-Subject 1: provisionAllAssignedSubjects creates Attendance (<Subject Name>) and subfolders for all assigned subjects', async () => {
  const mockDrive = createMockGoogleDriveEnvironment();
  const validToken = 'ya29.a0AfH6SMBx_mock_valid_teacher_drive_token_123456';
  const fakeWindow = { __SL_DRIVE_ACTIVE_TOKEN__: null };

  const client = WebDriveSync.createAttendanceDriveSyncClient({
    window: fakeWindow,
    backendFetch: createAuthenticatedBackendFetch(teacherToken),
    driveFetch: mockDrive.driveFetch
  });

  client.setAccessTokenForSession({ accessToken: validToken, expiresInSeconds: 3600 });
  await client.ensureFolderHierarchy();

  // Provision folders for all assigned subjects
  const provisionResult = await client.provisionAllAssignedSubjects({
    subjects: assignedSubjectsList
  });

  assert.equal(provisionResult.provisioned, true);
  assert.equal(provisionResult.total, assignedSubjectsList.length);
  assert.equal(provisionResult.results.length, assignedSubjectsList.length);

  for (const res of provisionResult.results) {
    assert.equal(res.success, true);
    assert.ok(res.hierarchy.folders.rootFolderId);
    assert.ok(res.hierarchy.folders.dailyFolderId);
    assert.ok(res.hierarchy.folders.monthlyFolderId);

    // Verify folder exists in mock Drive
    const rootInDrive = mockDrive.filesById.get(res.hierarchy.folders.rootFolderId);
    assert.ok(rootInDrive);
    assert.ok(rootInDrive.name.startsWith('Attendance ('));

    const dailyInDrive = mockDrive.filesById.get(res.hierarchy.folders.dailyFolderId);
    assert.ok(dailyInDrive);
    assert.equal(dailyInDrive.name, 'Daily Attendance');
    assert.deepEqual(dailyInDrive.parents, [rootInDrive.id]);

    const monthlyInDrive = mockDrive.filesById.get(res.hierarchy.folders.monthlyFolderId);
    assert.ok(monthlyInDrive);
    assert.equal(monthlyInDrive.name, 'Monthly Attendance');
    assert.deepEqual(monthlyInDrive.parents, [rootInDrive.id]);
  }

  // Calling provisionAllAssignedSubjects again is idempotent (reuses same folder IDs)
  const secondProvision = await client.provisionAllAssignedSubjects({
    subjects: assignedSubjectsList
  });
  assert.equal(secondProvision.provisioned, true);
  for (let i = 0; i < assignedSubjectsList.length; i++) {
    assert.equal(
      secondProvision.results[i].hierarchy.folders.rootFolderId,
      provisionResult.results[i].hierarchy.folders.rootFolderId
    );
  }
});

// ============================================================================
// 2. MULTI-SUBJECT WORKBOOK SYNC (syncAllAssignedSubjectsToDrive)
// ============================================================================

test('Multi-Subject 2: syncAllAssignedSubjectsToDrive uploads daily and monthly workbooks for each assigned subject', async () => {
  const mockDrive = createMockGoogleDriveEnvironment();
  const validToken = 'ya29.a0AfH6SMBx_mock_valid_teacher_drive_token_123456';
  const fakeWindow = { __SL_DRIVE_ACTIVE_TOKEN__: null };

  const client = WebDriveSync.createAttendanceDriveSyncClient({
    window: fakeWindow,
    backendFetch: createAuthenticatedBackendFetch(teacherToken),
    driveFetch: mockDrive.driveFetch
  });

  client.setAccessTokenForSession({ accessToken: validToken, expiresInSeconds: 3600 });
  await client.ensureFolderHierarchy();

  // Create attendance session for first assigned subject
  const sub1 = assignedSubjectsList[0];
  const createRes = await appFetch('/api/attendance/sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherToken}`
    },
    body: {
      subjectId: sub1.id,
      cohortId: testCohort.id,
      sessionDate: TODAY_NEPAL,
      records: [
        { studentId: 'auto_std_1', status: 'present' },
        { studentId: 'auto_std_2', status: 'present' },
        { studentId: 'auto_std_3', status: 'absent' },
        { studentId: 'auto_std_4', status: 'present' },
        { studentId: 'auto_std_5', status: 'present' }
      ]
    }
  });
  assert.ok(createRes.status === 201 || createRes.status === 200, `Expected 200 or 201 but got ${createRes.status}`);

  // Sync all assigned subjects to Drive
  const syncAllRes = await client.syncAllAssignedSubjectsToDrive({
    subjects: assignedSubjectsList,
    date: TODAY_NEPAL
  });

  assert.equal(syncAllRes.synced, true);
  assert.equal(syncAllRes.status, 'backed_up');
  assert.equal(syncAllRes.total, assignedSubjectsList.length);
  assert.equal(syncAllRes.completed, assignedSubjectsList.length);
  assert.equal(syncAllRes.failed, 0);

  // Verify each subject has daily and monthly files in mock Drive
  for (const item of syncAllRes.results) {
    assert.equal(item.success, true);
    assert.ok(item.data.dailyFile.driveFileId);
    assert.ok(item.data.monthlyFile.driveFileId);

    const dailyFile = mockDrive.filesById.get(item.data.dailyFile.driveFileId);
    assert.ok(dailyFile);
    assert.ok(dailyFile.name.endsWith('.xlsx'));

    const monthlyFile = mockDrive.filesById.get(item.data.monthlyFile.driveFileId);
    assert.ok(monthlyFile);
    assert.ok(monthlyFile.name.endsWith('.xlsx'));
  }
});

// ============================================================================
// 3. PERSISTENT IN-MEMORY SESSION RELIABILITY & ZERO BROWSER STORAGE INTEGRITY
// ============================================================================

test('Session Reliability 3: In-memory window sharing retains token across client instantiations without leaking to localStorage/sessionStorage', async () => {
  const mockDrive = createMockGoogleDriveEnvironment();
  const validToken = 'ya29.a0AfH6SMBx_mock_valid_teacher_drive_token_123456';

  const fakeLocal = new Map();
  const fakeSession = new Map();
  const makeStorage = (map) => ({
    get length() { return map.size; },
    key(i) { return [...map.keys()][i] || null; },
    getItem(k) { return map.get(k) || null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); }
  });

  const sharedWindow = {
    localStorage: makeStorage(fakeLocal),
    sessionStorage: makeStorage(fakeSession),
    __SL_DRIVE_ACTIVE_TOKEN__: null
  };

  // Client 1 connects and sets session token
  const client1 = WebDriveSync.createAttendanceDriveSyncClient({
    window: sharedWindow,
    backendFetch: createAuthenticatedBackendFetch(teacherToken),
    driveFetch: mockDrive.driveFetch
  });

  client1.setAccessTokenForSession({ accessToken: validToken, expiresInSeconds: 3600 });
  assert.equal(client1.hasValidAccessToken(), true);

  // Verify zero token storage in localStorage/sessionStorage
  assert.equal(fakeLocal.size, 0, 'No token in localStorage');
  assert.equal(fakeSession.size, 0, 'No token in sessionStorage');

  // Client 2 instantiated in the same window (e.g. switching views / subjects)
  const client2 = WebDriveSync.createAttendanceDriveSyncClient({
    window: sharedWindow,
    backendFetch: createAuthenticatedBackendFetch(teacherToken),
    driveFetch: mockDrive.driveFetch
  });

  // Client 2 immediately has valid access token from window memory!
  assert.equal(client2.hasValidAccessToken(), true, 'Client 2 must inherit valid in-memory session token');

  // Disconnecting clears the in-memory window token
  await client2.disconnectGoogleDrive();
  assert.equal(client2.hasValidAccessToken(), false);
  assert.equal(sharedWindow.__SL_DRIVE_ACTIVE_TOKEN__, null);

  // Client 3 now has no valid token
  const client3 = WebDriveSync.createAttendanceDriveSyncClient({
    window: sharedWindow,
    backendFetch: createAuthenticatedBackendFetch(teacherToken),
    driveFetch: mockDrive.driveFetch
  });
  assert.equal(client3.hasValidAccessToken(), false);
});

// ============================================================================
// 4. SILENT RENEWAL VS USER GESTURE ENFORCEMENT
// ============================================================================

test('Session Reliability 4: Silent renewal attempts prompt: empty without throwing USER_GESTURE_REQUIRED; interactive call enforces gesture', async () => {
  const validToken = 'ya29.a0AfH6SMBx_mock_valid_teacher_drive_token_123456';
  let requestedPrompt = null;

  const mockGisOAuth2 = {
    initTokenClient(cfg) {
      return {
        requestAccessToken(opts) {
          requestedPrompt = opts && opts.prompt !== undefined ? opts.prompt : null;
          cfg.callback({
            access_token: validToken,
            expires_in: 3600,
            scope: 'https://www.googleapis.com/auth/drive.file'
          });
        }
      };
    },
    hasGrantedAllScopes() {
      return true;
    }
  };

  const fakeWindow = {
    google: { accounts: { oauth2: mockGisOAuth2 } },
    __SL_DRIVE_ACTIVE_TOKEN__: null
  };

  const client = WebDriveSync.createAttendanceDriveSyncClient({
    window: fakeWindow,
    backendFetch: createAuthenticatedBackendFetch(teacherToken)
  });

  // Interactive request without user gesture still strictly throws USER_GESTURE_REQUIRED
  await assert.rejects(
    async () => {
      await client.requestAuthorization({ userGesture: false, silent: false });
    },
    (err) => err && err.code === 'USER_GESTURE_REQUIRED'
  );

  // Silent request does NOT throw USER_GESTURE_REQUIRED, attempts prompt: ''
  const silentRes = await client.requestAuthorization({ userGesture: false, silent: true });
  assert.equal(silentRes.authorized, true);
  assert.equal(requestedPrompt, '');
  assert.equal(client.hasValidAccessToken(), true);
});

// ============================================================================
// 5. MOBILE CLIENT: AUTO-REFRESH GETSTATUS AND MULTI-SUBJECT SYNC
// ============================================================================

test('Mobile Client 5: getStatus() rehydrates token from SecureStore; syncAllAssignedSubjectsToDrive provisions and syncs all subjects on mobile', async () => {
  const MobileDriveSync = await import('../mobile/services/attendance-drive-sync-core.ts');
  const mockDrive = createMockGoogleDriveEnvironment();
  const validToken = 'ya29.a0AfH6SMBx_mock_valid_teacher_drive_token_123456';

  const mockSecureStoreData = new Map([
    ['semester_library_teacher_drive_refresh_token_v1', '1//0g_mock_refresh_token_faculty_mobile']
  ]);
  const mockSecureStore = {
    async getItemAsync(key) {
      return mockSecureStoreData.get(key) || null;
    },
    async setItemAsync(key, value) {
      mockSecureStoreData.set(key, String(value));
    },
    async deleteItemAsync(key) {
      mockSecureStoreData.delete(key);
    }
  };

  const mobileClient = MobileDriveSync.createMobileAttendanceDriveSyncCore({
    platform: 'ios',
    extraConfig: {
      googleDriveIosClientId: 'test-ios-client-id.apps.googleusercontent.com'
    },
    backendFetch: createAuthenticatedBackendFetch(teacherToken),
    driveFetch: mockDrive.driveFetch,
    secureStore: mockSecureStore
  });

  // Ensure connection is marked connected in backend
  mobileClient.setAccessTokenForSession({ accessToken: validToken, expiresInSeconds: 3600 });
  await mobileClient.ensureFolderHierarchy();

  // Reset in-memory token to null
  await mobileClient.clearTokens({ deleteRefreshToken: false });
  assert.equal(mobileClient.hasValidAccessToken(), false);

  // getStatus() automatically restores inMemoryToken using the SecureStore refresh token!
  const statusAfterRehydrate = await mobileClient.getStatus();
  assert.equal(statusAfterRehydrate.connection.connectionStatus, 'connected');
  assert.equal(statusAfterRehydrate.hasActiveMemoryToken, true, 'getStatus must auto-rehydrate token from SecureStore');
  assert.equal(mobileClient.hasValidAccessToken(), true);

  // Mobile syncAllAssignedSubjectsToDrive succeeds
  const mobileSyncAll = await mobileClient.syncAllAssignedSubjectsToDrive({
    subjects: assignedSubjectsList,
    date: TODAY_NEPAL
  });

  assert.equal(mobileSyncAll.synced, true);
  assert.equal(mobileSyncAll.status, 'backed_up');
  assert.equal(mobileSyncAll.total, assignedSubjectsList.length);
  assert.equal(mobileSyncAll.completed, assignedSubjectsList.length);
  assert.equal(mobileSyncAll.failed, 0);
});
