'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

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
const JSZip = require('jszip');
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
  computeCanonicalSnapshotHash,
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

/**
 * Independent XLSX Validator using third-party JSZip AND Python 3's standard library
 * zipfile + xml.etree.ElementTree XML parser (completely independent of attendance-xlsx.js).
 */
async function validateXlsxIndependently(xlsxBuffer) {
  // 1. Validate with JSZip (independent Node ZIP reader)
  const zip = await JSZip.loadAsync(xlsxBuffer);
  const entryNames = Object.keys(zip.files);
  for (const requiredFile of [
    '[Content_Types].xml',
    '_rels/.rels',
    'xl/workbook.xml',
    'xl/_rels/workbook.xml.rels',
    'xl/styles.xml'
  ]) {
    assert.ok(entryNames.includes(requiredFile), `Missing required OOXML entry: ${requiredFile}`);
  }

  // 2. Validate with Python 3 zipfile.testzip() (CRC & deflate check) + xml.etree.ElementTree XML DOM parser
  const tmpFile = path.join(os.tmpdir(), `xlsx_verify_${Date.now()}_${Math.random().toString(36).slice(2)}.xlsx`);
  fs.writeFileSync(tmpFile, xlsxBuffer);
  try {
    const pyScript = `
import sys, json, zipfile, xml.etree.ElementTree as ET

path = sys.argv[1]
with zipfile.ZipFile(path, 'r') as zf:
    bad_file = zf.testzip()
    if bad_file is not None:
        raise RuntimeError(f"Corrupt ZIP entry: {bad_file}")
    names = zf.namelist()
    ct_root = ET.fromstring(zf.read('[Content_Types].xml'))
    rels_root = ET.fromstring(zf.read('_rels/.rels'))
    wb_root = ET.fromstring(zf.read('xl/workbook.xml'))
    wb_rels_root = ET.fromstring(zf.read('xl/_rels/workbook.xml.rels'))
    styles_root = ET.fromstring(zf.read('xl/styles.xml'))

    ns = {
        'main': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
        'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
        'pkgrel': 'http://schemas.openxmlformats.org/package/2006/relationships'
    }

    rel_map = {}
    for rel in wb_rels_root.findall('pkgrel:Relationship', ns):
        rel_map[rel.attrib['Id']] = rel.attrib['Target']

    sheets_out = []
    for sh in wb_root.findall('.//main:sheet', ns):
        sh_name = sh.attrib['name']
        sh_id = int(sh.attrib['sheetId'])
        r_id = sh.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']
        target = 'xl/' + rel_map[r_id]
        if target not in names:
            raise RuntimeError(f"Missing worksheet target {target}")
        ws_root = ET.fromstring(zf.read(target))
        dim_el = ws_root.find('main:dimension', ns)
        dim_ref = dim_el.attrib.get('ref') if dim_el is not None else None

        rows_data = []
        for row_el in ws_root.findall('.//main:sheetData/main:row', ns):
            cells = []
            for c_el in row_el.findall('main:c', ns):
                c_type = c_el.attrib.get('t', 'n')
                if c_type == 'inlineStr':
                    t_el = c_el.find('.//main:t', ns)
                    val = t_el.text if (t_el is not None and t_el.text is not None) else ''
                elif c_type == 'n':
                    v_el = c_el.find('main:v', ns)
                    raw_v = v_el.text if v_el is not None else '0'
                    val = float(raw_v) if '.' in raw_v else int(raw_v)
                elif c_type == 'b':
                    v_el = c_el.find('main:v', ns)
                    val = (v_el.text == '1') if v_el is not None else False
                else:
                    val = None
                cells.append({'ref': c_el.attrib.get('r'), 'type': c_type, 'value': val})
            rows_data.append(cells)
        sheets_out.append({
            'name': sh_name,
            'sheetId': sh_id,
            'rId': r_id,
            'target': target,
            'dimension': dim_ref,
            'rowCount': len(rows_data),
            'rows': rows_data
        })

print(json.dumps({'ok': True, 'sheets': sheets_out}))
`;
    const stdout = execFileSync('python3', ['-c', pyScript, tmpFile], { encoding: 'utf8' });
    return JSON.parse(stdout);
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (_) {}
  }
}

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

  // Students & CR in Mercury Cohort (including Unicode Devanagari & formula-injection test names!)
  await db.run(
    `INSERT INTO students (studentId, username, name, email, role, passwordHash, semester, cohort_id, account_status)
     VALUES ('stu_p2_1', 'aashrita_m', 'Aashrita लामिछाने (Mercury)', 'm1@gandaki.edu.np', 'student', ?, 'Semester 1', ?, 'active')`,
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
// 1. AUTHORIZATION, OWNERSHIP FORGERY & TOKEN REJECTION TESTS (Audit B)
// ============================================================================

test('Phase 2 Auth 1 (Audit B): Unauthenticated requests, students, and CRs are rejected across all backup coordination and workbook endpoints (including aliases)', async () => {
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
    { method: 'GET', path: `/api/attendance/workbooks/daily?date=${TODAY_NEPAL}` },
    { method: 'GET', path: '/api/attendance/backup/workbooks/annual?year=2026' },
    { method: 'GET', path: '/api/attendance/workbooks/annual?year=2026' }
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

test('Phase 2 Auth 2 (Audit B): Connection metadata rejects OAuth tokens/secrets, rejects ownership/role forgery, and guarantees admin read-only routes do not mutate teacher state', async () => {
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

  // 2. Teacher A attempts to forge Teacher B's teacherId, userId, or role -> 403 OWNERSHIP_FORGERY_REJECTED
  for (const forgedBody of [
    { teacherId: 'tea_id_b', rootFolderId: 'folder_root_123' },
    { userId: 'tea_user_b', rootFolderId: 'folder_root_123' },
    { role: 'admin', rootFolderId: 'folder_root_123' }
  ]) {
    const forgeRes = await fetch(`${baseUrl}/api/attendance/backup/connection`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teacherAToken}`
      },
      body: JSON.stringify(forgedBody)
    });
    assert.equal(forgeRes.status, 403);
    assert.equal((await forgeRes.json()).code, 'OWNERSHIP_FORGERY_REJECTED');
  }

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
  assert.equal((await adminPutRes.json()).code, 'TEACHER_ONLY_CONNECTION_WRITE');

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

  // 5. Teacher A checks GET /backup/status (and cannot query Teacher B's status or pass role=admin)
  const statusARes = await fetch(`${baseUrl}/api/attendance/backup/status`, {
    headers: { Authorization: `Bearer ${teacherAToken}` }
  });
  assert.equal(statusARes.status, 200);
  const statusAData = await statusARes.json();
  assert.equal(statusAData.canManageConnection, true);
  assert.equal(statusAData.connection.connectionStatus, 'connected');

  const crossStatusRes = await fetch(`${baseUrl}/api/attendance/backup/status?teacherId=tea_id_b`, {
    headers: { Authorization: `Bearer ${teacherAToken}` }
  });
  assert.equal(crossStatusRes.status, 403);

  const forgedRoleStatusRes = await fetch(`${baseUrl}/api/attendance/backup/status?role=admin`, {
    headers: { Authorization: `Bearer ${teacherAToken}` }
  });
  assert.equal(forgedRoleStatusRes.status, 403);

  // 6. Admin can read Teacher A's backup status without mutating teacher_drive_connections
  const beforeAdminRead = await db.get('SELECT * FROM teacher_drive_connections WHERE teacher_id = ?', 'tea_id_a');
  const adminStatusRes = await fetch(`${baseUrl}/api/attendance/backup/status?teacherId=tea_id_a`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert.equal(adminStatusRes.status, 200);
  const afterAdminRead = await db.get('SELECT * FROM teacher_drive_connections WHERE teacher_id = ?', 'tea_id_a');
  assert.deepEqual(afterAdminRead, beforeAdminRead, 'Admin GET /backup/status must not mutate teacher_drive_connections');
});

// ============================================================================
// 2. CONCURRENCY, LEASE SECURITY, RETRY BOUNDS & ARTIFACT STATE MACHINE (Audit A & C)
// ============================================================================

let sessionCitId = '';
let runV1Id = '';
let runV1Sha = '';

test('Phase 2 Concurrency & Claims 1 (Audit C): 256-bit CSPRNG claim tokens, zero token leakage, simultaneous claims, idempotent renewal, lease expiration recovery, strict idempotent completion hash/metadata check, and partial artifact success', async () => {
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

  // Teacher B cannot claim, complete, fail, or view revisions/artifacts of Teacher A's session
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

  // Simultaneous claims from two distinct clients (client_alpha and client_beta)
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
  // Audit C: Verify 256-bit CSPRNG hex token (64 hex chars)
  assert.match(initialSnapClaimToken, /^[0-9a-f]{64}$/, 'Claim token must be a 64-character CSPRNG hex string');

  // Audit C: Verify claimToken NEVER appears in GET /backup/pending, GET /backup/runs/:runId/artifacts, or GET /sessions/:id/revisions
  for (const readPath of [
    '/api/attendance/backup/pending',
    `/api/attendance/backup/runs/${runV1Id}/artifacts`,
    `/api/attendance/sessions/${sessionCitId}/revisions`
  ]) {
    const readRes = await fetch(`${baseUrl}${readPath}`, {
      headers: { Authorization: `Bearer ${teacherAToken}` }
    });
    assert.equal(readRes.status, 200);
    const rawJsonText = await readRes.text();
    assert.ok(!rawJsonText.includes(initialSnapClaimToken), `Claim token must never leak in ${readPath}`);
    assert.ok(!rawJsonText.includes('claimToken'), `claimToken field must never appear in ${readPath}`);
  }

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
    1
  );

  // Wait 1300ms for lease expiration
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
  assert.equal((await expiredCompleteRes.json()).code, 'CLAIM_LEASE_EXPIRED');

  // Recovery client claims the expired lease -> 200, attemptCount increments to 2
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
  const recoveredSnap = recoverData.claimedArtifacts.find((a) => a.artifactType === 'snapshot');
  const recoveredDaily = recoverData.claimedArtifacts.find((a) => a.artifactType === 'daily_workbook');
  const recoveredAnnual = recoverData.claimedArtifacts.find((a) => a.artifactType === 'annual_workbook');
  assert.equal(recoveredSnap.attemptCount, 2);

  // Complete 'snapshot' artifact
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
      driveFileId: 'drive_snap_file_v1',
      driveFileName: 'CIT111_v1.json',
      artifactSha256: runV1Sha
    })
  });
  assert.equal(snapCompleteRes.status, 200);

  // Audit C: Idempotent repeat completion with exact same fields -> 200 idempotent: true
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
      driveFileId: 'drive_snap_file_v1',
      driveFileName: 'CIT111_v1.json',
      artifactSha256: runV1Sha
    })
  });
  assert.equal(snapRepeatRes.status, 200);
  assert.equal((await snapRepeatRes.json()).idempotent, true);

  // Audit C: Attempting to change driveFileName or artifactSha256 on an already completed artifact -> 409
  const tamperNameRes = await fetch(`${baseUrl}/api/attendance/backup/runs/${runV1Id}/complete`, {
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
      driveFileId: 'drive_snap_file_v1',
      driveFileName: 'tampered_name.json',
      artifactSha256: runV1Sha
    })
  });
  assert.equal(tamperNameRes.status, 409);
  assert.equal((await tamperNameRes.json()).code, 'INVALID_ARTIFACT_STATE_TRANSITION');

  // Fail 'daily_workbook' and complete 'annual_workbook', then retry 'daily_workbook'
  await fetch(`${baseUrl}/api/attendance/backup/runs/${runV1Id}/fail`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      artifactType: 'daily_workbook',
      claimToken: recoveredDaily.claimToken,
      errorCode: 'DRIVE_RATE_LIMIT',
      errorMessage: 'Upload failed with Bearer ya29.a0AfH6SMBx_leaked_token',
      retryDelayMs: 0
    })
  });

  const annualFileSha = 'a'.repeat(64);
  await fetch(`${baseUrl}/api/attendance/backup/runs/${runV1Id}/complete`, {
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
      driveFileId: 'drive_annual_file_2026',
      artifactSha256: annualFileSha
    })
  });

  // Audit C: Verify attempting to alter artifactSha256 of already completed annual_workbook is rejected with 409
  const tamperAnnualShaRes = await fetch(`${baseUrl}/api/attendance/backup/runs/${runV1Id}/complete`, {
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
      driveFileId: 'drive_annual_file_2026',
      artifactSha256: 'b'.repeat(64)
    })
  });
  assert.equal(tamperAnnualShaRes.status, 409);

  // Re-claim and complete 'daily_workbook'
  const retryClaimRes = await fetch(`${baseUrl}/api/attendance/backup/runs/${runV1Id}/claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({ clientId: 'client_recovery', forceRetry: true })
  });
  const retryClaimData = await retryClaimRes.json();
  assert.equal(retryClaimData.claimedArtifacts.length, 1);
  assert.equal(retryClaimData.claimedArtifacts[0].artifactType, 'daily_workbook');

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
  assert.equal((await dailyCompleteRes.json()).backupStatus, 'backed_up');
});

test('Phase 2 Audit A & C: Historical v1 snapshot immutability after v2/v3 edits, disconnect revoking active worker claims, and bounded retry exhaustion', async () => {
  // Create a session for BSM111 on YESTERDAY_NEPAL (v1: stu_p2_1 = present, stu_p2_2 = present)
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

  // Audit C: Claim v1, then Teacher A calls POST /backup/disconnect while worker holds active claim!
  const preDiscClaimRes = await fetch(`${baseUrl}/api/attendance/backup/runs/${bsmV1RunId}/claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({ clientId: 'worker_before_disconnect' })
  });
  assert.equal(preDiscClaimRes.status, 200);
  const preDiscClaimData = await preDiscClaimRes.json();
  const preDiscSnapToken = preDiscClaimData.claimedArtifacts.find((a) => a.artifactType === 'snapshot').claimToken;

  const discRes = await fetch(`${baseUrl}/api/attendance/backup/disconnect`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({})
  });
  assert.equal(discRes.status, 200);

  // Worker with pre-disconnect claimToken tries to complete -> 409 INVALID_ARTIFACT_STATE_TRANSITION
  const postDiscComplete = await fetch(`${baseUrl}/api/attendance/backup/runs/${bsmV1RunId}/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      artifactType: 'snapshot',
      claimToken: preDiscSnapToken,
      revisionNo: 1,
      snapshotSha256: bsmV1Sha,
      driveFileId: 'should_be_rejected_after_disconnect'
    })
  });
  assert.equal(postDiscComplete.status, 409);

  // Reconnect Teacher A
  await fetch(`${baseUrl}/api/attendance/backup/connection`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({
      googleEmail: 'sharma.drive@gmail.com',
      rootFolderId: 'drive_root_sharma_01',
      connectionStatus: 'connected'
    })
  });

  // Claim v1 again, then edit session (v2) and admin-correct session (v3)
  const v1ClaimRes = await fetch(`${baseUrl}/api/attendance/backup/runs/${bsmV1RunId}/claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherAToken}`
    },
    body: JSON.stringify({ clientId: 'stale_worker' })
  });
  const v1ClaimData = await v1ClaimRes.json();
  const v1DailyClaimToken = v1ClaimData.claimedArtifacts.find((a) => a.artifactType === 'daily_workbook').claimToken;
  const v1SnapClaimToken = v1ClaimData.claimedArtifacts.find((a) => a.artifactType === 'snapshot').claimToken;

  // Teacher edit -> v2 (stu_p2_2 changed to absent)
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
  const bsmV2Sha = v2Data.backupRevision.snapshotSha256;

  // Admin correction -> v3 (both stu_p2_1 and stu_p2_2 changed to absent)
  const v3Res = await fetch(`${baseUrl}/api/attendance/admin/sessions/${bsmSessionId}/correct`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      reason: 'Admin correction creating v3',
      records: [
        { studentId: 'stu_p2_1', status: 'absent' },
        { studentId: 'stu_p2_2', status: 'absent' }
      ]
    })
  });
  assert.equal(v3Res.status, 200);
  const v3Data = await v3Res.json();
  const bsmV3Sha = v3Data.backupRevision.snapshotSha256;

  // Audit A: Retrieve v1 via GET /api/attendance/backup/runs/:v1RunId/artifacts and GET /api/attendance/sessions/:id/revisions
  // Verify v1 still has its exact original records (both 'present') and original SHA-256 hash, NEVER reconstructed from current attendance_records (where both are 'absent')!
  const v1ArtRes = await fetch(`${baseUrl}/api/attendance/backup/runs/${bsmV1RunId}/artifacts`, {
    headers: { Authorization: `Bearer ${teacherAToken}` }
  });
  assert.equal(v1ArtRes.status, 200);
  const v1ArtData = await v1ArtRes.json();
  assert.equal(v1ArtData.revisionNo, 1);
  assert.equal(v1ArtData.isLatestRevision, false);
  assert.equal(v1ArtData.snapshot.sha256, bsmV1Sha);
  assert.equal(computeCanonicalSnapshotHash(v1ArtData.snapshot.payload), bsmV1Sha);
  assert.deepEqual(
    v1ArtData.snapshot.payload.records.map((r) => ({ studentId: r.studentId, status: r.status })),
    [
      { studentId: 'stu_p2_1', status: 'present' },
      { studentId: 'stu_p2_2', status: 'present' }
    ],
    'v1 snapshot payload must retain original v1 records even after v2 and v3 mutated attendance_records'
  );

  // Verify hash chain v1 -> v2 -> v3 via GET /api/attendance/sessions/:id/revisions
  const revListRes = await fetch(`${baseUrl}/api/attendance/sessions/${bsmSessionId}/revisions`, {
    headers: { Authorization: `Bearer ${teacherAToken}` }
  });
  assert.equal(revListRes.status, 200);
  const revListData = await revListRes.json();
  assert.equal(revListData.revisions.length, 3);
  assert.equal(revListData.revisions[0].previousSnapshotSha256, null);
  assert.equal(revListData.revisions[0].snapshotSha256, bsmV1Sha);
  assert.equal(revListData.revisions[1].previousSnapshotSha256, bsmV1Sha);
  assert.equal(revListData.revisions[1].snapshotSha256, bsmV2Sha);
  assert.equal(revListData.revisions[2].previousSnapshotSha256, bsmV2Sha);
  assert.equal(revListData.revisions[2].snapshotSha256, bsmV3Sha);

  // Stale worker tries to complete v1's daily_workbook AFTER v2/v3 were committed -> 409 STALE_REVISION_WORKBOOK
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

  // Complete v1's immutable 'snapshot' artifact -> v1 transitions to 'backed_up'
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
  assert.equal((await v1SnapComplete.json()).backupStatus, 'backed_up');

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
    assert.equal(claimRes.status, 200);
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
// 3. AUDIT D — INITIAL SESSION CREATION RACES WITHOUT IN-PROCESS MUTEX
// ============================================================================

