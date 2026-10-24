'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const { PassThrough } = require('stream');

const testDbPath = path.join(
  os.tmpdir(),
  `attendance_backup_p3a_${Date.now()}_${Math.random().toString(36).slice(2)}.db`
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
  computeCanonicalSnapshotHash
} = require('../lib/attendance-service');
const { parseXlsxWorkbookBuffer } = require('../lib/attendance-xlsx');
const { formatNepalDate } = require('../lib/nepali-dates');
const WebDriveSync = require('../public/js/attendance-drive-sync');

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
      const rawBuf = Buffer.concat(resChunks);
      const rawText = rawBuf.toString('utf8');
      resolve({
        status: res.statusCode || 200,
        ok: (res.statusCode || 200) >= 200 && (res.statusCode || 200) < 300,
        headers: {
          get: (name) => res.getHeader(name.toLowerCase()) || null
        },
        buffer: async () => rawBuf,
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

/**
 * In-Memory Mock Google Drive v3 REST API Server
 * Simulates:
 * - GET /drive/v3/about
 * - GET /drive/v3/files/:id
 * - GET /drive/v3/files?q=...
 * - POST /drive/v3/files (folder creation)
 * - POST /upload/drive/v3/files?uploadType=multipart (file creation)
 * - PATCH /upload/drive/v3/files/:id?uploadType=multipart (file update)
 * - POST https://oauth2.googleapis.com/token (mobile PKCE code exchange & refresh)
 * - POST https://oauth2.googleapis.com/revoke (token revocation)
 */
function createMockGoogleDriveEnvironment({
  validAccessToken = 'ya29.a0AfH6SMBx_mock_valid_teacher_drive_token_123456',
  googleEmail = 'sharma.faculty@gmail.com'
} = {}) {
  const filesById = new Map();
  const requestLog = [];
  const uploadHistory = [];
  let fileIdCounter = 1;
  let forceNextStatus = null;
  let forceFailArtifactType = null;
  let revokedTokens = new Set();

  function parseMultipartBody(rawBody, contentTypeHeader) {
    const boundaryMatch = /boundary=([^\s;]+)/i.exec(contentTypeHeader || '');
    const boundary = boundaryMatch ? boundaryMatch[1] : '-------SemesterLibraryDriveSyncBoundary7MA4YWxkTrZu0gW';
    const parts = String(rawBody || '').split(`--${boundary}`);
    let metadata = {};
    let contentBytes = Buffer.alloc(0);

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed || trimmed === '--') continue;
      const splitIdx = part.indexOf('\r\n\r\n');
      if (splitIdx === -1) continue;
      const rawHeaders = part.slice(0, splitIdx);
      let bodySection = part.slice(splitIdx + 4);
      if (bodySection.endsWith('\r\n')) {
        bodySection = bodySection.slice(0, -2);
      }

      if (/Content-Type:\s*application\/json/i.test(rawHeaders)) {
        const metaParsed = JSON.parse(bodySection.trim());
        if (metaParsed && (metaParsed.appProperties || metaParsed.parents || metaParsed.mimeType)) {
          metadata = metaParsed;
        } else {
          contentBytes = Buffer.from(bodySection, 'utf8');
        }
      } else if (/Content-Transfer-Encoding:\s*base64/i.test(rawHeaders)) {
        contentBytes = Buffer.from(bodySection.trim(), 'base64');
      } else {
        contentBytes = Buffer.from(bodySection, 'utf8');
      }
    }

    return { metadata, contentBytes };
  }

  function matchesQuery(file, q) {
    if (!q) return !file.trashed;
    if (q.includes('trashed = false') && file.trashed) return false;

    const mimeMatch = /mimeType\s*=\s*'([^']+)'/.exec(q);
    if (mimeMatch && file.mimeType !== mimeMatch[1]) return false;

    const nameMatch = /name\s*=\s*'((?:\\'|[^'])*)'/.exec(q);
    if (nameMatch) {
      const expectedName = nameMatch[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
      if (file.name !== expectedName) return false;
    }

    const parentMatch = /'([^']+)'\s+in\s+parents/.exec(q);
    if (parentMatch) {
      const pId = parentMatch[1];
      if (!Array.isArray(file.parents) || !file.parents.includes(pId)) return false;
    }

    const propRegex = /appProperties\s+has\s+\{\s*key='([^']+)'\s+and\s+value='([^']+)'\s*\}/g;
    let pm;
    while ((pm = propRegex.exec(q)) !== null) {
      const k = pm[1];
      const v = pm[2];
      if (!file.appProperties || file.appProperties[k] !== v) {
        return false;
      }
    }

    return true;
  }

  async function driveFetch(urlStr, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const headers = options.headers || {};
    const authHeader = headers.Authorization || headers.authorization || '';
    requestLog.push({ method, url: urlStr, headers, body: options.body });

    if (urlStr.startsWith('https://oauth2.googleapis.com/revoke')) {
      const u = new URL(urlStr);
      const tok = u.searchParams.get('token');
      if (tok) revokedTokens.add(tok);
      return {
        status: 200,
        ok: true,
        json: async () => ({ revoked: true })
      };
    }

    if (urlStr.startsWith('https://oauth2.googleapis.com/token')) {
      const params = new URLSearchParams(String(options.body || ''));
      const grantType = params.get('grant_type');
      if (grantType === 'authorization_code') {
        const code = params.get('code');
        const verifier = params.get('code_verifier');
        if (!code || !verifier) {
          return {
            status: 400,
            ok: false,
            json: async () => ({ error: 'invalid_request', error_description: 'Missing code or PKCE code_verifier' })
          };
        }
        return {
          status: 200,
          ok: true,
          json: async () => ({
            access_token: validAccessToken,
            refresh_token: '1//0g_mock_refresh_token_secure_store_only',
            expires_in: 3600,
            scope: 'https://www.googleapis.com/auth/drive.file',
            token_type: 'Bearer'
          })
        };
      }
      if (grantType === 'refresh_token') {
        const refTok = params.get('refresh_token');
        if (refTok !== '1//0g_mock_refresh_token_secure_store_only') {
          return {
            status: 401,
            ok: false,
            json: async () => ({ error: 'invalid_grant', error_description: 'Refresh token invalid or revoked' })
          };
        }
        return {
          status: 200,
          ok: true,
          json: async () => ({
            access_token: validAccessToken,
            expires_in: 3600,
            scope: 'https://www.googleapis.com/auth/drive.file',
            token_type: 'Bearer'
          })
        };
      }
    }

    if (forceNextStatus) {
      const st = forceNextStatus;
      forceNextStatus = null;
      return {
        status: st,
        ok: false,
        json: async () => ({
          error: {
            code: st,
            message: st === 401 ? 'Invalid Credentials' : `Simulated Drive error ${st}`,
            errors: [{ reason: st === 401 ? 'authError' : 'backendError' }]
          }
        })
      };
    }

    const expectedBearer = `Bearer ${validAccessToken}`;
    if (authHeader !== expectedBearer || revokedTokens.has(validAccessToken)) {
      return {
        status: 401,
        ok: false,
        json: async () => ({
          error: {
            code: 401,
            message: 'Invalid or expired Google Drive OAuth access token.',
            errors: [{ reason: 'authError' }]
          }
        })
      };
    }

    const parsed = new URL(urlStr);
    const pathname = parsed.pathname;

    // 1. GET /drive/v3/about
    if (method === 'GET' && pathname === '/drive/v3/about') {
      return {
        status: 200,
        ok: true,
        json: async () => ({
          user: { emailAddress: googleEmail }
        })
      };
    }

    // 2. GET /drive/v3/files/:id
    if (method === 'GET' && pathname.startsWith('/drive/v3/files/')) {
      const fileId = decodeURIComponent(pathname.slice('/drive/v3/files/'.length));
      const f = filesById.get(fileId);
      if (!f) {
        return {
          status: 404,
          ok: false,
          json: async () => ({ error: { code: 404, message: 'File not found' } })
        };
      }
      return {
        status: 200,
        ok: true,
        json: async () => ({ ...f })
      };
    }

    // 3. GET /drive/v3/files?q=...
    if (method === 'GET' && pathname === '/drive/v3/files') {
      const q = parsed.searchParams.get('q') || '';
      const matched = [...filesById.values()]
        .filter((f) => matchesQuery(f, q))
        .sort((a, b) => a.createdTime.localeCompare(b.createdTime));
      return {
        status: 200,
        ok: true,
        json: async () => ({ files: matched })
      };
    }

    // 4. POST /drive/v3/files (Folder creation)
    if (method === 'POST' && pathname === '/drive/v3/files') {
      const meta = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
      const id = `drive_folder_${fileIdCounter++}`;
      const record = {
        id,
        name: meta.name,
        mimeType: meta.mimeType,
        parents: meta.parents || [],
        appProperties: meta.appProperties || {},
        trashed: false,
        createdTime: new Date(Date.now() + fileIdCounter).toISOString()
      };
      filesById.set(id, record);
      return {
        status: 200,
        ok: true,
        json: async () => ({ ...record })
      };
    }

    // 5. POST /upload/drive/v3/files (Multipart file creation)
    if (method === 'POST' && pathname === '/upload/drive/v3/files') {
      const cType = headers['Content-Type'] || headers['content-type'] || '';
      const { metadata, contentBytes } = parseMultipartBody(options.body, cType);
      const artType = metadata.appProperties && metadata.appProperties.slArtifactType;
      if (forceFailArtifactType && artType === forceFailArtifactType) {
        return {
          status: 503,
          ok: false,
          json: async () => ({
            error: {
              code: 503,
              message: `Simulated Drive upload failure for ${artType} with token ${validAccessToken}`
            }
          })
        };
      }

      const id = `drive_file_${fileIdCounter++}`;
      const sha256Checksum = crypto.createHash('sha256').update(contentBytes).digest('hex');
      const record = {
        id,
        name: metadata.name,
        mimeType: metadata.mimeType,
        parents: metadata.parents || [],
        appProperties: metadata.appProperties || {},
        sha256Checksum,
        contentBytes,
        trashed: false,
        version: 1,
        createdTime: new Date(Date.now() + fileIdCounter).toISOString()
      };
      filesById.set(id, record);
      uploadHistory.push({ op: 'create', id, name: record.name, artifactType: artType, sha256Checksum });
      return {
        status: 200,
        ok: true,
        json: async () => ({
          id: record.id,
          name: record.name,
          mimeType: record.mimeType,
          sha256Checksum: record.sha256Checksum,
          appProperties: record.appProperties
        })
      };
    }

    // 6. PATCH /upload/drive/v3/files/:id (Multipart file update)
    if (method === 'PATCH' && pathname.startsWith('/upload/drive/v3/files/')) {
      const fileId = decodeURIComponent(pathname.slice('/upload/drive/v3/files/'.length));
      const existing = filesById.get(fileId);
      if (!existing) {
        return {
          status: 404,
          ok: false,
          json: async () => ({ error: { code: 404, message: 'Target file not found for PATCH' } })
        };
      }

      const cType = headers['Content-Type'] || headers['content-type'] || '';
      const { metadata, contentBytes } = parseMultipartBody(options.body, cType);
      const artType = (metadata.appProperties && metadata.appProperties.slArtifactType) || existing.appProperties?.slArtifactType;
      if (forceFailArtifactType && artType === forceFailArtifactType) {
        return {
          status: 503,
          ok: false,
          json: async () => ({
            error: {
              code: 503,
              message: `Simulated Drive PATCH failure for ${artType}`
            }
          })
        };
      }

      const sha256Checksum = crypto.createHash('sha256').update(contentBytes).digest('hex');
      existing.name = metadata.name || existing.name;
      existing.appProperties = { ...(existing.appProperties || {}), ...(metadata.appProperties || {}) };
      existing.sha256Checksum = sha256Checksum;
      existing.contentBytes = contentBytes;
      existing.version = (existing.version || 1) + 1;

      uploadHistory.push({ op: 'update', id: existing.id, name: existing.name, artifactType: artType, sha256Checksum });
      return {
        status: 200,
        ok: true,
        json: async () => ({
          id: existing.id,
          name: existing.name,
          mimeType: existing.mimeType,
          sha256Checksum: existing.sha256Checksum,
          appProperties: existing.appProperties
        })
      };
    }

    return {
      status: 404,
      ok: false,
      json: async () => ({ error: { code: 404, message: `Unhandled mock Drive route: ${method} ${pathname}` } })
    };
  }

  let forceFailUploadStatus = null;

  return {
    filesById,
    requestLog,
    uploadHistory,
    revokedTokens,
    driveFetch: async (urlStr, options = {}) => {
      if (forceFailUploadStatus && String(urlStr).includes('/upload/drive/v3/files')) {
        const st = forceFailUploadStatus;
        forceFailUploadStatus = null;
        return {
          status: st,
          ok: false,
          json: async () => ({
            error: {
              code: st,
              message: st === 401 ? 'Invalid Credentials' : `Simulated upload error ${st}`,
              errors: [{ reason: st === 401 ? 'authError' : 'backendError' }]
            }
          })
        };
      }
      return driveFetch(urlStr, options);
    },
    setForceNextStatus(st) {
      forceNextStatus = st;
    },
    setForceFailUploadStatus(st) {
      forceFailUploadStatus = st;
    },
    setForceFailArtifactType(artType) {
      forceFailArtifactType = artType;
    }
  };
}

