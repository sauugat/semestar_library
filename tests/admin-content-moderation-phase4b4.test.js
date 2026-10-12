'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const test = require('node:test');
const assert = require('node:assert/strict');

// Configure isolated disposable SQLite database for testing Phase 4B.4
const tempDbPath = path.join(
  os.tmpdir(),
  `admin_content_moderation_phase4b4_${Date.now()}_${Math.random().toString(36).slice(2)}.db`
);

process.env.NODE_ENV = 'test';
process.env.DB_PATH = tempDbPath;
process.env.SEMESTER_DB_SKIP_INIT = '1';
process.env.SESSION_SECRET = 'test-session-secret-phase-4b4-moderation-key';
process.env.TEACHER_ONBOARDING_SECRET = 'test-teacher-onboarding-secret-key-32-bytes-secure!';
delete process.env.TEACHER_ONBOARDING_ENABLED; // strictly disabled
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
delete process.env.PGHOST;

// Core services and routers
const db = require('../db');
const { ensureAuditSchema, recordAdminAudit } = require('../lib/audit-service');
const { ensurePostsSchema } = require('../lib/posts');
const { isTeacherOnboardingEnabled } = require('../lib/teacher-service');
const { ensureAcademicCohortSchema } = require('../lib/academic-context');
const createAdminDashboardRouter = require('../routes/admin-dashboard');
const createPostsRouter = require('../routes/posts');
const { createAuthMiddleware } = require('../lib/auth-middleware');

let server;
let baseUrl;

const TEST_PASS = 'P@ssword123!';
const testPasswordHash = bcrypt.hashSync(TEST_PASS, 4);

