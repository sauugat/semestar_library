'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const express = require('express');
const session = require('express-session');

// Import core modules
const {
  ensureAuditSchema,
  recordAdminAudit,
  queryAdminAuditLogs,
  sanitizeAuditData
} = require('../lib/audit-service');

const {
  ensureTeacherSchema,
  createTeacherInvite,
  createTeacherInvitesBatch,
  regenerateTeacherInvitePassword,
  reissueTeacherInvite,
  revokeTeacherInvite,
  assignTeacherSubject,
  removeTeacherSubject,
  getTeacherAssignments,
  isTeacherOnboardingEnabled
} = require('../lib/teacher-service');

const { createAdminTeachersRouter } = require('../routes/admin-teachers');
const { createAdminDashboardRouter } = require('../routes/admin-dashboard');
const { createTeacherOnboardingRouter } = require('../routes/teacher-onboarding');

// Disposable SQLite DB test helper
const tempDbPath = path.join(
  os.tmpdir(),
  `admin_audit_safety_p4b1_1_${Date.now()}_${Math.random().toString(36).slice(2)}.db`
);
process.env.DATABASE_URL = `file:${tempDbPath}`;
process.env.SESSION_SECRET = 'test-session-secret-phase-4b1-1-safety-verification';
process.env.TEACHER_ONBOARDING_SECRET = 'test-teacher-onboarding-secret-key-32-bytes-secure!';
delete process.env.TEACHER_ONBOARDING_ENABLED; // strictly disabled

const db = require('../db');

let server;
let baseUrl;

test.before(async () => {
  // Initialize baseline application schema in disposable test database
  await db.initSchema();

  // Create isolated admin and student accounts for auth matrix testing
  const now = new Date().toISOString();
  await db.run(
    `INSERT OR REPLACE INTO students (studentId, name, passwordHash, role, createdAt)
     VALUES (?, ?, ?, ?, ?)`,
    'admin_safe_01', 'Admin Safe User', 'hash123', 'admin', now
  );
  await db.run(
    `INSERT OR REPLACE INTO students (studentId, name, passwordHash, role, createdAt)
     VALUES (?, ?, ?, ?, ?)`,
    'student_safe_01', 'Regular Student User', 'hash123', 'student', now
  );
  await db.run(
    `INSERT OR REPLACE INTO students (studentId, name, passwordHash, role, createdAt)
     VALUES (?, ?, ?, ?, ?)`,
    'cr_safe_01', 'Class Rep User', 'hash123', 'cr', now
  );
  await db.run(
    `INSERT OR REPLACE INTO students (studentId, name, passwordHash, role, createdAt)
     VALUES (?, ?, ?, ?, ?)`,
    'teacher_safe_01', 'Teacher Safe User', 'hash123', 'teacher', now
  );

  // Seed sample teacher and subject for assignment testing
  await db.run(
    `INSERT OR REPLACE INTO teachers (id, user_id, status, department, designation, created_at)
     VALUES (?, ?, 'active', 'BIT', 'Lecturer', ?)`,
    'T_SAFE_01', 'teacher_safe_01', now
  );
  await db.run(
    `INSERT OR REPLACE INTO subjects (id, code, name, semester, department, active)
     VALUES (?, ?, ?, ?, ?, 1)`,
    'SUB_SAFE_01', 'SAFE101', 'Safety Architecture', 1, 'BIT'
  );
  await db.run(
    `INSERT OR REPLACE INTO subjects (id, code, name, semester, department, active)
     VALUES (?, ?, ?, ?, ?, 1)`,
    'SUB_SAFE_02', 'SAFE102', 'Transactional Verification', 1, 'BIT'
  );

  // Setup express test server
  const app = express();
  app.use(express.json());
  app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
  }));

  // Login mock endpoint for cookie generation
  app.post('/api/test-login', (req, res) => {
    const { studentId, role } = req.body;
    req.session.studentId = studentId;
    req.session.userRole = role;
    res.json({ success: true, studentId, role });
  });

  const requireLogin = (req, res, next) => {
    if (!req.session || !req.session.studentId) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    next();
  };

  app.use('/api/admin', createAdminTeachersRouter({ db, requireLogin }));
  app.use('/api/admin', createAdminDashboardRouter({ db, requireLogin }));
  app.use('/api/teacher/onboarding', createTeacherOnboardingRouter({ db, requireLogin }));

  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

