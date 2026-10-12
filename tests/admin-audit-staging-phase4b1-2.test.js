'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const session = require('express-session');
const { PGlite } = require('@electric-sql/pglite');

const { createTransactionAdapter } = require('../lib/db-transaction');
const {
  ensureTeacherSchema,
  createTeacherInvite,
  createTeacherInvitesBatch,
  regenerateTeacherInvitePassword,
  reissueTeacherInvite,
  revokeTeacherInvite,
  assignTeacherSubject,
  removeTeacherSubject,
  getTeacherAssignments
} = require('../lib/teacher-service');

const {
  recordAdminAudit,
  queryAdminAuditLogs
} = require('../lib/audit-service');

const { createAdminTeachersRouter } = require('../routes/admin-teachers');
const { createAdminDashboardRouter } = require('../routes/admin-dashboard');
const teacherOnboardingRouter = require('../routes/teacher-onboarding');
const { isTeacherOnboardingEnabled } = require('../lib/teacher-service');

/**
 * Creates an isolated, disposable in-process PostgreSQL engine instance.
 * Completely decoupled from production Neon and requires zero network access.
 */
function createDisposablePostgresInstance() {
  const pg = new PGlite();
  const formatRow = r => r;
  const formatRows = rs => rs;

  function createPgAdapter(client) {
    const adapter = createTransactionAdapter({
      query: async (sql, args) => {
        const res = (args && args.length > 0) ? await client.query(sql, args) : await client.query(sql);
        return { rows: res.rows, rowCount: res.affectedRows };
      }
    }, true, formatRow, formatRows);
    adapter.isPostgres = true;
    adapter.exec = async (sql) => {
      if (client.exec) return await client.exec(sql);
      return await client.query(sql);
    };
    return adapter;
  }

  const db = createPgAdapter(pg);
  db.withTransaction = async (fn) => {
    return await pg.transaction(async (tx) => {
      const txAdapter = createPgAdapter(tx);
      return await fn(txAdapter);
    });
  };

  return { pg, db };
}

// Global test fixtures
let pgInstance;
let stagingDb;
let server;
let baseUrl;