test('Phase 2 Audit D: Simultaneous initial session submissions with skipInProcessLock=true converge atomically with zero duplicate sessions or orphaned backup rows', async () => {
  const raceDate = '2026-03-15';
  const [resA, resB] = await Promise.all([
    saveAttendanceSession(db, {
      actorUserId: 'tea_user_a',
      subjectId: 'BSM111',
      cohortId: cohortMercury.id,
      sessionDate: raceDate,
      skipInProcessLock: true,
      records: [
        { studentId: 'stu_p2_1', status: 'present' },
        { studentId: 'stu_p2_2', status: 'absent' }
      ]
    }),
    saveAttendanceSession(db, {
      actorUserId: 'tea_user_a',
      subjectId: 'BSM111',
      cohortId: cohortMercury.id,
      sessionDate: raceDate,
      skipInProcessLock: true,
      records: [
        { studentId: 'stu_p2_1', status: 'present' },
        { studentId: 'stu_p2_2', status: 'present' }
      ]
    })
  ]);

  assert.equal(resA.session.id, resB.session.id, 'Both concurrent submissions must resolve to the same session ID');

  const sessionRows = await db.all(
    `SELECT * FROM attendance_sessions WHERE cohort_id = ? AND subject_id = 'BSM111' AND session_date = ?`,
    cohortMercury.id,
    raceDate
  );
  assert.equal(sessionRows.length, 1, 'Strictly 1 session row must exist');

  const runRows = await db.all(
    `SELECT * FROM attendance_backup_runs WHERE session_id = ? ORDER BY revision_no ASC`,
    resA.session.id
  );
  assert.equal(runRows.length, 2, 'Strictly 2 sequential revisions (v1 and v2) must exist');
  assert.equal(Number(runRows[0].revisionNo || runRows[0].revision_no), 1);
  assert.equal(Number(runRows[1].revisionNo || runRows[1].revision_no), 2);
  assert.equal(
    runRows[1].previousSnapshotSha256 || runRows[1].previous_snapshot_sha256,
    runRows[0].snapshotSha256 || runRows[0].snapshot_sha256,
    'v2 must chain to v1 snapshotSha256'
  );

  // Verify zero orphaned backup runs or artifacts exist anywhere in DB
  const orphanRuns = await db.all(
    `SELECT r.id FROM attendance_backup_runs r
     LEFT JOIN attendance_sessions s ON s.id = r.session_id
     WHERE s.id IS NULL`
  );
  assert.equal(orphanRuns.length, 0, 'Zero orphaned backup runs may exist');
});