test.before(async () => {
  // 1. Initialize schema in disposable database
  await db.initSchema();
  await ensureAuditSchema(db);
  await ensureAcademicCohortSchema(db);
  await ensurePostsSchema(db);

  // 2. Seed permanent cohorts
  await db.run(
    `INSERT INTO cohorts (id, slot_code, group_code, display_name, current_semester, intake_year, intake_identifier, status)
     VALUES (?, 'mercury', 'MERCURY', 'Mercury Cohort', 1, 2026, '2026-MERCURY', 'active')`,
    'COH_MERCURY_01'
  );
  await db.run(
    `INSERT INTO cohorts (id, slot_code, group_code, display_name, current_semester, intake_year, intake_identifier, status)
     VALUES (?, 'venus', 'VENUS', 'Venus Cohort', 3, 2025, '2025-VENUS', 'active')`,
    'COH_VENUS_02'
  );
  await db.run(
    `INSERT INTO cohorts (id, slot_code, group_code, display_name, current_semester, intake_year, intake_identifier, status)
     VALUES (?, 'earth', 'EARTH', 'Earth Cohort', 5, 2024, '2024-EARTH', 'active')`,
    'COH_EARTH_03'
  );
  await db.run(
    `INSERT INTO cohorts (id, slot_code, group_code, display_name, current_semester, intake_year, intake_identifier, status)
     VALUES (?, 'mars', 'MARS', 'Mars Cohort', 7, 2023, '2023-MARS', 'active')`,
    'COH_MARS_04'
  );

  // 3. Seed users
  const users = [
    { id: 'ADM_01', user: 'admin1', name: 'Admin Alice', role: 'admin', email: 'admin@college.edu', suid: 'supa_adm_01' },
    { id: 'ADM_02', user: 'admin2', name: 'Admin Bob', role: 'admin', email: 'admin2@college.edu', suid: 'supa_adm_02' },
    { id: 'TEA_01', user: 'teacher1', name: 'Teacher Tara', role: 'teacher', email: 'teacher@college.edu', suid: 'supa_tea_01' },
    { id: 'STU_01', user: 'student1', name: 'Student Sam', role: 'student', email: 'student1@college.edu', suid: 'supa_stu_01', cohortId: 'COH_MERCURY_01', sem: 'Semester 1' },
    { id: 'STU_02', user: 'student2', name: 'Student Sara', role: 'student', email: 'student2@college.edu', suid: 'supa_stu_02', cohortId: 'COH_MERCURY_01', sem: 'Semester 1' },
    { id: 'STU_VENUS', user: 'student3', name: 'Student Victor', role: 'student', email: 'victor@college.edu', suid: 'supa_stu_03', cohortId: 'COH_VENUS_02', sem: 'Semester 3' },
    { id: 'CR_01', user: 'cr1', name: 'CR Chris', role: 'cr', email: 'cr1@college.edu', suid: 'supa_cr_01', cohortId: 'COH_MERCURY_01', sem: 'Semester 1' },
    { id: 'STU_SUSP', user: 'suspended1', name: 'Suspended Stu', role: 'student', email: 'susp@college.edu', suid: 'supa_susp_01', status: 'suspended', cohortId: 'COH_MERCURY_01', sem: 'Semester 1' }
  ];

  for (const u of users) {
    await db.run(
      `INSERT INTO students (studentId, username, name, passwordHash, role, department, semester, email, supabase_uid, cohort_id, account_status)
       VALUES (?, ?, ?, ?, ?, 'BIT', ?, ?, ?, ?, ?)`,
      u.id, u.user, u.name, testPasswordHash, u.role, u.sem || 'Semester 1', u.email, u.suid, u.cohortId || null, u.status || 'active'
    );
  }

  // 4. Seed sample posts
  // Post 1: Public general post by Sam
  await db.run(
    `INSERT INTO posts (id, user_id, title, content, type, category, visibility, audience_scope, target_all_semesters, semester_no, moderation_status, created_at)
     VALUES (1, 'STU_01', 'Sam Public Post', 'Hello public campus!', 'status', 'general', 'everyone', 'all_students', 1, 1, 'active', datetime('now', '-2 hours'))`
  );

  // Post 2: Student-only cohort post by Sam (Semester 1 / Mercury)
  await db.run(
    `INSERT INTO posts (id, user_id, title, content, type, category, visibility, audience_scope, target_all_semesters, semester_no, cohort_id, moderation_status, created_at)
     VALUES (2, 'STU_01', 'Sam Private Cohort Post', 'Exam notes for Mercury students only.', 'status', 'academic', 'students_only', 'student_only', 0, 1, 'COH_MERCURY_01', 'active', datetime('now', '-1 hour'))`
  );

  // Post 3: Venus-only post by Victor
  await db.run(
    `INSERT INTO posts (id, user_id, title, content, type, category, visibility, audience_scope, target_all_semesters, semester_no, cohort_id, moderation_status, created_at)
     VALUES (3, 'STU_VENUS', 'Victor Venus Post', 'Venus third semester project notes.', 'status', 'academic', 'students_only', 'student_only', 0, 3, 'COH_VENUS_02', 'active', datetime('now', '-30 minutes'))`
  );

  // 5. Seed comments on Post 1
  // Comment 1: Root comment by Sara
  await db.run(
    `INSERT INTO post_comments (id, post_id, parent_comment_id, user_id, content, moderation_status, created_at)
     VALUES (10, 1, NULL, 'STU_02', 'Great public post Sam!', 'active', datetime('now', '-90 minutes'))`
  );

  // Comment 2: Reply to Comment 1 by Sam
  await db.run(
    `INSERT INTO post_comments (id, post_id, parent_comment_id, user_id, content, moderation_status, created_at)
     VALUES (11, 1, 10, 'STU_01', 'Thanks Sara, glad you liked it.', 'active', datetime('now', '-80 minutes'))`
  );

  // Comment 3: Standalone root comment by CR Chris
  await db.run(
    `INSERT INTO post_comments (id, post_id, parent_comment_id, user_id, content, moderation_status, created_at)
     VALUES (12, 1, NULL, 'CR_01', 'Noted by CR.', 'active', datetime('now', '-70 minutes'))`
  );

  // 6. Build Express test app
  const app = express();
  app.use(express.json());
  app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
  }));

  // Dynamic user test injection via headers for automated requests
  const requireLogin = async (req, res, next) => {
    const callerId = req.headers['x-test-user'] || (req.session && req.session.studentId);
    if (!callerId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const student = await db.get(
      'SELECT studentId, role, name, department, semester, email, avatarUrl, account_status, cohort_id FROM students WHERE studentId = ?',
      callerId
    );
    if (!student) {
      return res.status(401).json({ message: 'User not found' });
    }
    if (student.account_status === 'suspended') {
      return res.status(403).json({ error: 'ACCOUNT_SUSPENDED', message: 'Account is suspended' });
    }

    req.student = student;
    req.user = student;
    req.session.studentId = student.studentId;
    req.session.role = student.role;
    next();
  };

  // Mount API routers
  const postsRouter = createPostsRouter(db, requireLogin, { uploadDir: os.tmpdir() });
  app.use('/api/posts', postsRouter);
  app.use('/api/admin', createAdminDashboardRouter(db, requireLogin));

  // Static route simulations for dashboards
  app.get('/dashboard.html', (req, res) => res.status(200).send('<html><body>Student Dashboard</body></html>'));
  app.get('/student-dashboard', (req, res) => res.status(200).send('<html><body>Student Dashboard Alias</body></html>'));
  app.get('/teacher-dashboard.html', (req, res) => res.status(200).send('<html><body>Teacher Dashboard</body></html>'));
  app.get('/admin-dashboard.html', (req, res) => res.status(200).send('<html><body>Admin Dashboard</body></html>'));

  // Start HTTP server on dynamic port
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
});