const PASSWORD = 'Test_Password123!';
let adminToken = '';
let teacherAToken = '';
let cohortMercury = null;
const TODAY_NEPAL = formatNepalDate(new Date());
const YESTERDAY_NEPAL = formatNepalDate(new Date(Date.now() - 24 * 60 * 60 * 1000));

const backendRequestAuditLog = [];

function createAuthenticatedBackendFetch(jwtToken, { failFirstCompleteForArtifact = null } = {}) {
  const failedOnceSet = new Set();
  return async (pathStr, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase();
    const bodyStr = options.body ? String(options.body) : '';
    backendRequestAuditLog.push({ method, path: pathStr, headers: options.headers || {}, body: bodyStr });

    if (
      failFirstCompleteForArtifact &&
      method === 'POST' &&
      pathStr.endsWith('/complete') &&
      bodyStr.includes(`"${failFirstCompleteForArtifact}"`) &&
      !failedOnceSet.has(failFirstCompleteForArtifact)
    ) {
      failedOnceSet.add(failFirstCompleteForArtifact);
      return {
        status: 502,
        ok: false,
        json: async () => ({
          code: 'LOST_COMPLETION_RESPONSE',
          message: 'Simulated lost network response after Drive upload succeeded.'
        })
      };
    }

    const headers = {
      ...(options.headers || {}),
      Authorization: `Bearer ${jwtToken}`
    };
    return await appFetch(`${baseUrl}${pathStr}`, {
      ...options,
      headers
    });
  };
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
     VALUES ('admin_p3a', 'admin_p3a', 'Admin Phase3A', 'adminp3a@gandaki.edu.np', 'admin', ?, NULL, 'active')`,
    passwordHash
  );

  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, department, account_status)
     VALUES ('tea_p3a_user', 'prof_p3a', 'Prof. Saugat Sharma', 'saugat.teacher@gandaki.edu.np', 'teacher', ?, NULL, 'BIT', 'active')`,
    passwordHash
  );
  await db.run(
    `INSERT INTO teachers (id, user_id, designation, status)
     VALUES ('tea_p3a_id', 'tea_p3a_user', 'Associate Professor', 'active')`
  );
  await db.run(
    `INSERT INTO teacher_subjects (id, teacher_id, subject_id) VALUES ('ts_p3a_1', 'tea_p3a_id', 'CIT111')`
  );
  await db.run(
    `INSERT INTO teacher_subjects (id, teacher_id, subject_id) VALUES ('ts_p3a_2', 'tea_p3a_id', 'BSM111')`
  );

  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, cohort_id, account_status)
     VALUES ('stu_p3a_1', 'stu_p3a_1', 'Aashrita लामिछाने', 's1@gandaki.edu.np', 'student', ?, 'Semester 1', ?, 'active')`,
    passwordHash,
    cohortMercury.id
  );
  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, cohort_id, account_status)
     VALUES ('stu_p3a_2', 'stu_p3a_2', 'Bikash गुरुङ', 's2@gandaki.edu.np', 'cr', ?, 'Semester 1', ?, 'active')`,
    passwordHash,
    cohortMercury.id
  );

  const aLogin = await appFetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: 'admin_p3a', password: PASSWORD })
  });
  adminToken = (await aLogin.json()).token;

  const tLogin = await appFetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: 'tea_p3a_user', password: PASSWORD })
  });
  teacherAToken = (await tLogin.json()).token;
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

// ============================================================================
// 1. MISSING OAUTH CLIENT IDS & ATTENDANCE INDEPENDENCE
// ============================================================================