// ============================================================================
// 4. AUDIT E — INDEPENDENT XLSX VALIDATION (JSZip + Python zipfile/ElementTree)
// ============================================================================

test('Phase 2B XLSX 1 (Audit E): Independent validation of worksheet name sanitization, collision deduplication, formula-injection neutralization, and empty datasets', async () => {
  assert.equal(sanitizeFormulaCellText("=CMD|' /C calc'!A0"), "'=CMD|' /C calc'!A0");
  assert.equal(sanitizeFormulaCellText('+SUM(A1:A10)'), "'+SUM(A1:A10)");
  assert.equal(sanitizeFormulaCellText('-1+2'), "'-1+2");
  assert.equal(sanitizeFormulaCellText('@SUM(1,2)'), "'@SUM(1,2)");
  assert.equal(sanitizeFormulaCellText('  =HYPERLINK("http://evil.tld")'), "'  =HYPERLINK(\"http://evil.tld\")");
  assert.equal(sanitizeFormulaCellText('Normal Student Name'), 'Normal Student Name');

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

  // Empty Daily Workbook validated independently via JSZip + Python zipfile/ElementTree
  const emptyDailyRes = await fetch(
    `${baseUrl}/api/attendance/backup/workbooks/daily?date=${TWO_DAYS_AGO_NEPAL}`,
    { headers: { Authorization: `Bearer ${teacherAToken}` } }
  );
  assert.equal(emptyDailyRes.status, 200);
  assert.equal(emptyDailyRes.headers.get('content-type'), XLSX_MIME_TYPE);
  const emptyDailyBuf = await emptyDailyRes.buffer();
  const indepEmptyDaily = await validateXlsxIndependently(emptyDailyBuf);
  assert.equal(indepEmptyDaily.ok, true);
  assert.deepEqual(indepEmptyDaily.sheets.map((s) => s.name), ['Daily Summary']);

  // Future date rejected with 400
  const futureDailyRes = await fetch(
    `${baseUrl}/api/attendance/backup/workbooks/daily?date=${TOMORROW_NEPAL}`,
    { headers: { Authorization: `Bearer ${teacherAToken}` } }
  );
  assert.equal(futureDailyRes.status, 400);
  assert.equal((await futureDailyRes.json()).code, 'FUTURE_DATE_NOT_ALLOWED');

  // Empty Annual Workbook validated independently
  const emptyAnnualRes = await fetch(
    `${baseUrl}/api/attendance/backup/workbooks/annual?year=2021`,
    { headers: { Authorization: `Bearer ${teacherAToken}` } }
  );
  assert.equal(emptyAnnualRes.status, 200);
  const indepEmptyAnnual = await validateXlsxIndependently(await emptyAnnualRes.buffer());
  assert.equal(indepEmptyAnnual.ok, true);
  assert.deepEqual(indepEmptyAnnual.sheets.map((s) => s.name), [
    'Session Overview',
    'Subject Summaries',
    'Audit & Revisions'
  ]);
});