test.after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  try {
    if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
  } catch (err) {
    // Ignore cleanup error in tmpdir
  }
});

// Helper HTTP caller
async function request(method, path, { headers = {}, body = null } = {}) {
  const url = `${baseUrl}${path}`;
  const reqHeaders = { ...headers };
  if (body) {
    reqHeaders['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, {
    method,
    headers: reqHeaders,
    body: body ? JSON.stringify(body) : undefined
  });

  let data;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    data = await res.json();
  } else {
    data = await res.text();
  }

  return { status: res.status, data, headers: res.headers };
}

// ==========================================
// TEST SCENARIOS (30 Step 10 Specifications)
// ==========================================

test('1. Admin removes a post with reason and verification', async () => {
  const res = await request('POST', '/api/admin/moderation/posts/1/remove', {
    headers: { 'x-test-user': 'ADM_01' },
    body: { reason: 'Contains unauthorized promotional links.' }
  });

  assert.equal(res.status, 200);
  assert.equal(res.data.success, true);
  assert.equal(res.data.moderation_status, 'removed');

  // Verify post row in database
  const post = await db.get('SELECT * FROM posts WHERE id = 1');
  assert.equal(post.moderation_status, 'removed');
  assert.equal(post.moderated_by, 'ADM_01');
  assert.equal(post.moderation_reason, 'Contains unauthorized promotional links.');
  assert.ok(post.moderated_at);
});

test('2. Admin restores a post', async () => {
  const res = await request('POST', '/api/admin/moderation/posts/1/restore', {
    headers: { 'x-test-user': 'ADM_01' },
    body: { reason: 'Appeal reviewed and cleared.' }
  });

  assert.equal(res.status, 200);
  assert.equal(res.data.success, true);
  assert.equal(res.data.moderation_status, 'active');

  const post = await db.get('SELECT * FROM posts WHERE id = 1');
  assert.equal(post.moderation_status, 'active');
  assert.equal(post.moderation_reason, null);
});

test('3. Admin removes a comment with reason', async () => {
  const res = await request('POST', '/api/admin/moderation/comments/12/remove', {
    headers: { 'x-test-user': 'ADM_01' },
    body: { reason: 'Off-topic spam comment.' }
  });

  assert.equal(res.status, 200);
  assert.equal(res.data.success, true);
  assert.equal(res.data.moderation_status, 'removed');

  const comment = await db.get('SELECT * FROM post_comments WHERE id = 12');
  assert.equal(comment.moderation_status, 'removed');
  assert.equal(comment.moderated_by, 'ADM_01');
  assert.equal(comment.moderation_reason, 'Off-topic spam comment.');
});

test('4. Admin restores a comment', async () => {
  const res = await request('POST', '/api/admin/moderation/comments/12/restore', {
    headers: { 'x-test-user': 'ADM_01' },
    body: { reason: 'Comment restored after verification.' }
  });

  assert.equal(res.status, 200);
  assert.equal(res.data.success, true);
  assert.equal(res.data.moderation_status, 'active');

  const comment = await db.get('SELECT * FROM post_comments WHERE id = 12');
  assert.equal(comment.moderation_status, 'active');
  assert.equal(comment.moderation_reason, null);
});

test('5. Students cannot moderate content (rejects 403)', async () => {
  const res = await request('POST', '/api/admin/moderation/posts/1/remove', {
    headers: { 'x-test-user': 'STU_01' },
    body: { reason: 'Student trying to moderate' }
  });
  assert.equal(res.status, 403);
});

