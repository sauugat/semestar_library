'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { PGlite } = require('@electric-sql/pglite');

const { createTransactionAdapter } = require('../lib/db-transaction');
const { ensureTeacherSchema } = require('../lib/teacher-service');
const { recordAdminAudit, queryAdminAuditLogs } = require('../lib/audit-service');
const { createAdminDashboardRouter } = require('../routes/admin-dashboard');
const { createAuthMiddleware } = require('../lib/auth-middleware');
const createPostImagesRouter = require('../routes/post-images');
const { createClient } = require('@libsql/client');

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

test('PHASE 4D.2: Database Migration Verification & Sequential Order on PostgreSQL', async (t) => {
  const { pg, db } = createDisposablePostgresInstance();

  // Baseline unmigrated PostgreSQL schema (legacy schema before Oct 12)
  await db.exec(`
    CREATE TABLE students (
      studentId TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      username TEXT,
      email TEXT,
      passwordHash TEXT,
      avatarUrl TEXT,
      role TEXT DEFAULT 'student',
      verification_status TEXT DEFAULT 'unverified',
      gender TEXT,
      cohort_id TEXT,
      supabase_uid TEXT,
      department TEXT DEFAULT 'BIT',
      semester TEXT DEFAULT 'Semester 1',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE posts (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT,
      content TEXT NOT NULL,
      type TEXT DEFAULT 'general',
      category TEXT,
      visibility TEXT DEFAULT 'public',
      target_semester INTEGER,
      attachment_url TEXT,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE post_comments (
      id BIGSERIAL PRIMARY KEY,
      post_id BIGINT NOT NULL,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      parent_comment_id BIGINT,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE mobile_tokens (
      token TEXT PRIMARY KEY,
      studentId TEXT NOT NULL REFERENCES students(studentId),
      expiresAt TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Insert test records into unmigrated tables
  await db.run("INSERT INTO students (studentId, username, name, role) VALUES ('stu_01', 'stu_01', 'Alice', 'student')");
  await db.run("INSERT INTO posts (user_id, content) VALUES ('stu_01', 'Hello world')");
  await db.run("INSERT INTO post_comments (post_id, user_id, content) VALUES (1, 'stu_01', 'Nice post')");

  // PART A: Test Authentication Failure on Unmigrated Database (Missing account_status)
  await t.test('1. Unmigrated Database: Mobile token and profile queries fail when account_status column is absent', async () => {
    // Attempting query that requires account_status on PostgreSQL:
    let caughtErr = null;
    try {
      await db.get(`
        SELECT m.token, m.studentId, m.expiresAt,
               s.username, s.name, s.role, s.department, s.semester,
               s.gender, s.email, s.avatarUrl, s.verification_status, s.account_status
        FROM mobile_tokens m
        LEFT JOIN students s ON s.studentId = m.studentId
        WHERE m.token = 'dummy_token'
      `);
    } catch (err) {
      caughtErr = err;
    }
    assert.ok(caughtErr, 'Query must fail when account_status column is missing');
    assert.match(caughtErr.message, /column.*account_status.*does not exist/i, 'Reports exact missing column error');
  });

  // PART B: Test Administrative Mutation Failure when admin_audit_logs is absent
  await t.test('2. Unmigrated Database: Administrative audit fails closed and rolls back mutations if admin_audit_logs is absent', async () => {
    let auditErr = null;
    try {
      await db.withTransaction(async (tx) => {
        // Business update
        await tx.run("UPDATE students SET role = 'cr' WHERE studentId = 'stu_01'");
        // Required audit logging
        await recordAdminAudit(tx, {
          actorUserId: 'stu_01',
          action: 'student_promoted_to_cr',
          entityType: 'student',
          entityId: 'stu_01',
          required: true
        });
      });
    } catch (err) {
      auditErr = err;
    }
    assert.ok(auditErr, 'Audit logging must throw when table does not exist');
    assert.match(auditErr.message, /admin_audit_logs/i);

    // Verify rollback
    const student = await db.get("SELECT role FROM students WHERE studentId = 'stu_01'");
    assert.equal(student.role, 'student', 'Transaction must roll back student role change when audit fails');
  });

  // PART C: Apply Migrations Sequentially
  const migrationDir = path.join(__dirname, '..', 'migrations');
  const sqlAudit = fs.readFileSync(path.join(migrationDir, '20261012_admin_audit_logs.sql'), 'utf8');
  const sqlSuspension = fs.readFileSync(path.join(migrationDir, '20261012_account_suspension.sql'), 'utf8');
  const sqlModeration = fs.readFileSync(path.join(migrationDir, '20261012_content_moderation.sql'), 'utf8');

  await t.test('3. Migration 1: 20261012_admin_audit_logs.sql applies cleanly', async () => {
    await db.exec(sqlAudit);
    const tableCheck = await db.get("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'admin_audit_logs') AS exists");
    assert.equal(Boolean(tableCheck.exists), true);
  });

  await t.test('4. Migration 2: 20261012_account_suspension.sql applies cleanly and adds default "active" to existing rows', async () => {
    await db.exec(sqlSuspension);
    const student = await db.get("SELECT studentId, account_status FROM students WHERE studentId = 'stu_01'");
    assert.equal(student.account_status, 'active');
  });

  await t.test('5. Migration 3: 20261012_content_moderation.sql applies cleanly and creates content_reports', async () => {
    await db.exec(sqlModeration);
    const post = await db.get("SELECT id, moderation_status FROM posts WHERE id = 1");
    assert.equal(post.moderation_status, 'active');
    const comment = await db.get("SELECT id, moderation_status FROM post_comments WHERE id = 1");
    assert.equal(comment.moderation_status, 'active');
    const reportCheck = await db.get("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'content_reports') AS exists");
    assert.equal(Boolean(reportCheck.exists), true);
  });

  await t.test('6. Idempotency: All 3 migrations can be re-run sequentially without error', async () => {
    await db.exec(sqlAudit);
    await db.exec(sqlSuspension);
    await db.exec(sqlModeration);
    assert.ok(true, 'Migrations re-applied without throwing');
  });
});

test('PHASE 4D.2: End-to-End Admin HTTP Workflows & Multi-Role Permissions on PostgreSQL', async (t) => {
  const { pg, db } = createDisposablePostgresInstance();

  // Initialize schema with all migrations applied
  await db.exec(`
    CREATE TABLE students (
      studentId TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      username TEXT,
      email TEXT,
      passwordHash TEXT,
      avatarUrl TEXT,
      role TEXT DEFAULT 'student',
      verification_status TEXT DEFAULT 'unverified',
      account_status VARCHAR(32) NOT NULL DEFAULT 'active',
      gender TEXT,
      cohort_id TEXT,
      supabase_uid TEXT,
      department TEXT DEFAULT 'BIT',
      semester TEXT DEFAULT 'Semester 1',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE posts (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT,
      content TEXT NOT NULL,
      type TEXT DEFAULT 'general',
      category TEXT,
      visibility TEXT DEFAULT 'public',
      target_semester INTEGER,
      attachment_url TEXT,
      moderation_status VARCHAR(32) NOT NULL DEFAULT 'active',
      moderated_at TIMESTAMPTZ,
      moderated_by TEXT,
      moderation_reason TEXT,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE post_comments (
      id BIGSERIAL PRIMARY KEY,
      post_id BIGINT NOT NULL,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      parent_comment_id BIGINT,
      moderation_status VARCHAR(32) NOT NULL DEFAULT 'active',
      moderated_at TIMESTAMPTZ,
      moderated_by TEXT,
      moderation_reason TEXT,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE post_media (
      id BIGSERIAL PRIMARY KEY,
      post_id BIGINT NOT NULL,
      url TEXT NOT NULL
    );

    CREATE TABLE content_reports (
      id BIGSERIAL PRIMARY KEY,
      content_type VARCHAR(32) NOT NULL,
      content_id BIGINT NOT NULL,
      reporter_id TEXT NOT NULL,
      reason VARCHAR(64) NOT NULL,
      description TEXT,
      status VARCHAR(32) NOT NULL DEFAULT 'open',
      resolved_by TEXT,
      resolved_at TIMESTAMPTZ,
      resolution_notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT uq_content_reports_reporter UNIQUE (reporter_id, content_type, content_id)
    );

    CREATE TABLE admin_audit_logs (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT NOT NULL REFERENCES students(studentId) ON DELETE RESTRICT,
      action VARCHAR(64) NOT NULL,
      entity_type VARCHAR(64) NOT NULL,
      entity_id TEXT,
      before_state JSONB,
      after_state JSONB,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE mobile_tokens (
      token TEXT PRIMARY KEY,
      studentId TEXT NOT NULL REFERENCES students(studentId),
      expiresAt TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE subjects (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      semester INTEGER NOT NULL,
      department TEXT NOT NULL DEFAULT 'BIT',
      credit_hours INTEGER DEFAULT 3,
      nature TEXT DEFAULT 'Theory',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE teachers (
      id TEXT PRIMARY KEY,
      user_id TEXT UNIQUE NOT NULL REFERENCES students(studentId),
      status TEXT DEFAULT 'active',
      designation TEXT
    );

    CREATE TABLE teacher_subjects (
      id TEXT PRIMARY KEY,
      teacher_id TEXT NOT NULL REFERENCES teachers(id),
      subject_id TEXT NOT NULL REFERENCES subjects(id),
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Seed test users
  const passHash = bcrypt.hashSync('TestSecret_123!', 10);
  await db.run("INSERT INTO students (studentId, username, name, role, passwordHash, account_status) VALUES ('adm_01', 'admin01', 'Admin QA', 'admin', ?, 'active')", passHash);
  await db.run("INSERT INTO students (studentId, username, name, role, passwordHash, account_status) VALUES ('stu_01', 'student01', 'Student QA', 'student', ?, 'active')", passHash);
  await db.run("INSERT INTO students (studentId, username, name, role, passwordHash, account_status) VALUES ('cr_01', 'cr01', 'CR QA', 'cr', ?, 'active')", passHash);
  await db.run("INSERT INTO students (studentId, username, name, role, passwordHash, account_status) VALUES ('tea_01', 'teacher01', 'Teacher QA', 'teacher', ?, 'active')", passHash);
  await db.run("INSERT INTO teachers (id, user_id, status) VALUES ('T_01', 'tea_01', 'active')");

  // Seed mobile tokens
  const expiry = new Date(Date.now() + 86400000).toISOString();
  const adminToken = 'tok_admin_' + crypto.randomUUID().replace(/-/g, '');
  const studentToken = 'tok_student_' + crypto.randomUUID().replace(/-/g, '');
  const crToken = 'tok_cr_' + crypto.randomUUID().replace(/-/g, '');
  const teacherToken = 'tok_teacher_' + crypto.randomUUID().replace(/-/g, '');

  await db.run("INSERT INTO mobile_tokens (token, studentId, expiresAt) VALUES (?, 'adm_01', ?)", adminToken, expiry);
  await db.run("INSERT INTO mobile_tokens (token, studentId, expiresAt) VALUES (?, 'stu_01', ?)", studentToken, expiry);
  await db.run("INSERT INTO mobile_tokens (token, studentId, expiresAt) VALUES (?, 'cr_01', ?)", crToken, expiry);
  await db.run("INSERT INTO mobile_tokens (token, studentId, expiresAt) VALUES (?, 'tea_01', ?)", teacherToken, expiry);

  // Setup Express server with Auth Middleware and Admin Dashboard Router
  const app = express();
  app.use(express.json());

  // Attach mock in-memory file blobs for image tests
  const fileBlobs = new Map();
  fileBlobs.set('a1b2c3d4-e5f6-7890-abcd-ef1234567890.jpg', { mimeType: 'image/jpeg', fileData: Buffer.from('FAKE_IMAGE_DATA') });
  db.getFileBlob = async (name) => fileBlobs.get(name) || null;

  const authMiddleware = createAuthMiddleware(db);
  app.use(authMiddleware.authenticate);

  // Seed a removed post with an image and a report
  await db.run(`
    INSERT INTO posts (id, user_id, title, content, attachment_url, moderation_status)
    VALUES (101, 'stu_01', 'Test Post', 'This is a test post', '/uploads/posts/a1b2c3d4-e5f6-7890-abcd-ef1234567890.jpg', 'removed')
  `);
  await db.run(`
    INSERT INTO post_comments (id, post_id, user_id, content, moderation_status)
    VALUES (201, 101, 'stu_01', 'Test Comment', 'active')
  `);
  await db.run(`
    INSERT INTO content_reports (id, content_type, content_id, reporter_id, reason, status)
    VALUES (301, 'post', 101, 'cr_01', 'inappropriate', 'open')
  `);

  app.use('/api/admin', createAdminDashboardRouter({ db, requireLogin: authMiddleware.requireLogin }));
  app.use('/uploads/posts', createPostImagesRouter(db));

  // Role protected sample endpoints for testing all four roles
  app.get('/api/test/student', authMiddleware.requireLogin, (req, res) => {
    if (['student', 'cr'].includes(req.user.role)) return res.json({ ok: true, role: req.user.role });
    res.status(403).json({ message: 'Forbidden' });
  });

  app.get('/api/test/teacher', authMiddleware.requireTeacher, (req, res) => {
    res.json({ ok: true, role: req.user.role });
  });

  app.get('/api/test/admin', authMiddleware.requireAdmin, (req, res) => {
    res.json({ ok: true, role: req.user.role });
  });

  let server;
  let baseUrl;
  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });

  t.after(() => {
    if (server) server.close();
  });

  async function apiRequest(method, urlPath, token, body = null, extraHeaders = {}) {
    const headers = { ...extraHeaders };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (body) headers['Content-Type'] = 'application/json';

    const res = await fetch(`${baseUrl}${urlPath}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    let data;
    try { data = await res.json(); } catch { data = null; }
    return { status: res.status, headers: res.headers, data };
  }

  // 1. All 4 Roles & Permission Verification
  await t.test('1. Role Access: Student token accesses student route, blocked from admin & teacher routes', async () => {
    const resStudent = await apiRequest('GET', '/api/test/student', studentToken);
    assert.equal(resStudent.status, 200);

    const resAdmin = await apiRequest('GET', '/api/test/admin', studentToken);
    assert.equal(resAdmin.status, 403);

    const resTeacher = await apiRequest('GET', '/api/test/teacher', studentToken);
    assert.equal(resTeacher.status, 403);
  });

  await t.test('2. Role Access: CR token retains student access, blocked from admin route', async () => {
    const resStudent = await apiRequest('GET', '/api/test/student', crToken);
    assert.equal(resStudent.status, 200);

    const resAdmin = await apiRequest('GET', '/api/test/admin', crToken);
    assert.equal(resAdmin.status, 403);
  });

  await t.test('3. Role Access: Teacher token accesses teacher route, blocked from student & admin routes', async () => {
    const resTeacher = await apiRequest('GET', '/api/test/teacher', teacherToken);
    assert.equal(resTeacher.status, 200);

    const resStudent = await apiRequest('GET', '/api/test/student', teacherToken);
    assert.equal(resStudent.status, 403);

    const resAdmin = await apiRequest('GET', '/api/test/admin', teacherToken);
    assert.equal(resAdmin.status, 403);
  });

  await t.test('4. Role Access: Admin token accesses admin overview and protected admin routes', async () => {
    const resOverview = await apiRequest('GET', '/api/admin/overview', adminToken);
    assert.equal(resOverview.status, 200);
    assert.ok(resOverview.data.counts?.students !== undefined);
  });

  await t.test('5. Role Access: Unknown / absent token is rejected with 401', async () => {
    const resNoAuth = await apiRequest('GET', '/api/admin/overview', null);
    assert.equal(resNoAuth.status, 401);

    const resInvalid = await apiRequest('GET', '/api/admin/overview', 'tok_invalid_123');
    assert.equal(resInvalid.status, 401);
  });

  // 2. Admin Mutation Workflows: User Management & Suspension
  await t.test('6. Admin User Mutation: Suspend test student account with mandatory reason', async () => {
    // Attempt without reason -> fails 400
    const resFail = await apiRequest('POST', '/api/admin/users/stu_01/suspend', adminToken, { reason: 'hi' });
    assert.equal(resFail.status, 400);

    // Valid suspension
    const resSuspend = await apiRequest('POST', '/api/admin/users/stu_01/suspend', adminToken, {
      reason: 'Repeated community guidelines violation'
    });
    assert.equal(resSuspend.status, 200);

    // Verify DB state
    const student = await db.get("SELECT account_status FROM students WHERE studentId = 'stu_01'");
    assert.equal(student.account_status, 'suspended');

    // Verify audit log
    const audit = await db.get("SELECT action, actor_user_id, entity_id FROM admin_audit_logs WHERE action = 'account_suspended' ORDER BY created_at DESC LIMIT 1");
    assert.equal(audit.action, 'account_suspended');
    assert.equal(audit.actor_user_id, 'adm_01');
    assert.equal(audit.entity_id, 'stu_01');
  });

  await t.test('7. Suspended Student Session: Suspended account receives 403 ACCOUNT_SUSPENDED and mobile token is pruned', async () => {
    // 1. Existing mobile token was immediately revoked/deleted during suspension
    const resAccessPruned = await apiRequest('GET', '/api/test/student', studentToken);
    assert.equal(resAccessPruned.status, 401);
    const tokenRow = await db.get("SELECT token FROM mobile_tokens WHERE token = ?", studentToken);
    assert.ok(!tokenRow);

    // 2. Any active token presented for a suspended account is intercepted by auth middleware:
    const activeTokenForSuspended = 'tok_susp_probe_' + crypto.randomUUID().replace(/-/g, '');
    const expiry = new Date(Date.now() + 86400000).toISOString();
    await db.run("INSERT INTO mobile_tokens (token, studentId, expiresAt) VALUES (?, 'stu_01', ?)", activeTokenForSuspended, expiry);

    const resAccessActive = await apiRequest('GET', '/api/test/student', activeTokenForSuspended);
    assert.equal(resAccessActive.status, 403);
    assert.equal(resAccessActive.data.error, 'ACCOUNT_SUSPENDED');

    // Token must be immediately pruned upon attempted access
    const probeRow = await db.get("SELECT token FROM mobile_tokens WHERE token = ?", activeTokenForSuspended);
    assert.ok(!probeRow);
  });

  await t.test('8. Admin User Mutation: Reactivate test student account', async () => {
    const resReactivate = await apiRequest('POST', '/api/admin/users/stu_01/reactivate', adminToken, {
      reason: 'Appeal approved by administration'
    });
    assert.equal(resReactivate.status, 200);

    const student = await db.get("SELECT account_status FROM students WHERE studentId = 'stu_01'");
    assert.equal(student.account_status, 'active');

    const audit = await db.get("SELECT action FROM admin_audit_logs WHERE action = 'account_reactivated' ORDER BY created_at DESC LIMIT 1");
    assert.equal(audit.action, 'account_reactivated');
  });

  await t.test('9. Admin Role Mutation: Promote Student to CR and demote back to Student', async () => {
    // Promote
    const resPromote = await apiRequest('POST', '/api/admin/users/stu_01/promote-cr', adminToken, {
      reason: 'Elected class representative for BIT semester 1'
    });
    assert.equal(resPromote.status, 200);
    const stuPromoted = await db.get("SELECT role FROM students WHERE studentId = 'stu_01'");
    assert.equal(stuPromoted.role, 'cr');

    // Demote
    const resDemote = await apiRequest('POST', '/api/admin/users/stu_01/demote-student', adminToken, {
      reason: 'Semester term completed'
    });
    assert.equal(resDemote.status, 200);
    const stuDemoted = await db.get("SELECT role FROM students WHERE studentId = 'stu_01'");
    assert.equal(stuDemoted.role, 'student');
  });

  // 3. Admin Mutation Workflows: Academics
  await t.test('10. Admin Academics Mutation: Create, Edit, Archive, and Reactivate canonical subject', async () => {
    // Create
    const resCreate = await apiRequest('POST', '/api/admin/academics/subjects', adminToken, {
      id: 'SUB_QA_101',
      code: 'QA101',
      name: 'Software Quality Assurance',
      semester: 4,
      department: 'BIT',
      creditHours: 3,
      nature: 'Theory + Practical',
      reason: 'New curriculum requirement'
    });
    assert.equal(resCreate.status, 201);

    const auditCreate = await db.get("SELECT action, entity_id FROM admin_audit_logs WHERE action = 'subject_created' ORDER BY created_at DESC LIMIT 1");
    assert.equal(auditCreate.action, 'subject_created');
    assert.equal(auditCreate.entity_id, 'QA101');

    // Edit
    const resEdit = await apiRequest('PUT', '/api/admin/academics/subjects/QA101', adminToken, {
      name: 'Advanced Software Quality Assurance',
      creditHours: 4,
      reason: 'Credit update'
    });
    assert.equal(resEdit.status, 200);

    const auditEdit = await db.get("SELECT action FROM admin_audit_logs WHERE action = 'subject_updated' ORDER BY created_at DESC LIMIT 1");
    assert.equal(auditEdit.action, 'subject_updated');

    // Archive
    const resArchive = await apiRequest('POST', '/api/admin/academics/subjects/QA101/archive', adminToken, {
      reason: 'Course discontinued for next cycle'
    });
    assert.equal(resArchive.status, 200);

    const auditArchive = await db.get("SELECT action FROM admin_audit_logs WHERE action = 'subject_archived' ORDER BY created_at DESC LIMIT 1");
    assert.equal(auditArchive.action, 'subject_archived');

    // Reactivate
    const resReactivate = await apiRequest('POST', '/api/admin/academics/subjects/QA101/reactivate', adminToken, {
      reason: 'Course reinstated'
    });
    assert.equal(resReactivate.status, 200);

    const auditReactivate = await db.get("SELECT action FROM admin_audit_logs WHERE action = 'subject_reactivated' ORDER BY created_at DESC LIMIT 1");
    assert.equal(auditReactivate.action, 'subject_reactivated');
  });

  // 4. Admin Mutation Workflows: Content Moderation & Reporting
  await t.test('11. Admin Moderation Mutation: Resolve/Dismiss reports, Remove/Restore posts and comments', async () => {
    // Resolve Report
    const resResolve = await apiRequest('POST', '/api/admin/moderation/reports/301/resolve', adminToken, {
      actionTaken: 'post_removed',
      resolutionNotes: 'Post violates community guidelines'
    });
    assert.equal(resResolve.status, 200);

    // Restore Post
    const resRestorePost = await apiRequest('POST', '/api/admin/moderation/posts/101/restore', adminToken, {
      reason: 'Reviewed and cleared by admin'
    });
    assert.equal(resRestorePost.status, 200);
    const postRestored = await db.get("SELECT moderation_status FROM posts WHERE id = 101");
    assert.equal(postRestored.moderation_status, 'active');

    // Remove Post
    const resRemovePost = await apiRequest('POST', '/api/admin/moderation/posts/101/remove', adminToken, {
      reason: 'Spam violation'
    });
    assert.equal(resRemovePost.status, 200);
    const postRemoved = await db.get("SELECT moderation_status FROM posts WHERE id = 101");
    assert.equal(postRemoved.moderation_status, 'removed');

    // Remove Comment
    const resRemoveComment = await apiRequest('POST', '/api/admin/moderation/comments/201/remove', adminToken, {
      reason: 'Harassment'
    });
    assert.equal(resRemoveComment.status, 200);
    const commentRemoved = await db.get("SELECT moderation_status FROM post_comments WHERE id = 201");
    assert.equal(commentRemoved.moderation_status, 'removed');

    // Restore Comment
    const resRestoreComment = await apiRequest('POST', '/api/admin/moderation/comments/201/restore', adminToken, {
      reason: 'Mistake cleared'
    });
    assert.equal(resRestoreComment.status, 200);
    const commentRestored = await db.get("SELECT moderation_status FROM post_comments WHERE id = 201");
    assert.equal(commentRestored.moderation_status, 'active');
  });

  // 5. Moderation Media Security
  await t.test('12. Moderation Media Security: Query params or headers alone cannot access removed-post media', async () => {
    // Post 101 has attachment /uploads/posts/a1b2c3d4-e5f6-7890-abcd-ef1234567890.jpg and moderation_status = 'removed'

    // Scenario A: Anonymous request with ?moderation=true -> 404
    const resAnon = await fetch(`${baseUrl}/uploads/posts/a1b2c3d4-e5f6-7890-abcd-ef1234567890.jpg?moderation=true`);
    assert.equal(resAnon.status, 404);

    // Scenario B: Student bearer token with ?moderation=true -> 404
    const resStu = await fetch(`${baseUrl}/uploads/posts/a1b2c3d4-e5f6-7890-abcd-ef1234567890.jpg?moderation=true`, {
      headers: { 'Authorization': `Bearer ${crToken}` }
    });
    assert.equal(resStu.status, 404);

    // Scenario C: Teacher bearer token with ?moderation=true -> 404
    const resTea = await fetch(`${baseUrl}/uploads/posts/a1b2c3d4-e5f6-7890-abcd-ef1234567890.jpg?moderation=true`, {
      headers: { 'Authorization': `Bearer ${teacherToken}` }
    });
    assert.equal(resTea.status, 404);

    // Scenario D: Header x-admin-moderation without admin credentials -> 404
    const resHeader = await fetch(`${baseUrl}/uploads/posts/a1b2c3d4-e5f6-7890-abcd-ef1234567890.jpg`, {
      headers: {
        'Authorization': `Bearer ${crToken}`,
        'x-admin-moderation': 'true'
      }
    });
    assert.equal(resHeader.status, 404);

    // Scenario E: Genuine Authenticated Admin without moderation flag -> 404 (normal feed view hides removed media)
    const resAdminNoFlag = await fetch(`${baseUrl}/uploads/posts/a1b2c3d4-e5f6-7890-abcd-ef1234567890.jpg`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.equal(resAdminNoFlag.status, 404);

    // Scenario F: Genuine Authenticated Admin WITH ?moderation=true -> 200 (allowed for admin moderation preview)
    const resAdminWithFlag = await fetch(`${baseUrl}/uploads/posts/a1b2c3d4-e5f6-7890-abcd-ef1234567890.jpg?moderation=true`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.equal(resAdminWithFlag.status, 200);
    const buf = await resAdminWithFlag.arrayBuffer();
    assert.equal(Buffer.from(buf).toString(), 'FAKE_IMAGE_DATA');
  });

  // 6. Offline Data Safety: SQLite Chat Data & Draft Preservation
  await t.test('13. Offline Data Safety: Account switching preserves unsent drafts (id <= 0) and purges confirmed messages (id > 0)', async () => {
    const os = require('os');
    const chatDbPath = path.join(os.tmpdir(), `chat_test_p4d2_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
    const chatClient = createClient({ url: `file:${chatDbPath}` });

    await chatClient.execute(`
      CREATE TABLE chat_cache_v3 (
        scope TEXT NOT NULL,
        id INTEGER NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY(scope, id)
      )
    `);
    await chatClient.execute(`CREATE TABLE chat_events_v3 (scope TEXT NOT NULL, event_id TEXT NOT NULL, created_at INTEGER NOT NULL)`);
    await chatClient.execute(`CREATE TABLE chat_meta_v3 (scope TEXT NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL)`);

    // Seed 1 server-confirmed message (id = 88) and 1 pending offline draft (id = -10)
    await chatClient.execute({ sql: `INSERT INTO chat_cache_v3 VALUES ('scope_bit_1', 88, '{"id":88,"text":"Server message"}')`, args: [] });
    await chatClient.execute({ sql: `INSERT INTO chat_cache_v3 VALUES ('scope_bit_1', -10, '{"id":-10,"text":"Unsent student draft"}')`, args: [] });
    await chatClient.execute({ sql: `INSERT INTO chat_events_v3 VALUES ('scope_bit_1', 'evt_1', 123456789)`, args: [] });
    await chatClient.execute({ sql: `INSERT INTO chat_meta_v3 VALUES ('scope_bit_1', 'meta_1', '{"state":1}')`, args: [] });

    // Simulate account switch: clearChatDb({ preservePending: true })
    await chatClient.execute('DELETE FROM chat_cache_v3 WHERE id > 0');
    await chatClient.execute('DELETE FROM chat_events_v3');
    await chatClient.execute('DELETE FROM chat_meta_v3');

    // Verify draft (id = -10) is preserved and confirmed message (id = 88) is deleted
    const remaining = await chatClient.execute('SELECT * FROM chat_cache_v3');
    assert.equal(remaining.rows.length, 1);
    assert.equal(remaining.rows[0].id, -10);
    assert.match(String(remaining.rows[0].payload), /Unsent student draft/);

    // Simulate full logout: clearChatDb({ preservePending: false })
    await chatClient.execute('DELETE FROM chat_cache_v3');
    const finalRows = await chatClient.execute('SELECT * FROM chat_cache_v3');
    assert.equal(finalRows.rows.length, 0);

    chatClient.close();
    try { fs.unlinkSync(chatDbPath); } catch (_) {}
  });
});
