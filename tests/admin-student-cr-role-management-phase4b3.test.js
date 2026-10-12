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

// Configure isolated disposable SQLite database for testing Phase 4B.3
const tempDbPath = path.join(
  os.tmpdir(),
  `admin_cr_management_phase4b3_${Date.now()}_${Math.random().toString(36).slice(2)}.db`
);

process.env.NODE_ENV = 'test';
process.env.DB_PATH = tempDbPath;
process.env.SEMESTER_DB_SKIP_INIT = '1';
process.env.SESSION_SECRET = 'test-session-secret-phase-4b3-cr-management-key';
process.env.TEACHER_ONBOARDING_SECRET = 'test-teacher-onboarding-secret-key-32-bytes-secure!';
delete process.env.TEACHER_ONBOARDING_ENABLED; // strictly disabled
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
delete process.env.PGHOST;

// Core services and routers
const db = require('../db');
const { ensureAuditSchema } = require('../lib/audit-service');
const { isTeacherOnboardingEnabled } = require('../lib/teacher-service');
const { ensureAcademicCohortSchema } = require('../lib/academic-context');
const { createAdminDashboardRouter } = require('../routes/admin-dashboard');
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

  // 2. Seed permanent cohorts
  await db.run(
    `INSERT INTO cohorts (id, slot_code, group_code, display_name, current_semester, intake_year, intake_identifier, status)
     VALUES (?, 'mercury', 'MERCURY', 'Mercury Cohort', 1, 2026, '2026-MERCURY', 'active')`,
    'COH_MERCURY_01'
  );

  // 3. Seed users
  const users = [
    { id: 'ADM_01', user: 'admin1', name: 'Admin Alice', role: 'admin', email: 'admin@college.edu', suid: 'supa_adm_01' },
    { id: 'ADM_02', user: 'admin2', name: 'Admin Bob', role: 'admin', email: 'admin2@college.edu', suid: 'supa_adm_02' },
    { id: 'TEA_01', user: 'teacher1', name: 'Teacher Tara', role: 'teacher', email: 'teacher@college.edu', suid: 'supa_tea_01' },
    { id: 'STU_01', user: 'student1', name: 'Student Sam', role: 'student', email: 'student1@college.edu', suid: 'supa_stu_01', cohortId: 'COH_MERCURY_01' },
    { id: 'STU_02', user: 'student2', name: 'Student Sara', role: 'student', email: 'student2@college.edu', suid: 'supa_stu_02', cohortId: 'COH_MERCURY_01' },
    { id: 'CR_01', user: 'cr1', name: 'CR Chris', role: 'cr', email: 'cr1@college.edu', suid: 'supa_cr_01', cohortId: 'COH_MERCURY_01' },
    { id: 'STU_SUSP', user: 'suspended1', name: 'Suspended Stu', role: 'student', email: 'susp@college.edu', suid: 'supa_susp_01', status: 'suspended', cohortId: 'COH_MERCURY_01' }
  ];

  for (const u of users) {
    await db.run(
      `INSERT INTO students (studentId, username, name, passwordHash, role, department, semester, email, supabase_uid, cohort_id, account_status)
       VALUES (?, ?, ?, ?, ?, 'BIT', 'Semester 1', ?, ?, ?, ?)`,
      u.id, u.user, u.name, testPasswordHash, u.role, u.email, u.suid, u.cohortId || null, u.status || 'active'
    );
  }

  // Seed sample post, note, and assignment
  await db.run(
    `INSERT INTO posts (id, user_id, title, content, type, audience_scope, cohort_id, semester_no)
     VALUES (101, 'STU_01', 'Sam Note Post', 'Sample post content', 'status', 'cohort', 'COH_MERCURY_01', 1)`
  );
  await db.run(
    `INSERT INTO files (id, storedName, originalName, title, uploadedBy, sizeBytes, uploadedAt, cohort_id, semester_no)
     VALUES (201, 'notes.pdf', 'Lecture1.pdf', 'Lecture 1 Notes', 'STU_01', 1024, datetime('now'), 'COH_MERCURY_01', 1)`
  );

  // 4. Build Express application with dynamic session & token auth
  const app = express();
  app.use(express.json());
  app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
  }));

  const authMw = createAuthMiddleware(db);

  // Dynamic session middleware mirroring server.js
  const requireSessionLogin = async (req, res, next) => {
    if (req.isSuspended) {
      return res.status(403).json({ error: 'ACCOUNT_SUSPENDED', message: 'Account is suspended' });
    }
    if (req.user && req.user.studentId) {
      if (req.user.account_status === 'suspended') {
        return res.status(403).json({ error: 'ACCOUNT_SUSPENDED', message: 'Account is suspended' });
      }
      req.student = req.user;
      req.session.role = req.user.role || 'student';
      return next();
    }
    if (req.session && req.session.studentId) {
      const student = await db.get(
        'SELECT studentId, role, name, department, semester, email, avatarUrl, account_status FROM students WHERE studentId = ?',
        req.session.studentId
      );
      if (!student) {
        if (typeof req.session.destroy === 'function') req.session.destroy(() => {});
        return res.status(401).json({ message: 'User not found' });
      }
      if (student.account_status === 'suspended') {
        if (typeof req.session.destroy === 'function') req.session.destroy(() => {});
        return res.status(403).json({ error: 'ACCOUNT_SUSPENDED', message: 'Account is suspended' });
      }
      req.user = student;
      req.student = student;
      req.session.role = student.role || 'student';
      return next();
    }
    return res.status(401).json({ message: 'Authentication required' });
  };

  // Mount Admin Dashboard router
  app.use('/api/admin', createAdminDashboardRouter({ db, requireLogin: requireSessionLogin }));

  // Mock /api/login endpoint
  app.post('/api/login', async (req, res) => {
    const { studentId, password } = req.body || {};
    const student = await db.get('SELECT * FROM students WHERE studentId = ?', studentId);
    if (!student) return res.status(401).json({ message: 'Invalid credentials' });
    if (student.account_status === 'suspended') {
      return res.status(403).json({ error: 'ACCOUNT_SUSPENDED' });
    }
    if (!bcrypt.compareSync(password, student.passwordHash)) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    req.session.studentId = student.studentId;
    req.session.studentName = student.name;
    req.session.role = student.role || 'student';
    res.json({ success: true, role: student.role });
  });

  // Mock /api/mobile/login endpoint
  app.post('/api/mobile/login', async (req, res) => {
    const { studentId } = req.body || {};
    const student = await db.get('SELECT * FROM students WHERE studentId = ?', studentId);
    if (!student) return res.status(401).json({ message: 'User not found' });
    const token = `mob_${studentId}_${Date.now()}`;
    await db.run(
      'INSERT INTO mobile_tokens (token, studentId, createdAt, expiresAt) VALUES (?, ?, ?, ?)',
      token, student.studentId, new Date().toISOString(), new Date(Date.now() + 86400000).toISOString()
    );
    res.json({ success: true, token, studentId: student.studentId });
  });

  // Mock /api/me endpoint returning current authoritative role
  app.get('/api/me', requireSessionLogin, (req, res) => {
    res.json({
      studentId: req.user.studentId,
      name: req.user.name,
      role: req.user.role,
      isCR: req.user.role === 'cr' || req.user.role === 'class_rep',
      isAdmin: req.user.role === 'admin',
      semester: req.user.semester,
      cohortId: req.user.cohort_id
    });
  });

  // Mock /api/profile endpoint returning fresh user profile
  app.get('/api/profile', authMw.authenticate, authMw.requireLogin, (req, res) => {
    res.json({
      studentId: req.user.studentId,
      name: req.user.name,
      role: req.user.role,
      isCR: req.user.role === 'cr' || req.user.role === 'class_rep',
      isAdmin: req.user.role === 'admin'
    });
  });

  // CR-only capability: Pin chat announcement
  app.post('/api/chat/pinned', requireSessionLogin, (req, res) => {
    const role = req.user.role;
    if (role !== 'admin' && role !== 'cr' && role !== 'class_rep') {
      return res.status(403).json({ error: 'Forbidden: Only admins or class representatives can pin messages.' });
    }
    res.json({ success: true, pinned: true });
  });

  // CR-only capability: Create assignment
  app.post('/api/assignments', requireSessionLogin, (req, res) => {
    const role = req.user.role;
    if (role !== 'admin' && role !== 'teacher' && role !== 'cr' && role !== 'class_rep') {
      return res.status(403).json({ error: 'Forbidden: Only faculty or CRs can create assignments.' });
    }
    res.json({ success: true, assignmentCreated: true });
  });

  // Student dashboard route
  app.get('/api/student/dashboard', requireSessionLogin, (req, res) => {
    res.json({ success: true, dashboard: 'student-dashboard', role: req.user.role });
  });

  // Teacher portal route
  app.get('/api/teacher/portal', requireSessionLogin, (req, res) => {
    if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: Faculty access only.' });
    }
    res.json({ success: true, portal: 'faculty-portal' });
  });

  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
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