test.after(async () => {
  if (server) await new Promise(r => server.close(r));
  await db.close();
  try {
    if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
  } catch (_) {}
});

// Helper for cookie-authenticated HTTP requests
async function makeRequest(path, { method = 'GET', body = null, headers = {} } = {}) {
  const url = `${baseUrl}${path}`;
  const fetchOpts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  };
  if (body) {
    fetchOpts.body = JSON.stringify(body);
  }
  const res = await fetch(url, fetchOpts);
  let json = null;
  try {
    json = await res.json();
  } catch (_) {}
  return { status: res.status, headers: res.headers, body: json };
}

async function loginAs(studentId, role) {
  const res = await fetch(`${baseUrl}/api/test-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId, role })
  });
  const cookie = res.headers.get('set-cookie');
  return cookie ? cookie.split(';')[0] : '';
}

// ============================================================================
// TEST 1: Production-mode application does not create audit tables automatically
// ============================================================================
test('1. Production-mode application does not create audit tables automatically', async () => {
  // Create a separate disposable database for schema safety isolation
  const isolatedProdDbPath = path.join(
    os.tmpdir(),
    `prod_guard_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`
  );
  const { createClient } = require('@libsql/client');
  const isolatedClient = createClient({ url: `file:${isolatedProdDbPath}` });
  const isolatedDb = {
    isPostgres: false,
    run: (sql, ...params) => isolatedClient.execute({ sql, args: params }),
    get: async (sql, ...params) => {
      const res = await isolatedClient.execute({ sql, args: params });
      return res.rows && res.rows[0];
    },
    exec: (sql) => isolatedClient.executeMultiple(sql)
  };

  // Explicitly simulate production environment
  const originalEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';

    // Call ensureAuditSchema under production mode
    await ensureAuditSchema(isolatedDb);

    // Call ensureTeacherSchema under production mode
    await ensureTeacherSchema(isolatedDb);

    // Verify admin_audit_logs was NEVER created
    const checkTable = await isolatedDb.get(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='admin_audit_logs'"
    );
    assert.strictEqual(checkTable, undefined, 'admin_audit_logs must not exist in production mode');
  } finally {
    process.env.NODE_ENV = originalEnv;
    isolatedClient.close();
    try {
      if (fs.existsSync(isolatedProdDbPath)) fs.unlinkSync(isolatedProdDbPath);
    } catch (_) {}
  }
});

// ============================================================================
// TEST 2: Audit insert failure rolls back the associated business mutation
// ============================================================================
test('2. Audit insert failure rolls back the associated business mutation', async () => {
  // Ensure audit table exists in the main test DB for standard operations
  await ensureAuditSchema(db);

  // Attempt subject assignment with an invalid/empty adminId
  // Because audit recording is required=true within the transaction, the entire mutation must roll back
  await assert.rejects(
    async () => {
      await assignTeacherSubject(db, {
        adminId: '', // Invalid actor identity triggers audit rejection
        teacherId: 'T_SAFE_01',
        subjectIdOrCode: 'SAFE101'
      });
    },
    /Valid administrator actor identity is required/
  );

  // Verify that SAFE101 was NOT committed to teacher_subjects
  const assigned = await db.get(
    "SELECT * FROM teacher_subjects WHERE teacher_id = 'T_SAFE_01' AND subject_id = 'SUB_SAFE_01'"
  );
  assert.strictEqual(assigned, undefined, 'Teacher subject assignment must be completely rolled back');
});

// ============================================================================
// TEST 3: A failed rollback cannot leave an unaudited successful mutation
// ============================================================================
test('3. A failed rollback cannot leave an unaudited successful mutation', async () => {
  // Create an invitation to test password regeneration rollback
  const initialInvite = await createTeacherInvite(db, {
    initialUsername: 'safe_teacher_test_01',
    temporaryPassword: 'TempPassword123!',
    createdBy: 'admin_safe_01'
  });
  assert.ok(initialInvite.id);

  const beforeRow = await db.get(
    'SELECT temporary_password_hash, onboarding_nonce FROM teacher_invites WHERE id = ?',
    initialInvite.id
  );

  // Temporarily break the audit table to simulate hard audit failure inside transaction
  await db.exec('ALTER TABLE admin_audit_logs RENAME TO admin_audit_logs_temp');

  try {
    // Attempt password regeneration when audit logging cannot succeed
    await assert.rejects(
      async () => {
        await regenerateTeacherInvitePassword(db, initialInvite.id, {
          adminId: 'admin_safe_01'
        });
      },
      /Critical administrative action aborted: Required audit record could not be written/
    );

    // Verify database state: invitation password hash and nonce MUST NOT have changed
    const afterRow = await db.get(
      'SELECT temporary_password_hash, onboarding_nonce FROM teacher_invites WHERE id = ?',
      initialInvite.id
    );
    assert.strictEqual(
      afterRow.temporary_password_hash,
      beforeRow.temporary_password_hash,
      'Password hash must remain unchanged after audit failure'
    );
    assert.strictEqual(
      afterRow.onboarding_nonce,
      beforeRow.onboarding_nonce,
      'Nonce must remain unchanged after audit failure'
    );

    // Attempt invitation revocation when audit logging cannot succeed
    await assert.rejects(
      async () => {
        await revokeTeacherInvite(db, initialInvite.id, {
          adminId: 'admin_safe_01'
        });
      },
      /Critical administrative action aborted: Required audit record could not be written/
    );

    // Verify status was NOT changed to 'disabled'
    const statusRow = await db.get(
      'SELECT status FROM teacher_invites WHERE id = ?',
      initialInvite.id
    );
    assert.strictEqual(statusRow.status, 'provisioned', 'Status must not be mutated without audit');
  } finally {
    // Restore audit table
    await db.exec('ALTER TABLE admin_audit_logs_temp RENAME TO admin_audit_logs');
  }
});

// ============================================================================
// TEST 4: Bulk invitation audit failures cannot leave partially committed changes
// ============================================================================
test('4. Bulk invitation audit failures cannot leave partially committed changes', async () => {
  // Count current invites
  const countBefore = (await db.get('SELECT COUNT(*) AS c FROM teacher_invites')).c;

  // Temporarily rename audit table to trigger audit failure during bulk invite creation
  await db.exec('ALTER TABLE admin_audit_logs RENAME TO admin_audit_logs_temp');

  try {
    await assert.rejects(
      async () => {
        await createTeacherInvitesBatch(db, {
          count: 5,
          createdBy: 'admin_safe_01'
        });
      },
      /Critical administrative action aborted: Required audit record could not be written/
    );

    // Check count after failed batch: must be EXACTLY the same (0 rows inserted)
    const countAfter = (await db.get('SELECT COUNT(*) AS c FROM teacher_invites')).c;
    assert.strictEqual(countAfter, countBefore, 'Zero invites should remain after transactional rollback');
  } finally {
    await db.exec('ALTER TABLE admin_audit_logs_temp RENAME TO admin_audit_logs');
  }
});

// ============================================================================
// TEST 5: Credentials never enter audit records
// ============================================================================
test('5. Credentials never enter audit records', async () => {
  // Perform successful single, bulk, regen, and revoke operations
  const bulkResult = await createTeacherInvitesBatch(db, {
    count: 2,
    createdBy: 'admin_safe_01'
  });
  assert.strictEqual(bulkResult.invites.length, 2);
  const inviteId = bulkResult.invites[0].id;

  await regenerateTeacherInvitePassword(db, inviteId, { adminId: 'admin_safe_01' });
  await reissueTeacherInvite(db, inviteId, { adminId: 'admin_safe_01' });
  await revokeTeacherInvite(db, inviteId, { adminId: 'admin_safe_01' });

  // Query all audit logs
  const logs = await db.all('SELECT * FROM admin_audit_logs');
  assert.ok(logs.length >= 4, 'Audit records must be populated');

  for (const log of logs) {
    const rawRecord = JSON.stringify(log);

    // Ensure no plaintext password leaks
    assert.doesNotMatch(rawRecord, /temporary_password":\s*"(?!\\[REDACTED\\])[^"]+"/i);
    // Ensure no bcrypt hash leaks ($2a$, $2b$, $2y$)
    assert.doesNotMatch(rawRecord, /\$2[aby]\$[0-9]{2}\$[A-Za-z0-9./]{20,}/);

    // Check parsed states
    const metadata = log.metadata ? JSON.parse(log.metadata) : {};
    const beforeState = log.before_state ? JSON.parse(log.before_state) : {};
    const afterState = log.after_state ? JSON.parse(log.after_state) : {};

    for (const obj of [metadata, beforeState, afterState]) {
      for (const [k, v] of Object.entries(obj)) {
        if (/pass(word)?|hash|token|secret|key|nonce/i.test(k)) {
          assert.strictEqual(v, '[REDACTED]', `Field ${k} must be redacted in audit`);
        }
      }
    }
  }
});

// ============================================================================
// TEST 6: Actor identity cannot be spoofed
// ============================================================================
test('6. Actor identity cannot be spoofed', async () => {
  const adminCookie = await loginAs('admin_safe_01', 'admin');

  // Attempt to spoof actor in body and query
  const res = await makeRequest('/api/admin/teachers/T_SAFE_01/subjects', {
    method: 'POST',
    headers: { Cookie: adminCookie },
    body: {
      subjectId: 'SUB_SAFE_01',
      actorUserId: 'malicious_impersonator',
      adminId: 'malicious_impersonator'
    }
  });

  assert.strictEqual(res.status, 201);

  // Verify the audit log strictly recorded 'admin_safe_01' from session, NOT 'malicious_impersonator'
  const latestAudit = await db.get(
    "SELECT actor_user_id, action FROM admin_audit_logs WHERE action = 'teacher_subject_assigned' ORDER BY created_at DESC LIMIT 1"
  );
  assert.strictEqual(latestAudit.actor_user_id, 'admin_safe_01');
  assert.notStrictEqual(latestAudit.actor_user_id, 'malicious_impersonator');
});

// ============================================================================
// TEST 7: Unauthorized activity reads fail
// ============================================================================
test('7. Unauthorized activity reads fail', async () => {
  // 1. Unauthenticated request
  const unauthRes = await makeRequest('/api/admin/activity');
  assert.strictEqual(unauthRes.status, 401, 'Unauthenticated request must receive 401');

  // 2. Student role
  const studentCookie = await loginAs('student_safe_01', 'student');
  const studentRes = await makeRequest('/api/admin/activity', {
    headers: { Cookie: studentCookie }
  });
  assert.strictEqual(studentRes.status, 403, 'Student must receive 403');

  // 3. Class Representative (CR) role
  const crCookie = await loginAs('cr_safe_01', 'cr');
  const crRes = await makeRequest('/api/admin/activity', {
    headers: { Cookie: crCookie }
  });
  assert.strictEqual(crRes.status, 403, 'CR must receive 403');

  // 4. Teacher role
  const teacherCookie = await loginAs('teacher_safe_01', 'teacher');
  const teacherRes = await makeRequest('/api/admin/activity', {
    headers: { Cookie: teacherCookie }
  });
  assert.strictEqual(teacherRes.status, 403, 'Teacher must receive 403');

  // 5. Admin role
  const adminCookie = await loginAs('admin_safe_01', 'admin');
  const adminRes = await makeRequest('/api/admin/activity', {
    headers: { Cookie: adminCookie }
  });
  assert.strictEqual(adminRes.status, 200, 'Admin must receive 200');
  assert.ok(Array.isArray(adminRes.body.logs), 'Admin response contains activity logs');
});

// ============================================================================
// TEST 8: Teacher assignment APIs still work
// ============================================================================
test('8. Teacher assignment APIs still work', async () => {
  const adminCookie = await loginAs('admin_safe_01', 'admin');

  // Assign second subject
  const assignRes = await makeRequest('/api/admin/teachers/T_SAFE_01/subjects', {
    method: 'POST',
    headers: { Cookie: adminCookie },
    body: { subjectId: 'SUB_SAFE_02' }
  });
  assert.strictEqual(assignRes.status, 201);
  assert.strictEqual(assignRes.body.message, 'Subject assigned successfully.');

  // Remove first subject
  const removeRes = await makeRequest('/api/admin/teachers/T_SAFE_01/subjects/SUB_SAFE_01', {
    method: 'DELETE',
    headers: { Cookie: adminCookie }
  });
  assert.strictEqual(removeRes.status, 200);
  assert.strictEqual(removeRes.body.message, 'Subject assignment removed successfully.');

  // Verify resulting assignments
  const getRes = await makeRequest('/api/admin/teachers/T_SAFE_01/subjects', {
    headers: { Cookie: adminCookie }
  });
  assert.strictEqual(getRes.status, 200);
  const remainingCodes = getRes.body.subjects.map(s => s.code);
  assert.deepStrictEqual(remainingCodes, ['SAFE102']);
});

// ============================================================================
// TEST 9: Existing cohort audit records remain unchanged
// ============================================================================
test('9. Existing cohort audit records remain unchanged', async () => {
  // Ensure cohort_audit_logs exists and has data
  await db.run(
    `INSERT INTO cohort_audit_logs (id, cohort_id, action, metadata, performed_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    'cohort_audit_test_01', 'cohort_2026_bit', 'cohort_promoted', '{"nextSemester":2}', 'admin_safe_01', new Date().toISOString()
  );

  const cohortLog = await db.get("SELECT * FROM cohort_audit_logs WHERE id = 'cohort_audit_test_01'");
  assert.ok(cohortLog);
  assert.strictEqual(cohortLog.action, 'cohort_promoted');

  // Verify that querying admin_audit_logs does NOT touch or collide with cohort_audit_logs
  const adminLogs = await db.all("SELECT * FROM admin_audit_logs WHERE id = 'cohort_audit_test_01'");
  assert.strictEqual(adminLogs.length, 0, 'No ID or schema collision between audit tables');
});

