'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');

const testDbPath = path.join(os.tmpdir(), `phase4c2_mobile_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
process.env.NODE_ENV = 'test';
process.env.DB_PATH = testDbPath;
process.env.TEACHER_ONBOARDING_ENABLED = 'false';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const bcrypt = require('bcryptjs');
const app = require('../server');
const db = require('../db');
const { ensureTeacherSchema } = require('../lib/teacher-service');
const { ensureAuditSchema, recordAdminAudit } = require('../lib/audit-service');
const { ensurePostsSchema } = require('../lib/posts');
const { updateCanonicalSubject } = require('../lib/academic-service');

let server;
let baseUrl;

const adminPassword = 'AdminMobile_Pass4C2!';
const admin2Password = 'Admin2Mobile_Pass4C2!';
const teacherPassword = 'TeacherMobile_Pass4C2!';
const studentPassword = 'StudentMobile_Pass4C2!';
const crPassword = 'CrMobile_Pass4C2!';
const suspendedAdminPassword = 'SuspAdmin_Pass4C2!';

let adminToken = '';
let admin2Token = '';
let teacherToken = '';
let studentToken = '';
let crToken = '';
let suspendedAdminToken = '';

test.before(async () => {
  await db.initSchema();
  await ensureTeacherSchema({ exec: db.exec, isPostgres: db.isPostgres });
  await ensureAuditSchema(db);
  await ensurePostsSchema(db);

  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  const hashAdmin = bcrypt.hashSync(adminPassword, 10);
  const hashAdmin2 = bcrypt.hashSync(admin2Password, 10);
  const hashTeacher = bcrypt.hashSync(teacherPassword, 10);
  const hashStudent = bcrypt.hashSync(studentPassword, 10);
  const hashCr = bcrypt.hashSync(crPassword, 10);
  const hashSuspendedAdmin = bcrypt.hashSync(suspendedAdminPassword, 10);

  // 1. Seed Cohorts
  await db.run(
    `INSERT INTO cohorts (id, slot_code, display_name, status, current_semester)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (id) DO NOTHING`,
    'c_mercury', 'mercury', 'Mercury Cohort', 'active', 1
  );

  // 2. Seed Subjects
  await db.run(
    `INSERT INTO subjects (id, code, name, semester, department, active)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO NOTHING`,
    'SUB4C1', 'SUB4C1', 'Database Systems', 3, 'BIT', 1
  );

  // 3. Seed Accounts
  await db.run(
    `INSERT INTO students (studentId, name, email, role, passwordHash, semester, department, cohort_id, account_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'adm_4c2_root', 'Root Admin', 'admin@gandaki.edu.np', 'admin', hashAdmin, '1', 'BIT', null, 'active'
  );

  await db.run(
    `INSERT INTO students (studentId, name, email, role, passwordHash, semester, department, cohort_id, account_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'adm_4c2_secondary', 'Secondary Admin', 'admin2@gandaki.edu.np', 'admin', hashAdmin2, '1', 'BIT', null, 'active'
  );

  await db.run(
    `INSERT INTO students (studentId, name, email, role, passwordHash, semester, department, cohort_id, account_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    't_4c2_fac', 'Faculty Jane', 'faculty@gandaki.edu.np', 'teacher', hashTeacher, '1', 'BIT', null, 'active'
  );

  await db.run(
    `INSERT INTO students (studentId, name, email, role, passwordHash, semester, department, cohort_id, account_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'stu_4c2_target', 'Alice Student', 'student@gandaki.edu.np', 'student', hashStudent, '3', 'BIT', 'c_mercury', 'active'
  );

  await db.run(
    `INSERT INTO students (studentId, name, email, role, passwordHash, semester, department, cohort_id, account_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'cr_4c2_target', 'Bob Representative', 'cr@gandaki.edu.np', 'cr', hashCr, '3', 'BIT', 'c_mercury', 'active'
  );

  await db.run(
    `INSERT INTO students (studentId, name, email, role, passwordHash, semester, department, cohort_id, account_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'adm_4c2_suspended', 'Suspended Admin', 'susp_admin@gandaki.edu.np', 'admin', hashSuspendedAdmin, '1', 'BIT', null, 'suspended'
  );

  // 4. Authenticate via POST /api/mobile/login to obtain actual bearer tokens
  const adminLoginRes = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'adm_4c2_root', password: adminPassword }),
  });
  assert.equal(adminLoginRes.status, 200);
  adminToken = (await adminLoginRes.json()).token;

  const admin2LoginRes = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'adm_4c2_secondary', password: admin2Password }),
  });
  assert.equal(admin2LoginRes.status, 200);
  admin2Token = (await admin2LoginRes.json()).token;

  const teacherLoginRes = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 't_4c2_fac', password: teacherPassword }),
  });
  assert.equal(teacherLoginRes.status, 200);
  teacherToken = (await teacherLoginRes.json()).token;

  const studentLoginRes = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'stu_4c2_target', password: studentPassword }),
  });
  assert.equal(studentLoginRes.status, 200);
  studentToken = (await studentLoginRes.json()).token;

  const crLoginRes = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'cr_4c2_target', password: crPassword }),
  });
  assert.equal(crLoginRes.status, 200);
  crToken = (await crLoginRes.json()).token;

  // Insert a mock token for suspended admin directly to test pre-existing token rejection
  suspendedAdminToken = 'mock_suspended_admin_token_64_characters_long_for_test_purposes_1234';
  await db.run(
    'INSERT INTO mobile_tokens (token, studentId, createdAt, expiresAt) VALUES (?, ?, ?, ?)',
    suspendedAdminToken,
    'adm_4c2_suspended',
    new Date().toISOString(),
    new Date(Date.now() + 86400000).toISOString()
  );
});

test.after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await db.close();
  try {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  } catch {}
});

// ==========================================
// TEST SUITE: PHASE 4C.2 ADMIN MOBILE ACTIONS
// ==========================================

test('1. Admin mobile bearer token accepted by authorized admin endpoints', async () => {
  const endpoints = [
    '/api/admin/overview',
    '/api/admin/users?page=1&limit=10',
    '/api/admin/academics',
    '/api/admin/moderation/queue',
    '/api/admin/activity',
    '/api/admin/audit-logs',
  ];

  for (const ep of endpoints) {
    const res = await fetch(`${baseUrl}${ep}`, {
      headers: { Authorization: `Bearer ${adminToken}`, Accept: 'application/json' },
    });
    assert.equal(res.status, 200, `Admin mobile bearer token must access ${ep}`);
  }
});

test('2. Student mobile token rejected by admin endpoints (403)', async () => {
  const res = await fetch(`${baseUrl}/api/admin/overview`, {
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  assert.equal(res.status, 403);
});

test('3. CR mobile token rejected by admin endpoints (403)', async () => {
  const res = await fetch(`${baseUrl}/api/admin/overview`, {
    headers: { Authorization: `Bearer ${crToken}` },
  });
  assert.equal(res.status, 403);
});

test('4. Teacher mobile token rejected by admin endpoints (403)', async () => {
  const res = await fetch(`${baseUrl}/api/admin/overview`, {
    headers: { Authorization: `Bearer ${teacherToken}` },
  });
  assert.equal(res.status, 403);
});

test('5. Expired mobile token rejected (401)', async () => {
  const expiredToken = 'expired_mock_token_64_characters_for_mobile_auth_test_123456789';
  await db.run(
    'INSERT INTO mobile_tokens (token, studentId, createdAt, expiresAt) VALUES (?, ?, ?, ?)',
    expiredToken,
    'adm_4c2_root',
    new Date(Date.now() - 100000).toISOString(),
    new Date(Date.now() - 50000).toISOString()
  );

  const res = await fetch(`${baseUrl}/api/admin/overview`, {
    headers: { Authorization: `Bearer ${expiredToken}` },
  });
  assert.equal(res.status, 401);
});

test('6. Suspended administrator blocked from admin endpoints (403)', async () => {
  const res = await fetch(`${baseUrl}/api/admin/overview`, {
    headers: { Authorization: `Bearer ${suspendedAdminToken}` },
  });
  assert.equal(res.status, 403);
  const data = await res.json();
  assert.equal(data.error, 'ACCOUNT_SUSPENDED');
});

test('7. Admin can suspend eligible student account with mobile bearer token', async () => {
  const res = await fetch(`${baseUrl}/api/admin/users/stu_4c2_target/suspend`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ reason: 'Policy violation investigation' }),
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.accountStatus, 'suspended');

  // Verify in database
  const user = await db.get('SELECT account_status FROM students WHERE studentId = ?', 'stu_4c2_target');
  assert.equal(user.account_status, 'suspended');
});

test('8. Admin can reactivate suspended account with mobile bearer token', async () => {
  const res = await fetch(`${baseUrl}/api/admin/users/stu_4c2_target/reactivate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ reason: 'Investigation completed with clear standing' }),
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.accountStatus, 'active');

  const user = await db.get('SELECT account_status FROM students WHERE studentId = ?', 'stu_4c2_target');
  assert.equal(user.account_status, 'active');
});