test('Phase 3A Test 1: Missing OAuth Client IDs report Not Configured safely without breaking attendance submission or editing', async () => {
  delete process.env.GOOGLE_DRIVE_WEB_CLIENT_ID;
  delete process.env.EXPO_PUBLIC_GOOGLE_DRIVE_WEB_CLIENT_ID;
  delete process.env.GOOGLE_DRIVE_IOS_CLIENT_ID;
  delete process.env.EXPO_PUBLIC_GOOGLE_DRIVE_IOS_CLIENT_ID;
  delete process.env.GOOGLE_DRIVE_ANDROID_CLIENT_ID;
  delete process.env.EXPO_PUBLIC_GOOGLE_DRIVE_ANDROID_CLIENT_ID;

  const mockDrive = createMockGoogleDriveEnvironment();
  const client = WebDriveSync.createAttendanceDriveSyncClient({
    backendFetch: createAuthenticatedBackendFetch(teacherAToken),
    driveFetch: mockDrive.driveFetch
  });

  const status = await client.getStatus();
  assert.equal(status.oauth.configured, false);
  assert.equal(status.oauth.status, 'not_configured');
  assert.equal(status.connection.connectionStatus, 'not_configured');

  // Calling connectGoogleDrive or syncPendingWork when unconfigured returns safe 'not_configured' state without throwing or calling Drive
  const connectRes = await client.connectGoogleDrive({ userGesture: true });
  assert.equal(connectRes.notConfigured, true);
  assert.equal(connectRes.status, 'not_configured');
  assert.equal(mockDrive.requestLog.length, 0);

  const syncRes = await client.syncPendingWork();
  assert.equal(syncRes.notConfigured, true);
  assert.equal(syncRes.status, 'not_configured');

  // Attendance submission succeeds normally even when OAuth is not configured and Drive is unavailable
  const saveRes = await appFetch(`${baseUrl}/api/attendance/sessions`, {
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
        { studentId: 'stu_p3a_1', status: 'present' },
        { studentId: 'stu_p3a_2', status: 'absent' }
      ]
    })
  });
  assert.equal(saveRes.status, 201);
  const saveData = await saveRes.json();
  assert.equal(saveData.created, true);
  assert.equal(saveData.backupRevision.revisionNo, 1);
  assert.equal(saveData.backupRevision.backupStatus, 'pending');

  // Verify placeholder values (e.g. from .env.example) safely report Not Configured without error
  process.env.GOOGLE_DRIVE_WEB_CLIENT_ID = 'YOUR_WEB_CLIENT_ID.apps.googleusercontent.com';
  const placeholderStatus = await client.getStatus();
  assert.equal(placeholderStatus.oauth.configured, false);
  assert.equal(placeholderStatus.oauth.status, 'not_configured');
  assert.equal(placeholderStatus.oauth.configError, null);

  // Verify malformed non-placeholder values report Not Configured + actionable configError and throw OAUTH_CONFIG_INVALID on auth attempt
  process.env.GOOGLE_DRIVE_WEB_CLIENT_ID = 'not-a-valid-google-client-id';
  const malformedStatus = await client.getStatus();
  assert.equal(malformedStatus.oauth.configured, false);
  assert.match(malformedStatus.oauth.configError, /Invalid Web Google OAuth Client ID format/);
  await assert.rejects(
    async () => {
      await client.requestAuthorization({ userGesture: true });
    },
    (err) => err && err.code === 'OAUTH_CONFIG_INVALID'
  );
  delete process.env.GOOGLE_DRIVE_WEB_CLIENT_ID;
});

// ============================================================================
// 2. OAUTH CANCELLATION, USER GESTURE GUARD, TOKEN STORAGE & ZERO TOKEN LEAKAGE
// ============================================================================

test('Phase 3A Test 2: Web OAuth user-gesture enforcement, user cancellation, narrow drive.file scope verification, and zero browser storage or backend token leakage', async () => {
  process.env.GOOGLE_DRIVE_WEB_CLIENT_ID = '1234567890-webtest.apps.googleusercontent.com';

  const fakeLocalStorage = new Map();
  const fakeSessionStorage = new Map();
  const makeStorage = (map) => ({
    get length() {
      return map.size;
    },
    key(idx) {
      return [...map.keys()][idx] || null;
    },
    getItem(k) {
      return map.get(k) || null;
    },
    setItem(k, v) {
      map.set(k, String(v));
    },
    removeItem(k) {
      map.delete(k);
    }
  });

  let simulatedGisResponse = null;
  let simulatedGisPopupError = null;
  let requestedScope = null;

  const mockGisOAuth2 = {
    initTokenClient(cfg) {
      requestedScope = cfg.scope;
      return {
        requestAccessToken() {
          if (simulatedGisPopupError) {
            cfg.error_callback(simulatedGisPopupError);
            return;
          }
          cfg.callback(simulatedGisResponse);
        }
      };
    },
    hasGrantedAllScopes(resp, requiredScope) {
      return String(resp.scope || '').includes(requiredScope);
    }
  };

  const mockDrive = createMockGoogleDriveEnvironment();
  const client = WebDriveSync.createAttendanceDriveSyncClient({
    window: {
      localStorage: makeStorage(fakeLocalStorage),
      sessionStorage: makeStorage(fakeSessionStorage),
      google: { accounts: { oauth2: mockGisOAuth2 } }
    },
    backendFetch: createAuthenticatedBackendFetch(teacherAToken),
    driveFetch: mockDrive.driveFetch
  });

  // 1. Attempting interactive authorization without userGesture=true is rejected
  await assert.rejects(
    async () => {
      await client.requestAuthorization({ userGesture: false });
    },
    (err) => err && err.code === 'USER_GESTURE_REQUIRED'
  );

  // 2. User closes popup or cancels consent -> OAUTH_CANCELLED
  simulatedGisPopupError = { type: 'popup_closed' };
  await assert.rejects(
    async () => {
      await client.requestAuthorization({ userGesture: true });
    },
    (err) => err && err.code === 'OAUTH_CANCELLED'
  );
  simulatedGisPopupError = null;

  simulatedGisResponse = { error: 'access_denied', error_description: 'User denied access toya29.a0AfH6SMBx_secret' };
  await assert.rejects(
    async () => {
      await client.requestAuthorization({ userGesture: true });
    },
    (err) => {
      assert.equal(err.code, 'OAUTH_CANCELLED');
      assert.ok(!err.message.includes('ya29.'), 'Error message must scrub any token pattern');
      return true;
    }
  );

  // 3. Missing drive.file scope -> OAUTH_SCOPE_MISSING
  simulatedGisResponse = {
    access_token: 'ya29.a0AfH6SMBx_wrong_scope_token',
    expires_in: 3600,
    scope: 'email profile'
  };
  await assert.rejects(
    async () => {
      await client.requestAuthorization({ userGesture: true });
    },
    (err) => err && err.code === 'OAUTH_SCOPE_MISSING'
  );

  // 4. Successful authorization with narrow drive.file scope
  const validToken = 'ya29.a0AfH6SMBx_mock_valid_teacher_drive_token_123456';
  simulatedGisResponse = {
    access_token: validToken,
    expires_in: 3600,
    scope: 'https://www.googleapis.com/auth/drive.file'
  };

  const authRes = await client.requestAuthorization({ userGesture: true });
  assert.equal(authRes.authorized, true);
  assert.equal(requestedScope, 'https://www.googleapis.com/auth/drive.file');
  assert.equal(client.hasValidAccessToken(), true);

  // Verify token is NEVER stored in localStorage or sessionStorage
  assert.equal(fakeLocalStorage.size, 0, 'Access token must never be stored in localStorage');
  assert.equal(fakeSessionStorage.size, 0, 'Access token must never be stored in sessionStorage');

  // Verify client-side assertNoSecretsInBackendPayload blocks any accidental token key or pattern
  assert.throws(
    () => {
      client.assertNoSecretsInBackendPayload({ accessToken: validToken });
    },
    (err) => err && err.code === 'SENSITIVE_TOKEN_FORBIDDEN'
  );
  assert.throws(
    () => {
      client.assertNoSecretsInBackendPayload({ rootFolderId: validToken });
    },
    (err) => err && err.code === 'SENSITIVE_TOKEN_FORBIDDEN'
  );
});

// ============================================================================
// 3. IDEMPOTENT FOLDER PROVISIONING, REUSE, SEARCH & CROSS-DEVICE SYNC
// ============================================================================