test('Phase 2B XLSX 2 (Audit B & E): Independent validation of Daily workbook contents, cross-teacher isolation (even on shared subject!), Unicode Devanagari, formula-injection escaping, and privacy minimization', async () => {
  // Teacher B creates a session for ELX111 on TODAY_NEPAL
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
  const teaBSessionId = (await teaBSave.json()).session.id;

  // Audit B: Even if Teacher B is temporarily granted CIT111 subject assignment, Teacher B must NOT
  // be able to read Teacher A's session revisions or export Teacher A's CIT111 session in Teacher B's workbook!
  await db.run(
    `INSERT INTO teacher_subjects (id, teacher_id, subject_id) VALUES ('ts_shared_cit', 'tea_id_b', 'CIT111')`
  );
  try {
    const crossTeacherRevRes = await fetch(`${baseUrl}/api/attendance/sessions/${sessionCitId}/revisions`, {
      headers: { Authorization: `Bearer ${teacherBToken}` }
    });
    assert.equal(
      crossTeacherRevRes.status,
      403,
      'Teacher B must be blocked from viewing Teacher A session revisions even when sharing a subject code'
    );

    const teaBDailyWb = await fetch(
      `${baseUrl}/api/attendance/backup/workbooks/daily?date=${TODAY_NEPAL}&format=json`,
      { headers: { Authorization: `Bearer ${teacherBToken}` } }
    );
    assert.equal(teaBDailyWb.status, 200);
    const teaBDailyData = await teaBDailyWb.json();
    assert.deepEqual(
      teaBDailyData.sessions.map((s) => s.sessionId),
      [teaBSessionId],
      'Teacher B daily workbook must only include Teacher B sessions, never Teacher A sessions'
    );
  } finally {
    await db.run(`DELETE FROM teacher_subjects WHERE id = 'ts_shared_cit'`);
  }

  // Teacher A downloads Daily Workbook for TODAY_NEPAL and we validate it with independent JSZip + Python XML validator
  const dailyRes = await fetch(
    `${baseUrl}/api/attendance/backup/workbooks/daily?date=${TODAY_NEPAL}`,
    { headers: { Authorization: `Bearer ${teacherAToken}` } }
  );
  assert.equal(dailyRes.status, 200);
  const buf = await dailyRes.buffer();

  const indep = await validateXlsxIndependently(buf);
  assert.equal(indep.ok, true);
  assert.deepEqual(indep.sheets.map((s) => s.name), ['Daily Summary', 'CIT111_Mercury']);
  assert.ok(indep.sheets[0].dimension.startsWith('A1:'));
  assert.ok(indep.sheets[1].dimension.startsWith('A1:'));

  // Inspect cells extracted by Python's ElementTree parser
  const detailRowsPy = indep.sheets[1].rows;
  const stu1Cells = detailRowsPy.find((r) => r.some((c) => c.value === 'stu_p2_1'));
  const stu2Cells = detailRowsPy.find((r) => r.some((c) => c.value === 'stu_p2_2'));
  assert.ok(stu1Cells, 'stu_p2_1 row must be present in Python-parsed XML');
  assert.equal(stu1Cells[2].value, 'Aashrita लामिछाने (Mercury)', 'Unicode Devanagari student name must round-trip intact');
  assert.equal(stu2Cells[2].type, 'inlineStr');
  assert.ok(String(stu2Cells[2].value).startsWith("'=CMD|"), 'Formula-injection string must be prefixed with literal single quote');

  // Audit B privacy check: ensure no student email, username, or actorUserId appears in the workbook XML
  const fullIndepJson = JSON.stringify(indep);
  assert.ok(!fullIndepJson.includes('m1@gandaki.edu.np'), 'Student email must not appear in workbook');
  assert.ok(!fullIndepJson.includes('aashrita_m'), 'Student username must not appear in workbook');
  assert.ok(!fullIndepJson.includes('tea_user_a'), 'Internal actorUserId must not appear in workbook');
});