test('9. Admin can promote Student to CR with mobile bearer token', async () => {
  const res = await fetch(`${baseUrl}/api/admin/users/stu_4c2_target/promote-cr`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ reason: 'Elected class representative for Sem 3' }),
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.role, 'cr');

  const user = await db.get('SELECT role FROM students WHERE studentId = ?', 'stu_4c2_target');
  assert.equal(user.role, 'cr');
});

test('10. Admin can demote CR to Student with mobile bearer token', async () => {
  const res = await fetch(`${baseUrl}/api/admin/users/stu_4c2_target/demote-student`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ reason: 'End of term transition' }),
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.role, 'student');

  const user = await db.get('SELECT role FROM students WHERE studentId = ?', 'stu_4c2_target');
  assert.equal(user.role, 'student');
});

test('11. Account suspension requires mandatory reason (min length 3)', async () => {
  const res = await fetch(`${baseUrl}/api/admin/users/stu_4c2_target/suspend`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ reason: '  ' }),
  });
  assert.equal(res.status, 400);
});

test('12. Role change requires mandatory reason', async () => {
  const res = await fetch(`${baseUrl}/api/admin/users/stu_4c2_target/promote-cr`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ reason: '' }),
  });
  assert.equal(res.status, 400);
});

test('13. Admin cannot suspend self', async () => {
  const res = await fetch(`${baseUrl}/api/admin/users/adm_4c2_root/suspend`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ reason: 'Attempt self-suspension' }),
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.ok(data.message.includes('Administrators cannot suspend their own account'));
});