test('Phase 3A Test 3: Idempotent folder creation, saved-ID reuse across devices, search fallback when saved ID is missing/trashed, and concurrent provisioning coalescing', async () => {
  process.env.GOOGLE_DRIVE_WEB_CLIENT_ID = '1234567890-webtest.apps.googleusercontent.com';
  const validToken = 'ya29.a0AfH6SMBx_mock_valid_teacher_drive_token_123456';
  const mockDrive = createMockGoogleDriveEnvironment({ validAccessToken: validToken });

  const device1Client = WebDriveSync.createAttendanceDriveSyncClient({
    clientId: 'web_device_1',
    backendFetch: createAuthenticatedBackendFetch(teacherAToken),
    driveFetch: mockDrive.driveFetch
  });
  device1Client.setAccessTokenForSession({ accessToken: validToken, expiresInSeconds: 3600 });

  // 1. First connection: concurrent calls to ensureFolderHierarchy() coalesce and create exactly 4 folders
  const [prov1A, prov1B] = await Promise.all([
    device1Client.ensureFolderHierarchy(),
    device1Client.ensureFolderHierarchy()
  ]);
  assert.deepEqual(prov1A.folders, prov1B.folders);
  assert.equal(prov1A.resolution.root, 'created');
  assert.equal(prov1A.resolution.daily, 'created');
  assert.equal(prov1A.resolution.full, 'created');
  assert.equal(prov1A.resolution.snapshots, 'created');

  const folderEntries = [...mockDrive.filesById.values()].filter(
    (f) => f.mimeType === 'application/vnd.google-apps.folder'
  );
  assert.equal(folderEntries.length, 4, 'Must create exactly 1 root folder and 3 subfolders');

  // 2. Second device connects for the same teacher: reads saved folder IDs from GET /backup/status and reuses all 4 without creating duplicates
  const device2Client = WebDriveSync.createAttendanceDriveSyncClient({
    clientId: 'web_device_2',
    backendFetch: createAuthenticatedBackendFetch(teacherAToken),
    driveFetch: mockDrive.driveFetch
  });
  device2Client.setAccessTokenForSession({ accessToken: validToken, expiresInSeconds: 3600 });

  const prov2 = await device2Client.ensureFolderHierarchy();
  assert.deepEqual(prov2.folders, prov1A.folders);
  assert.equal(prov2.resolution.root, 'saved_id');
  assert.equal(prov2.resolution.daily, 'saved_id');
  assert.equal(prov2.resolution.full, 'saved_id');
  assert.equal(prov2.resolution.snapshots, 'saved_id');

  // 3. If teacher disconnects with clearFolders=true (wiping DB folder IDs) and reconnects with a fresh token, client searches Drive and reuses existing folders instead of creating duplicates!
  await device1Client.disconnectGoogleDrive({ clearFolders: true });
  assert.ok(mockDrive.revokedTokens.has(validToken), 'Disconnect must revoke the previous OAuth token');
  mockDrive.revokedTokens.clear();
  device1Client.setAccessTokenForSession({ accessToken: validToken, expiresInSeconds: 3600 });

  const provAfterClear = await device1Client.ensureFolderHierarchy();
  assert.deepEqual(provAfterClear.folders, prov1A.folders, 'Must discover and reuse existing Drive folders by search');
  assert.equal(provAfterClear.resolution.root, 'search');
  assert.equal(provAfterClear.resolution.daily, 'search');
  assert.equal(provAfterClear.resolution.full, 'search');
  assert.equal(provAfterClear.resolution.snapshots, 'search');

  const folderCountAfterReconnect = [...mockDrive.filesById.values()].filter(
    (f) => f.mimeType === 'application/vnd.google-apps.folder'
  ).length;
  assert.equal(folderCountAfterReconnect, 4, 'No duplicate folders created on reconnect');
});

// ============================================================================
// 4. END-TO-END WORKER SYNC, LOST COMPLETION RECOVERY & IMMUTABLE SNAPSHOTS
// ============================================================================

test('Phase 3A Test 4: Worker syncs snapshot, daily_workbook, and annual_workbook; recovers from lost completion response without duplicate uploads; preserves v1 snapshot immutability while updating workbooks on v2/v3', async () => {
  process.env.GOOGLE_DRIVE_WEB_CLIENT_ID = '1234567890-webtest.apps.googleusercontent.com';
  const validToken = 'ya29.a0AfH6SMBx_mock_valid_teacher_drive_token_123456';
  const mockDrive = createMockGoogleDriveEnvironment({ validAccessToken: validToken });

  // Simulate a lost completion response on the first attempt to complete 'snapshot'
  const clientWithLostComplete = WebDriveSync.createAttendanceDriveSyncClient({
    clientId: 'worker_lost_complete_test',
    backendFetch: createAuthenticatedBackendFetch(teacherAToken, {
      failFirstCompleteForArtifact: 'snapshot'
    }),
    driveFetch: mockDrive.driveFetch
  });
  clientWithLostComplete.setAccessTokenForSession({ accessToken: validToken, expiresInSeconds: 3600 });

  // First sync attempt:
  // - 'snapshot' uploads to Drive, but POST /complete fails with 502 (lost completion response)
  // - 'daily_workbook' and 'annual_workbook' upload and complete cleanly!
  const firstSync = await clientWithLostComplete.syncPendingWork({ forceRetry: true });
  assert.equal(firstSync.synced, false);
  assert.equal(firstSync.completedArtifacts, 2);
  assert.equal(firstSync.failedArtifacts, 1);

  const snapshotCreatesAfterFirst = mockDrive.uploadHistory.filter(
    (u) => u.artifactType === 'snapshot' && u.op === 'create'
  );
  assert.equal(snapshotCreatesAfterFirst.length, 1, 'Snapshot was uploaded to Drive once');

  // Second sync attempt (retry after lost completion response):
  // Worker finds the already-uploaded snapshot in Drive via appProperties (`slScopeKey`), verifies its SHA-256 matches,
  // and completes the artifact WITHOUT creating a duplicate file or overwriting the snapshot!
  const retrySync = await clientWithLostComplete.syncPendingWork({ forceRetry: true });
  assert.equal(retrySync.synced, true);
  assert.equal(retrySync.status, 'backed_up');
  assert.equal(retrySync.completedArtifacts, 1);
  assert.equal(retrySync.runs[0].artifacts[0].artifactType, 'snapshot');
  assert.equal(retrySync.runs[0].artifacts[0].reusedExistingFile, true);

  const snapshotCreatesAfterRetry = mockDrive.uploadHistory.filter(
    (u) => u.artifactType === 'snapshot' && u.op === 'create'
  );
  assert.equal(snapshotCreatesAfterRetry.length, 1, 'Lost completion recovery must not create duplicate snapshot files');

  // Now create a v2 teacher edit and v3 admin correction while a historical session is also created
  // Create a session for BSM111 on YESTERDAY_NEPAL (v1: both present)
  const bsmSaveRes = await appFetch(`${baseUrl}/api/attendance/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      subjectId: 'BSM111',
      cohortId: cohortMercury.id,
      sessionDate: YESTERDAY_NEPAL,
      records: [
        { studentId: 'stu_p3a_1', status: 'present' },
        { studentId: 'stu_p3a_2', status: 'present' }
      ]
    })
  });
  assert.equal(bsmSaveRes.status, 201);
  const bsmV1Data = await bsmSaveRes.json();
  const bsmSessionId = bsmV1Data.session.id;
  const bsmV1Sha = bsmV1Data.backupRevision.snapshotSha256;

  // Before syncing v1, teacher edits session to v2 (stu_p3a_2 -> absent), and admin corrects to v3 (stu_p3a_1 -> absent)
  const bsmV2Res = await appFetch(`${baseUrl}/api/attendance/sessions/${bsmSessionId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      reason: 'Teacher edit to v2',
      records: [
        { studentId: 'stu_p3a_1', status: 'present' },
        { studentId: 'stu_p3a_2', status: 'absent' }
      ]
    })
  });
  assert.equal(bsmV2Res.status, 200);
  const bsmV2Sha = (await bsmV2Res.json()).backupRevision.snapshotSha256;

  const bsmV3Res = await appFetch(`${baseUrl}/api/attendance/admin/sessions/${bsmSessionId}/correct`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      reason: 'Admin correction to v3',
      records: [
        { studentId: 'stu_p3a_1', status: 'absent' },
        { studentId: 'stu_p3a_2', status: 'absent' }
      ]
    })
  });
  assert.equal(bsmV3Res.status, 200);
  const bsmV3Sha = (await bsmV3Res.json()).backupRevision.snapshotSha256;

  // Run syncPendingWork():
  // - v1 and v2 runs must upload ONLY their immutable historical snapshots (their daily/annual workbooks are superseded by v3!)
  // - v3 run uploads its v3 snapshot AND updates the daily workbook and annual workbook in place!
  const multiRevSync = await clientWithLostComplete.syncPendingWork({ forceRetry: true });
  assert.equal(multiRevSync.synced, true);
  assert.equal(multiRevSync.status, 'backed_up');

  // Inspect all snapshot files stored in Mock Google Drive
  const storedSnapshots = [...mockDrive.filesById.values()].filter(
    (f) => f.appProperties && f.appProperties.slArtifactType === 'snapshot' && f.appProperties.slSessionId === bsmSessionId
  );
  assert.equal(storedSnapshots.length, 3, 'All 3 historical revisions (v1, v2, v3) must exist as distinct immutable snapshot files in Drive');

  const snapByRev = new Map(storedSnapshots.map((s) => [Number(s.appProperties.slRevisionNo), s]));
  const snapV1Payload = JSON.parse(snapByRev.get(1).contentBytes.toString('utf8'));
  const snapV2Payload = JSON.parse(snapByRev.get(2).contentBytes.toString('utf8'));
  const snapV3Payload = JSON.parse(snapByRev.get(3).contentBytes.toString('utf8'));

  assert.equal(computeCanonicalSnapshotHash(snapV1Payload), bsmV1Sha);
  assert.equal(computeCanonicalSnapshotHash(snapV2Payload), bsmV2Sha);
  assert.equal(computeCanonicalSnapshotHash(snapV3Payload), bsmV3Sha);

  // Verify v1 snapshot in Drive still has both students 'present' (not reconstructed from v3!)
  assert.deepEqual(
    snapV1Payload.records.map((r) => r.status),
    ['present', 'present']
  );
  assert.deepEqual(
    snapV2Payload.records.map((r) => r.status),
    ['present', 'absent']
  );
  assert.deepEqual(
    snapV3Payload.records.map((r) => r.status),
    ['absent', 'absent']
  );

  // Verify annual workbook was updated in place via PATCH (not duplicated) and parses as a valid XLSX containing both CIT111 and BSM111
  const annualFiles = [...mockDrive.filesById.values()].filter(
    (f) => f.appProperties && f.appProperties.slArtifactType === 'annual_workbook'
  );
  assert.equal(annualFiles.length, 1, 'Annual workbook must be updated in place (single Drive file)');
  assert.equal(annualFiles[0].version, 2, 'Annual workbook was created on run 1 and updated via PATCH on BSM111 v3');
  const parsedAnnual = parseXlsxWorkbookBuffer(annualFiles[0].contentBytes);
  assert.ok(parsedAnnual.sheetNames.includes('Session Overview'));
  assert.ok(parsedAnnual.sheetNames.includes('Audit & Revisions'));
});