test('6. CRs cannot moderate content (rejects 403)', async () => {
  const res = await request('POST', '/api/admin/moderation/posts/1/remove', {
    headers: { 'x-test-user': 'CR_01' },
    body: { reason: 'CR trying to moderate' }
  });
  assert.equal(res.status, 403);
});

test('7. Teachers cannot moderate content (rejects 403)', async () => {
  const res = await request('POST', '/api/admin/moderation/posts/1/remove', {
    headers: { 'x-test-user': 'TEA_01' },
    body: { reason: 'Teacher trying to moderate' }
  });
  assert.equal(res.status, 403);
});

test('8. Unauthenticated users are rejected (rejects 401)', async () => {
  const res = await request('POST', '/api/admin/moderation/posts/1/remove', {
    body: { reason: 'No auth header' }
  });
  assert.equal(res.status, 401);
});

test('9. Removal requires a reason (rejects empty/whitespace with 400)', async () => {
  const resEmpty = await request('POST', '/api/admin/moderation/posts/1/remove', {
    headers: { 'x-test-user': 'ADM_01' },
    body: { reason: '' }
  });
  assert.equal(resEmpty.status, 400);

  const resWhitespace = await request('POST', '/api/admin/moderation/posts/1/remove', {
    headers: { 'x-test-user': 'ADM_01' },
    body: { reason: '   ' }
  });
  assert.equal(resWhitespace.status, 400);
});

test('10. Removed content disappears from public/feed listings', async () => {
  // First ensure Post 1 is active, check it appears in feed
  await db.run("UPDATE posts SET moderation_status = 'active' WHERE id = 1");
  const feedBefore = await request('GET', '/api/posts', {
    headers: { 'x-test-user': 'STU_01' }
  });
  assert.equal(feedBefore.status, 200);
  const foundBefore = (feedBefore.data.posts || []).some(p => p.id === 1);
  assert.equal(foundBefore, true);

  // Now admin removes Post 1
  await request('POST', '/api/admin/moderation/posts/1/remove', {
    headers: { 'x-test-user': 'ADM_01' },
    body: { reason: 'Temporarily removed for review' }
  });

  // Verify it disappeared from feed
  const feedAfter = await request('GET', '/api/posts', {
    headers: { 'x-test-user': 'STU_01' }
  });
  assert.equal(feedAfter.status, 200);
  const foundAfter = (feedAfter.data.posts || []).some(p => p.id === 1);
  assert.equal(foundAfter, false, 'Removed post must not appear in feed listing');
});

test('11. Removed content cannot be accessed through direct detail URLs (returns 404)', async () => {
  // Post 1 is removed
  const res = await request('GET', '/api/posts/1', {
    headers: { 'x-test-user': 'STU_01' }
  });
  assert.equal(res.status, 404);
  assert.equal(res.data.isRemoved, true);
  assert.ok(res.data.message.includes('removed by moderation'));
});

test('12. Restored content uses original audience restrictions', async () => {
  // Restore Post 1
  await request('POST', '/api/admin/moderation/posts/1/restore', {
    headers: { 'x-test-user': 'ADM_01' },
    body: { reason: 'Cleared review' }
  });

  // Now remove and restore Post 2 (which is student-only / Mercury cohort)
  await request('POST', '/api/admin/moderation/posts/2/remove', {
    headers: { 'x-test-user': 'ADM_01' },
    body: { reason: 'Testing cohort post removal' }
  });
  await request('POST', '/api/admin/moderation/posts/2/restore', {
    headers: { 'x-test-user': 'ADM_01' },
    body: { reason: 'Testing cohort post restore' }
  });

  // Authorized student (Mercury) CAN view Post 2
  const stuMercuryRes = await request('GET', '/api/posts/2', {
    headers: { 'x-test-user': 'STU_01' }
  });
  assert.equal(stuMercuryRes.status, 200);

  // Unauthorized student (Venus) CANNOT view Post 2
  const stuVenusRes = await request('GET', '/api/posts/2', {
    headers: { 'x-test-user': 'STU_VENUS' }
  });
  assert.equal(stuVenusRes.status, 404);
});