test('14. Admin cannot suspend other admins', async () => {
  const res = await fetch(`${baseUrl}/api/admin/users/adm_4c2_secondary/suspend`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ reason: 'Attempt peer suspension' }),
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.ok(data.message.includes('Administrator accounts cannot be suspended'));
});

test('15. Student semester and cohort remain strictly unchanged across role transitions', async () => {
  const user = await db.get('SELECT semester, cohort_id FROM students WHERE studentId = ?', 'stu_4c2_target');
  assert.equal(user.semester, '3');
  assert.equal(user.cohort_id, 'c_mercury');
});

test('16. Admin creates canonical subject with mobile bearer token', async () => {
  const res = await fetch(`${baseUrl}/api/admin/academics/subjects`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      code: 'NET301',
      name: 'Computer Networks',
      semester: 3,
      department: 'BIT',
      creditHours: 3.0,
      nature: 'Theory & Practical',
      reason: 'Curriculum update',
    }),
  });
  assert.equal(res.status, 201);
  const data = await res.json();
  assert.equal(data.subject.code, 'NET301');
});

test('17. Admin edits subject metadata with mobile bearer token', async () => {
  const res = await fetch(`${baseUrl}/api/admin/academics/subjects/NET301`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'Advanced Computer Networks',
      creditHours: 4.0,
      reason: 'Credit expansion',
    }),
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.subject.name, 'Advanced Computer Networks');
});

test('18. Admin archives subject with mobile bearer token', async () => {
  const res = await fetch(`${baseUrl}/api/admin/academics/subjects/NET301/archive`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ reason: 'Elective discontinued' }),
  });
  assert.equal(res.status, 200);

  const sub = await db.get('SELECT active FROM subjects WHERE code = ?', 'NET301');
  assert.equal(Number(sub.active), 0);
});