// ============================================================================
// 5. TOKEN EXPIRY MID-SYNC, PARTIAL FAILURE, DISCONNECT & RECONNECT RECOVERY
// ============================================================================

test('Phase 3A Test 5: Partial artifact failure preserves completed siblings; token expiry transitions connection to reconnect_required; reconnect recovers pending work', async () => {
  process.env.GOOGLE_DRIVE_WEB_CLIENT_ID = '1234567890-webtest.apps.googleusercontent.com';
  const validToken = 'ya29.a0AfH6SMBx_mock_valid_teacher_drive_token_123456';
  const mockDrive = createMockGoogleDriveEnvironment({ validAccessToken: validToken });

  const client = WebDriveSync.createAttendanceDriveSyncClient({
    clientId: 'worker_failure_recovery_test',
    backendFetch: createAuthenticatedBackendFetch(teacherAToken),
    driveFetch: mockDrive.driveFetch
  });
  client.setAccessTokenForSession({ accessToken: validToken, expiresInSeconds: 3600 });
  await client.ensureFolderHierarchy();

  // Create a new session for BSM111 on TODAY_NEPAL
  const saveRes = await appFetch(`${baseUrl}/api/attendance/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      subjectId: 'BSM111',
      cohortId: cohortMercury.id,
      sessionDate: TODAY_NEPAL,
      records: [
        { studentId: 'stu_p3a_1', status: 'present' },
        { studentId: 'stu_p3a_2', status: 'present' }
      ]
    })
  });
  assert.equal(saveRes.status, 201);
  const runId = (await saveRes.json()).backupRevision.id;

  // 1. Simulate Drive 503 failure ONLY on 'daily_workbook'
  mockDrive.setForceFailArtifactType('daily_workbook');
  const partialRes = await client.syncPendingWork({ sessionId: (await client.getStatus()) && undefined, forceRetry: true });
  assert.equal(partialRes.synced, false);
  assert.equal(partialRes.completedArtifacts, 2, 'snapshot and annual_workbook must succeed');
  assert.equal(partialRes.failedArtifacts, 1, 'daily_workbook failed');
  mockDrive.setForceFailArtifactType(null);

  // Verify on server that snapshot and annual_workbook are 'backed_up' while daily_workbook is 'failed' (with redacted error message)
  const artCheck1 = await appFetch(`${baseUrl}/api/attendance/backup/runs/${runId}/artifacts`, {
    headers: { Authorization: `Bearer ${teacherAToken}` }
  });
  const artData1 = await artCheck1.json();
  const byType1 = new Map(artData1.artifacts.map((a) => [a.artifactType, a]));
  assert.equal(byType1.get('snapshot').status, 'backed_up');
  assert.equal(byType1.get('annual_workbook').status, 'backed_up');
  assert.equal(byType1.get('daily_workbook').status, 'failed');
  assert.ok(!String(byType1.get('daily_workbook').lastErrorMessage).includes(validToken), 'Token must be scrubbed from failure message');

  // 2. Simulate 401 token expiry on the next Drive upload call (after folder check)
  mockDrive.setForceFailArtifactType(null);
  mockDrive.setForceFailUploadStatus(401);

  const authExpiredSync = await client.syncPendingWork({ forceRetry: true });
  assert.equal(authExpiredSync.synced, false);
  assert.equal(authExpiredSync.reconnectRequired, true);
  assert.equal(authExpiredSync.status, 'reconnect_required');
  assert.equal(client.hasValidAccessToken(), false, 'Expired token must be cleared from memory');

  // Server connection status and artifact status are now 'reconnect_required', and claiming while in 'reconnect_required' is blocked with 409 DRIVE_RECONNECT_REQUIRED
  const statusAfterExpiry = await client.getStatus();
  assert.equal(statusAfterExpiry.connection.connectionStatus, 'reconnect_required');

  const artCheckAfterExpiry = await appFetch(`${baseUrl}/api/attendance/backup/runs/${runId}/artifacts`, {
    headers: { Authorization: `Bearer ${teacherAToken}` }
  });
  const artDataAfterExpiry = await artCheckAfterExpiry.json();
  const byTypeAfterExpiry = new Map(artDataAfterExpiry.artifacts.map((a) => [a.artifactType, a]));
  assert.equal(byTypeAfterExpiry.get('daily_workbook').status, 'reconnect_required');

  const blockedClaimRes = await appFetch(`${baseUrl}/api/attendance/backup/runs/${runId}/claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({ clientId: 'rogue_worker', forceRetry: true })
  });
  assert.equal(blockedClaimRes.status, 409);
  assert.equal((await blockedClaimRes.json()).code, 'DRIVE_RECONNECT_REQUIRED');

  // 3. Reconnect with fresh token -> resets 'reconnect_required' artifacts to 'pending' and completes the remaining 'daily_workbook' without re-uploading completed siblings!
  client.setAccessTokenForSession({ accessToken: validToken, expiresInSeconds: 3600 });
  await client.ensureFolderHierarchy();

  const recoveredSync = await client.syncPendingWork({ forceRetry: true });
  assert.equal(recoveredSync.synced, true);
  assert.equal(recoveredSync.status, 'backed_up');
  assert.equal(recoveredSync.completedArtifacts, 1, 'Only the remaining daily_workbook needed to be uploaded');

  // 4. Verify disconnect revokes token and server blocks claims while disconnected
  const discRes = await client.disconnectGoogleDrive();
  assert.equal(discRes.disconnected, true);
  assert.equal(discRes.connection.connectionStatus, 'disconnected');
  assert.ok(mockDrive.revokedTokens.has(validToken), 'Disconnect must revoke OAuth token with Google');

  // Audit every backend request sent during the entire test file: ZERO tokens or forbidden keys ever sent to backend!
  for (const reqEntry of backendRequestAuditLog) {
    assert.ok(!reqEntry.body.includes(validToken), `Backend request ${reqEntry.method} ${reqEntry.path} must never contain Google OAuth access token`);
    assert.ok(!reqEntry.body.includes('1//0g_mock_refresh_token'), `Backend request ${reqEntry.method} ${reqEntry.path} must never contain refresh token`);
  }
});

// ============================================================================
// 6. MOBILE EXPO SDK 57 NATIVE OAUTH PKCE + SECURE STORE + SYNC WORKER
// ============================================================================