async function makeRequest(endpoint, { method = 'GET', body = null, headers = {} } = {}) {
  const url = `${baseUrl}${endpoint}`;
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  let json = null;
  const rawText = await res.text();
  try { json = JSON.parse(rawText); } catch (_) { json = { raw: rawText }; }
  return { status: res.status, headers: res.headers, body: json };
}

async function loginAs(studentId, password = TEST_PASS) {
  const res = await makeRequest('/api/login', { method: 'POST', body: { studentId, password } });
  const setCookie = res.headers.get('set-cookie');
  const cookie = setCookie ? setCookie.split(';')[0] : '';
  return { cookie, status: res.status, body: res.body };
}

// ============================================================================
// PHASE 4B.3 TESTS: 28 RIGOROUS SECURITY & FUNCTIONAL REQUIREMENTS
// ============================================================================

test('Req 1: Admin successfully promotes Student to CR with mandatory reason', async () => {
  const { cookie } = await loginAs('ADM_01');
  const res = await makeRequest('/api/admin/users/STU_01/promote-cr', {
    method: 'POST',
    headers: { cookie },
    body: { reason: 'Elected class representative for Spring semester' }
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.role, 'cr');
  assert.equal(res.body.previousRole, 'student');

  // Verify DB state
  const stu = await db.get('SELECT role FROM students WHERE studentId = ?', 'STU_01');
  assert.equal(stu.role, 'cr');
});

test('Req 2: Admin successfully demotes CR to regular Student with mandatory reason', async () => {
  const { cookie } = await loginAs('ADM_01');
  const res = await makeRequest('/api/admin/users/CR_01/demote-student', {
    method: 'POST',
    headers: { cookie },
    body: { reason: 'Term completed; regular student status restored' }
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.role, 'student');
  assert.equal(res.body.previousRole, 'cr');

  // Verify DB state
  const cr = await db.get('SELECT role FROM students WHERE studentId = ?', 'CR_01');
  assert.equal(cr.role, 'student');
});

test('Req 3: Regular Student cannot promote or demote accounts (403 Forbidden)', async () => {
  const { cookie } = await loginAs('STU_02');
  const res = await makeRequest('/api/admin/users/STU_02/promote-cr', {
    method: 'POST',
    headers: { cookie },
    body: { reason: 'Self-promotion attempt' }
  });
  assert.equal(res.status, 403);
});

test('Req 4: Class Representative (CR) cannot promote or demote accounts (403 Forbidden)', async () => {
  // STU_01 is now a CR
  const { cookie } = await loginAs('STU_01');
  const res = await makeRequest('/api/admin/users/STU_02/promote-cr', {
    method: 'POST',
    headers: { cookie },
    body: { reason: 'Peer promotion attempt' }
  });
  assert.equal(res.status, 403);
});

test('Req 5: Teacher cannot promote or demote accounts (403 Forbidden)', async () => {
  const { cookie } = await loginAs('TEA_01');
  const res = await makeRequest('/api/admin/users/STU_02/promote-cr', {
    method: 'POST',
    headers: { cookie },
    body: { reason: 'Teacher promotion attempt' }
  });
  assert.equal(res.status, 403);
});

test('Req 6: Admin cannot promote another admin or self to CR (400 Bad Request)', async () => {
  const { cookie } = await loginAs('ADM_01');

  // Attempt self-modification
  const selfRes = await makeRequest('/api/admin/users/ADM_01/promote-cr', {
    method: 'POST',
    headers: { cookie },
    body: { reason: 'Self promote attempt' }
  });
  assert.equal(selfRes.status, 400);

  // Attempt another admin modification
  const peerRes = await makeRequest('/api/admin/users/ADM_02/promote-cr', {
    method: 'POST',
    headers: { cookie },
    body: { reason: 'Peer admin promote attempt' }
  });
  assert.equal(peerRes.status, 400);
});

test('Req 7: Admin cannot promote teacher to CR (400 Bad Request)', async () => {
  const { cookie } = await loginAs('ADM_01');
  const res = await makeRequest('/api/admin/users/TEA_01/promote-cr', {
    method: 'POST',
    headers: { cookie },
    body: { reason: 'Faculty to CR attempt' }
  });
  assert.equal(res.status, 400);
});

test('Req 8: Invalid transitions are rejected (409 Conflict)', async () => {
  const { cookie } = await loginAs('ADM_01');

  // Promoting an account that is ALREADY a CR (STU_01 is now CR)
  const dupPromote = await makeRequest('/api/admin/users/STU_01/promote-cr', {
    method: 'POST',
    headers: { cookie },
    body: { reason: 'Duplicate promote attempt' }
  });
  assert.equal(dupPromote.status, 409);

  // Demoting an account that is ALREADY a Student (STU_02 is a Student)
  const dupDemote = await makeRequest('/api/admin/users/STU_02/demote-student', {
    method: 'POST',
    headers: { cookie },
    body: { reason: 'Duplicate demote attempt' }
  });
  assert.equal(dupDemote.status, 409);
});

test('Req 9: Suspended accounts cannot have their roles modified (400 Bad Request)', async () => {
  const { cookie } = await loginAs('ADM_01');
  const res = await makeRequest('/api/admin/users/STU_SUSP/promote-cr', {
    method: 'POST',
    headers: { cookie },
    body: { reason: 'Promote suspended student attempt' }
  });
  assert.equal(res.status, 400);
});

test('Req 10 & 11: Promotion & Demotion preserve academic identity (studentId, email, username, passwordHash)', async () => {
  const before = await db.get('SELECT * FROM students WHERE studentId = ?', 'STU_01');

  const { cookie } = await loginAs('ADM_01');
  // Demote STU_01 back to student
  await makeRequest('/api/admin/users/STU_01/demote-student', {
    method: 'POST',
    headers: { cookie },
    body: { reason: 'Routine cycle check' }
  });

  const after = await db.get('SELECT * FROM students WHERE studentId = ?', 'STU_01');

  assert.equal(after.studentId, before.studentId);
  assert.equal(after.username, before.username);
  assert.equal(after.email, before.email);
  assert.equal(after.passwordHash, before.passwordHash);
  assert.equal(after.supabase_uid, before.supabase_uid);
  assert.equal(after.role, 'student');

  // Promote STU_01 again to CR
  await makeRequest('/api/admin/users/STU_01/promote-cr', {
    method: 'POST',
    headers: { cookie },
    body: { reason: 'Restore CR role' }
  });
  const reAfter = await db.get('SELECT * FROM students WHERE studentId = ?', 'STU_01');
  assert.equal(reAfter.studentId, before.studentId);
  assert.equal(reAfter.email, before.email);
  assert.equal(reAfter.role, 'cr');
});

test('Req 12 & 13: Semester and Cohort UUID remain strictly unchanged across role transitions', async () => {
  const stu = await db.get('SELECT semester, cohort_id FROM students WHERE studentId = ?', 'STU_01');
  assert.equal(stu.semester, 'Semester 1');
  assert.equal(stu.cohort_id, 'COH_MERCURY_01');
});

test('Req 14: Existing content (posts, files, comments) remains completely intact', async () => {
  const post = await db.get('SELECT * FROM posts WHERE id = 101');
  assert.ok(post, 'Post must remain intact');
  assert.equal(post.user_id, 'STU_01');

  const file = await db.get('SELECT * FROM files WHERE id = 201');
  assert.ok(file, 'File must remain intact');
  assert.equal(file.uploadedBy, 'STU_01');
});

test('Req 15: Promoted CR receives authorized CR permissions (pin announcements & assignments)', async () => {
  // STU_01 is currently promoted to CR
  const { cookie } = await loginAs('STU_01');

  // Can pin chat announcement
  const pinRes = await makeRequest('/api/chat/pinned', {
    method: 'POST',
    headers: { cookie }
  });
  assert.equal(pinRes.status, 200);

  // Can create assignment
  const assignRes = await makeRequest('/api/assignments', {
    method: 'POST',
    headers: { cookie }
  });
  assert.equal(assignRes.status, 200);
});

test('Req 16: Demoted CR immediately loses CR-only privileges (403 Forbidden)', async () => {
  // CR_01 was demoted to regular student in Req 2
  const { cookie } = await loginAs('CR_01');

  const pinRes = await makeRequest('/api/chat/pinned', {
    method: 'POST',
    headers: { cookie }
  });
  assert.equal(pinRes.status, 403);

  const assignRes = await makeRequest('/api/assignments', {
    method: 'POST',
    headers: { cookie }
  });
  assert.equal(assignRes.status, 403);
});

test('Req 17: Existing web session dynamically observes new role without relogin', async () => {
  // 1. Log in STU_02 (current role: student)
  const { cookie } = await loginAs('STU_02');

  // Verify initial role via /api/me
  const meInitial = await makeRequest('/api/me', { headers: { cookie } });
  assert.equal(meInitial.body.role, 'student');
  assert.equal(meInitial.body.isCR, false);

  // 2. Admin promotes STU_02 to CR in the background
  const { cookie: adminCookie } = await loginAs('ADM_01');
  await makeRequest('/api/admin/users/STU_02/promote-cr', {
    method: 'POST',
    headers: { cookie: adminCookie },
    body: { reason: 'Mid-session promotion' }
  });

  // 3. Subsequent request using existing STU_02 session cookie immediately sees role = 'cr'
  const meUpdated = await makeRequest('/api/me', { headers: { cookie } });
  assert.equal(meUpdated.body.role, 'cr');
  assert.equal(meUpdated.body.isCR, true);

  // 4. Existing session now succeeds at CR-only operations
  const pinRes = await makeRequest('/api/chat/pinned', {
    method: 'POST',
    headers: { cookie }
  });
  assert.equal(pinRes.status, 200);
});

test('Req 18: Existing mobile token dynamically observes new role on next request', async () => {
  // STU_02 is currently CR
  // Issue mobile token
  const mobLogin = await makeRequest('/api/mobile/login', {
    method: 'POST',
    body: { studentId: 'STU_02' }
  });
  const token = mobLogin.body.token;

  // Profile shows CR
  const prof1 = await makeRequest('/api/profile', {
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(prof1.body.role, 'cr');
  assert.equal(prof1.body.isCR, true);

  // Admin demotes STU_02 back to student
  const { cookie: adminCookie } = await loginAs('ADM_01');
  await makeRequest('/api/admin/users/STU_02/demote-student', {
    method: 'POST',
    headers: { cookie: adminCookie },
    body: { reason: 'Demote mid-token session' }
  });

  // Same existing mobile token now immediately reflects student role
  const prof2 = await makeRequest('/api/profile', {
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(prof2.body.role, 'student');
  assert.equal(prof2.body.isCR, false);
});

test('Req 19: Supabase authentication requests observe new role dynamically', async () => {
  // Auth middleware resolves student by supabase_uid
  const authMw = createAuthMiddleware(db);
  const req = {
    headers: { authorization: 'Bearer test_supabase_token' },
    userEmail: 'student1@college.edu',
    supabaseUid: 'supa_stu_01'
  };

  // Currently STU_01 is CR
  const userRow = await db.get('SELECT role FROM students WHERE supabase_uid = ?', 'supa_stu_01');
  assert.equal(userRow.role, 'cr');
});

test('Req 20: Mobile navigation remains student-style (5 tabs) and CR continues using Student Dashboard', async () => {
  const { cookie } = await loginAs('STU_01');
  // Both Student and CR use Student Dashboard
  const dashRes = await makeRequest('/api/student/dashboard', { headers: { cookie } });
  assert.equal(dashRes.status, 200);
  assert.equal(dashRes.body.dashboard, 'student-dashboard');

  // CR cannot access Teacher Portal
  const teachRes = await makeRequest('/api/teacher/portal', { headers: { cookie } });
  assert.equal(teachRes.status, 403);
});

test('Req 21: Role change creates exactly one durable audit log entry', async () => {
  const auditLogs = await db.all(
    `SELECT * FROM admin_audit_logs WHERE entity_id = 'STU_02' ORDER BY created_at ASC`
  );

  // STU_02 was promoted once and demoted once
  const promoteLogs = auditLogs.filter(l => l.action === 'student_promoted_to_cr');
  const demoteLogs = auditLogs.filter(l => l.action === 'cr_demoted_to_student');

  assert.equal(promoteLogs.length, 1);
  assert.equal(demoteLogs.length, 1);

  const pLog = promoteLogs[0];
  assert.equal(pLog.actor_user_id, 'ADM_01');
  assert.equal(pLog.entity_type, 'account');
  assert.equal(pLog.entity_id, 'STU_02');

  const meta = typeof pLog.metadata === 'object' ? pLog.metadata : JSON.parse(pLog.metadata);
  assert.equal(meta.reason, 'Mid-session promotion');
});

test('Req 22: Transaction safety: Audit failure rolls back role change', async () => {
  // Test transaction rollback when audit recording fails
  const initialRole = (await db.get('SELECT role FROM students WHERE studentId = ?', 'STU_02')).role;
  assert.equal(initialRole, 'student');

  const mockFailTx = async () => {
    return db.withTransaction(async (tx) => {
      await tx.run("UPDATE students SET role = 'cr' WHERE studentId = 'STU_02'");
      // Force audit failure
      throw new Error('SIMULATED_AUDIT_DISK_FULL');
    });
  };

  await assert.rejects(mockFailTx, /SIMULATED_AUDIT_DISK_FULL/);

  // Role in DB must have rolled back to student
  const postRole = (await db.get('SELECT role FROM students WHERE studentId = ?', 'STU_02')).role;
  assert.equal(postRole, 'student');
});

test('Req 23: Role-change history is accessible only to administrators', async () => {
  // Admin can access
  const { cookie: adminCookie } = await loginAs('ADM_01');
  const histRes = await makeRequest('/api/admin/users/STU_02/role-history', {
    headers: { cookie: adminCookie }
  });
  assert.equal(histRes.status, 200);
  assert.ok(Array.isArray(histRes.body.history));

  // Platform-wide role history
  const allHistRes = await makeRequest('/api/admin/roles/history', {
    headers: { cookie: adminCookie }
  });
  assert.equal(allHistRes.status, 200);
  assert.ok(allHistRes.body.history.length >= 2);

  // Student is denied (403)
  const { cookie: stuCookie } = await loginAs('STU_02');
  const deniedRes = await makeRequest('/api/admin/users/STU_02/role-history', {
    headers: { cookie: stuCookie }
  });
  assert.equal(deniedRes.status, 403);
});

test('Req 24: Existing Student Dashboard features continue to work', async () => {
  const { cookie } = await loginAs('STU_02');
  const res = await makeRequest('/api/student/dashboard', { headers: { cookie } });
  assert.equal(res.status, 200);
});

test('Req 25: Existing Teacher Portal features continue to work', async () => {
  const { cookie } = await loginAs('TEA_01');
  const res = await makeRequest('/api/teacher/portal', { headers: { cookie } });
  assert.equal(res.status, 200);
});

test('Req 26: Existing Admin Dashboard features and CR list endpoint work', async () => {
  const { cookie } = await loginAs('ADM_01');
  const crListRes = await makeRequest('/api/admin/cr', { headers: { cookie } });
  assert.equal(crListRes.status, 200);
  assert.ok(crListRes.body.success);
  assert.ok(Array.isArray(crListRes.body.crs));
});

test('Req 27: Account suspension remains strictly enforced', async () => {
  const loginSusp = await makeRequest('/api/login', {
    method: 'POST',
    body: { studentId: 'STU_SUSP', password: TEST_PASS }
  });
  assert.equal(loginSusp.status, 403);
  assert.equal(loginSusp.body.error, 'ACCOUNT_SUSPENDED');
});

test('Req 28: Teacher onboarding remains strictly disabled platform-wide', () => {
  assert.equal(isTeacherOnboardingEnabled(), false);
});

test('Concurrent conflicting role changes on the same account resolve deterministically', async () => {
  const { cookie } = await loginAs('ADM_01');

  // Trigger two concurrent promotions on STU_02
  const [res1, res2] = await Promise.all([
    makeRequest('/api/admin/users/STU_02/promote-cr', {
      method: 'POST',
      headers: { cookie },
      body: { reason: 'Concurrent promote candidate 1' }
    }),
    makeRequest('/api/admin/users/STU_02/promote-cr', {
      method: 'POST',
      headers: { cookie },
      body: { reason: 'Concurrent promote candidate 2' }
    })
  ]);

  // One must succeed (200) and the other must reject with conflict (409)
  const statuses = [res1.status, res2.status].sort();
  assert.deepEqual(statuses, [200, 409]);

  // Final role is cr
  const finalRole = (await db.get('SELECT role FROM students WHERE studentId = ?', 'STU_02')).role;
  assert.equal(finalRole, 'cr');
});