test('19. Admin reactivates subject with mobile bearer token', async () => {
  const res = await fetch(`${baseUrl}/api/admin/academics/subjects/NET301/reactivate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ reason: 'Elective reopened' }),
  });
  assert.equal(res.status, 200);

  const sub = await db.get('SELECT active FROM subjects WHERE code = ?', 'NET301');
  assert.equal(Number(sub.active), 1);
});

test('20. Linked subject semester change is rejected safely (409 Conflict)', async () => {
  // Link a file to SUB4C1
  await db.run(
    `INSERT INTO files (storedName, originalName, title, subject, semester, uploadedBy, sizeBytes, uploadedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    'file_linked_test.pdf', 'file_linked_test.pdf', 'Lecture 1 Notes', 'SUB4C1', '3', 'adm_4c2_root', 1024, new Date().toISOString()
  );

  const res = await fetch(`${baseUrl}/api/admin/academics/subjects/SUB4C1`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      semester: 4,
      reason: 'Attempted semester migration',
    }),
  });

  assert.equal(res.status, 409, 'Must return HTTP 409 Conflict when subject has linked materials');
});

test('21. Admin removes and restores posts with mobile bearer token', async () => {
  // Create test post
  const insPost = await db.run(
    `INSERT INTO posts (user_id, title, content, type, category, moderation_status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    'stu_4c2_target', 'Test Discussion', 'Inappropriate content to moderate', 'status', 'general', 'active'
  );
  const postId = insPost.lastInsertRowid;

  // Remove post
  const remRes = await fetch(`${baseUrl}/api/admin/moderation/posts/${postId}/remove`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ reason: 'Violates community guidelines' }),
  });
  assert.equal(remRes.status, 200);

  const postAfterRemove = await db.get('SELECT moderation_status FROM posts WHERE id = ?', postId);
  assert.equal(postAfterRemove.moderation_status, 'removed');

  // Restore post
  const restRes = await fetch(`${baseUrl}/api/admin/moderation/posts/${postId}/restore`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ reason: 'Appeal granted' }),
  });
  assert.equal(restRes.status, 200);

  const postAfterRestore = await db.get('SELECT moderation_status FROM posts WHERE id = ?', postId);
  assert.equal(postAfterRestore.moderation_status, 'active');
});

test('22. Admin removes and restores comments with mobile bearer token', async () => {
  const insPost = await db.run(
    `INSERT INTO posts (user_id, title, content, type, category, moderation_status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    'stu_4c2_target', 'Comment Test Post', 'Parent post', 'status', 'general', 'active'
  );
  const postId = insPost.lastInsertRowid;

  const insComm = await db.run(
    `INSERT INTO post_comments (post_id, user_id, content, moderation_status)
     VALUES (?, ?, ?, ?)`,
    postId, 'stu_4c2_target', 'Disruptive comment', 'active'
  );
  const commentId = insComm.lastInsertRowid;

  // Remove comment
  const remRes = await fetch(`${baseUrl}/api/admin/moderation/comments/${commentId}/remove`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ reason: 'Spam comment' }),
  });
  assert.equal(remRes.status, 200);

  const commAfterRemove = await db.get('SELECT moderation_status FROM post_comments WHERE id = ?', commentId);
  assert.equal(commAfterRemove.moderation_status, 'removed');

  // Restore comment
  const restRes = await fetch(`${baseUrl}/api/admin/moderation/comments/${commentId}/restore`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ reason: 'Restored upon review' }),
  });
  assert.equal(restRes.status, 200);

  const commAfterRestore = await db.get('SELECT moderation_status FROM post_comments WHERE id = ?', commentId);
  assert.equal(commAfterRestore.moderation_status, 'active');
});

test('23. Admin resolves and dismisses reports with mobile bearer token', async () => {
  const insRep1 = await db.run(
    `INSERT INTO content_reports (content_type, content_id, reporter_id, reason, status)
     VALUES (?, ?, ?, ?, ?)`,
    'post', 1, 'stu_4c2_target', 'harassment', 'open'
  );
  const rep1Id = insRep1.lastInsertRowid;

  const insRep2 = await db.run(
    `INSERT INTO content_reports (content_type, content_id, reporter_id, reason, status)
     VALUES (?, ?, ?, ?, ?)`,
    'post', 1, 'cr_4c2_target', 'misinformation', 'open'
  );
  const rep2Id = insRep2.lastInsertRowid;

  // Resolve rep1
  const resRes = await fetch(`${baseUrl}/api/admin/moderation/reports/${rep1Id}/resolve`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ resolutionNotes: 'Reviewed and actioned' }),
  });
  assert.equal(resRes.status, 200);

  // Dismiss rep2
  const disRes = await fetch(`${baseUrl}/api/admin/moderation/reports/${rep2Id}/dismiss`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ resolutionNotes: 'No policy infraction found' }),
  });
  assert.equal(disRes.status, 200);

  const rep1 = await db.get('SELECT status FROM content_reports WHERE id = ?', rep1Id);
  const rep2 = await db.get('SELECT status FROM content_reports WHERE id = ?', rep2Id);
  assert.equal(rep1.status, 'resolved');
  assert.equal(rep2.status, 'dismissed');
});