test('Phase 2B XLSX 3 (Audit B & E): Independent validation of Annual workbook uncapped totals (>50 sessions), year boundary isolation, email scrubbing in audit reasons, and 413 oversized request protection', async () => {
  // Seed 55 finalized sessions in 2025 for CIT111 and 1 session in 2024-12-31
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

  let last2025SessionId = '';
  for (let i = 1; i <= 55; i++) {
    const month = i <= 28 ? '01' : '02';
    const day = String(i <= 28 ? i : i - 28).padStart(2, '0');
    const dateStr = `2025-${month}-${day}`;
    const stu1Present = i <= 44;

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

  // Perform an admin correction on the 55th session with an email address and formula prefix in the reason
  await adminCorrectAttendanceSession(db, {
    adminUserId: 'admin_p2',
    sessionId: last2025SessionId,
    reason: '=Approved medical note from doctor@hospital.org.np for student',
    records: [
      { studentId: 'stu_p2_1', status: 'present' },
      { studentId: 'stu_p2_2', status: 'present' }
    ]
  });

  // Generate 2025 Annual Workbook and validate independently via JSZip + Python zipfile/ElementTree
  const annualRes = await fetch(
    `${baseUrl}/api/attendance/backup/workbooks/annual?year=2025`,
    { headers: { Authorization: `Bearer ${teacherAToken}` } }
  );
  assert.equal(annualRes.status, 200);
  const annualBuf = await annualRes.buffer();

  const indepAnnual = await validateXlsxIndependently(annualBuf);
  assert.equal(indepAnnual.ok, true);
  assert.deepEqual(indepAnnual.sheets.map((s) => s.name), [
    'Session Overview',
    'Subject Summaries',
    'Mat_CIT111_Mercury_S1',
    'Audit & Revisions'
  ]);

  // Verify Subject Summaries sheet via Python parser has 55 total sessions, 45 present, 10 absent, 81.82%
  const subjSummariesPy = indepAnnual.sheets[1].rows;
  const stu1SummaryCells = subjSummariesPy.find((r) => r.some((c) => c.value === 'stu_p2_1'));
  assert.ok(stu1SummaryCells);
  assert.equal(stu1SummaryCells[7].type, 'n');
  assert.equal(stu1SummaryCells[7].value, 55);
  assert.equal(stu1SummaryCells[8].value, 45);
  assert.equal(stu1SummaryCells[9].value, 10);
  assert.equal(stu1SummaryCells[10].value, 81.82);

  // Verify Audit & Revisions sheet scrubbed the email in reason and prefixed formula '=' with "'"
  const auditSheetText = JSON.stringify(indepAnnual.sheets[3]);
  assert.ok(!auditSheetText.includes('doctor@hospital.org.np'), 'Email in audit reason must be scrubbed from exported workbook');
  assert.ok(auditSheetText.includes('[REDACTED_EMAIL]'), 'Redacted email placeholder must appear');
  assert.ok(auditSheetText.includes("'=Approved medical note"), 'Formula prefix in audit reason must be neutralized');
  assert.ok(!auditSheetText.includes('admin_p2'), 'Internal actorUserId must not appear in Audit & Revisions sheet');

  // Verify oversized request protection (413 WORKBOOK_LIMIT_EXCEEDED) when session count exceeds maxSessionsLimit
  await assert.rejects(
    async () => {
      await generateAnnualAttendanceWorkbook(db, {
        actorUserId: 'tea_user_a',
        year: '2025',
        maxSessionsLimit: 10
      });
    },
    (err) => err && err.status === 413 && err.code === 'WORKBOOK_LIMIT_EXCEEDED'
  );
});

// ============================================================================
// 5. AUDIT D & F — POSTGRESQL (PGLITE) UPGRADE PATHS, CONCURRENT SCHEMA INIT & RACES
// ============================================================================

test('Phase 2 PostgreSQL (PGlite) (Audit D & F): Upgrade path from Step 2 -> Phase 1 -> Phase 2, concurrent ensureAttendanceSchema startup, cross-connection initial session race, and FOR UPDATE claims pass on PostgreSQL', async () => {
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

  // Audit F: Apply Step 2 -> Phase 1 -> Phase 2 migrations sequentially, then fire 3 concurrent ensureAttendanceSchema() calls
  for (const migFile of [
    '20261024_attendance_schema.sql',
    '20261025_attendance_drive_backup.sql',
    '20261026_attendance_backup_artifacts.sql'
  ]) {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', migFile), 'utf8');
    await pgDb.exec(sql);
  }

  await Promise.all([
    ensureAttendanceSchema(pgDb),
    ensureAttendanceSchema(pgDb),
    ensureAttendanceSchema(pgDb)
  ]);

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

  // Audit D on PostgreSQL: Simultaneous initial session submissions with skipInProcessLock=true
  const [pgSave1, pgSave2] = await Promise.all([
    saveAttendanceSession(pgDb, {
      actorUserId: 'pg_tea_1',
      subjectId: 'CIT111',
      cohortId: pgCohort.id,
      sessionDate: TODAY_NEPAL,
      skipInProcessLock: true,
      records: [{ studentId: 'pg_stu_1', status: 'absent' }]
    }),
    saveAttendanceSession(pgDb, {
      actorUserId: 'pg_tea_1',
      subjectId: 'CIT111',
      cohortId: pgCohort.id,
      sessionDate: TODAY_NEPAL,
      skipInProcessLock: true,
      records: [{ studentId: 'pg_stu_1', status: 'present' }]
    })
  ]);
  assert.equal(pgSave1.session.id, pgSave2.session.id);

  const pgRevs = await pgDb.all(
    `SELECT * FROM attendance_backup_runs WHERE session_id = ? ORDER BY revision_no ASC`,
    pgSave1.session.id
  );
  assert.equal(pgRevs.length, 2, 'Both PG concurrent submissions must be recorded as sequential revisions v1 and v2');
  const latestPgRun = pgRevs[1];
  const pgRunId = latestPgRun.id;
  const pgSha = latestPgRun.snapshotSha256 || latestPgRun.snapshot_sha256;

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
        revisionNo: 2,
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
  const indepPgDaily = await validateXlsxIndependently(
    Buffer.from(artBundle.workbooks.daily.bundle.base64, 'base64')
  );
  assert.equal(indepPgDaily.ok, true);

  await pg.close();
});