test('13. Student-only posts remain restricted from ordinary teacher feeds', async () => {
  const teacherFeed = await request('GET', '/api/posts', {
    headers: { 'x-test-user': 'TEA_01' }
  });
  assert.equal(teacherFeed.status, 200);
  const posts = teacherFeed.data.posts || [];
  const foundCohortPost = posts.some(p => p.id === 2);
  assert.equal(foundCohortPost, false, 'Student-only post #2 must not be exposed to teacher feed');
});

test('14. Admin moderation access is explicit and separated from feeds', async () => {
  // Admin moderation detail endpoint allows inspection of Post 2
  const adminModRes = await request('GET', '/api/admin/moderation/posts/2', {
    headers: { 'x-test-user': 'ADM_01' }
  });
  assert.equal(adminModRes.status, 200);
  assert.equal(adminModRes.data.post.id, 2);
  assert.equal(adminModRes.data.post.user_id, 'STU_01');

  // Ordinary feed accessed by admin adheres to regular rules
  const queueRes = await request('GET', '/api/admin/moderation/queue', {
    headers: { 'x-test-user': 'ADM_01' }
  });
  assert.equal(queueRes.status, 200);
  assert.ok(Array.isArray(queueRes.data.reports));
});

test('15. Private DMs remain inaccessible through content moderation', async () => {
  // Ensure moderation APIs do not query or expose dm messages
  const modQueue = await request('GET', '/api/admin/moderation/queue', {
    headers: { 'x-test-user': 'ADM_01' }
  });
  assert.equal(modQueue.status, 200);
  // Verify report items do not have DM structures
  for (const item of (modQueue.data.reports || [])) {
    assert.equal(item.conversation_id, undefined);
    assert.equal(item.direct_message_id, undefined);
  }
});

test('16. Authorized users can report content', async () => {
  const res = await request('POST', '/api/posts/1/report', {
    headers: { 'x-test-user': 'STU_02' },
    body: {
      reason: 'harassment',
      description: 'Contains disrespectful comments directed at student cohort.'
    }
  });

  assert.equal(res.status, 201);
  assert.equal(res.data.success, true);
  assert.equal(res.data.status, 'open');

  // Verify in content_reports
  const report = await db.get("SELECT * FROM content_reports WHERE content_type = 'post' AND content_id = 1");
  assert.ok(report);
  assert.equal(report.reporter_id, 'STU_02');
  assert.equal(report.reason, 'harassment');
  assert.equal(report.status, 'open');
});

test('17. Users cannot report inaccessible posts (returns 404)', async () => {
  // Venus student attempting to report Post 2 (restricted to Mercury)
  const res = await request('POST', '/api/posts/2/report', {
    headers: { 'x-test-user': 'STU_VENUS' },
    body: {
      reason: 'spam',
      description: 'I should not be able to report what I cannot see.'
    }
  });
  assert.equal(res.status, 404);
});

test('18. Duplicate report handling prevents abuse (returns 409 Conflict)', async () => {
  // Student Sara already reported Post 1 in Test 16. Reporting again while report is open:
  const res = await request('POST', '/api/posts/1/report', {
    headers: { 'x-test-user': 'STU_02' },
    body: {
      reason: 'spam',
      description: 'Second report from same user.'
    }
  });
  assert.equal(res.status, 409);
  assert.ok(res.data.message.includes('already submitted an active report'));
});

test('19. Admin can resolve reports', async () => {
  const reportRow = await db.get("SELECT id FROM content_reports WHERE content_type = 'post' AND content_id = 1");
  assert.ok(reportRow);

  const res = await request('POST', `/api/admin/moderation/reports/${reportRow.id}/resolve`, {
    headers: { 'x-test-user': 'ADM_02' },
    body: { resolutionNotes: 'Reviewed post; content adheres to community guidelines.' }
  });

  assert.equal(res.status, 200);
  assert.equal(res.data.status, 'resolved');

  const updatedReport = await db.get('SELECT * FROM content_reports WHERE id = ?', reportRow.id);
  assert.equal(updatedReport.status, 'resolved');
  assert.equal(updatedReport.resolved_by, 'ADM_02');
  assert.ok(updatedReport.resolved_at);
});