test('24. Audit records generated correctly with actorUserId = authenticated admin ID', async () => {
  const recentLogs = await db.all(
    `SELECT * FROM admin_audit_logs WHERE actor_user_id = 'adm_4c2_root' ORDER BY id DESC LIMIT 10`
  );
  assert.ok(recentLogs.length > 0, 'Audit logs must exist for admin actions');

  const actions = recentLogs.map((l) => l.action);
  assert.ok(actions.includes('content_report_resolved') || actions.includes('content_report_dismissed'));
  assert.ok(actions.includes('post_removed') || actions.includes('post_restored'));
});

test('25. Audit failures roll back mutations transactionally', async () => {
  const initialStatus = (await db.get('SELECT account_status FROM students WHERE studentId = ?', 'stu_4c2_target')).account_status;

  const mockFailTx = async () => {
    return db.withTransaction(async (tx) => {
      await tx.run("UPDATE students SET account_status = 'suspended' WHERE studentId = 'stu_4c2_target'");
      throw new Error('SIMULATED_AUDIT_LOG_IO_FAILURE');
    });
  };

  await assert.rejects(mockFailTx, /SIMULATED_AUDIT_LOG_IO_FAILURE/);

  const postStatus = (await db.get('SELECT account_status FROM students WHERE studentId = ?', 'stu_4c2_target')).account_status;
  assert.equal(postStatus, initialStatus, 'Account status must roll back to active on transaction failure');
});

test('26. Mutation UI prevents duplicate requests (isSubmitting guard in component files)', () => {
  const usersViewCode = fs.readFileSync(path.resolve(__dirname, '../mobile/components/admin/AdminUsersView.tsx'), 'utf8');
  assert.ok(usersViewCode.includes('if (!selectedUser || !activeAction || isSubmittingAction) return;'));
  assert.ok(usersViewCode.includes('isSubmitting={isSubmittingAction}'));

  const confirmModalCode = fs.readFileSync(path.resolve(__dirname, '../mobile/components/admin/AdminActionConfirmModal.tsx'), 'utf8');
  assert.ok(confirmModalCode.includes('disabled={!canSubmit}'));
});

test('27. Relevant React Query caches invalidate after mutations', () => {
  const usersViewCode = fs.readFileSync(path.resolve(__dirname, '../mobile/components/admin/AdminUsersView.tsx'), 'utf8');
  assert.ok(usersViewCode.includes("queryKey: ['admin-users']"));
  assert.ok(usersViewCode.includes("queryKey: ['admin-overview']"));
  assert.ok(usersViewCode.includes("queryKey: ['admin-user-suspension-history', selectedUser.studentId]"));
  assert.ok(usersViewCode.includes("queryKey: ['admin-user-role-history', selectedUser.studentId]"));

  const academicsViewCode = fs.readFileSync(path.resolve(__dirname, '../mobile/components/admin/AdminAcademicsView.tsx'), 'utf8');
  assert.ok(academicsViewCode.includes("queryKey: ['admin-academics-overview']"));
  assert.ok(academicsViewCode.includes("queryKey: ['admin-academics-subjects']"));

  const contentViewCode = fs.readFileSync(path.resolve(__dirname, '../mobile/components/admin/AdminContentView.tsx'), 'utf8');
  assert.ok(contentViewCode.includes("queryKey: ['admin-moderation-queue']"));
  assert.ok(contentViewCode.includes("queryKey: ['admin-moderation-reports']"));
});