test('Phase 3A Test 6: Mobile OAuth 2.0 Authorization Code with PKCE (S256), platform client IDs, reverse-client-ID redirect URI, SecureStore refresh, and mobile sync worker', async () => {
  const MobileDriveSync = await import('../mobile/services/attendance-drive-sync-core.ts');

  const validToken = 'ya29.a0AfH6SMBx_mobile_pkce_valid_token_987654';
  const mockDrive = createMockGoogleDriveEnvironment({ validAccessToken: validToken });

  // Reconnect Teacher A on backend for mobile test
  const twoDaysAgoNepal = formatNepalDate(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000));
  await appFetch(`${baseUrl}/api/attendance/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      subjectId: 'CIT111',
      cohortId: cohortMercury.id,
      sessionDate: twoDaysAgoNepal,
      records: [
        { studentId: 'stu_p3a_1', status: 'present' },
        { studentId: 'stu_p3a_2', status: 'present' }
      ]
    })
  });

  const secureStoreMap = new Map();
  const mockSecureStore = {
    async getItemAsync(k) {
      return secureStoreMap.get(k) || null;
    },
    async setItemAsync(k, v) {
      secureStoreMap.set(k, String(v));
    },
    async deleteItemAsync(k) {
      secureStoreMap.delete(k);
    }
  };

  let capturedAuthUrl = '';
  let capturedRedirectUri = '';
  let simulateCancel = false;

  const iosClientId = '9988776655-iosfaculty.apps.googleusercontent.com';
  const expectedIosRedirectUri = 'com.googleusercontent.apps.9988776655-iosfaculty:/oauthredirect';

  const mobileClient = MobileDriveSync.createMobileAttendanceDriveSyncCore({
    platform: 'ios',
    iosClientId,
    androidClientId: '9988776655-androidfaculty.apps.googleusercontent.com',
    driveFetch: mockDrive.driveFetch,
    backendFetch: createAuthenticatedBackendFetch(teacherAToken),
    secureStore: mockSecureStore,
    openAuthSessionAsync: async (authUrl, redirectUri) => {
      capturedAuthUrl = authUrl;
      capturedRedirectUri = redirectUri;
      if (simulateCancel) {
        return { type: 'cancel' };
      }
      const parsed = new URL(authUrl);
      const state = parsed.searchParams.get('state');
      return {
        type: 'success',
        url: `${redirectUri}?code=4/0AdQt8qh_mock_pkce_auth_code&state=${encodeURIComponent(state)}&scope=${encodeURIComponent(MobileDriveSync.DRIVE_FILE_SCOPE)}`
      };
    }
  });

  // 1. Verify platform client ID and reverse-client-ID redirect URI resolution
  const resolvedCfg = mobileClient.resolveOAuthConfig();
  assert.equal(resolvedCfg.platform, 'ios');
  assert.equal(resolvedCfg.configured, true);
  assert.equal(resolvedCfg.activeClientId, iosClientId);
  assert.equal(resolvedCfg.redirectUri, expectedIosRedirectUri);

  // 2. Verify user cancellation handling on mobile
  simulateCancel = true;
  await assert.rejects(
    async () => {
      await mobileClient.requestAuthorization();
    },
    (err) => err && err.code === 'OAUTH_CANCELLED'
  );
  simulateCancel = false;

  // 3. Connect Google Drive via Authorization Code + PKCE (S256)
  const connectRes = await mobileClient.connectGoogleDrive();
  assert.equal(connectRes.connected, true);
  assert.equal(capturedRedirectUri, expectedIosRedirectUri);

  const parsedAuthUrl = new URL(capturedAuthUrl);
  assert.equal(parsedAuthUrl.searchParams.get('client_id'), iosClientId);
  assert.equal(parsedAuthUrl.searchParams.get('response_type'), 'code');
  assert.equal(parsedAuthUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(parsedAuthUrl.searchParams.get('code_challenge').length >= 43, 'PKCE S256 code_challenge must be present');

  // Verify access token is ONLY in memory while refresh token is stored in SecureStore (never sent to backend)
  assert.equal(
    secureStoreMap.get(MobileDriveSync.SECURE_STORE_REFRESH_TOKEN_KEY),
    '1//0g_mock_refresh_token_secure_store_only'
  );
  assert.ok(
    ![...secureStoreMap.values()].some((v) => v.includes(validToken)),
    'Short-lived access token must remain in memory and not be persisted in SecureStore'
  );

  // 4. Clear in-memory access token and verify mobile worker silently refreshes using SecureStore refresh token and syncs pending run!
  await mobileClient.clearTokens({ deleteRefreshToken: false });
  assert.equal(mobileClient.hasValidAccessToken(), false);

  const mobileSyncRes = await mobileClient.syncPendingWork({ forceRetry: true });
  assert.equal(mobileSyncRes.synced, true);
  assert.equal(mobileSyncRes.status, 'backed_up');
  assert.equal(mobileSyncRes.completedArtifacts, 3);
  assert.equal(mobileClient.hasValidAccessToken(), true, 'Access token was refreshed via SecureStore refresh_token');
});

// ============================================================================
// 7. MULTI-SESSION AGGREGATE WORKBOOK FRESHNESS, SNAPSHOT CONFLICT & SCOPED MATCHING
// ============================================================================

test('Phase 3A Test 7: Aggregate workbook revision safety across multiple sessions, immutable snapshot conflict protection, and scoped existing file matching', async () => {
  process.env.GOOGLE_DRIVE_WEB_CLIENT_ID = '1234567890-webtest.apps.googleusercontent.com';
  const validToken = 'ya29.a0AfH6SMBx_mock_valid_teacher_drive_token_123456';
  const mockDrive = createMockGoogleDriveEnvironment({ validAccessToken: validToken });

  const threeDaysAgoNepal = formatNepalDate(new Date(Date.now() - 3 * 24 * 60 * 60 * 1000));

  // Create Session 1 (CIT111) on threeDaysAgoNepal (v1)
  const s1Res = await appFetch(`${baseUrl}/api/attendance/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      subjectId: 'CIT111',
      cohortId: cohortMercury.id,
      sessionDate: threeDaysAgoNepal,
      records: [
        { studentId: 'stu_p3a_1', status: 'present' },
        { studentId: 'stu_p3a_2', status: 'present' }
      ]
    })
  });
  assert.equal(s1Res.status, 201);
  const s1Data = await s1Res.json();
  const s1RunId = s1Data.backupRevision.id;

  // Fetch the 1-session workbook bundle BEFORE Session 2 is created (simulating a stale worker that fetched early)
  const staleBundleRes = await appFetch(
    `${baseUrl}/api/attendance/backup/runs/${s1RunId}/artifacts?includePayloads=1`,
    { headers: { Authorization: `Bearer ${teacherAToken}` } }
  );
  const staleRunBundle = await staleBundleRes.json();
  assert.equal(staleRunBundle.workbooks.daily.bundle.aggregateSessionCount, 1);
  assert.equal(staleRunBundle.workbooks.daily.bundle.aggregateRevisionSum, 1);

  // Now create Session 2 (BSM111) on the SAME date (threeDaysAgoNepal) and edit it to v2!
  const s2Res = await appFetch(`${baseUrl}/api/attendance/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      subjectId: 'BSM111',
      cohortId: cohortMercury.id,
      sessionDate: threeDaysAgoNepal,
      records: [
        { studentId: 'stu_p3a_1', status: 'present' },
        { studentId: 'stu_p3a_2', status: 'absent' }
      ]
    })
  });
  assert.equal(s2Res.status, 201);
  const s2SessionId = (await s2Res.json()).session.id;

  const s2EditRes = await appFetch(`${baseUrl}/api/attendance/sessions/${s2SessionId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      reason: 'Update BSM111 to v2 on same date',
      records: [
        { studentId: 'stu_p3a_1', status: 'absent' },
        { studentId: 'stu_p3a_2', status: 'absent' }
      ]
    })
  });
  assert.equal(s2EditRes.status, 200);
  const s2V2RunId = (await s2EditRes.json()).backupRevision.id;

  const client = WebDriveSync.createAttendanceDriveSyncClient({
    clientId: 'worker_aggregate_workbook_test',
    backendFetch: createAuthenticatedBackendFetch(teacherAToken),
    driveFetch: mockDrive.driveFetch
  });
  client.setAccessTokenForSession({ accessToken: validToken, expiresInSeconds: 3600 });
  const prov = await client.ensureFolderHierarchy();

  // Sync Session 2 (v2) first so the Daily Workbook in Drive now contains BOTH sessions (aggregateSessionCount=2, aggregateRevisionSum=3)
  const syncS2 = await client.syncPendingWork({ sessionId: s2SessionId, forceRetry: true });
  assert.equal(syncS2.synced, true);

  const dailyFileInDrive = [...mockDrive.filesById.values()].find(
    (f) =>
      f.appProperties &&
      f.appProperties.slArtifactType === 'daily_workbook' &&
      f.appProperties.slScopeKey === `daily:tea_p3a_id:${threeDaysAgoNepal}`
  );
  assert.ok(dailyFileInDrive, 'Daily workbook for threeDaysAgoNepal must exist in Drive');
  assert.equal(dailyFileInDrive.appProperties.slAggregateSessionCount, '2');
  assert.equal(dailyFileInDrive.appProperties.slAggregateRevSum, '3');
  const newerWorkbookSha = dailyFileInDrive.sha256Checksum;

  // Scenario 9 (Multi-Session Aggregate Stale Workbook Guard):
  // If a stale worker attempts to upload the old 1-session workbook bundle (`aggregateSessionCount=1, aggregateRevisionSum=1`)
  // over the existing 2-session Drive workbook (`slAggregateSessionCount=2, slAggregateRevSum=3`), it MUST be rejected with STALE_REVISION_WORKBOOK!
  await assert.rejects(
    async () => {
      await client.uploadOrReconcileArtifactToDrive({
        artifactMeta: staleRunBundle.artifacts.find((a) => a.artifactType === 'daily_workbook'),
        claimedItem: { artifactType: 'daily_workbook', driveFileName: staleRunBundle.workbooks.daily.filename },
        runBundle: staleRunBundle,
        folders: prov.folders
      });
    },
    (err) => err && err.code === 'STALE_REVISION_WORKBOOK'
  );
  assert.equal(
    dailyFileInDrive.sha256Checksum,
    newerWorkbookSha,
    'Newer multi-session Drive workbook must NEVER be overwritten by a stale 1-session bundle'
  );

  // When Session 1's run is synced normally (fetching the fresh aggregate bundle from server), it sees the identical 2-session SHA-256 and reuses the Drive file without re-uploading!
  const syncS1 = await client.syncPendingWork({ sessionId: s1Data.session.id, forceRetry: true });
  assert.equal(syncS1.synced, true);
  const s1RunSummary = syncS1.runs.find((r) => r.runId === s1RunId);
  const s1DailyOutcome = s1RunSummary.artifacts.find((a) => a.artifactType === 'daily_workbook');
  assert.equal(s1DailyOutcome.status, 'backed_up');
  assert.equal(s1DailyOutcome.reusedExistingFile, true);

  // Scenario 7 (Immutable Snapshot Hash Conflict):
  // If an existing snapshot file in Drive has the same scopeKey (`session:<id>:v1`) but a tampered/conflicting SHA-256,
  // uploadOrReconcileArtifactToDrive MUST refuse to overwrite it and throw IMMUTABLE_SNAPSHOT_CONFLICT.
  const s1SnapFile = [...mockDrive.filesById.values()].find(
    (f) =>
      f.appProperties &&
      f.appProperties.slArtifactType === 'snapshot' &&
      f.appProperties.slScopeKey === `session:${s1Data.session.id}:v1`
  );
  assert.ok(s1SnapFile);
  const originalSnapSha = s1SnapFile.appProperties.slArtifactSha256;
  s1SnapFile.appProperties.slArtifactSha256 = 'f'.repeat(64);

  await assert.rejects(
    async () => {
      await client.uploadOrReconcileArtifactToDrive({
        artifactMeta: staleRunBundle.artifacts.find((a) => a.artifactType === 'snapshot'),
        claimedItem: { artifactType: 'snapshot', driveFileName: staleRunBundle.snapshot.filename },
        runBundle: staleRunBundle,
        folders: prov.folders
      });
    },
    (err) => err && err.code === 'IMMUTABLE_SNAPSHOT_CONFLICT'
  );
  s1SnapFile.appProperties.slArtifactSha256 = originalSnapSha;

  // Defect 2 Verification (Scoped Existing File Matching):
  // Place a decoy file in the Daily Attendance folder with the same filename `Attendance_Daily_${threeDaysAgoNepal}.xlsx`
  // but belonging to a DIFFERENT scope (`daily:other_teacher:${threeDaysAgoNepal}`).
  // Verify findExistingArtifactFile ignores the wrong-scope file and selects only the file with matching `slScopeKey`.
  mockDrive.filesById.set('decoy_wrong_scope_file', {
    id: 'decoy_wrong_scope_file',
    name: `Attendance_Daily_${threeDaysAgoNepal}.xlsx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    parents: [prov.folders.dailyFolderId],
    appProperties: {
      slApp: 'semester_library',
      slArtifactType: 'daily_workbook',
      slScopeKey: `daily:other_teacher:${threeDaysAgoNepal}`
    },
    trashed: false,
    createdTime: '2020-01-01T00:00:00.000Z'
  });

  const matchedFile = await client.findExistingArtifactFile({
    folderId: prov.folders.dailyFolderId,
    savedDriveFileId: 'decoy_wrong_scope_file',
    artifactType: 'daily_workbook',
    targetScopeKey: `daily:tea_p3a_id:${threeDaysAgoNepal}`,
    driveFileName: `Attendance_Daily_${threeDaysAgoNepal}.xlsx`
  });
  assert.equal(matchedFile.id, dailyFileInDrive.id, 'Must reject decoy file with mismatched slScopeKey even if passed as savedDriveFileId');
});

// ============================================================================
// 8. WORKER CRASH RECOVERY, TWO-CLIENT CONTENTION, STALE LEASE & IN-FLIGHT DISCONNECT
// ============================================================================

test('Phase 3A Test 8: Worker crash before completion, two-client concurrent claim contention, stale lease expiration in flight, and in-flight upload followed by disconnect/reconnect', async () => {
  process.env.GOOGLE_DRIVE_WEB_CLIENT_ID = '1234567890-webtest.apps.googleusercontent.com';
  const validToken = 'ya29.a0AfH6SMBx_mock_valid_teacher_drive_token_123456';
  const mockDrive = createMockGoogleDriveEnvironment({ validAccessToken: validToken });

  const fourDaysAgoNepal = formatNepalDate(new Date(Date.now() - 4 * 24 * 60 * 60 * 1000));
  const saveRes = await appFetch(`${baseUrl}/api/attendance/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      subjectId: 'CIT111',
      cohortId: cohortMercury.id,
      sessionDate: fourDaysAgoNepal,
      records: [
        { studentId: 'stu_p3a_1', status: 'present' },
        { studentId: 'stu_p3a_2', status: 'absent' }
      ]
    })
  });
  assert.equal(saveRes.status, 201);
  const saveData = await saveRes.json();
  const sessionId = saveData.session.id;
  const runId = saveData.backupRevision.id;

  const clientA = WebDriveSync.createAttendanceDriveSyncClient({
    clientId: 'worker_client_A',
    backendFetch: createAuthenticatedBackendFetch(teacherAToken),
    driveFetch: mockDrive.driveFetch
  });
  clientA.setAccessTokenForSession({ accessToken: validToken, expiresInSeconds: 3600 });
  const prov = await clientA.ensureFolderHierarchy();

  // Scenario 4 & 5: Two clients attempt the same run; Client A claims with a short 1000ms lease
  const claimARes = await appFetch(`${baseUrl}/api/attendance/backup/runs/${runId}/claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      clientId: 'worker_client_A',
      leaseDurationMs: 1000,
      revisionNo: 1,
      snapshotSha256: saveData.backupRevision.snapshotSha256
    })
  });
  assert.equal(claimARes.status, 200);
  const claimAData = await claimARes.json();
  assert.equal(claimAData.claimed, true);
  assert.equal(claimAData.claimedArtifacts.length, 3);

  // Client B attempts to claim the same run while Client A's lease is active -> rejected with 409 CLAIM_CONFLICT
  const claimBWhileActiveRes = await appFetch(`${baseUrl}/api/attendance/backup/runs/${runId}/claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      clientId: 'worker_client_B',
      leaseDurationMs: 60000,
      revisionNo: 1,
      snapshotSha256: saveData.backupRevision.snapshotSha256
    })
  });
  assert.equal(claimBWhileActiveRes.status, 409);
  const claimBWhileActiveData = await claimBWhileActiveRes.json();
  assert.equal(claimBWhileActiveData.code, 'CLAIM_LEASE_ACTIVE');

  // Scenario 3: Client A uploads the snapshot to Google Drive, then "crashes" before calling /complete!
  const bundleRes = await appFetch(
    `${baseUrl}/api/attendance/backup/runs/${runId}/artifacts?includePayloads=1`,
    { headers: { Authorization: `Bearer ${teacherAToken}` } }
  );
  const runBundle = await bundleRes.json();
  const snapClaimA = claimAData.claimedArtifacts.find((a) => a.artifactType === 'snapshot');

  const uploadedByCrashedWorker = await clientA.uploadOrReconcileArtifactToDrive({
    artifactMeta: runBundle.artifacts.find((a) => a.artifactType === 'snapshot'),
    claimedItem: snapClaimA,
    runBundle,
    folders: prov.folders
  });
  assert.equal(uploadedByCrashedWorker.reusedExistingFile, false);

  // Wait 1100ms for Client A's 1000ms lease to expire
  await new Promise((r) => setTimeout(r, 1100));

  // Scenario 5: Client A wakes up after lease expiry and tries to call /complete with its expired lease -> rejected with 409 CLAIM_LEASE_EXPIRED
  const expiredCompleteRes = await appFetch(`${baseUrl}/api/attendance/backup/runs/${runId}/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      artifactType: 'snapshot',
      claimToken: snapClaimA.claimToken,
      revisionNo: 1,
      snapshotSha256: saveData.backupRevision.snapshotSha256,
      driveFileId: uploadedByCrashedWorker.driveFileId,
      driveFileName: uploadedByCrashedWorker.driveFileName,
      artifactSha256: uploadedByCrashedWorker.artifactSha256
    })
  });
  assert.equal(expiredCompleteRes.status, 409);
  assert.equal((await expiredCompleteRes.json()).code, 'CLAIM_LEASE_EXPIRED');

  // Step 6: In-flight upload followed by teacher disconnect before completion:
  // Suppose teacher disconnects right now while artifacts are still uncompleted.
  await clientA.disconnectGoogleDrive();
  mockDrive.revokedTokens.clear();

  // Attempting to complete while disconnected is rejected with 409 DRIVE_DISCONNECTED
  const completeWhileDisconnectedRes = await appFetch(`${baseUrl}/api/attendance/backup/runs/${runId}/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      artifactType: 'snapshot',
      claimToken: snapClaimA.claimToken,
      revisionNo: 1,
      snapshotSha256: saveData.backupRevision.snapshotSha256,
      driveFileId: uploadedByCrashedWorker.driveFileId,
      driveFileName: uploadedByCrashedWorker.driveFileName,
      artifactSha256: uploadedByCrashedWorker.artifactSha256
    })
  });
  assert.equal(completeWhileDisconnectedRes.status, 409);
  assert.equal((await completeWhileDisconnectedRes.json()).code, 'DRIVE_DISCONNECTED');

  // Now Client B reconnects and runs syncPendingWork:
  // It claims the run (rotating claimToken), discovers the snapshot already uploaded by crashed Client A via appProperties,
  // reuses `uploadedByCrashedWorker.driveFileId` without re-uploading, and completes all 3 artifacts!
  const clientB = WebDriveSync.createAttendanceDriveSyncClient({
    clientId: 'worker_client_B',
    backendFetch: createAuthenticatedBackendFetch(teacherAToken),
    driveFetch: mockDrive.driveFetch
  });
  clientB.setAccessTokenForSession({ accessToken: validToken, expiresInSeconds: 3600 });
  await clientB.ensureFolderHierarchy();

  const syncBRes = await clientB.syncPendingWork({ sessionId, forceRetry: true });
  assert.equal(syncBRes.synced, true);
  assert.equal(syncBRes.status, 'backed_up');
  const runSummaryB = syncBRes.runs.find((r) => r.runId === runId);
  const snapOutcomeB = runSummaryB.artifacts.find((a) => a.artifactType === 'snapshot');
  assert.equal(snapOutcomeB.driveFileId, uploadedByCrashedWorker.driveFileId);
  assert.equal(snapOutcomeB.reusedExistingFile, true, 'Client B must reconcile the file uploaded before crash/disconnect without re-uploading');
});