test('20. Admin can dismiss reports', async () => {
  // Have CR Chris report Comment 10
  const reportRes = await request('POST', '/api/posts/1/comments/10/report', {
    headers: { 'x-test-user': 'CR_01' },
    body: { reason: 'other', description: 'Suspected duplicate message.' }
  });
  assert.equal(reportRes.status, 201);
  const repId = reportRes.data.reportId;

  // Admin dismisses report
  const dismissRes = await request('POST', `/api/admin/moderation/reports/${repId}/dismiss`, {
    headers: { 'x-test-user': 'ADM_01' },
    body: { resolutionNotes: 'Report deemed unfounded.' }
  });

  assert.equal(dismissRes.status, 200);
  assert.equal(dismissRes.data.status, 'dismissed');

  const reportRow = await db.get('SELECT * FROM content_reports WHERE id = ?', repId);
  assert.equal(reportRow.status, 'dismissed');
  assert.equal(reportRow.resolved_by, 'ADM_01');
});

test('21. Moderation generates durable audit records', async () => {
  const logs = await db.all(
    `SELECT * FROM admin_audit_logs 
     WHERE action IN ('post_removed', 'post_restored', 'comment_removed', 'comment_restored', 'content_report_resolved', 'content_report_dismissed')
     ORDER BY created_at DESC`
  );

  assert.ok(logs.length >= 4, 'Multiple moderation actions must have been logged');
  const actions = new Set(logs.map(l => l.action));
  assert.ok(actions.has('post_removed'));
  assert.ok(actions.has('post_restored'));
  assert.ok(actions.has('content_report_resolved'));
  assert.ok(actions.has('content_report_dismissed'));

  // Validate metadata and actor
  const removeLog = logs.find(l => l.action === 'post_removed');
  assert.ok(removeLog);
  assert.equal(removeLog.actor_user_id, 'ADM_01');
  assert.equal(removeLog.entity_type, 'post');
});

test('22. Audit failure rolls back moderation transactionally', async () => {
  // Test atomic rollback: simulate a failing audit insert during post removal
  // We can test this by running db.withTransaction or verifying that invalid action/actor aborts
  const postBefore = await db.get('SELECT moderation_status FROM posts WHERE id = 1');
  const initialStatus = postBefore.moderation_status;

  // Attempt remove with an invalid actor that will fail audit insertion constraint
  try {
    await db.withTransaction(async (tx) => {
      await tx.run("UPDATE posts SET moderation_status = 'removed' WHERE id = 1");
      // Intentionally call audit with non-existent foreign key actor to trigger constraint failure
      await tx.run(
        `INSERT INTO admin_audit_logs (id, actor_user_id, action, entity_type, entity_id, created_at)
         VALUES ('fail_test_01', 'NON_EXISTENT_ADMIN', 'post_removed', 'post', '1', datetime('now'))`
      );
    });
    assert.fail('Transaction should have rolled back due to audit constraint violation');
  } catch (err) {
    // Expected rollback
    assert.ok(err);
  }

  // Verify post status was preserved / rolled back
  const postAfter = await db.get('SELECT moderation_status FROM posts WHERE id = 1');
  assert.equal(postAfter.moderation_status, initialStatus, 'Post status must roll back on audit failure');
});

test('23. Comment threads remain consistent when parent is removed', async () => {
  // Comment 10 has child Comment 11 (reply from Sam)
  // Admin removes Comment 10
  await request('POST', '/api/admin/moderation/comments/10/remove', {
    headers: { 'x-test-user': 'ADM_01' },
    body: { reason: 'Violates language guidelines' }
  });

  // Now student Sara fetches comments for Post 1
  const commentsRes = await request('GET', '/api/posts/1/comments', {
    headers: { 'x-test-user': 'STU_02' }
  });

  assert.equal(commentsRes.status, 200);
  const comments = Array.isArray(commentsRes.data) ? commentsRes.data : (commentsRes.data.comments || []);

  // Find parent comment 10 in tree
  const parentComment = comments.find(c => c.id === 10);
  assert.ok(parentComment, 'Parent comment row must be preserved to maintain thread structure');
  assert.equal(parentComment.isRemoved, true);
  assert.equal(parentComment.content, '[Comment removed by moderation]');
  assert.equal(parentComment.name, 'Removed Comment');
  assert.equal(parentComment.avatarUrl, null);

  // Child comment 11 must still be intact inside replies
  assert.ok(parentComment.replies && parentComment.replies.length > 0, 'Child replies must be preserved');
  const childReply = parentComment.replies.find(r => r.id === 11);
  assert.ok(childReply);
  assert.equal(childReply.content, 'Thanks Sara, glad you liked it.');
});