test('28. Existing five-tab admin navigation works', async () => {
  const { ADMIN_TAB_CONFIGS } = await import('../mobile/constants/tabs.ts');
  assert.equal(ADMIN_TAB_CONFIGS.length, 5);
  assert.equal(ADMIN_TAB_CONFIGS[0].name, 'index');
  assert.equal(ADMIN_TAB_CONFIGS[0].label, 'Dashboard');
  assert.equal(ADMIN_TAB_CONFIGS[1].name, 'library');
  assert.equal(ADMIN_TAB_CONFIGS[1].label, 'Users');
  assert.equal(ADMIN_TAB_CONFIGS[2].name, 'chat');
  assert.equal(ADMIN_TAB_CONFIGS[2].label, 'Academics');
  assert.equal(ADMIN_TAB_CONFIGS[3].name, 'games');
  assert.equal(ADMIN_TAB_CONFIGS[3].label, 'Content');
  assert.equal(ADMIN_TAB_CONFIGS[4].name, 'profile');
  assert.equal(ADMIN_TAB_CONFIGS[4].label, 'Profile');
});

test('29. Student and CR tabs remain unchanged', async () => {
  const { STUDENT_TAB_CONFIGS } = await import('../mobile/constants/tabs.ts');
  const { resolveAppRole } = await import('../mobile/utils/roles.ts');
  assert.equal(STUDENT_TAB_CONFIGS.length, 5);
  assert.equal(STUDENT_TAB_CONFIGS[0].label, 'Home');
  assert.equal(STUDENT_TAB_CONFIGS[1].label, 'Library');
  assert.equal(STUDENT_TAB_CONFIGS[2].label, 'Chat');
  assert.equal(STUDENT_TAB_CONFIGS[3].label, 'Games');
  assert.equal(STUDENT_TAB_CONFIGS[4].label, 'Profile');

  assert.equal(resolveAppRole({ role: 'student' }), 'student');
  assert.equal(resolveAppRole({ role: 'cr' }), 'student');
});

test('30. Teacher tabs remain unchanged', async () => {
  const { TEACHER_TAB_CONFIGS } = await import('../mobile/constants/tabs.ts');
  const { resolveAppRole } = await import('../mobile/utils/roles.ts');
  assert.equal(TEACHER_TAB_CONFIGS.length, 5);
  assert.equal(TEACHER_TAB_CONFIGS[0].label, 'Dashboard');
  assert.equal(TEACHER_TAB_CONFIGS[1].label, 'My Materials');
  assert.equal(TEACHER_TAB_CONFIGS[2].label, 'Chat');
  assert.equal(TEACHER_TAB_CONFIGS[3].label, 'Notices');
  assert.equal(TEACHER_TAB_CONFIGS[4].label, 'Profile');

  assert.equal(resolveAppRole({ role: 'teacher' }), 'teacher');
});

test('31. No role-specific data leaks across account switching', () => {
  const authContextCode = fs.readFileSync(path.resolve(__dirname, '../mobile/context/AuthContext.tsx'), 'utf8');
  assert.ok(authContextCode.includes('await clearAppQueryCache();'));
  assert.ok(authContextCode.includes('await clearChatDb();') || authContextCode.includes('await clearChatDb({ preservePending: true });'));
  assert.ok(authContextCode.includes('await clearAllDmCache();'));
});

test('32. Missing migration displays a safe unavailable state', () => {
  const contentViewCode = fs.readFileSync(path.resolve(__dirname, '../mobile/components/admin/AdminContentView.tsx'), 'utf8');
  assert.ok(contentViewCode.includes('overviewQuery.data?.unavailable'));
  assert.ok(contentViewCode.includes('Content moderation schema pending staging migration'));
});

test('33. Teacher onboarding remains disabled platform-wide', () => {
  const { isTeacherOnboardingEnabled } = require('../lib/teacher-service');
  assert.equal(isTeacherOnboardingEnabled(), false);
});

test('34. Concurrent conflicting actions resolve safely and deterministically', async () => {
  // Test concurrent suspend calls on the same account
  const [resA, resB] = await Promise.all([
    fetch(`${baseUrl}/api/admin/users/cr_4c2_target/suspend`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Concurrent suspension request A' }),
    }),
    fetch(`${baseUrl}/api/admin/users/cr_4c2_target/suspend`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Concurrent suspension request B' }),
    }),
  ]);

  const statuses = [resA.status, resB.status];
  assert.ok(statuses.includes(200), 'At least one request must succeed');
  assert.ok(statuses.includes(409) || statuses.filter((s) => s === 200).length === 2, 'Conflicting request must either succeed or return 409 conflict');
});