// ============================================================================
// TEST 10: Teacher onboarding remains disabled platform-wide
// ============================================================================
test('10. Teacher onboarding remains disabled platform-wide', async () => {
  // Invariant check: helper reports false
  assert.strictEqual(isTeacherOnboardingEnabled(), false, 'isTeacherOnboardingEnabled must be false');

  // All onboarding endpoints return 503 Service Unavailable
  const claimRes = await makeRequest('/api/teacher/onboarding/claim', {
    method: 'POST',
    body: { token: 'mock-token' }
  });
  assert.strictEqual(claimRes.status, 503);
  assert.match(claimRes.body.message, /Teacher onboarding is currently disabled/i);

  const validateRes = await makeRequest('/api/teacher/onboarding/validate-credentials', {
    method: 'POST',
    body: { username: 'teacher001', password: 'TempPassword123!' }
  });
  assert.strictEqual(validateRes.status, 503);
  assert.match(validateRes.body.message, /Teacher onboarding is currently disabled/i);

  const completeRes = await makeRequest('/api/teacher/onboarding/complete', {
    method: 'POST',
    body: { token: 'mock-token', password: 'NewPassword123!' }
  });
  assert.strictEqual(completeRes.status, 503);
  assert.match(completeRes.body.message, /Teacher onboarding is currently disabled/i);
});
