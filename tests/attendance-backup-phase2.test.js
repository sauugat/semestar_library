'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const testDbPath = path.join(
  os.tmpdir(),
  `attendance_backup_p2_${Date.now()}_${Math.random().toString(36).slice(2)}.db`
);
process.env.NODE_ENV = 'test';
process.env.DB_PATH = testDbPath;
process.env.SEMESTER_DB_SKIP_INIT = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { PassThrough } = require('stream');
const bcrypt = require('bcryptjs');
const { PGlite } = require('@electric-sql/pglite');

const app = require('../server');
const db = require('../db');
const { createTransactionAdapter } = require('../lib/db-transaction');
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
  editAttendanceSessionById,
  adminCorrectAttendanceSession,
  claimBackupRunArtifacts,
  completeBackupArtifact,
  failBackupArtifact,
  getBackupRunArtifacts,
  generateDailyAttendanceWorkbook,
  generateAnnualAttendanceWorkbook
} = require('../lib/attendance-service');
const {
  sanitizeFormulaCellText,
  sanitizeWorksheetName,
  buildXlsxWorkbookBuffer,
  parseXlsxWorkbookBuffer,
  XLSX_MIME_TYPE
} = require('../lib/attendance-xlsx');
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

const PASSWORD = 'Test_Password123!';
let adminToken = '';
let teacherAToken = '';
let teacherBToken = '';
let student1Token = '';
let cr1Token = '';

let cohortMercury = null;