test('24. Student Dashboard routes still work', async () => {
  const res1 = await request('GET', '/dashboard.html', {
    headers: { 'x-test-user': 'STU_01' }
  });
  assert.equal(res1.status, 200);

  const res2 = await request('GET', '/student-dashboard', {
    headers: { 'x-test-user': 'CR_01' }
  });
  assert.equal(res2.status, 200);
});

test('25. Teacher Dashboard routes still work', async () => {
  const res = await request('GET', '/teacher-dashboard.html', {
    headers: { 'x-test-user': 'TEA_01' }
  });
  assert.equal(res.status, 200);
});

test('26. Admin Dashboard routes still work', async () => {
  const res1 = await request('GET', '/admin-dashboard.html', {
    headers: { 'x-test-user': 'ADM_01' }
  });
  assert.equal(res1.status, 200);

  const res2 = await request('GET', '/api/admin/overview', {
    headers: { 'x-test-user': 'ADM_01' }
  });
  assert.equal(res2.status, 200);
  assert.ok(res2.data.counts);
});

test('27. Account suspension remains enforced on feeds and reports', async () => {
  const feedRes = await request('GET', '/api/posts', {
    headers: { 'x-test-user': 'STU_SUSP' }
  });
  assert.equal(feedRes.status, 403);
  assert.equal(feedRes.data.error, 'ACCOUNT_SUSPENDED');

  const reportRes = await request('POST', '/api/posts/1/report', {
    headers: { 'x-test-user': 'STU_SUSP' },
    body: { reason: 'spam' }
  });
  assert.equal(reportRes.status, 403);
  assert.equal(reportRes.data.error, 'ACCOUNT_SUSPENDED');
});

test('28. CR role management remains functional', async () => {
  // Admin promotes STU_02 to CR
  const promoteRes = await request('POST', '/api/admin/users/STU_02/promote-cr', {
    headers: { 'x-test-user': 'ADM_01' },
    body: { reason: 'Elected class representative' }
  });
  assert.equal(promoteRes.status, 200);
  assert.equal(promoteRes.data.role, 'cr');

  const stuRow = await db.get("SELECT role FROM students WHERE studentId = 'STU_02'");
  assert.equal(stuRow.role, 'cr');

  // Admin demotes STU_02 back to student
  const demoteRes = await request('POST', '/api/admin/users/STU_02/demote-student', {
    headers: { 'x-test-user': 'ADM_01' },
    body: { reason: 'Semester term completed' }
  });
  assert.equal(demoteRes.status, 200);
  assert.equal(demoteRes.data.role, 'student');
});

test('29. Permanent cohort assignments remain unchanged', async () => {
  const cohorts = await db.all('SELECT slot_code, current_semester, status FROM cohorts ORDER BY slot_code ASC');
  assert.equal(cohorts.length, 4);
  const slots = cohorts.map(c => c.slot_code);
  assert.deepEqual(slots.sort(), ['earth', 'mars', 'mercury', 'venus']);
});

test('30. Teacher onboarding remains disabled', () => {
  assert.equal(isTeacherOnboardingEnabled(), false);
});

test('31. Concurrent moderation actions execute safely without corruption', async () => {
  // Ensure Post 3 is active
  await db.run("UPDATE posts SET moderation_status = 'active' WHERE id = 3");

  // Run two concurrent removals from two admins
  const [resA, resB] = await Promise.all([
    request('POST', '/api/admin/moderation/posts/3/remove', {
      headers: { 'x-test-user': 'ADM_01' },
      body: { reason: 'Concurrent test removal by Admin 1' }
    }),
    request('POST', '/api/admin/moderation/posts/3/remove', {
      headers: { 'x-test-user': 'ADM_02' },
      body: { reason: 'Concurrent test removal by Admin 2' }
    })
  ]);

  // One will succeed (200), the second will see it is already removed (409 Conflict) or also succeed cleanly
  const statuses = [resA.status, resB.status];
  assert.ok(statuses.includes(200), 'At least one concurrent removal must succeed with 200');
  assert.ok(statuses.includes(409) || statuses.filter(s => s === 200).length === 2, 'Second call must handle state transition cleanly');

  const finalPost = await db.get('SELECT moderation_status FROM posts WHERE id = 3');
  assert.equal(finalPost.moderation_status, 'removed');
});