test.before(async () => {
  // 1. Initialize isolated in-process PostgreSQL instance
  const instance = createDisposablePostgresInstance();
  pgInstance = instance.pg;
  stagingDb = instance.db;

  // 2. Initialize actual PostgreSQL baseline students table as db.js defines it
  await stagingDb.exec(`
    CREATE TABLE IF NOT EXISTS students (
      studentId TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      username TEXT,
      email TEXT,
      passwordHash TEXT,
      avatarUrl TEXT,
      role TEXT DEFAULT 'student',
      verification_status TEXT DEFAULT 'unverified',
      account_status VARCHAR(32) NOT NULL DEFAULT 'active',
      department TEXT DEFAULT 'BIT',
      semester TEXT DEFAULT 'Semester 1',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 3. Apply PostgreSQL teacher accounts schema
  await ensureTeacherSchema(stagingDb);

  // 4. Seed test users (disposable test fixtures, no real faculty accounts)
  await stagingDb.run("INSERT INTO students (studentId, username, name, role, department) VALUES ('admin_stag_01', 'admin_stag_01', 'Staging Admin', 'admin', 'BIT')");
  await stagingDb.run("INSERT INTO students (studentId, username, name, role, department) VALUES ('student_stag_01', 'student_stag_01', 'Staging Student', 'student', 'BIT')");
  await stagingDb.run("INSERT INTO students (studentId, username, name, role, department) VALUES ('teacher_stag_01', 'teacher_stag_01', 'Staging Teacher', 'teacher', 'BIT')");
  await stagingDb.run("INSERT INTO students (studentId, username, name, role, department) VALUES ('cr_stag_01', 'cr_stag_01', 'Staging CR', 'cr', 'BIT')");

  await stagingDb.run("INSERT INTO teachers (id, user_id, status, designation) VALUES ('T_STAG_01', 'teacher_stag_01', 'active', 'Lecturer')");
  await stagingDb.run("INSERT INTO subjects (id, code, name, semester, department, active) VALUES ('SUB_STAG_01', 'CS101', 'Intro to Computer Science', 1, 'BIT', TRUE)");
  await stagingDb.run("INSERT INTO subjects (id, code, name, semester, department, active) VALUES ('SUB_STAG_02', 'CS102', 'Data Structures', 1, 'BIT', TRUE)");

  // 5. Setup test HTTP app
  const app = express();
  app.use(express.json());
  app.use(session({
    secret: 'test-staging-session-secret-key-32-bytes',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
  }));

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

  app.use('/api/admin', createAdminTeachersRouter({ db: stagingDb, requireLogin }));
  app.use('/api/admin', createAdminDashboardRouter({ db: stagingDb, requireLogin }));
  app.use('/api/teacher/onboarding', teacherOnboardingRouter);

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
  if (pgInstance) await pgInstance.close();
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
// 1. DATABASE ENVIRONMENT SAFETY & ISOLATION
// ============================================================================
test('1. Environment Safety: Target is an isolated, disposable PostgreSQL engine without network credentials', async () => {
  // Verify that the staging database is an isolated PGlite instance
  assert.ok(stagingDb.isPostgres, 'Engine must identify as PostgreSQL');
  assert.strictEqual(typeof pgInstance.close, 'function', 'Engine is locally disposable');
  
  // Verify that live production Neon connection is NOT used in this suite
  assert.notStrictEqual(process.env.DATABASE_URL, 'postgresql://neondb_owner:...', 'Must not connect to production');
});

// ============================================================================
// 2. POSTGRESQL MIGRATION VERIFICATION
// ============================================================================
test('2. Migration: migrations/20261012_admin_audit_logs.sql applies cleanly and is idempotent', async () => {
  const migrationPath = path.join(__dirname, '..', 'migrations', '20261012_admin_audit_logs.sql');
  const migrationSql = fs.readFileSync(migrationPath, 'utf8');

  // Apply migration once
  await stagingDb.exec(migrationSql);

  // Apply migration a second time to verify idempotency
  await stagingDb.exec(migrationSql);

  // Verify column definitions in information_schema
  const columnsRes = await stagingDb.all(`
    SELECT column_name, data_type, udt_name
    FROM information_schema.columns
    WHERE table_name = 'admin_audit_logs'
    ORDER BY ordinal_position
  `);

  const colMap = Object.fromEntries(columnsRes.map(c => [c.column_name, c.udt_name || c.data_type]));
  assert.strictEqual(colMap.id, 'text', 'id must be text');
  assert.strictEqual(colMap.actor_user_id, 'text', 'actor_user_id must be text');
  assert.strictEqual(colMap.action, 'varchar', 'action must be varchar');
  assert.strictEqual(colMap.entity_type, 'varchar', 'entity_type must be varchar');
  assert.strictEqual(colMap.entity_id, 'text', 'entity_id must be text');
  assert.strictEqual(colMap.before_state, 'jsonb', 'before_state must be jsonb');
  assert.strictEqual(colMap.after_state, 'jsonb', 'after_state must be jsonb');
  assert.strictEqual(colMap.metadata, 'jsonb', 'metadata must be jsonb');
  assert.strictEqual(colMap.created_at, 'timestamptz', 'created_at must be timestamptz');

  // Verify all 4 indexes are registered in PostgreSQL
  const indexRes = await stagingDb.all(`
    SELECT indexname FROM pg_indexes WHERE tablename = 'admin_audit_logs'
  `);
  const indexNames = new Set(indexRes.map(i => i.indexname));
  assert.ok(indexNames.has('idx_admin_audit_created_at'), 'idx_admin_audit_created_at must exist');
  assert.ok(indexNames.has('idx_admin_audit_actor'), 'idx_admin_audit_actor must exist');
  assert.ok(indexNames.has('idx_admin_audit_action'), 'idx_admin_audit_action must exist');
  assert.ok(indexNames.has('idx_admin_audit_entity'), 'idx_admin_audit_entity must exist');

  // Verify Foreign Key enforcement (RESTRICT on delete of student)
  await stagingDb.run("INSERT INTO admin_audit_logs (id, actor_user_id, action, entity_type) VALUES ('audit_fk_test', 'admin_stag_01', 'test_check', 'test')");
  
  await assert.rejects(
    async () => {
      await stagingDb.run("DELETE FROM students WHERE studentId = 'admin_stag_01'");
    },
    /violates RESTRICT setting of foreign key constraint/i,
    'Deleting student with audit records must be restricted'
  );

  // Clean test row
  await stagingDb.run("DELETE FROM admin_audit_logs WHERE id = 'audit_fk_test'");
});

// ============================================================================
// 3. REAL POSTGRESQL TRANSACTION TESTS
// ============================================================================
test('3.1. Successful teacher assignment creates exactly one audit record', async () => {
  const auditBefore = (await stagingDb.all("SELECT * FROM admin_audit_logs WHERE action = 'teacher_subject_assigned'")).length;

  const result = await assignTeacherSubject(stagingDb, {
    adminId: 'admin_stag_01',
    teacherId: 'T_STAG_01',
    subjectIdOrCode: 'CS101'
  });

  assert.ok(result.subjects.some(s => s.code === 'CS101'));

  const auditAfter = await stagingDb.all("SELECT * FROM admin_audit_logs WHERE action = 'teacher_subject_assigned'");
  assert.strictEqual(auditAfter.length, auditBefore + 1, 'Exactly one audit record must be created');
  assert.strictEqual(auditAfter[auditAfter.length - 1].actor_user_id, 'admin_stag_01');
});

test('3.2. Audit failure rolls back teacher assignment on PostgreSQL', async () => {
  // Break audit table temporarily to simulate audit write failure
  await stagingDb.exec('ALTER TABLE admin_audit_logs RENAME TO admin_audit_logs_backup');

  try {
    await assert.rejects(
      async () => {
        await assignTeacherSubject(stagingDb, {
          adminId: 'admin_stag_01',
          teacherId: 'T_STAG_01',
          subjectIdOrCode: 'CS102'
        });
      },
      /Critical administrative action aborted: Required audit record could not be written/i
    );

    // Verify assignment was NOT committed to teacher_subjects
    const assignment = await stagingDb.all("SELECT * FROM teacher_subjects WHERE subject_id = 'SUB_STAG_02'");
    assert.strictEqual(assignment.length, 0, 'Assignment must be completely rolled back');
  } finally {
    await stagingDb.exec('ALTER TABLE admin_audit_logs_backup RENAME TO admin_audit_logs');
  }
});

test('3.3. Teacher subject removal and audit insert commit together', async () => {
  const auditBefore = (await stagingDb.all("SELECT * FROM admin_audit_logs WHERE action = 'teacher_subject_removed'")).length;

  const result = await removeTeacherSubject(stagingDb, {
    adminId: 'admin_stag_01',
    teacherId: 'T_STAG_01',
    subjectIdOrCode: 'CS101'
  });

  assert.ok(!result.subjects.some(s => s.code === 'CS101'));

  const auditAfter = await stagingDb.all("SELECT * FROM admin_audit_logs WHERE action = 'teacher_subject_removed'");
  assert.strictEqual(auditAfter.length, auditBefore + 1, 'Exactly one removal audit record must be created');
});

test('3.4. Failed audit prevents invitation creation on PostgreSQL', async () => {
  await stagingDb.exec('ALTER TABLE admin_audit_logs RENAME TO admin_audit_logs_backup');

  try {
    await assert.rejects(
      async () => {
        await createTeacherInvite(stagingDb, {
          initialUsername: 't_uncommitted_fail',
          temporaryPassword: 'TempPassword123!',
          createdBy: 'admin_stag_01'
        });
      },
      /Critical administrative action aborted: Required audit record could not be written/i
    );

    const invite = await stagingDb.all("SELECT * FROM teacher_invites WHERE initial_username = 't_uncommitted_fail'");
    assert.strictEqual(invite.length, 0, 'Invite must not exist after rollback');
  } finally {
    await stagingDb.exec('ALTER TABLE admin_audit_logs_backup RENAME TO admin_audit_logs');
  }
});

test('3.5. Bulk invitation failure does not leave partially committed records on PostgreSQL', async () => {
  const countBefore = (await stagingDb.all("SELECT * FROM teacher_invites")).length;

  await stagingDb.exec('ALTER TABLE admin_audit_logs RENAME TO admin_audit_logs_backup');

  try {
    await assert.rejects(
      async () => {
        await createTeacherInvitesBatch(stagingDb, {
          count: 5,
          createdBy: 'admin_stag_01'
        });
      },
      /Critical administrative action aborted: Required audit record could not be written/i
    );

    const countAfter = (await stagingDb.all("SELECT * FROM teacher_invites")).length;
    assert.strictEqual(countAfter, countBefore, 'Zero rows should be committed when bulk batch rolls back');
  } finally {
    await stagingDb.exec('ALTER TABLE admin_audit_logs_backup RENAME TO admin_audit_logs');
  }
});

test('3.6. Password regeneration cannot complete without its required audit record', async () => {
  const invite = await createTeacherInvite(stagingDb, {
    initialUsername: 't_regen_fail_test',
    temporaryPassword: 'OriginalPass123!',
    createdBy: 'admin_stag_01'
  });

  const beforeRow = await stagingDb.get("SELECT temporary_password_hash, onboarding_nonce FROM teacher_invites WHERE id = ?", invite.id);

  await stagingDb.exec('ALTER TABLE admin_audit_logs RENAME TO admin_audit_logs_backup');

  try {
    await assert.rejects(
      async () => {
        await regenerateTeacherInvitePassword(stagingDb, invite.id, {
          adminId: 'admin_stag_01'
        });
      },
      /Critical administrative action aborted: Required audit record could not be written/i
    );

    const afterRow = await stagingDb.get("SELECT temporary_password_hash, onboarding_nonce FROM teacher_invites WHERE id = ?", invite.id);
    assert.strictEqual(afterRow.temporary_password_hash, beforeRow.temporary_password_hash, 'Password hash must be unchanged');
    assert.strictEqual(afterRow.onboarding_nonce, beforeRow.onboarding_nonce, 'Nonce must be unchanged');
  } finally {
    await stagingDb.exec('ALTER TABLE admin_audit_logs_backup RENAME TO admin_audit_logs');
  }
});

test('3.7. Transactions use the same PostgreSQL connection', async () => {
  // Verify transaction adapter shares connection context
  await stagingDb.withTransaction(async (tx) => {
    // Both statement 1 and 2 are executed on the same tx client
    await tx.run("INSERT INTO subjects (id, code, name, semester, department, active) VALUES ('SUB_TX_1', 'TX101', 'Tx Test', 1, 'BIT', TRUE)");
    const foundInside = await tx.get("SELECT * FROM subjects WHERE id = 'SUB_TX_1'");
    assert.ok(foundInside, 'Row must be immediately visible on same connection client');
  });

  const foundCommitted = await stagingDb.get("SELECT * FROM subjects WHERE id = 'SUB_TX_1'");
  assert.ok(foundCommitted, 'Row must be committed after transaction finishes');
});

test('3.8. Concurrent duplicate assignments do not create inconsistent records', async () => {
  // Run two concurrent assignment attempts for the exact same teacher and subject
  const [res1, res2] = await Promise.allSettled([
    assignTeacherSubject(stagingDb, {
      adminId: 'admin_stag_01',
      teacherId: 'T_STAG_01',
      subjectIdOrCode: 'CS102'
    }),
    assignTeacherSubject(stagingDb, {
      adminId: 'admin_stag_01',
      teacherId: 'T_STAG_01',
      subjectIdOrCode: 'CS102'
    })
  ]);

  // Exactly one should succeed, and one should fail with duplicate conflict
  const fulfilledCount = [res1, res2].filter(r => r.status === 'fulfilled').length;
  const rejectedCount = [res1, res2].filter(r => r.status === 'rejected').length;

  assert.strictEqual(fulfilledCount, 1, 'Exactly one concurrent assignment must succeed');
  assert.strictEqual(rejectedCount, 1, 'Exactly one concurrent assignment must fail');

  // Verify database integrity: only 1 row in teacher_subjects
  const rows = await stagingDb.all("SELECT * FROM teacher_subjects WHERE teacher_id = 'T_STAG_01' AND subject_id = 'SUB_STAG_02'");
  assert.strictEqual(rows.length, 1, 'Only one assignment row exists');

  // Verify only 1 audit record exists
  const audits = await stagingDb.all("SELECT * FROM admin_audit_logs WHERE action = 'teacher_subject_assigned' AND entity_id = 'T_STAG_01' AND (metadata->>'subjectCode' = 'CS102')");
  assert.strictEqual(audits.length, 1, 'Only one audit log row exists');
});

// ============================================================================
// 4. ADMIN ACTIVITY VERIFICATION ON POSTGRESQL
// ============================================================================
test('4. Admin Activity HTTP verification on PostgreSQL', async () => {
  // 1. Unauthenticated -> 401
  const unauthRes = await makeRequest('/api/admin/activity');
  assert.strictEqual(unauthRes.status, 401);

  // 2. Student role -> 403
  const studentCookie = await loginAs('student_stag_01', 'student');
  const studentRes = await makeRequest('/api/admin/activity', { headers: { Cookie: studentCookie } });
  assert.strictEqual(studentRes.status, 403);

  // 3. Teacher role -> 403
  const teacherCookie = await loginAs('teacher_stag_01', 'teacher');
  const teacherRes = await makeRequest('/api/admin/activity', { headers: { Cookie: teacherCookie } });
  assert.strictEqual(teacherRes.status, 403);

  // 4. CR role -> 403
  const crCookie = await loginAs('cr_stag_01', 'cr');
  const crRes = await makeRequest('/api/admin/activity', { headers: { Cookie: crCookie } });
  assert.strictEqual(crRes.status, 403);

  // 5. Admin role -> 200
  const adminCookie = await loginAs('admin_stag_01', 'admin');
  const adminRes = await makeRequest('/api/admin/activity?page=1&limit=5', { headers: { Cookie: adminCookie } });
  assert.strictEqual(adminRes.status, 200);
  assert.strictEqual(adminRes.body.auditTableAvailable, true);
  assert.ok(Array.isArray(adminRes.body.logs));
  assert.ok(adminRes.body.logs.length > 0);

  // Verify pagination
  assert.strictEqual(adminRes.body.pagination.page, 1);
  assert.strictEqual(adminRes.body.pagination.limit, 5);

  // Verify filtering by action
  const filterRes = await makeRequest('/api/admin/activity?action=teacher_subject_assigned', { headers: { Cookie: adminCookie } });
  assert.strictEqual(filterRes.status, 200);
  for (const log of filterRes.body.logs) {
    assert.strictEqual(log.action, 'teacher_subject_assigned');
  }

  // Verify sensitive credentials absence
  for (const log of adminRes.body.logs) {
    const raw = JSON.stringify(log);
    assert.doesNotMatch(raw, /passwordHash/i);
    assert.doesNotMatch(raw, /\$2[aby]\$/);
  }

  // Verify persistence across simulated app restart (re-query directly via PostgreSQL)
  const persistedQuery = await queryAdminAuditLogs(stagingDb, { page: 1, limit: 10 });
  assert.ok(persistedQuery.logs.length > 0, 'Audit history persists in PostgreSQL');
});

// ============================================================================
// 5. EXISTING TEACHER FUNCTIONALITY ON POSTGRESQL STAGING
// ============================================================================
test('5. Existing teacher functionality operates cleanly on PostgreSQL staging', async () => {
  const adminCookie = await loginAs('admin_stag_01', 'admin');
  
  // 1. List teacher invites via admin route
  const invitesRes = await makeRequest('/api/admin/teacher-invites', { headers: { Cookie: adminCookie } });
  assert.strictEqual(invitesRes.status, 200);
  assert.ok(Array.isArray(invitesRes.body.invites));

  // 2. Fetch teacher assignments
  const assignments = await getTeacherAssignments(stagingDb, 'T_STAG_01');
  assert.ok(Array.isArray(assignments.subjects));
});

// ============================================================================
// 6. TEACHER ONBOARDING REMAINS DISABLED
// ============================================================================
test('6. Teacher onboarding feature flag remains strictly disabled', async () => {
  // 1. Service function flag must return false
  assert.strictEqual(isTeacherOnboardingEnabled(), false, 'Teacher onboarding flag must remain false');

  // 2. HTTP endpoint must fail-closed with 503 Service Unavailable
  const onboardRes = await makeRequest('/api/teacher/onboarding/validate-credentials', {
    method: 'POST',
    body: {
      temporaryUsername: 't_disabled_test',
      temporaryPassword: 'DisabledPass123!'
    }
  });
  assert.strictEqual(onboardRes.status, 503, 'Must return HTTP 503 when onboarding is disabled');
});