const TODAY_NEPAL = formatNepalDate(new Date());
const YESTERDAY_NEPAL = formatNepalDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
const TWO_DAYS_AGO_NEPAL = formatNepalDate(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000));
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

  // Admin account
  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, account_status)
     VALUES ('admin_p2', 'admin_p2', 'Admin Phase2', 'adminp2@gandaki.edu.np', 'admin', ?, NULL, 'active')`,
    passwordHash
  );

  // Teacher A: assigned to CIT111 and BSM111 (Semester 1)
  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, department, account_status)
     VALUES ('tea_user_a', 'prof_sharma', 'Prof. Ram Sharma', 'sharma@gandaki.edu.np', 'teacher', ?, NULL, 'BIT', 'active')`,
    passwordHash
  );
  await db.run(
    `INSERT INTO teachers (id, user_id, designation, status)
     VALUES ('tea_id_a', 'tea_user_a', 'Associate Professor', 'active')`
  );
  await db.run(
    `INSERT INTO teacher_subjects (id, teacher_id, subject_id) VALUES ('ts_p2_1', 'tea_id_a', 'CIT111')`
  );
  await db.run(
    `INSERT INTO teacher_subjects (id, teacher_id, subject_id) VALUES ('ts_p2_2', 'tea_id_a', 'BSM111')`
  );

  // Teacher B: assigned ONLY to ELX111 (Semester 1)
  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, department, account_status)
     VALUES ('tea_user_b', 'prof_joshi', 'Prof. Hari Joshi', 'joshi@gandaki.edu.np', 'teacher', ?, NULL, 'BIT', 'active')`,
    passwordHash
  );
  await db.run(
    `INSERT INTO teachers (id, user_id, designation, status)
     VALUES ('tea_id_b', 'tea_user_b', 'Lecturer', 'active')`
  );
  await db.run(
    `INSERT INTO teacher_subjects (id, teacher_id, subject_id) VALUES ('ts_p2_3', 'tea_id_b', 'ELX111')`
  );

  // Students & CR in Mercury Cohort (including one formula-injection test name!)
  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, cohort_id, account_status)
     VALUES ('stu_p2_1', 'aashrita_m', 'Aashrita Mercury', 'm1@gandaki.edu.np', 'student', ?, 'Semester 1', ?, 'active')`,
    passwordHash,
    cohortMercury.id
  );
  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, cohort_id, account_status)
     VALUES ('stu_p2_2', 'ankit_m', '=CMD|'' /C calc''!A0 Ankit', 'm2@gandaki.edu.np', 'cr', ?, 'Semester 1', ?, 'active')`,
    passwordHash,
    cohortMercury.id
  );

  adminToken = await loginMobile('admin_p2');
  teacherAToken = await loginMobile('tea_user_a');
  teacherBToken = await loginMobile('tea_user_b');
  student1Token = await loginMobile('stu_p2_1');
  cr1Token = await loginMobile('stu_p2_2');
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
// 1. AUTHORIZATION, OWNERSHIP FORGERY & TOKEN REJECTION TESTS
// ============================================================================

test('Phase 2 Auth 1: Unauthenticated requests, students, and CRs are rejected across all backup coordination and workbook endpoints', async () => {
  const endpoints = [
    { method: 'GET', path: '/api/attendance/backup/status' },
    { method: 'PUT', path: '/api/attendance/backup/connection', body: { rootFolderId: 'folder_abc_123' } },
    { method: 'POST', path: '/api/attendance/backup/disconnect', body: {} },
    { method: 'GET', path: '/api/attendance/backup/pending' },
    { method: 'POST', path: '/api/attendance/backup/runs/fake_run/claim', body: {} },
    { method: 'POST', path: '/api/attendance/backup/runs/fake_run/complete', body: {} },
    { method: 'POST', path: '/api/attendance/backup/runs/fake_run/fail', body: {} },
    { method: 'GET', path: '/api/attendance/backup/runs/fake_run/artifacts' },
    { method: 'GET', path: '/api/attendance/sessions/fake_session/revisions' },
    { method: 'GET', path: `/api/attendance/backup/workbooks/daily?date=${TODAY_NEPAL}` },
    { method: 'GET', path: '/api/attendance/backup/workbooks/annual?year=2026' }
  ];

  for (const ep of endpoints) {
    // Unauthenticated -> 401
    const unauthRes = await fetch(`${baseUrl}${ep.path}`, {
      method: ep.method,
      headers: ep.body ? { 'Content-Type': 'application/json' } : {},
      body: ep.body ? JSON.stringify(ep.body) : undefined
    });
    assert.equal(unauthRes.status, 401, `Unauthenticated ${ep.method} ${ep.path} must return 401`);

    // Student & CR -> 403
    for (const token of [student1Token, cr1Token]) {
      const roleRes = await fetch(`${baseUrl}${ep.path}`, {
        method: ep.method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(ep.body ? { 'Content-Type': 'application/json' } : {})
        },
        body: ep.body ? JSON.stringify(ep.body) : undefined
      });
      assert.equal(roleRes.status, 403, `Student/CR ${ep.method} ${ep.path} must return 403`);
    }
  }
});

test('Phase 2 Auth 2: Connection metadata rejects OAuth tokens/secrets, rejects ownership forgery, and distinguishes admin visibility from teacher connection write authority', async () => {
  // 1. Teacher A attempts to send OAuth tokens or secrets in PUT /backup/connection -> 400 SENSITIVE_TOKEN_FORBIDDEN
  const secretPayloads = [
    { rootFolderId: 'folder_root_123', accessToken: 'ya29.a0AfH6SMBx_secret_token_value' },
    { rootFolderId: 'folder_root_123', refresh_token: '1//0gsecret_refresh_token_value' },
    { rootFolderId: 'folder_root_123', code: '4/0AdQt8qh_oauth_auth_code' },
    { rootFolderId: 'folder_root_123', clientSecret: 'GOCSPX-secret_value_123' },
    { rootFolderId: 'ya29.a0AfH6SMBx_disguised_token_in_folder_id' }
  ];

  for (const badBody of secretPayloads) {
    const res = await fetch(`${baseUrl}/api/attendance/backup/connection`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherAToken}`
      },
      body: JSON.stringify(badBody)
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.code, 'SENSITIVE_TOKEN_FORBIDDEN');
  }

  // 2. Teacher A attempts to forge Teacher B's teacherId or userId -> 403 OWNERSHIP_FORGERY_REJECTED
  const forgeRes = await fetch(`${baseUrl}/api/attendance/backup/connection`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      teacherId: 'tea_id_b',
      rootFolderId: 'folder_root_123'
    })
  });
  assert.equal(forgeRes.status, 403);
  const forgeData = await forgeRes.json();
  assert.equal(forgeData.code, 'OWNERSHIP_FORGERY_REJECTED');

  // 3. Admin attempts to write or disconnect a Drive connection -> 403 TEACHER_ONLY_CONNECTION_WRITE
  const adminPutRes = await fetch(`${baseUrl}/api/attendance/backup/connection`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      teacherId: 'tea_id_a',
      rootFolderId: 'folder_root_123'
    })
  });
  assert.equal(adminPutRes.status, 403);
  const adminPutData = await adminPutRes.json();
  assert.equal(adminPutData.code, 'TEACHER_ONLY_CONNECTION_WRITE');

  const adminDiscRes = await fetch(`${baseUrl}/api/attendance/backup/disconnect`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`
    },
    body: JSON.stringify({})
  });
  assert.equal(adminDiscRes.status, 403);

  // 4. Teacher A saves valid non-secret Drive connection metadata -> 200
  const validConnRes = await fetch(`${baseUrl}/api/attendance/backup/connection`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      googleEmail: 'sharma.drive@gmail.com',
      rootFolderId: 'drive_root_sharma_01',
      rootFolderName: 'Semester Library Attendance Backups',
      dailyFolderId: 'drive_daily_sharma_01',
      fullFolderId: 'drive_full_sharma_01',
      snapshotsFolderId: 'drive_snap_sharma_01',
      connectionStatus: 'connected'
    })
  });
  assert.equal(validConnRes.status, 200);
  const validConnData = await validConnRes.json();
  assert.equal(validConnData.connected, true);
  assert.equal(validConnData.connection.teacherId, 'tea_id_a');
  assert.equal(validConnData.connection.userId, 'tea_user_a');
  assert.equal(validConnData.connection.googleEmail, 'sharma.drive@gmail.com');
  assert.equal(validConnData.connection.rootFolderId, 'drive_root_sharma_01');
  assert.equal(validConnData.connection.dailyFolderId, 'drive_daily_sharma_01');
  assert.equal(validConnData.connection.fullFolderId, 'drive_full_sharma_01');
  assert.equal(validConnData.connection.snapshotsFolderId, 'drive_snap_sharma_01');

  // 5. Teacher A checks GET /backup/status (and cannot query Teacher B's status)
  const statusARes = await fetch(`${baseUrl}/api/attendance/backup/status`, {
    headers: { Authorization: `Bearer ${teacherAToken}` }
  });
  assert.equal(statusARes.status, 200);
  const statusAData = await statusARes.json();
  assert.equal(statusAData.canManageConnection, true);
  assert.equal(statusAData.connection.connectionStatus, 'connected');
  assert.match(statusAData.connectionStatusNote, /informational/i);

  const crossStatusRes = await fetch(`${baseUrl}/api/attendance/backup/status?teacherId=tea_id_b`, {
    headers: { Authorization: `Bearer ${teacherAToken}` }
  });
  assert.equal(crossStatusRes.status, 403);

  // 6. Admin can read Teacher A's backup status (read-only administrative visibility)
  const adminStatusRes = await fetch(`${baseUrl}/api/attendance/backup/status?teacherId=tea_id_a`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert.equal(adminStatusRes.status, 200);
  const adminStatusData = await adminStatusRes.json();
  assert.equal(adminStatusData.role, 'admin');
  assert.equal(adminStatusData.canManageConnection, false);
  assert.equal(adminStatusData.connection.googleEmail, 'sharma.drive@gmail.com');
});

// ============================================================================
// 2. CONCURRENCY, LEASE EXPIRATION, RETRY BOUNDS & ARTIFACT STATE MACHINE TESTS
// ============================================================================

let sessionCitId = '';
let runV1Id = '';
let runV1Sha = '';

test('Phase 2 Concurrency & Claims 1: Simultaneous claims from separate clients, idempotent renewal, lease expiration recovery, stale claim rejection, and partial artifact success', async () => {
  // Teacher A creates an attendance session for CIT111 on TODAY_NEPAL
  const saveRes = await fetch(`${baseUrl}/api/attendance/sessions`, {
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
        { studentId: 'stu_p2_1', status: 'present' },
        { studentId: 'stu_p2_2', status: 'absent' }
      ]
    })
  });
  assert.equal(saveRes.status, 201);
  const saveData = await saveRes.json();
  sessionCitId = saveData.session.id;
  runV1Id = saveData.backupRevision.id;
  runV1Sha = saveData.backupRevision.snapshotSha256;
  assert.equal(saveData.backupRevision.artifacts.length, 3);

  // Teacher B (unassigned to CIT111) cannot view pending, claim, complete, fail, or view revisions/artifacts of Teacher A's session
  const teaBClaim = await fetch(`${baseUrl}/api/attendance/backup/runs/${runV1Id}/claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherBToken}`
    },
    body: JSON.stringify({ clientId: 'tea_b_client' })
  });
  assert.equal(teaBClaim.status, 403);

  const teaBArt = await fetch(`${baseUrl}/api/attendance/backup/runs/${runV1Id}/artifacts`, {
    headers: { Authorization: `Bearer ${teacherBToken}` }
  });
  assert.equal(teaBArt.status, 403);

  const teaBRev = await fetch(`${baseUrl}/api/attendance/sessions/${sessionCitId}/revisions`, {
    headers: { Authorization: `Bearer ${teacherBToken}` }
  });
  assert.equal(teaBRev.status, 403);

  // Admin cannot claim Teacher A's backup run
  const adminClaim = await fetch(`${baseUrl}/api/attendance/backup/runs/${runV1Id}/claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`
    },
    body: JSON.stringify({ clientId: 'admin_client' })
  });
  assert.equal(adminClaim.status, 403);

  // Simultaneous claims from two distinct clients (client_alpha and client_beta) with 60s lease:
  // Strictly ONE must succeed (200) and the other must be rejected with 409 CLAIM_LEASE_ACTIVE
  const [claimAlpha, claimBeta] = await Promise.all([
    fetch(`${baseUrl}/api/attendance/backup/runs/${runV1Id}/claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherAToken}`
      },
      body: JSON.stringify({ clientId: 'client_alpha', leaseDurationMs: 60000 })
    }),
    fetch(`${baseUrl}/api/attendance/backup/runs/${runV1Id}/claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherAToken}`
      },
      body: JSON.stringify({ clientId: 'client_beta', leaseDurationMs: 60000 })
    })
  ]);

  const statuses = [claimAlpha.status, claimBeta.status].sort();
  assert.deepEqual(statuses, [200, 409], 'Exactly one concurrent client claim must win (200) and the other must receive 409');

  const winningRes = claimAlpha.status === 200 ? claimAlpha : claimBeta;
  const winningClient = claimAlpha.status === 200 ? 'client_alpha' : 'client_beta';
  const winData = await winningRes.json();
  assert.equal(winData.claimed, true);
  assert.equal(winData.claimedArtifacts.length, 3);

  const initialSnapClaimToken = winData.claimedArtifacts.find((a) => a.artifactType === 'snapshot').claimToken;

  // Idempotent repeat claim by the SAME winning client renews the lease without incrementing attemptCount
  const renewRes = await fetch(`${baseUrl}/api/attendance/backup/runs/${runV1Id}/claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({ clientId: winningClient, leaseDurationMs: 1200 })
  });
  assert.equal(renewRes.status, 200);
  const renewData = await renewRes.json();
  assert.equal(renewData.idempotent, true);
  assert.equal(
    renewData.claimedArtifacts.find((a) => a.artifactType === 'snapshot').attemptCount,
    1,
    'Idempotent renewal by the same client must not increment attemptCount'
  );
  assert.equal(
    renewData.claimedArtifacts.find((a) => a.artifactType === 'snapshot').claimToken,
    initialSnapClaimToken,
    'Idempotent renewal must preserve the active claimToken'
  );

  // Simulate lease expiration (wait 1300ms so the 1200ms lease expires)
  await new Promise((r) => setTimeout(r, 1300));

  // Stale client attempts to complete after lease expired -> 409 CLAIM_LEASE_EXPIRED
  const expiredCompleteRes = await fetch(`${baseUrl}/api/attendance/backup/runs/${runV1Id}/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      artifactType: 'snapshot',
      claimToken: initialSnapClaimToken,
      revisionNo: 1,
      snapshotSha256: runV1Sha,
      driveFileId: 'drive_snap_file_v1'
    })
  });
  assert.equal(expiredCompleteRes.status, 409);
  const expiredCompleteData = await expiredCompleteRes.json();
  assert.equal(expiredCompleteData.code, 'CLAIM_LEASE_EXPIRED');

  // Recovery client (client_recovery) claims the expired lease -> 200, attemptCount increments to 2
  const recoverRes = await fetch(`${baseUrl}/api/attendance/backup/runs/${runV1Id}/claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({ clientId: 'client_recovery', leaseDurationMs: 60000 })
  });
  assert.equal(recoverRes.status, 200);
  const recoverData = await recoverRes.json();
  assert.equal(recoverData.claimed, true);
  const recoveredSnap = recoverData.claimedArtifacts.find((a) => a.artifactType === 'snapshot');
  const recoveredDaily = recoverData.claimedArtifacts.find((a) => a.artifactType === 'daily_workbook');
  const recoveredAnnual = recoverData.claimedArtifacts.find((a) => a.artifactType === 'annual_workbook');
  assert.equal(recoveredSnap.attemptCount, 2);
  assert.notEqual(recoveredSnap.claimToken, initialSnapClaimToken);

  // Stale claimToken from previous crashed client is rejected -> 409 STALE_OR_INVALID_CLAIM
  const staleTokenRes = await fetch(`${baseUrl}/api/attendance/backup/runs/${runV1Id}/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      artifactType: 'snapshot',
      claimToken: initialSnapClaimToken,
      revisionNo: 1,
      snapshotSha256: runV1Sha,
      driveFileId: 'drive_snap_file_v1'
    })
  });
  assert.equal(staleTokenRes.status, 409);
  assert.equal((await staleTokenRes.json()).code, 'STALE_OR_INVALID_CLAIM');

  // Reject completion with "{ success: true }" missing required verification fields -> 400
  const naiveSuccessRes = await fetch(`${baseUrl}/api/attendance/backup/runs/${runV1Id}/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({ success: true })
  });
  assert.equal(naiveSuccessRes.status, 400);

  // Reject completion with wrong revisionNo or wrong snapshotSha256 -> 409 REVISION_HASH_MISMATCH
  const wrongRevRes = await fetch(`${baseUrl}/api/attendance/backup/runs/${runV1Id}/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      artifactType: 'snapshot',
      claimToken: recoveredSnap.claimToken,
      revisionNo: 99,
      snapshotSha256: runV1Sha,
      driveFileId: 'drive_snap_file_v1'
    })
  });
  assert.equal(wrongRevRes.status, 409);
  assert.equal((await wrongRevRes.json()).code, 'REVISION_HASH_MISMATCH');

  // PARTIAL SUCCESS: Complete 'snapshot' artifact ONLY
  const snapCompleteRes = await fetch(`${baseUrl}/api/attendance/backup/runs/${runV1Id}/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      artifactType: 'snapshot',
      claimToken: recoveredSnap.claimToken,
      revisionNo: 1,
      snapshotSha256: runV1Sha,
      driveFileId: 'drive_snap_file_v1'
    })
  });
  assert.equal(snapCompleteRes.status, 200);
  const snapCompleteData = await snapCompleteRes.json();
  assert.equal(snapCompleteData.completed, true);
  assert.equal(snapCompleteData.allArtifactsComplete, false, 'Run must NOT be marked complete when only 1 of 3 artifacts succeeded');
  assert.equal(snapCompleteData.backupStatus, 'in_progress');

  // Idempotent repeat completion of 'snapshot' with same driveFileId and claimToken -> 200 idempotent: true
  const snapRepeatRes = await fetch(`${baseUrl}/api/attendance/backup/runs/${runV1Id}/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      artifactType: 'snapshot',
      claimToken: recoveredSnap.claimToken,
      revisionNo: 1,
      snapshotSha256: runV1Sha,
      driveFileId: 'drive_snap_file_v1'
    })
  });
  assert.equal(snapRepeatRes.status, 200);
  assert.equal((await snapRepeatRes.json()).idempotent, true);

  // Attempting to overwrite 'snapshot' with a different driveFileId -> 409 INVALID_ARTIFACT_STATE_TRANSITION
  const snapOverwriteRes = await fetch(`${baseUrl}/api/attendance/backup/runs/${runV1Id}/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      artifactType: 'snapshot',
      claimToken: recoveredSnap.claimToken,
      revisionNo: 1,
      snapshotSha256: runV1Sha,
      driveFileId: 'drive_snap_different_id'
    })
  });
  assert.equal(snapOverwriteRes.status, 409);

  // Fail 'daily_workbook' with an error message containing sensitive token patterns (verify sanitization!)
  const failDailyRes = await fetch(`${baseUrl}/api/attendance/backup/runs/${runV1Id}/fail`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      artifactType: 'daily_workbook',
      claimToken: recoveredDaily.claimToken,
      errorCode: 'DRIVE_RATE_LIMIT',
      errorMessage: 'Upload failed with header Bearer ya29.a0AfH6SMBx_leaked_token and ?access_token=secret123',
      retryDelayMs: 0
    })
  });
  assert.equal(failDailyRes.status, 200);
  const failDailyData = await failDailyRes.json();
  assert.ok(!failDailyData.lastErrorMessage.includes('ya29.'), 'Sanitizer must redact Google access tokens from error messages');
  assert.ok(!failDailyData.lastErrorMessage.includes('secret123'), 'Sanitizer must redact query token values');

  // Complete 'annual_workbook'
  const annualCompleteRes = await fetch(`${baseUrl}/api/attendance/backup/runs/${runV1Id}/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      artifactType: 'annual_workbook',
      claimToken: recoveredAnnual.claimToken,
      revisionNo: 1,
      snapshotSha256: runV1Sha,
      driveFileId: 'drive_annual_file_2026'
    })
  });
  assert.equal(annualCompleteRes.status, 200);
  const annualCompleteData = await annualCompleteRes.json();
  assert.equal(annualCompleteData.allArtifactsComplete, false, 'Run must still be failed because daily_workbook failed');
  assert.equal(annualCompleteData.backupStatus, 'failed');

  // Re-claim run: ONLY 'daily_workbook' should be claimed; 'snapshot' and 'annual_workbook' remain 'backed_up'!
  const retryClaimRes = await fetch(`${baseUrl}/api/attendance/backup/runs/${runV1Id}/claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({ clientId: 'client_recovery', forceRetry: true })
  });
  assert.equal(retryClaimRes.status, 200);
  const retryClaimData = await retryClaimRes.json();
  assert.equal(retryClaimData.claimedArtifacts.length, 1, 'Only the failed daily_workbook artifact must be re-claimed');
  assert.equal(retryClaimData.claimedArtifacts[0].artifactType, 'daily_workbook');
  assert.equal(retryClaimData.claimedArtifacts[0].attemptCount, 3);

  // Complete 'daily_workbook' -> now all 3 artifacts are 'backed_up', so run transitions to 'backed_up'!
  const dailyCompleteRes = await fetch(`${baseUrl}/api/attendance/backup/runs/${runV1Id}/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      artifactType: 'daily_workbook',
      claimToken: retryClaimData.claimedArtifacts[0].claimToken,
      revisionNo: 1,
      snapshotSha256: runV1Sha,
      driveFileId: 'drive_daily_file_today'
    })
  });
  assert.equal(dailyCompleteRes.status, 200);
  const dailyCompleteData = await dailyCompleteRes.json();
  assert.equal(dailyCompleteData.allArtifactsComplete, true);
  assert.equal(dailyCompleteData.backupStatus, 'backed_up');
});

test('Phase 2 Concurrency & Claims 2: Stale revision workbook prevention and bounded retry exhaustion (MAX_BACKUP_ATTEMPTS = 5)', async () => {
  // Create a session for BSM111 on YESTERDAY_NEPAL (v1)
  const v1Res = await fetch(`${baseUrl}/api/attendance/sessions`, {
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
        { studentId: 'stu_p2_1', status: 'present' },
        { studentId: 'stu_p2_2', status: 'present' }
      ]
    })
  });
  assert.equal(v1Res.status, 201);
  const v1Data = await v1Res.json();
  const bsmSessionId = v1Data.session.id;
  const bsmV1RunId = v1Data.backupRevision.id;
  const bsmV1Sha = v1Data.backupRevision.snapshotSha256;

  // Claim v1 before editing
  const v1ClaimRes = await fetch(`${baseUrl}/api/attendance/backup/runs/${bsmV1RunId}/claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({ clientId: 'stale_worker' })
  });
  assert.equal(v1ClaimRes.status, 200);
  const v1ClaimData = await v1ClaimRes.json();
  const v1DailyClaimToken = v1ClaimData.claimedArtifacts.find((a) => a.artifactType === 'daily_workbook').claimToken;
  const v1SnapClaimToken = v1ClaimData.claimedArtifacts.find((a) => a.artifactType === 'snapshot').claimToken;

  // Now Teacher A edits BSM111 session -> creates v2!
  const v2Res = await fetch(`${baseUrl}/api/attendance/sessions/${bsmSessionId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      reason: 'Update mark creating v2',
      records: [
        { studentId: 'stu_p2_1', status: 'present' },
        { studentId: 'stu_p2_2', status: 'absent' }
      ]
    })
  });
  assert.equal(v2Res.status, 200);
  const v2Data = await v2Res.json();
  const bsmV2RunId = v2Data.backupRevision.id;
  assert.equal(v2Data.backupRevision.revisionNo, 2);

  // Stale worker tries to complete v1's daily_workbook AFTER v2 was committed -> 409 STALE_REVISION_WORKBOOK
  const staleWorkbookComplete = await fetch(`${baseUrl}/api/attendance/backup/runs/${bsmV1RunId}/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      artifactType: 'daily_workbook',
      claimToken: v1DailyClaimToken,
      revisionNo: 1,
      snapshotSha256: bsmV1Sha,
      driveFileId: 'stale_daily_file_id'
    })
  });
  assert.equal(staleWorkbookComplete.status, 409);
  assert.equal((await staleWorkbookComplete.json()).code, 'STALE_REVISION_WORKBOOK');

  // However, v1's immutable 'snapshot' artifact CAN still complete, and once completed, v1 is marked 'backed_up'
  // (because v1's workbooks were superseded by v2!)
  const v1SnapComplete = await fetch(`${baseUrl}/api/attendance/backup/runs/${bsmV1RunId}/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      artifactType: 'snapshot',
      claimToken: v1SnapClaimToken,
      revisionNo: 1,
      snapshotSha256: bsmV1Sha,
      driveFileId: 'v1_immutable_snap_id'
    })
  });
  assert.equal(v1SnapComplete.status, 200);
  const v1SnapCompleteData = await v1SnapComplete.json();
  assert.equal(v1SnapCompleteData.backupStatus, 'backed_up');
  assert.equal(v1SnapCompleteData.allArtifactsComplete, true);

  // Test Bounded Retries (MAX_BACKUP_ATTEMPTS = 5) on bsmV2RunId's snapshot artifact:
  for (let attempt = 1; attempt <= 5; attempt++) {
    const claimRes = await fetch(`${baseUrl}/api/attendance/backup/runs/${bsmV2RunId}/claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherAToken}`
      },
      body: JSON.stringify({
        clientId: 'retry_worker',
        artifactTypes: ['snapshot'],
        forceRetry: true
      })
    });
    assert.equal(claimRes.status, 200, `Attempt ${attempt} claim must succeed`);
    const claimData = await claimRes.json();
    assert.equal(claimData.claimedArtifacts[0].attemptCount, attempt);

    const failRes = await fetch(`${baseUrl}/api/attendance/backup/runs/${bsmV2RunId}/fail`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherAToken}`
      },
      body: JSON.stringify({
        artifactType: 'snapshot',
        claimToken: claimData.claimedArtifacts[0].claimToken,
        errorCode: 'NETWORK_TIMEOUT',
        errorMessage: `Attempt ${attempt} timed out`,
        retryDelayMs: 0
      })
    });
    assert.equal(failRes.status, 200);
  }

  // 6th attempt must be rejected with 409 RETRY_LIMIT_EXCEEDED
  const exhaustedRes = await fetch(`${baseUrl}/api/attendance/backup/runs/${bsmV2RunId}/claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      clientId: 'retry_worker',
      artifactTypes: ['snapshot'],
      forceRetry: true
    })
  });
  assert.equal(exhaustedRes.status, 409);
  assert.equal((await exhaustedRes.json()).code, 'RETRY_LIMIT_EXCEEDED');
});

// ============================================================================
// 3. PHASE 2B — DETERMINISTIC XLSX GENERATION, SECURITY & TOTALS ACCURACY TESTS
// ============================================================================

test('Phase 2B XLSX 1: Worksheet name sanitization, collision deduplication, formula-injection neutralization, and empty datasets', async () => {
  // 1. Formula injection neutralization unit checks
  assert.equal(sanitizeFormulaCellText("=CMD|' /C calc'!A0"), "'=CMD|' /C calc'!A0");
  assert.equal(sanitizeFormulaCellText('+SUM(A1:A10)'), "'+SUM(A1:A10)");
  assert.equal(sanitizeFormulaCellText('-1+2'), "'-1+2");
  assert.equal(sanitizeFormulaCellText('@SUM(1,2)'), "'@SUM(1,2)");
  assert.equal(sanitizeFormulaCellText('  =HYPERLINK("http://evil.tld")'), "'  =HYPERLINK(\"http://evil.tld\")");
  assert.equal(sanitizeFormulaCellText('Normal Student Name'), 'Normal Student Name');

  // 2. Worksheet name collisions, invalid chars, >31 chars, and reserved 'History'
  const used = new Set();
  const s1 = sanitizeWorksheetName('CIT111:Programming/C*?[Sem1]_VeryLongWorksheetTitle', used);
  const s2 = sanitizeWorksheetName('cit111:programming/c*?[sem1]_verylongworksheettitle', used);
  const s3 = sanitizeWorksheetName('CIT111:Programming/C*?[Sem1]_VeryLongWorksheetTitle', used);
  const sHist = sanitizeWorksheetName('History', used);

  assert.ok(s1.length <= 31);
  assert.ok(s2.length <= 31);
  assert.ok(s3.length <= 31);
  assert.notEqual(s1.toLowerCase(), s2.toLowerCase());
  assert.notEqual(s2.toLowerCase(), s3.toLowerCase());
  assert.ok(s2.endsWith('_2'));
  assert.ok(s3.endsWith('_3'));
  assert.equal(sHist, 'Sheet');

  // 3. Empty Daily Workbook for a date with no sessions (TWO_DAYS_AGO_NEPAL)
  const emptyDailyRes = await fetch(
    `${baseUrl}/api/attendance/backup/workbooks/daily?date=${TWO_DAYS_AGO_NEPAL}`,
    { headers: { Authorization: `Bearer ${teacherAToken}` } }
  );
  assert.equal(emptyDailyRes.status, 200);
  assert.equal(emptyDailyRes.headers.get('content-type'), XLSX_MIME_TYPE);
  assert.match(emptyDailyRes.headers.get('content-disposition'), /Attendance_Daily_/);
  const emptyDailyBuf = await emptyDailyRes.buffer();
  const parsedEmptyDaily = parseXlsxWorkbookBuffer(emptyDailyBuf);
  assert.deepEqual(parsedEmptyDaily.sheetNames, ['Daily Summary']);

  // 4. Future date must be rejected with 400 FUTURE_DATE_NOT_ALLOWED
  const futureDailyRes = await fetch(
    `${baseUrl}/api/attendance/backup/workbooks/daily?date=${TOMORROW_NEPAL}`,
    { headers: { Authorization: `Bearer ${teacherAToken}` } }
  );
  assert.equal(futureDailyRes.status, 400);
  assert.equal((await futureDailyRes.json()).code, 'FUTURE_DATE_NOT_ALLOWED');

  // 5. Empty Annual Workbook for a year with no sessions (2021)
  const emptyAnnualRes = await fetch(
    `${baseUrl}/api/attendance/backup/workbooks/annual?year=2021`,
    { headers: { Authorization: `Bearer ${teacherAToken}` } }
  );
  assert.equal(emptyAnnualRes.status, 200);
  const parsedEmptyAnnual = parseXlsxWorkbookBuffer(await emptyAnnualRes.buffer());
  assert.deepEqual(parsedEmptyAnnual.sheetNames, ['Session Overview', 'Subject Summaries', 'Audit & Revisions']);
});

test('Phase 2B XLSX 2: Daily workbook contents, teacher scope isolation, formula-injection escaping in student names, and privacy minimization', async () => {
  // Teacher B creates a session for ELX111 on TODAY_NEPAL (must NOT appear in Teacher A's daily workbook!)
  const teaBSave = await fetch(`${baseUrl}/api/attendance/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherBToken}`
    },
    body: JSON.stringify({
      subjectId: 'ELX111',
      cohortId: cohortMercury.id,
      sessionDate: TODAY_NEPAL,
      records: [
        { studentId: 'stu_p2_1', status: 'absent' },
        { studentId: 'stu_p2_2', status: 'present' }
      ]
    })
  });
  assert.equal(teaBSave.status, 201);

  // Teacher A cannot request a workbook for Teacher B's subject ELX111 -> 403 UNAUTHORIZED_SUBJECT
  const unauthSubjWb = await fetch(
    `${baseUrl}/api/attendance/backup/workbooks/daily?date=${TODAY_NEPAL}&subjectId=ELX111`,
    { headers: { Authorization: `Bearer ${teacherAToken}` } }
  );
  assert.equal(unauthSubjWb.status, 403);

  // Teacher A downloads Daily Workbook for TODAY_NEPAL
  const dailyRes1 = await fetch(
    `${baseUrl}/api/attendance/backup/workbooks/daily?date=${TODAY_NEPAL}`,
    { headers: { Authorization: `Bearer ${teacherAToken}` } }
  );
  assert.equal(dailyRes1.status, 200);
  const buf1 = await dailyRes1.buffer();

  // Repeat download to verify byte-for-byte determinism
  const dailyRes2 = await fetch(
    `${baseUrl}/api/attendance/backup/workbooks/daily?date=${TODAY_NEPAL}`,
    { headers: { Authorization: `Bearer ${teacherAToken}` } }
  );
  const buf2 = await dailyRes2.buffer();
  assert.equal(
    dailyRes1.headers.get('x-workbook-sha256'),
    dailyRes2.headers.get('x-workbook-sha256'),
    'Daily XLSX generation must be byte-for-byte deterministic'
  );
  assert.ok(buf1.equals(buf2));

  const parsed = parseXlsxWorkbookBuffer(buf1);
  assert.equal(parsed.sheetNames.length, 2, 'Daily Summary + 1 authorized session detail sheet (CIT111)');
  assert.equal(parsed.sheetNames[0], 'Daily Summary');
  assert.equal(parsed.sheetNames[1], 'CIT111_Mercury');

  // Verify Summary sheet contains ONLY CIT111 (not ELX111) and matches runV1Sha & revisionNo = 1
  const summarySheet = parsed.sheets[0];
  const sessionRowInSummary = summarySheet.rows.find((r) => r && r[0] === sessionCitId);
  assert.ok(sessionRowInSummary, 'CIT111 session must appear in Daily Summary');
  assert.equal(sessionRowInSummary[2], 'CIT111');
  assert.equal(sessionRowInSummary[7], 2);  // Total Students
  assert.equal(sessionRowInSummary[8], 1);  // Present
  assert.equal(sessionRowInSummary[9], 1);  // Absent
  assert.equal(sessionRowInSummary[10], 50); // 50%
  assert.equal(sessionRowInSummary[11], 1);  // Revision 1
  assert.equal(sessionRowInSummary[13], runV1Sha);

  // Verify ELX111 does NOT appear anywhere in Teacher A's workbook
  const allCellsFlat = JSON.stringify(parsed.sheets);
  assert.ok(!allCellsFlat.includes('ELX111'), 'Teacher B subject ELX111 must never leak into Teacher A workbook');

  // Verify student emails and password hashes NEVER appear in workbook
  assert.ok(!allCellsFlat.includes('m1@gandaki.edu.np'), 'Student email must not be exported');
  assert.ok(!allCellsFlat.includes('m2@gandaki.edu.np'), 'Student email must not be exported');

  // Verify formula-injection student name ('=CMD|' /C calc'!A0 Ankit') is neutralized with a leading single quote
  const detailSheet = parsed.sheets[1];
  const stu2Row = detailSheet.rows.find((r) => r && r[1] === 'stu_p2_2');
  assert.ok(stu2Row, 'stu_p2_2 row must exist in session detail sheet');
  assert.ok(
    String(stu2Row[2]).startsWith("'=CMD|"),
    `Formula injection name must start with single quote, got: ${stu2Row[2]}`
  );
});

test('Phase 2B XLSX 3: Annual workbook uncapped totals (>50 sessions), year boundary isolation, and audit/revision ledger accuracy', async () => {
  // Seed 55 finalized sessions in 2025 for CIT111 (to prove annual workbook never caps at 50 sessions!)
  // and 1 session in 2024-12-31 (to prove year boundary isolation!)
  await saveAttendanceSession(db, {
    actorUserId: 'tea_user_a',
    subjectId: 'CIT111',
    cohortId: cohortMercury.id,
    sessionDate: '2024-12-31',
    records: [
      { studentId: 'stu_p2_1', status: 'absent' },
      { studentId: 'stu_p2_2', status: 'absent' }
    ]
  });

  let expected2025PresentStu1 = 0;
  let last2025SessionId = '';

  for (let i = 1; i <= 55; i++) {
    const month = i <= 28 ? '01' : '02';
    const day = String(i <= 28 ? i : i - 28).padStart(2, '0');
    const dateStr = `2025-${month}-${day}`;
    const stu1Present = i <= 44; // Present in 44 of 55 sessions = 80%
    if (stu1Present) expected2025PresentStu1 += 1;

    const saved = await saveAttendanceSession(db, {
      actorUserId: 'tea_user_a',
      subjectId: 'CIT111',
      cohortId: cohortMercury.id,
      sessionDate: dateStr,
      records: [
        { studentId: 'stu_p2_1', status: stu1Present ? 'present' : 'absent' },
        { studentId: 'stu_p2_2', status: 'present' }
      ]
    });
    last2025SessionId = saved.session.id;
  }

  // Perform an admin correction on the 55th session in 2025 so it has v1 (session_created) and v2 (admin_correction)
  await adminCorrectAttendanceSession(db, {
    adminUserId: 'admin_p2',
    sessionId: last2025SessionId,
    reason: 'Medical leave verified by department',
    records: [
      { studentId: 'stu_p2_1', status: 'present' }, // flipped from absent -> present (45 / 55)
      { studentId: 'stu_p2_2', status: 'present' }
    ]
  });
  expected2025PresentStu1 += 1; // Now 45 out of 55 sessions

  // Generate 2025 Annual Workbook for Teacher A
  const annualRes = await fetch(
    `${baseUrl}/api/attendance/backup/workbooks/annual?year=2025`,
    { headers: { Authorization: `Bearer ${teacherAToken}` } }
  );
  assert.equal(annualRes.status, 200);
  assert.equal(annualRes.headers.get('content-type'), XLSX_MIME_TYPE);

  const parsedAnnual = parseXlsxWorkbookBuffer(await annualRes.buffer());
  assert.deepEqual(parsedAnnual.sheetNames, [
    'Session Overview',
    'Subject Summaries',
    'Mat_CIT111_Mercury_S1',
    'Audit & Revisions'
  ]);

  // 1. Verify 2024-12-31 is NOT included in 2025 workbook
  const overviewText = JSON.stringify(parsedAnnual.sheets[0]);
  assert.ok(!overviewText.includes('2024-12-31'), '2024 session must be excluded from 2025 annual workbook');

  // 2. Verify Subject Summaries sheet computes totals across ALL 55 sessions (not capped at 50!)
  const subjSummariesSheet = parsedAnnual.sheets[1];
  const stu1SummaryRow = subjSummariesSheet.rows.find(
    (r) => r && r[0] === 'CIT111' && r[4] === 'stu_p2_1'
  );
  assert.ok(stu1SummaryRow, 'stu_p2_1 summary row for CIT111 must exist');
  assert.equal(stu1SummaryRow[7], 55, 'Total Sessions must be all 55 sessions (uncapped)');
  assert.equal(stu1SummaryRow[8], 45, 'Present Count must be 45 (including admin correction)');
  assert.equal(stu1SummaryRow[9], 10, 'Absent Count must be 10');
  assert.equal(stu1SummaryRow[10], 81.82, 'Attendance % must be 81.82%');

  // 3. Verify Audit & Revisions sheet includes both v1 (session_created) and v2 (admin_correction) for last2025SessionId
  const auditSheet = parsedAnnual.sheets[3];
  const lastSessAuditRows = auditSheet.rows.filter((r) => r && r[0] === last2025SessionId);
  assert.equal(lastSessAuditRows.length, 2, 'Both v1 and v2 revisions must be listed in Audit & Revisions');
  assert.equal(lastSessAuditRows[0][4], 1);
  assert.equal(lastSessAuditRows[0][5], 'session_created');
  assert.equal(lastSessAuditRows[1][4], 2);
  assert.equal(lastSessAuditRows[1][5], 'admin_correction');
  assert.equal(lastSessAuditRows[1][8], 'Medical leave verified by department');
  assert.equal(lastSessAuditRows[1][9], lastSessAuditRows[0][10], 'v2 previous hash must equal v1 snapshot hash');
});

// ============================================================================
// 4. POSTGRESQL (PGLITE) DUAL-ENGINE PARITY & CROSS-CONNECTION CONCURRENCY TEST
// ============================================================================

test('Phase 2 PostgreSQL (PGlite): Migrations 20261025 + 20261026, cross-connection FOR UPDATE claims, partial failure recovery, and XLSX generation pass on PostgreSQL', async () => {
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

  // Apply all 3 PostgreSQL migration files in order
  for (const migFile of [
    '20261024_attendance_schema.sql',
    '20261025_attendance_drive_backup.sql',
    '20261026_attendance_backup_artifacts.sql'
  ]) {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', migFile), 'utf8');
    await pgDb.exec(sql);
  }

  await pgDb.run(
    `INSERT INTO subjects (id, code, name, semester, department, credit_hours, active)
     VALUES ('CIT111', 'CIT111', 'Programming in C', 1, 'BIT', 3.0, TRUE)`
  );
  const pgCohort = await createCohort(pgDb, {
    slotCode: 'mercury',
    displayName: 'Mercury',
    currentSemester: 1,
    intakeYear: 2026
  });

  await pgDb.run(
    `INSERT INTO students (studentId, username, name, role, account_status)
     VALUES ('pg_tea_1', 'pg_tea_1', 'PG Teacher', 'teacher', 'active')`
  );
  await pgDb.run(
    `INSERT INTO teachers (id, user_id, designation, status)
     VALUES ('pg_tea_id_1', 'pg_tea_1', 'Professor', 'active')`
  );
  await pgDb.run(
    `INSERT INTO teacher_subjects (id, teacher_id, subject_id)
     VALUES ('pg_ts_1', 'pg_tea_id_1', 'CIT111')`
  );
  await pgDb.run(
    `INSERT INTO students (studentId, username, name, role, semester, cohort_id, account_status)
     VALUES ('pg_stu_1', 'pg_stu_1', 'PG Student 1', 'student', 'Semester 1', ?, 'active')`,
    pgCohort.id
  );

  const saved = await saveAttendanceSession(pgDb, {
    actorUserId: 'pg_tea_1',
    subjectId: 'CIT111',
    cohortId: pgCohort.id,
    sessionDate: TODAY_NEPAL,
    records: [{ studentId: 'pg_stu_1', status: 'present' }]
  });
  const pgRunId = saved.backupRevision.id;
  const pgSha = saved.backupRevision.snapshotSha256;

  // Concurrent claims on PostgreSQL
  const results = await Promise.allSettled([
    claimBackupRunArtifacts(pgDb, {
      actorUserId: 'pg_tea_1',
      runId: pgRunId,
      body: { clientId: 'pg_client_1', leaseDurationMs: 60000 }
    }),
    claimBackupRunArtifacts(pgDb, {
      actorUserId: 'pg_tea_1',
      runId: pgRunId,
      body: { clientId: 'pg_client_2', leaseDurationMs: 60000 }
    })
  ]);

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'Strictly one PG claim must succeed');
  assert.equal(rejected.length, 1, 'Second concurrent PG claim must be rejected');
  assert.equal(rejected[0].reason.code, 'CLAIM_LEASE_ACTIVE');

  const claimWinner = fulfilled[0].value;
  for (const art of claimWinner.claimedArtifacts) {
    await completeBackupArtifact(pgDb, {
      actorUserId: 'pg_tea_1',
      runId: pgRunId,
      body: {
        artifactType: art.artifactType,
        claimToken: art.claimToken,
        revisionNo: 1,
        snapshotSha256: pgSha,
        driveFileId: `pg_drive_${art.artifactType}`
      }
    });
  }

  const artBundle = await getBackupRunArtifacts(pgDb, {
    actorUserId: 'pg_tea_1',
    runId: pgRunId,
    includePayloads: true
  });
  assert.equal(artBundle.backupStatus, 'backed_up');
  assert.ok(artBundle.workbooks.daily.bundle.base64.length > 100);
  assert.ok(artBundle.workbooks.annual.bundle.base64.length > 100);

  await pg.close();
});