// ============================================================================
// 9. WEB STORAGE SCOPING & MOBILE PKCE CSRF STATE / EXPIRY / REPLAY HARDENING
// ============================================================================

test('Phase 3A Test 9: Web storage cleanup preserves unrelated keys; Mobile PKCE enforces CSRF state match, TTL expiration, missing-code rejection, and single-flight auth coalescing', async () => {
  // 1. Web storage cleanup must NEVER delete unrelated application keys
  const fakeLocal = new Map([
    ['semester_library_theme', 'dark'],
    ['google_drive_unrelated_app_pref', 'keep_me'],
    ['sl_attendance_drive_oauth_token', 'ya29.should_be_removed']
  ]);
  const makeStorage = (map) => ({
    get length() {
      return map.size;
    },
    key(idx) {
      return [...map.keys()][idx] || null;
    },
    getItem(k) {
      return map.get(k) || null;
    },
    setItem(k, v) {
      map.set(k, String(v));
    },
    removeItem(k) {
      map.delete(k);
    }
  });

  const mockDrive = createMockGoogleDriveEnvironment();
  WebDriveSync.createAttendanceDriveSyncClient({
    window: {
      localStorage: makeStorage(fakeLocal),
      sessionStorage: makeStorage(new Map())
    },
    backendFetch: createAuthenticatedBackendFetch(teacherAToken),
    driveFetch: mockDrive.driveFetch
  });

  assert.equal(fakeLocal.get('semester_library_theme'), 'dark', 'Unrelated app storage key must be preserved');
  assert.equal(fakeLocal.get('google_drive_unrelated_app_pref'), 'keep_me', 'Unrelated google_drive preference key must not be deleted');
  assert.equal(fakeLocal.has('sl_attendance_drive_oauth_token'), false, 'Feature-owned token key must be purged');

  // 2. Mobile PKCE CSRF state mismatch, TTL expiration, and missing code handling
  const MobileDriveSync = await import('../mobile/services/attendance-drive-sync-core.ts');
  let clockMs = Date.now();
  let redirectBehavior = 'state_mismatch';
  let openAuthCallCount = 0;

  const mobileClient = MobileDriveSync.createMobileAttendanceDriveSyncCore({
    platform: 'android',
    androidClientId: '4455667788-androidtest.apps.googleusercontent.com',
    now: () => clockMs,
    driveFetch: mockDrive.driveFetch,
    backendFetch: createAuthenticatedBackendFetch(teacherAToken),
    openAuthSessionAsync: async (authUrl, redirectUri) => {
      openAuthCallCount += 1;
      const parsed = new URL(authUrl);
      const state = parsed.searchParams.get('state');

      if (redirectBehavior === 'state_mismatch') {
        return {
          type: 'success',
          url: `${redirectUri}?code=4/mock_code&state=wrong_tampered_state`
        };
      }
      if (redirectBehavior === 'expired_ttl') {
        // Advance clock by 11 minutes (> 10 minute PKCE_STATE_TTL_MS) before browser returns
        clockMs += 11 * 60 * 1000;
        return {
          type: 'success',
          url: `${redirectUri}?code=4/mock_code&state=${encodeURIComponent(state)}`
        };
      }
      if (redirectBehavior === 'missing_code') {
        return {
          type: 'success',
          url: `${redirectUri}?state=${encodeURIComponent(state)}`
        };
      }
      await new Promise((r) => setTimeout(r, 20));
      return {
        type: 'success',
        url: `${redirectUri}?code=4/mock_valid_code&state=${encodeURIComponent(state)}&scope=${encodeURIComponent(MobileDriveSync.DRIVE_FILE_SCOPE)}`
      };
    }
  });

  assert.equal(
    mobileClient.resolveOAuthConfig().redirectUri,
    'com.googleusercontent.apps.4455667788-androidtest:/oauthredirect'
  );

  redirectBehavior = 'state_mismatch';
  await assert.rejects(
    async () => {
      await mobileClient.requestAuthorization();
    },
    (err) => err && err.code === 'OAUTH_STATE_MISMATCH'
  );

  redirectBehavior = 'expired_ttl';
  await assert.rejects(
    async () => {
      await mobileClient.requestAuthorization();
    },
    (err) => err && err.code === 'OAUTH_STATE_EXPIRED'
  );

  redirectBehavior = 'missing_code';
  await assert.rejects(
    async () => {
      await mobileClient.requestAuthorization();
    },
    (err) => err && err.code === 'OAUTH_CODE_MISSING'
  );

  // Concurrent requestAuthorization calls coalesce into a single interactive browser session
  redirectBehavior = 'valid';
  const beforeCalls = openAuthCallCount;
  const [auth1, auth2] = await Promise.all([
    mobileClient.requestAuthorization({ prompt: 'consent' }),
    mobileClient.requestAuthorization({ prompt: 'consent' })
  ]);
  assert.equal(auth1.authorized, true);
  assert.equal(auth2.authorized, true);
  assert.equal(openAuthCallCount - beforeCalls, 1, 'Concurrent requestAuthorization calls must coalesce into 1 browser session');
});

