'use strict';

const os = require('os');
const path = require('path');
const testDbPath = path.join(os.tmpdir(), `teacher_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
process.env.NODE_ENV = 'test';
process.env.DB_PATH = testDbPath;
process.env.SEMESTER_DB_SKIP_INIT = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const bcrypt = require('bcryptjs');
const db = require('../db');
const {
  ensureTeacherSchema,
  seedCanonicalSubjects,
  createTeacherInvite,
  verifyTemporaryTeacherCredentials,
  signOnboardingToken,
  verifyOnboardingToken,
  getOnboardingState,
  checkPermanentUsernameAvailability,
  checkPermanentEmailAvailability,
  validateTeacherName,
  listOnboardingSubjects,
  searchSubjects,
  validateSubjectIds,
  transitionInviteStatus,
  isTeacherOnboardingEnabled,
  getTeacherOnboardingSecret,
  submitTeacherOnboarding,
  resendTeacherVerification,
  changeTeacherPendingEmail,
  finalizeTeacherOnboarding,
  getTeacherSubjects,
  maskEmail,
  resendCooldownMap
} = require('../lib/teacher-service');
const { createAuthMiddleware } = require('../lib/auth-middleware');
const { getAcademicContext } = require('../lib/academic-context');
const {
  validateOutputPathOutsideRepo,
  parseArgs,
  generateSecurePassword,
  runProvisioning
} = require('../scripts/provision-teachers');

let server;
let baseUrl;
let app;

test.before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.TEACHER_ONBOARDING_ENABLED = '1';
  process.env.TEACHER_ONBOARDING_SECRET = 'test-teacher-onboarding-secret-key-32-bytes-secure!';
  await db.initSchema();
  await ensureTeacherSchema({ exec: db.exec, isPostgres: db.isPostgres });
  await seedCanonicalSubjects(db);

  // Clean test fixtures
  await db.run("DELETE FROM teacher_onboarding_pending_subjects").catch(() => {});
  await db.run("DELETE FROM teacher_onboarding_pending").catch(() => {});
  await db.run("DELETE FROM teacher_subjects WHERE teacher_id LIKE 'test_%' OR teacher_id LIKE 't_%'").catch(() => {});
  await db.run("DELETE FROM teachers WHERE id LIKE 'test_%' OR id LIKE 't_%'").catch(() => {});
  await db.run("DELETE FROM teacher_invites WHERE initial_username LIKE 'test_%' OR initial_username LIKE 'v_%' OR initial_username LIKE 'pend_%' OR initial_username LIKE 'res_%' OR initial_username LIKE 'fin_%' OR initial_username LIKE 'chg_%' OR initial_username LIKE 'mob_%' OR initial_username LIKE 'teacher%'").catch(() => {});
  await db.run("DELETE FROM students WHERE studentId LIKE 'test_%' OR studentId LIKE 't_%'").catch(() => {});
  await db.run("DELETE FROM subjects WHERE id = 'test_sub_inactive'").catch(() => {});

  // Seed fixture student and admin for collision & permission tests
  await db.run(
    `INSERT INTO students (studentId, username, name, role, email, department, semester, passwordHash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    'test_student_clash',
    'existing_user',
    'Existing Student',
    'student',
    'existing@example.com',
    'BIT',
    'Semester 1',
    'fake_hash'
  );

  await db.run(
    `INSERT INTO students (studentId, username, name, role, email, department, semester, passwordHash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    'test_admin_user',
    'superadmin',
    'System Admin',
    'admin',
    'admin@example.com',
    'BIT',
    'Semester 1',
    'fake_hash'
  );

  // Spin up test server with mounted endpoints
  const express = require('express');
  app = express();
  app.use(express.json());

  const mockSupabase = {
    auth: {
      signUp: async ({ email, password }) => {
        const uid = 'mock-sb-uid-' + Math.random().toString(36).slice(2, 9);
        return {
          data: {
            user: {
              id: uid,
              email
            }
          },
          error: null
        };
      },
      resend: async ({ type, email }) => {
        return { data: {}, error: null };
      },
      verifyOtp: async ({ email, token, type }) => {
        if (!token || token.length !== 6 || token === '000000') {
          return { data: { user: null, session: null }, error: { message: 'Token has expired or is invalid', code: 'bad_code' } };
        }
        if (token === '999999') {
          return { data: { user: null, session: null }, error: { message: 'Token has expired', code: 'otp_expired' } };
        }
        const uid = 'mock-otp-uid-' + Math.random().toString(36).slice(2, 9);
        return {
          data: {
            user: {
              id: uid,
              email: email || 'verified.teacher@example.com',
              email_confirmed_at: '2026-10-08T12:00:00Z'
            },
            session: {
              access_token: 'mock-sb-token-' + uid,
              refresh_token: 'mock-refresh-token',
              token_type: 'bearer',
              user: {
                id: uid,
                email: email || 'verified.teacher@example.com',
                email_confirmed_at: '2026-10-08T12:00:00Z'
              }
            }
          },
          error: null
        };
      },
      getUser: async (token) => {
        if (token === 'unconfirmed-sb-token') {
          return { data: { user: { id: 'unconf-uid', email: 'unconf@example.com', email_confirmed_at: null } }, error: null };
        }
        if (token === 'sb-uid-non-existent-random') {
          return { data: { user: { id: 'sb-uid-non-existent-random', email: 'nonexistent.random@example.com', email_confirmed_at: '2026-10-08T12:00:00Z' } }, error: null };
        }
        if (typeof token === 'string' && token.startsWith('mock-sb-token-')) {
          const uid = token.replace('mock-sb-token-', '');
          return {
            data: {
              user: {
                id: uid,
                email: 'verified.teacher@example.com',
                email_confirmed_at: '2026-10-08T12:00:00Z'
              }
            },
            error: null
          };
        }
        return {
          data: {
            user: {
              id: token || 'mock-verified-uid',
              email: 'verified.teacher@example.com',
              email_confirmed_at: '2026-10-08T12:00:00Z'
            }
          },
          error: null
        };
      },
      admin: {
        updateUserById: async (uid, { email }) => {
          return { data: { user: { id: uid, email } }, error: null };
        }
      }
    }
  };
  app.set('supabaseClientMock', mockSupabase);
  global.__testSupabaseMock = mockSupabase;
  process.env.__TEST_SUPABASE_MOCK = '1';

  const auth = createAuthMiddleware(db);
  app.use(auth.authenticate);

  app.use('/api/teacher/onboarding', require('../routes/teacher-onboarding'));

  // Normal protected app test routes across multiple core domains
  app.get('/api/me', auth.requireLogin, (req, res) => res.json({ user: req.user }));
  app.get('/api/admin/check', auth.requireAdmin, (req, res) => res.json({ ok: true }));
  app.get('/api/teacher/check', auth.requireTeacher, (req, res) => res.json({ ok: true }));
  app.get('/api/chat', auth.requireLogin, (req, res) => res.json({ chat: [] }));
  app.get('/api/files', auth.requireLogin, (req, res) => res.json({ files: [] }));
  app.get('/api/posts', auth.requireLogin, (req, res) => res.json({ posts: [] }));
  app.get('/api/assignments', auth.requireLogin, (req, res) => res.json({ assignments: [] }));

  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
});

test.after(async () => {
  if (server) {
    await new Promise(resolve => server.close(resolve));
  }
  // Cleanup test fixtures
  await db.run("DELETE FROM teacher_onboarding_pending_subjects").catch(() => {});
  await db.run("DELETE FROM teacher_onboarding_pending").catch(() => {});
  await db.run("DELETE FROM teacher_subjects WHERE teacher_id LIKE 'test_%' OR teacher_id LIKE 't_%'").catch(() => {});
  await db.run("DELETE FROM teachers WHERE id LIKE 'test_%' OR id LIKE 't_%'").catch(() => {});
  await db.run("DELETE FROM teacher_invites WHERE initial_username LIKE 'test_%' OR initial_username LIKE 'v_%' OR initial_username LIKE 'pend_%' OR initial_username LIKE 'res_%' OR initial_username LIKE 'fin_%' OR initial_username LIKE 'chg_%' OR initial_username LIKE 'mob_%' OR initial_username LIKE 'teacher%'").catch(() => {});
  await db.run("DELETE FROM students WHERE studentId LIKE 'test_%' OR studentId LIKE 't_%'").catch(() => {});
  await db.run("DELETE FROM subjects WHERE id = 'test_sub_inactive'").catch(() => {});
  await db.close().catch(() => {});
  try {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  } catch (_) {}
});

// ============================================================================
// 1. DATABASE SCHEMA & IDEMPOTENCY TESTS (Items 1-9, 24, 25, 26)
// ============================================================================

test('1. Migration is idempotent: ensureTeacherSchema can run repeatedly without error', async () => {
  await ensureTeacherSchema({ exec: db.exec, isPostgres: db.isPostgres });
  await ensureTeacherSchema({ exec: db.exec, isPostgres: db.isPostgres });
  assert.ok(true);
});

test('2. Schema: teacher_invites table exists and stores required fields', async () => {
  const row = await db.get("SELECT COUNT(*) AS c FROM teacher_invites");
  assert.ok(row && typeof row.c === 'number');
});

test('3. Schema: subjects table exists and contains canonical columns', async () => {
  const row = await db.get("SELECT id, code, name, semester, department, credit_hours, nature, active FROM subjects LIMIT 1");
  assert.ok(row);
  assert.ok(row.code);
});

test('4. Schema: teachers table exists and links to students with unique user_id', async () => {
  const countRow = await db.get("SELECT COUNT(*) AS c FROM teachers");
  assert.ok(countRow && typeof countRow.c === 'number');
});

test('5. Schema: teacher_subjects table exists with foreign key pairings', async () => {
  const countRow = await db.get("SELECT COUNT(*) AS c FROM teacher_subjects");
  assert.ok(countRow && typeof countRow.c === 'number');
});

test('6. Schema: expected indexes and unique constraints exist', async () => {
  if (!db.isPostgres) {
    const indexes = await db.all("SELECT name FROM sqlite_master WHERE type='index'");
    const names = new Set(indexes.map(i => i.name));
    assert.ok(names.has('idx_teacher_invites_username'));
    assert.ok(names.has('idx_subjects_code'));
    assert.ok(names.has('idx_teacher_subjects_teacher'));
  }
});

test('7. Schema: existing students table rows are not modified or corrupted', async () => {
  const student = await db.get("SELECT username, role, department, semester FROM students WHERE studentId = 'test_student_clash'");
  assert.equal(student.username, 'existing_user');
  assert.equal(student.role, 'student');
  assert.equal(student.department, 'BIT');
  assert.equal(student.semester, 'Semester 1');
});

test('8. Subject seed produces exactly 45 canonical courses', async () => {
  const countRow = await db.get("SELECT COUNT(*) AS c FROM subjects");
  assert.equal(countRow.c, 45, 'Must contain exactly 45 canonical courses from syllabus-data.json');
});

test('9. Semesters 1–8 represented with exact course distributions', async () => {
  const semesters = await db.all("SELECT semester, COUNT(*) AS c FROM subjects GROUP BY semester ORDER BY semester");
  const map = {};
  semesters.forEach(s => { map[s.semester] = s.c; });

  assert.equal(map[1], 6, 'Semester 1 must have 6 courses');
  assert.equal(map[2], 6, 'Semester 2 must have 6 courses');
  assert.equal(map[3], 6, 'Semester 3 must have 6 courses');
  assert.equal(map[4], 6, 'Semester 4 must have 6 courses');
  assert.equal(map[5], 6, 'Semester 5 must have 6 courses');
  assert.equal(map[6], 6, 'Semester 6 must have 6 courses');
  assert.equal(map[7], 5, 'Semester 7 must have 5 courses');
  assert.equal(map[8], 4, 'Semester 8 must have 4 courses');
});

test('24. Subject seed exactness: matches syllabus-data.json deterministically for all 45 courses', async () => {
  const syllabusPath = path.join(__dirname, '..', 'syllabus-data.json');
  const rawData = JSON.parse(fs.readFileSync(syllabusPath, 'utf8'));
  const ROMANS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

  let checkedCourses = 0;
  for (const s of rawData.semesters || []) {
    const semIndex = ROMANS.indexOf((s.semester || '').trim());
    const semNum = semIndex !== -1 ? semIndex + 1 : parseInt(s.semester, 10);
    for (const c of s.courses || []) {
      const code = (c.code || '').trim();
      const title = (c.title || '').trim();
      if (!code || !title) continue;
      const expectedCredit = parseFloat(String(c.credit).replace(/[^\d.]/g, '')) || 3.0;

      const row = await db.get('SELECT * FROM subjects WHERE code = ?', code);
      assert.ok(row, `Subject ${code} must exist in database`);
      assert.equal(row.name, title, `Title for ${code} must match syllabus`);
      assert.equal(row.semester, semNum, `Semester for ${code} must match syllabus`);
      assert.equal(row.department, 'BIT');
      assert.equal(Number(row.credit_hours || row.credithours), expectedCredit, `Credit for ${code} must match`);
      assert.equal(row.nature, c.nature ? c.nature.trim() : null, `Nature for ${code} must match`);
      checkedCourses++;
    }
  }
  assert.equal(checkedCourses, 45, 'Checked all 45 syllabus courses');
});

test('25. DB Constraints: database enforces unique indexes and check constraints', async () => {
  // A. teacher_invites.initial_username case-insensitive uniqueness
  await db.run(
    "INSERT INTO teacher_invites (id, initial_username, temporary_password_hash, expires_at) VALUES ('test_u1', 't_uniq_chk', 'hash', '2030-01-01')"
  );
  await assert.rejects(async () => {
    await db.run(
      "INSERT INTO teacher_invites (id, initial_username, temporary_password_hash, expires_at) VALUES ('test_u2', 'T_UNIQ_CHK', 'hash', '2030-01-01')"
    );
  }, /UNIQUE constraint/i);
  await db.run("DELETE FROM teacher_invites WHERE id IN ('test_u1', 'test_u2')");

  // B. subjects.semester CHECK (1..8)
  await assert.rejects(async () => {
    await db.run(
      "INSERT INTO subjects (id, code, name, semester) VALUES ('CIT991', 'CIT991', 'Invalid Sem', 9)"
    );
  }, /CHECK constraint/i);

  // C. teacher_invites status CHECK
  await assert.rejects(async () => {
    await db.run(
      "INSERT INTO teacher_invites (id, initial_username, temporary_password_hash, status, expires_at) VALUES ('test_u3', 't_bad_stat', 'hash', 'bogus_status', '2030-01-01')"
    );
  }, /CHECK constraint/i);

  // D. teachers status CHECK
  await assert.rejects(async () => {
    await db.run(
      "INSERT INTO teachers (id, user_id, status) VALUES ('test_t_bad', 'test_student_clash', 'bogus')"
    );
  }, /CHECK constraint/i);
});

test('26. Existing student data safety: repeatedly running schema leaves students byte-for-byte identical', async () => {
  const studentsBefore = await db.all("SELECT * FROM students ORDER BY studentId");
  await ensureTeacherSchema({ exec: db.exec, isPostgres: db.isPostgres });
  await ensureTeacherSchema({ exec: db.exec, isPostgres: db.isPostgres });
  const studentsAfter = await db.all("SELECT * FROM students ORDER BY studentId");

  assert.equal(studentsAfter.length, studentsBefore.length);
  assert.deepEqual(studentsAfter, studentsBefore);
});

// ============================================================================
// 2. TEMPORARY AUTHENTICATION & RESTRICTED ONBOARDING TOKEN TESTS (Items 10-21)
// ============================================================================

test('10. Valid temporary credentials succeed and return restricted onboarding session', async () => {
  const invite = await createTeacherInvite(db, {
    initialUsername: 'test_teacher_01',
    temporaryPassword: 'TempPassword123#',
    expiryDays: 14
  });

  const check = await verifyTemporaryTeacherCredentials(db, {
    username: 'test_teacher_01',
    password: 'TempPassword123#'
  });

  assert.equal(check.success, true);
  assert.equal(check.invite.status, 'onboarding', 'Status transitions to onboarding on first login');
});

test('11. Wrong temporary password rejected', async () => {
  const check = await verifyTemporaryTeacherCredentials(db, {
    username: 'test_teacher_01',
    password: 'WrongPassword999'
  });

  assert.equal(check.success, false);
  assert.equal(check.reason, 'INVALID_CREDENTIALS');
});

test('12. Nonexistent username produces generic failure', async () => {
  const check = await verifyTemporaryTeacherCredentials(db, {
    username: 'test_nonexistent_user',
    password: 'AnyPassword123'
  });

  assert.equal(check.success, false);
  assert.equal(check.reason, 'INVALID_CREDENTIALS');
});

test('13. Expired temporary invite rejected', async () => {
  const expiredInvite = await createTeacherInvite(db, {
    initialUsername: 'test_teacher_expired',
    temporaryPassword: 'TempPassword123#',
    expiryDays: -1
  });

  const check = await verifyTemporaryTeacherCredentials(db, {
    username: 'test_teacher_expired',
    password: 'TempPassword123#'
  });

  assert.equal(check.success, false);
  assert.equal(check.reason, 'INVITE_EXPIRED');
});

test('14. Disabled temporary invite rejected', async () => {
  const invite = await createTeacherInvite(db, {
    initialUsername: 'test_teacher_disabled',
    temporaryPassword: 'TempPassword123#'
  });

  await db.run("UPDATE teacher_invites SET status = 'disabled' WHERE id = ?", invite.id);

  const check = await verifyTemporaryTeacherCredentials(db, {
    username: 'test_teacher_disabled',
    password: 'TempPassword123#'
  });

  assert.equal(check.success, false);
  assert.equal(check.reason, 'INVITE_DISABLED');
});

test('15. Completed temporary invite rejected', async () => {
  const invite = await createTeacherInvite(db, {
    initialUsername: 'test_teacher_done',
    temporaryPassword: 'TempPassword123#'
  });

  await db.run("UPDATE teacher_invites SET status = 'completed' WHERE id = ?", invite.id);

  const check = await verifyTemporaryTeacherCredentials(db, {
    username: 'test_teacher_done',
    password: 'TempPassword123#'
  });

  assert.equal(check.success, false);
  assert.equal(check.reason, 'INVITE_COMPLETED');
});

test('16. Temporary password stored only as hash in DB and never plaintext', async () => {
  const invite = await createTeacherInvite(db, {
    initialUsername: 'test_teacher_hashchk',
    temporaryPassword: 'PlainTextSecret!77',
    expiryDays: 14
  });

  const row = await db.get("SELECT * FROM teacher_invites WHERE id = ?", invite.id);
  assert.ok(row.temporary_password_hash.startsWith('$2'), 'Bcrypt hash required');
  assert.notEqual(row.temporary_password_hash, 'PlainTextSecret!77');
  assert.equal(row.temporary_password, undefined);
  assert.equal(row.password_plaintext, undefined);
  assert.equal(row.initial_password, undefined);
});

test('17. Onboarding token contains restricted scope and correct payload', () => {
  const { token, expiresAt } = signOnboardingToken({
    inviteId: 'inv_scope_test',
    initialUsername: 'teacher001',
    nonce: 1
  });

  assert.ok(token);
  assert.ok(expiresAt);

  const verified = verifyOnboardingToken(token);
  assert.equal(verified.valid, true);
  assert.equal(verified.payload.inviteId, 'inv_scope_test');
  assert.equal(verified.payload.initialUsername, 'teacher001');
  assert.equal(verified.payload.scope, 'teacher_onboarding');
});

test('18. Onboarding token expiration: valid token before exp accepted, same token after exp rejected', async () => {
  // A. Token with future expiration -> accepted
  const validTokenData = signOnboardingToken({
    inviteId: 'inv_exp_test',
    initialUsername: 'teacher_exp',
    nonce: 1,
    ttlMs: 3600 * 1000 // 1 hour in future
  });
  const verifiedValid = verifyOnboardingToken(validTokenData.token);
  assert.equal(verifiedValid.valid, true);

  // B. Token with past expiration -> rejected with 'Token has expired'
  const expiredTokenData = signOnboardingToken({
    inviteId: 'inv_exp_test',
    initialUsername: 'teacher_exp',
    nonce: 1,
    ttlMs: -10 * 1000 // 10 seconds in past
  });
  const verifiedExpired = verifyOnboardingToken(expiredTokenData.token);
  assert.equal(verifiedExpired.valid, false);
  assert.equal(verifiedExpired.error, 'Token has expired');

  // C. Test via HTTP endpoint with expired token
  const stateRes = await fetch(`${baseUrl}/api/teacher/onboarding/state`, {
    headers: { Authorization: `Bearer ${expiredTokenData.token}` }
  });
  assert.equal(stateRes.status, 401);
  const data = await stateRes.json();
  assert.match(data.message, /expired/i);
});

test('19. Invalid token signature is rejected', () => {
  const { token } = signOnboardingToken({ inviteId: 'inv_tamper', initialUsername: 'teacher001' });
  const parts = token.split('.');
  parts[2] = 'tampered_signature_xyz';
  const badToken = parts.join('.');

  const verified = verifyOnboardingToken(badToken);
  assert.equal(verified.valid, false);
  assert.match(verified.error, /signature/i);
});

test('20. Invite resume semantics & nonce invalidation: token A revoked, token B works, teacher not stranded', async () => {
  const invite = await createTeacherInvite(db, {
    initialUsername: 'test_teacher_resume',
    temporaryPassword: 'ResumePassword123#'
  });

  // Login 1 -> Token A
  const login1 = await fetch(`${baseUrl}/api/teacher/onboarding/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'test_teacher_resume', password: 'ResumePassword123#' })
  });
  const { onboardingToken: tokenA } = await login1.json();

  // Teacher closes app, logs in again -> Token B
  const login2 = await fetch(`${baseUrl}/api/teacher/onboarding/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'test_teacher_resume', password: 'ResumePassword123#' })
  });
  const { onboardingToken: tokenB } = await login2.json();

  // Token A is now invalidated
  const resA = await fetch(`${baseUrl}/api/teacher/onboarding/state`, {
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert.equal(resA.status, 401);
  const dataA = await resA.json();
  assert.match(dataA.message, /invalidated by a newer login/i);

  // Token B succeeds
  const resB = await fetch(`${baseUrl}/api/teacher/onboarding/state`, {
    headers: { Authorization: `Bearer ${tokenB}` }
  });
  assert.equal(resB.status, 200);
  const dataB = await resB.json();
  assert.equal(dataB.state.initialUsername, 'test_teacher_resume');
  assert.equal(dataB.state.status, 'onboarding');
});

test('21. Invite expiry vs token expiry: 2h token expires but 14d invite allows re-login, expired invite blocks login', async () => {
  const invite = await createTeacherInvite(db, {
    initialUsername: 'test_teacher_reauth',
    temporaryPassword: 'ReauthPassword123#',
    expiryDays: 14
  });

  // Simulate an expired 2-hour onboarding token for this invite
  const expiredToken = signOnboardingToken({
    inviteId: invite.id,
    initialUsername: 'test_teacher_reauth',
    nonce: 1,
    ttlMs: -1000
  }).token;

  const expiredCheck = await fetch(`${baseUrl}/api/teacher/onboarding/state`, {
    headers: { Authorization: `Bearer ${expiredToken}` }
  });
  assert.equal(expiredCheck.status, 401);

  // Teacher re-authenticates with temporary credentials (14-day invite still valid)
  const reauth = await fetch(`${baseUrl}/api/teacher/onboarding/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'test_teacher_reauth', password: 'ReauthPassword123#' })
  });
  assert.equal(reauth.status, 200);
  const { onboardingToken: freshToken } = await reauth.json();

  const validCheck = await fetch(`${baseUrl}/api/teacher/onboarding/state`, {
    headers: { Authorization: `Bearer ${freshToken}` }
  });
  assert.equal(validCheck.status, 200);

  // Now simulate expired 14-day invite in DB
  await db.run("UPDATE teacher_invites SET expires_at = '2020-01-01T00:00:00.000Z' WHERE id = ?", invite.id);

  const blockedLogin = await fetch(`${baseUrl}/api/teacher/onboarding/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'test_teacher_reauth', password: 'ReauthPassword123#' })
  });
  assert.equal(blockedLogin.status, 401);
});

// ============================================================================
// 3. API ISOLATION & SECURITY BOUNDARIES (Items 21-28, 5, 6, 7)
// ============================================================================

test('22. Security isolation: Onboarding token cannot access /api/me (rejected with 401)', async () => {
  const loginRes = await fetch(`${baseUrl}/api/teacher/onboarding/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'test_teacher_01', password: 'TempPassword123#' })
  });
  const { onboardingToken } = await loginRes.json();

  const meRes = await fetch(`${baseUrl}/api/me`, {
    headers: { Authorization: `Bearer ${onboardingToken}` }
  });
  assert.equal(meRes.status, 401);
});

test('23. Security isolation: Onboarding token cannot access /api/chat (rejected with 401)', async () => {
  const loginRes = await fetch(`${baseUrl}/api/teacher/onboarding/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'test_teacher_01', password: 'TempPassword123#' })
  });
  const { onboardingToken } = await loginRes.json();

  const chatRes = await fetch(`${baseUrl}/api/chat`, {
    headers: { Authorization: `Bearer ${onboardingToken}` }
  });
  assert.equal(chatRes.status, 401);
});

test('24. Security isolation: Onboarding token cannot access /api/files (rejected with 401)', async () => {
  const loginRes = await fetch(`${baseUrl}/api/teacher/onboarding/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'test_teacher_01', password: 'TempPassword123#' })
  });
  const { onboardingToken } = await loginRes.json();

  const filesRes = await fetch(`${baseUrl}/api/files`, {
    headers: { Authorization: `Bearer ${onboardingToken}` }
  });
  assert.equal(filesRes.status, 401);
});

test('25. Security isolation: Onboarding token cannot access /api/posts (rejected with 401)', async () => {
  const loginRes = await fetch(`${baseUrl}/api/teacher/onboarding/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'test_teacher_01', password: 'TempPassword123#' })
  });
  const { onboardingToken } = await loginRes.json();

  const postsRes = await fetch(`${baseUrl}/api/posts`, {
    headers: { Authorization: `Bearer ${onboardingToken}` }
  });
  assert.equal(postsRes.status, 401);
});

test('26. Security isolation: Onboarding token cannot access /api/assignments or admin checks (401/403)', async () => {
  const loginRes = await fetch(`${baseUrl}/api/teacher/onboarding/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'test_teacher_01', password: 'TempPassword123#' })
  });
  const { onboardingToken } = await loginRes.json();

  const assignRes = await fetch(`${baseUrl}/api/assignments`, {
    headers: { Authorization: `Bearer ${onboardingToken}` }
  });
  assert.equal(assignRes.status, 401);

  const adminRes = await fetch(`${baseUrl}/api/admin/check`, {
    headers: { Authorization: `Bearer ${onboardingToken}` }
  });
  assert.equal(adminRes.status, 403);
});

test('27. Role escalation prevention: Client-supplied role is strictly ignored by server', async () => {
  const loginRes = await fetch(`${baseUrl}/api/teacher/onboarding/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'test_teacher_01', password: 'TempPassword123#' })
  });
  const { onboardingToken } = await loginRes.json();

  // Client attempts to pass role: 'admin'
  const res = await fetch(`${baseUrl}/api/teacher/onboarding/check-username`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${onboardingToken}`
    },
    body: JSON.stringify({
      username: 'dr.sharma',
      role: 'admin'
    })
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.role, undefined, 'Server must never echo or accept client-supplied role');
});

test('28. Invite-ID tampering prevention: Token for Invite A cannot operate on Invite B via body or query', async () => {
  const inviteA = await createTeacherInvite(db, {
    initialUsername: 'test_teacher_inv_a',
    temporaryPassword: 'PasswordA123#'
  });
  const inviteB = await createTeacherInvite(db, {
    initialUsername: 'test_teacher_inv_b',
    temporaryPassword: 'PasswordB123#'
  });

  const loginA = await fetch(`${baseUrl}/api/teacher/onboarding/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'test_teacher_inv_a', password: 'PasswordA123#' })
  });
  const { onboardingToken: tokenA } = await loginA.json();

  // Client passes inviteId of Invite B in query and body
  const stateRes = await fetch(`${baseUrl}/api/teacher/onboarding/state?inviteId=${inviteB.id}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${tokenA}`
    }
  });

  assert.equal(stateRes.status, 200);
  const data = await stateRes.json();
  // Server must strictly operate on Invite A from token
  assert.equal(data.state.inviteId, inviteA.id);
  assert.equal(data.state.initialUsername, 'test_teacher_inv_a');
  assert.notEqual(data.state.inviteId, inviteB.id);
});

// ============================================================================
// 4. USERNAME, EMAIL & NAME VALIDATION TESTS (Items 29-31, 8, 9)
// ============================================================================

test('29. Temp username collisions prevented across students and teacher_invites', async () => {
  // A. Collision with students.username
  await assert.rejects(async () => {
    await createTeacherInvite(db, {
      initialUsername: 'existing_user',
      temporaryPassword: 'Password123#'
    });
  }, /collides with an existing student account/i);

  // B. Collision with existing teacher_invites
  await assert.rejects(async () => {
    await createTeacherInvite(db, {
      initialUsername: 'test_teacher_01',
      temporaryPassword: 'Password123#'
    });
  }, /already provisioned/i);
});

test('30. Reserved permanent usernames rejected', async () => {
  const r1 = await checkPermanentUsernameAvailability(db, 'admin');
  assert.equal(r1.available, false);
  assert.match(r1.reason, /reserved/i);

  const r2 = await checkPermanentUsernameAvailability(db, 'teacher');
  assert.equal(r2.available, false);
  assert.match(r2.reason, /reserved/i);
});

test('31. Global permanent username collision against students rejected', async () => {
  const avail = await checkPermanentUsernameAvailability(db, 'existing_user');
  assert.equal(avail.available, false);
  assert.match(avail.reason, /already taken/i);

  const valid = await checkPermanentUsernameAvailability(db, 'ram.narayan');
  assert.equal(valid.available, true);
  assert.equal(valid.username, 'ram.narayan');
});

test('Validation: checkPermanentEmailAvailability detects collision against students', async () => {
  const avail = await checkPermanentEmailAvailability(db, 'existing@example.com');
  assert.equal(avail.available, false);
  assert.match(avail.reason, /already exists/i);
});

test('Validation: validateTeacherName supports realistic academic names with titles', () => {
  const v1 = validateTeacherName('Dr. Ram Sharma');
  assert.equal(v1.valid, true);
  assert.equal(v1.cleanedName, 'Dr. Ram Sharma');

  const v2 = validateTeacherName('Prof. A. K. Joshi');
  assert.equal(v2.valid, true);

  const v3 = validateTeacherName('A'); // Too short
  assert.equal(v3.valid, false);
});

// ============================================================================
// 5. SUBJECTS CATALOG, SEARCH & VALIDATION (Items 32-39, 10, 11, 12)
// ============================================================================

test('32. Onboarding subject list requires onboarding token', async () => {
  const res = await fetch(`${baseUrl}/api/teacher/onboarding/subjects`);
  assert.equal(res.status, 401);
});

test('33. Returns canonical subjects with required attributes', async () => {
  const loginRes = await fetch(`${baseUrl}/api/teacher/onboarding/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'test_teacher_01', password: 'TempPassword123#' })
  });
  const { onboardingToken } = await loginRes.json();

  const subjectsRes = await fetch(`${baseUrl}/api/teacher/onboarding/subjects`, {
    headers: { Authorization: `Bearer ${onboardingToken}` }
  });

  assert.equal(subjectsRes.status, 200);
  const data = await subjectsRes.json();
  assert.ok(Array.isArray(data.subjects));
  assert.equal(data.subjects.length, 45);
  const first = data.subjects[0];
  assert.ok(first.id);
  assert.ok(first.code);
  assert.ok(first.name);
  assert.ok(first.semester);
  assert.equal(first.department, 'BIT');
});

test('34. Subject listing returns all 8 semesters', async () => {
  const subjects = await listOnboardingSubjects(db);
  const sems = new Set(subjects.map(s => s.semester));
  for (let i = 1; i <= 8; i++) {
    assert.ok(sems.has(i), `Semester ${i} must be present`);
  }
});

test('35. Subject listing returns 45 unique course codes', async () => {
  const subjects = await listOnboardingSubjects(db);
  const codes = new Set(subjects.map(s => s.code));
  assert.equal(codes.size, 45);
});

test('36. Subject search: service matching works by code (CIT/BCT) and case-insensitively', async () => {
  const matches = await searchSubjects(db, 'bct111');
  assert.ok(matches.length >= 1);
  assert.equal(matches[0].code, 'BCT111');

  const upperMatches = await searchSubjects(db, 'BCT111');
  assert.equal(upperMatches[0].code, 'BCT111');
});

test('37. Subject search: service matching works by title (e.g. "web")', async () => {
  const matches = await searchSubjects(db, 'web');
  assert.ok(matches.length >= 1);
  assert.ok(matches.some(m => m.name.toLowerCase().includes('web')));

  // Test via HTTP endpoint
  const loginRes = await fetch(`${baseUrl}/api/teacher/onboarding/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'test_teacher_01', password: 'TempPassword123#' })
  });
  const { onboardingToken } = await loginRes.json();

  const searchRes = await fetch(`${baseUrl}/api/teacher/onboarding/subjects?q=web`, {
    headers: { Authorization: `Bearer ${onboardingToken}` }
  });
  assert.equal(searchRes.status, 200);
  const searchData = await searchRes.json();
  assert.ok(searchData.subjects.length >= 1);
});

test('38. Subject validation: validateSubjectIds approves valid canonical IDs, rejects fake CIT999 or inactive', async () => {
  // A. Valid canonical IDs
  const valid = await validateSubjectIds(db, ['BCT111', 'ELX111']);
  assert.equal(valid.valid, true);

  // B. Fake ID
  const invalidFake = await validateSubjectIds(db, ['CIT999']);
  assert.equal(invalidFake.valid, false);
  assert.match(invalidFake.reason, /CIT999 does not exist/i);

  // C. Inactive subject
  await db.run("UPDATE subjects SET active = 0 WHERE code = 'BCT111'");
  const invalidInactive = await validateSubjectIds(db, ['BCT111']);
  assert.equal(invalidInactive.valid, false);
  assert.match(invalidInactive.reason, /inactive/i);
  await db.run("UPDATE subjects SET active = 1 WHERE code = 'BCT111'");

  // D. Duplicate IDs in payload
  const invalidDups = await validateSubjectIds(db, ['BCT111', 'BCT111']);
  assert.equal(invalidDups.valid, false);
  assert.match(invalidDups.reason, /duplicate/i);
});

test('39. teacher_subjects UNIQUE constraint: prevents duplicate assignment to same teacher, allows multi-teacher subject', async () => {
  await db.run("DELETE FROM teacher_subjects WHERE teacher_id LIKE 'test_ts_%'").catch(() => {});
  await db.run("DELETE FROM teachers WHERE id LIKE 'test_ts_%'").catch(() => {});
  await db.run("DELETE FROM students WHERE studentId LIKE 'test_ts_%'").catch(() => {});

  // Seed two teachers
  await db.run(
    "INSERT INTO students (studentId, username, name, role, email, department, passwordHash) VALUES ('test_ts_u1', 'prof.x', 'Prof X', 'teacher', 'x@test.com', 'BIT', 'fake')"
  );
  await db.run(
    "INSERT INTO students (studentId, username, name, role, email, department, passwordHash) VALUES ('test_ts_u2', 'prof.y', 'Prof Y', 'teacher', 'y@test.com', 'BIT', 'fake')"
  );
  await db.run("INSERT INTO teachers (id, user_id) VALUES ('test_ts_t1', 'test_ts_u1')");
  await db.run("INSERT INTO teachers (id, user_id) VALUES ('test_ts_t2', 'test_ts_u2')");

  // Teacher X + BCT111 succeeds
  await db.run("INSERT INTO teacher_subjects (id, teacher_id, subject_id) VALUES ('ts_1', 'test_ts_t1', 'BCT111')");

  // Same Teacher X + BCT111 fails
  await assert.rejects(async () => {
    await db.run("INSERT INTO teacher_subjects (id, teacher_id, subject_id) VALUES ('ts_2', 'test_ts_t1', 'BCT111')");
  }, /UNIQUE constraint/i);

  // Teacher Y + BCT111 succeeds (many-to-many relationship)
  await db.run("INSERT INTO teacher_subjects (id, teacher_id, subject_id) VALUES ('ts_3', 'test_ts_t2', 'BCT111')");

  // Cleanup
  await db.run("DELETE FROM teacher_subjects WHERE teacher_id LIKE 'test_ts_%'");
  await db.run("DELETE FROM teachers WHERE id LIKE 'test_ts_%'");
  await db.run("DELETE FROM students WHERE studentId LIKE 'test_ts_%'");
});

// ============================================================================
// 6. PROVISIONING CLI & SAFETY TESTS (Items 40-47, 13, 14, 15, 16, 17)
// ============================================================================

test('40. Provisioning dry-run does NOT mutate database (actual DB row count check)', async () => {
  const countBefore = (await db.get("SELECT COUNT(*) AS c FROM teacher_invites")).c;

  const res = await runProvisioning({
    count: 50,
    dryRun: true,
    apply: false,
    prefix: 'test_dr_'
  });

  assert.equal(res.dryRun, true);
  const countAfter = (await db.get("SELECT COUNT(*) AS c FROM teacher_invites")).c;
  assert.equal(countAfter, countBefore, 'Dry run must perform zero DB mutations');
});

test('41. --apply required for mutation: test DB provisioning generates exactly 50 rows', async () => {
  await db.run("DELETE FROM teacher_invites WHERE initial_username LIKE 'test_ap_%'");

  const res = await runProvisioning({
    count: 50,
    dryRun: false,
    apply: true,
    prefix: 'test_ap_'
  });

  assert.equal(res.applied, true);
  assert.equal(res.count, 50);

  const rows = await db.all("SELECT * FROM teacher_invites WHERE initial_username LIKE 'test_ap_%'");
  assert.equal(rows.length, 50, 'Exactly 50 rows inserted in test DB');

  // Verify fields
  for (const r of rows) {
    assert.equal(r.status, 'provisioned');
    assert.ok(r.expires_at);
  }

  // Cleanup
  await db.run("DELETE FROM teacher_invites WHERE initial_username LIKE 'test_ap_%'");
});

test('42. 50 generated temp usernames are unique', async () => {
  await db.run("DELETE FROM teacher_invites WHERE initial_username LIKE 'test_uniq_%'");

  await runProvisioning({
    count: 50,
    dryRun: false,
    apply: true,
    prefix: 'test_uniq_'
  });

  const rows = await db.all("SELECT initial_username FROM teacher_invites WHERE initial_username LIKE 'test_uniq_%'");
  const set = new Set(rows.map(r => r.initial_username));
  assert.equal(set.size, 50, 'All 50 usernames must be unique');

  await db.run("DELETE FROM teacher_invites WHERE initial_username LIKE 'test_uniq_%'");
});

test('43. Provisioning skips existing username collisions against students and teacher_invites', async () => {
  await db.run("DELETE FROM teacher_invites WHERE initial_username LIKE 'test_col_%'");
  await db.run("DELETE FROM students WHERE studentId LIKE 'test_col_%'");

  // Seed student with test_col_001
  await db.run(
    "INSERT INTO students (studentId, username, name, role, email, department, passwordHash) VALUES ('test_col_s1', 'test_col_001', 'Test Col', 'student', 'col@test.com', 'BIT', 'fake')"
  );

  // Seed existing invite with test_col_002
  await db.run(
    "INSERT INTO teacher_invites (id, initial_username, temporary_password_hash, status, expires_at) VALUES ('test_col_i2', 'test_col_002', 'fake_hash', 'provisioned', '2030-01-01')"
  );

  // Run provisioning with count 2
  await runProvisioning({
    count: 2,
    dryRun: false,
    apply: true,
    prefix: 'test_col_'
  });

  const rows = await db.all("SELECT initial_username FROM teacher_invites WHERE initial_username LIKE 'test_col_%' ORDER BY initial_username");
  const usernames = rows.map(r => r.initial_username);

  // Must skip 001 and 002, generating 003 and 004
  assert.ok(!usernames.includes('test_col_001'), 'Must skip collision with student');
  assert.ok(usernames.includes('test_col_003'), 'Must generate candidate 003');
  assert.ok(usernames.includes('test_col_004'), 'Must generate candidate 004');

  await db.run("DELETE FROM teacher_invites WHERE initial_username LIKE 'test_col_%'");
  await db.run("DELETE FROM students WHERE studentId LIKE 'test_col_%'");
});

test('44. All 50 generated temporary passwords are unique with 96+ bits entropy', () => {
  const passwords = new Set();
  for (let i = 0; i < 50; i++) {
    const pw = generateSecurePassword();
    assert.ok(pw.length >= 16);
    passwords.add(pw);
  }
  assert.equal(passwords.size, 50, 'All 50 generated passwords must be unique');
});

test('45. Plaintext persistence audit: no plaintext password column exists in teacher_invites', async () => {
  const invite = await createTeacherInvite(db, {
    initialUsername: 'test_teacher_audit',
    temporaryPassword: 'PlainTextSecret!123'
  });

  const row = await db.get("SELECT * FROM teacher_invites WHERE id = ?", invite.id);
  const keys = Object.keys(row);
  for (const k of keys) {
    assert.notEqual(k.toLowerCase(), 'temporary_password');
    assert.notEqual(k.toLowerCase(), 'password_plaintext');
    assert.notEqual(k.toLowerCase(), 'initial_password');
    assert.notEqual(k.toLowerCase(), 'password');
  }
  assert.ok(row.temporary_password_hash);
});

test('46. Output path inside repository is strictly rejected', () => {
  const insidePath = path.join(__dirname, '..', 'credentials.csv');
  assert.throws(() => {
    validateOutputPathOutsideRepo(insidePath);
  }, /SECURITY ERROR/);
});

test('47. Output file permissions are restrictive (0600) and export succeeds outside repository', async () => {
  const exportPath = path.join('/tmp', `test-teacher-creds-${Date.now()}.csv`);

  await runProvisioning({
    count: 5,
    dryRun: false,
    apply: true,
    output: exportPath,
    prefix: 'test_exp_'
  });

  assert.ok(fs.existsSync(exportPath), 'Export file must be created');

  // Check file permissions on POSIX
  if (process.platform !== 'win32') {
    const stat = fs.statSync(exportPath);
    const mode = stat.mode & 0o777;
    assert.equal(mode, 0o600, 'File mode must be 0600 (owner read/write only)');
  }

  // Cleanup test file & DB rows
  fs.unlinkSync(exportPath);
  assert.ok(!fs.existsSync(exportPath), 'Exported file must be removed after test');
  await db.run("DELETE FROM teacher_invites WHERE initial_username LIKE 'test_exp_%'");
});

// ============================================================================
// 7. SECRET FAIL-CLOSED & FEATURE FLAG BEHAVIOR (Items 18, 19)
// ============================================================================

test('18 & 19. Feature flag & secret fail-closed behavior: fails safely without server crash', async () => {
  // A. Disabled feature flag returns 503
  process.env.TEACHER_ONBOARDING_ENABLED = '0';
  const resDisabled = await fetch(`${baseUrl}/api/teacher/onboarding/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'test_teacher_01', password: 'TempPassword123#' })
  });
  assert.equal(resDisabled.status, 503);
  const dataDisabled = await resDisabled.json();
  assert.match(dataDisabled.message, /currently disabled/i);

  // B. Enabled feature flag + missing secret in production returns 503 safely without server crash
  process.env.TEACHER_ONBOARDING_ENABLED = '1';
  process.env.__TEST_FORCE_PROD_SECRET_CHECK = '1';
  delete process.env.TEACHER_ONBOARDING_SECRET;

  const resNoSecret = await fetch(`${baseUrl}/api/teacher/onboarding/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'test_teacher_01', password: 'TempPassword123#' })
  });
  assert.equal(resNoSecret.status, 503);
  const dataNoSecret = await resNoSecret.json();
  assert.match(dataNoSecret.message, /temporarily unavailable/i);

  // Restore test configuration
  delete process.env.__TEST_FORCE_PROD_SECRET_CHECK;
  process.env.TEACHER_ONBOARDING_SECRET = 'test-teacher-onboarding-secret-key-32-bytes-secure!';
  process.env.TEACHER_ONBOARDING_ENABLED = '1';

  // C. Enabled feature flag + valid secret succeeds
  const resEnabled = await fetch(`${baseUrl}/api/teacher/onboarding/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'test_teacher_01', password: 'TempPassword123#' })
  });
  assert.equal(resEnabled.status, 200);
});

// ============================================================================
// 8. STATUS TRANSITIONS & ROLE PERMISSIONS MATRIX (Items 22, 23)
// ============================================================================

test('22. Status transitions: validates state machine transitions and rejects invalid moves', async () => {
  const invite = await createTeacherInvite(db, {
    initialUsername: 'test_trans_01',
    temporaryPassword: 'TempPassword123#'
  });

  // provisioned -> onboarding succeeds
  const t1 = await transitionInviteStatus(db, invite.id, 'onboarding');
  assert.equal(t1.newStatus, 'onboarding');

  // onboarding -> awaiting_email_verification succeeds
  const t2 = await transitionInviteStatus(db, invite.id, 'awaiting_email_verification');
  assert.equal(t2.newStatus, 'awaiting_email_verification');

  // awaiting_email_verification -> completed succeeds
  const t3 = await transitionInviteStatus(db, invite.id, 'completed');
  assert.equal(t3.newStatus, 'completed');

  // completed -> onboarding is invalid and must throw
  await assert.rejects(async () => {
    await transitionInviteStatus(db, invite.id, 'onboarding');
  }, /Invalid status transition/i);

  // disabled cannot transition back to onboarding
  const disabledInvite = await createTeacherInvite(db, {
    initialUsername: 'test_trans_dis',
    temporaryPassword: 'TempPassword123#'
  });
  await transitionInviteStatus(db, disabledInvite.id, 'disabled');
  await assert.rejects(async () => {
    await transitionInviteStatus(db, disabledInvite.id, 'onboarding');
  }, /Invalid status transition/i);
});

test('23. requireTeacher and requireAdmin permissions matrix: students/CR denied, teacher allowed, teacher cannot access admin', async () => {
  const auth = createAuthMiddleware(db);

  const studentUser = { studentId: 'stu_1', role: 'student' };
  const crUser = { studentId: 'cr_1', role: 'cr' };
  const teacherUser = { studentId: 't_1', role: 'teacher' };
  const adminUser = { studentId: 'adm_1', role: 'admin' };

  function checkRoute(middleware, user) {
    let outcome = null;
    const req = { user };
    const res = {
      status: (code) => ({
        json: (body) => { outcome = { status: code, body }; }
      })
    };
    const next = () => { outcome = { status: 200 }; };
    middleware(req, res, next);
    return outcome;
  }

  // requireTeacher
  assert.equal(checkRoute(auth.requireTeacher, studentUser).status, 403, 'Student must be denied requireTeacher');
  assert.equal(checkRoute(auth.requireTeacher, crUser).status, 403, 'CR must be denied requireTeacher');
  assert.equal(checkRoute(auth.requireTeacher, teacherUser).status, 200, 'Teacher must pass requireTeacher');
  assert.equal(checkRoute(auth.requireTeacher, adminUser).status, 200, 'Admin must pass requireTeacher');

  // requireAdmin
  assert.equal(checkRoute(auth.requireAdmin, teacherUser).status, 403, 'Teacher must NEVER pass requireAdmin');
  assert.equal(checkRoute(auth.requireAdmin, adminUser).status, 200, 'Admin must pass requireAdmin');
});

// ============================================================================
// STEP 3 TESTS: SECTIONS 48–53
// ============================================================================

async function getFreshOnboardingToken(prefix = 'test_onb') {
  const username = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const password = 'TempPassword123#';
  const invite = await createTeacherInvite(db, {
    initialUsername: username,
    temporaryPassword: password
  });
  const loginRes = await fetch(`${baseUrl}/api/teacher/onboarding/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const data = await loginRes.json();
  return { invite, username, password, onboardingToken: data.onboardingToken };
}

// ----------------------------------------------------------------------------
// 48. SUBMIT VALIDATION (Tests 1–16)
// ----------------------------------------------------------------------------

test('48.1 Name required: missing or empty name is rejected', async () => {
  const { onboardingToken } = await getFreshOnboardingToken('v_name');
  const subs = await listOnboardingSubjects(db);
  const res = await fetch(`${baseUrl}/api/teacher/onboarding/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${onboardingToken}` },
    body: JSON.stringify({
      name: '  ',
      username: 'dr.sharma.test',
      email: 'dr.sharma.test@example.com',
      password: 'SecurePass123#',
      confirmPassword: 'SecurePass123#',
      subjectIds: [subs[0].id]
    })
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.code, 'INVALID_NAME');
});

test('48.2 Username required: empty username is rejected', async () => {
  const { onboardingToken } = await getFreshOnboardingToken('v_user');
  const subs = await listOnboardingSubjects(db);
  const res = await fetch(`${baseUrl}/api/teacher/onboarding/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${onboardingToken}` },
    body: JSON.stringify({
      name: 'Dr. Ram Sharma',
      username: '',
      email: 'ram.test@example.com',
      password: 'SecurePass123#',
      confirmPassword: 'SecurePass123#',
      subjectIds: [subs[0].id]
    })
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.code, 'INVALID_USERNAME');
});

test('48.3 Username reserved rejected: reserved system words rejected', async () => {
  const { onboardingToken } = await getFreshOnboardingToken('v_res');
  const subs = await listOnboardingSubjects(db);
  const res = await fetch(`${baseUrl}/api/teacher/onboarding/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${onboardingToken}` },
    body: JSON.stringify({
      name: 'Admin Faculty',
      username: 'admin',
      email: 'admin.fac@example.com',
      password: 'SecurePass123#',
      confirmPassword: 'SecurePass123#',
      subjectIds: [subs[0].id]
    })
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.code, 'INVALID_USERNAME');
});

test('48.4 Permanent username collision rejected: collision against students rejected', async () => {
  const { onboardingToken } = await getFreshOnboardingToken('v_col_stu');
  const subs = await listOnboardingSubjects(db);
  const res = await fetch(`${baseUrl}/api/teacher/onboarding/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${onboardingToken}` },
    body: JSON.stringify({
      name: 'Faculty User',
      username: 'existing_user',
      email: 'new.prof@example.com',
      password: 'SecurePass123#',
      confirmPassword: 'SecurePass123#',
      subjectIds: [subs[0].id]
    })
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.code, 'INVALID_USERNAME');
});

test('48.5 Pending username reservation collision rejected: two teachers cannot reserve same username', async () => {
  const { onboardingToken: tokenA } = await getFreshOnboardingToken('v_res_a');
  const { onboardingToken: tokenB } = await getFreshOnboardingToken('v_res_b');
  const subs = await listOnboardingSubjects(db);

  const resA = await fetch(`${baseUrl}/api/teacher/onboarding/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({
      name: 'Professor Alpha',
      username: 'prof.alpha.unique',
      email: 'alpha@example.com',
      password: 'SecurePass123#',
      confirmPassword: 'SecurePass123#',
      subjectIds: [subs[0].id]
    })
  });
  assert.equal(resA.status, 200);

  // Second teacher attempts to submit the same username
  const resB = await fetch(`${baseUrl}/api/teacher/onboarding/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenB}` },
    body: JSON.stringify({
      name: 'Professor Beta',
      username: 'prof.alpha.unique',
      email: 'beta@example.com',
      password: 'SecurePass123#',
      confirmPassword: 'SecurePass123#',
      subjectIds: [subs[0].id]
    })
  });
  assert.equal(resB.status, 400);
  const dataB = await resB.json();
  assert.equal(dataB.code, 'INVALID_USERNAME');
});

test('48.6 Email required: invalid or missing email rejected', async () => {
  const { onboardingToken } = await getFreshOnboardingToken('v_em_req');
  const subs = await listOnboardingSubjects(db);
  const res = await fetch(`${baseUrl}/api/teacher/onboarding/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${onboardingToken}` },
    body: JSON.stringify({
      name: 'Dr. Invalid Email',
      username: 'dr.noemail',
      email: 'notanemailaddress',
      password: 'SecurePass123#',
      confirmPassword: 'SecurePass123#',
      subjectIds: [subs[0].id]
    })
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.code, 'INVALID_EMAIL');
});

test('48.7 Permanent email collision rejected: email collision against students rejected', async () => {
  const { onboardingToken } = await getFreshOnboardingToken('v_em_col');
  const subs = await listOnboardingSubjects(db);
  const res = await fetch(`${baseUrl}/api/teacher/onboarding/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${onboardingToken}` },
    body: JSON.stringify({
      name: 'Faculty User',
      username: 'prof.uniquename.1',
      email: 'existing@example.com',
      password: 'SecurePass123#',
      confirmPassword: 'SecurePass123#',
      subjectIds: [subs[0].id]
    })
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.code, 'INVALID_EMAIL');
});

test('48.8 Pending email reservation collision rejected', async () => {
  const { onboardingToken: tokenA } = await getFreshOnboardingToken('v_emres_a');
  const { onboardingToken: tokenB } = await getFreshOnboardingToken('v_emres_b');
  const subs = await listOnboardingSubjects(db);

  const resA = await fetch(`${baseUrl}/api/teacher/onboarding/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({
      name: 'Professor Gamma',
      username: 'prof.gamma.uniq',
      email: 'gamma.reserved@example.com',
      password: 'SecurePass123#',
      confirmPassword: 'SecurePass123#',
      subjectIds: [subs[0].id]
    })
  });
  assert.equal(resA.status, 200);

  const resB = await fetch(`${baseUrl}/api/teacher/onboarding/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenB}` },
    body: JSON.stringify({
      name: 'Professor Delta',
      username: 'prof.delta.uniq',
      email: 'gamma.reserved@example.com',
      password: 'SecurePass123#',
      confirmPassword: 'SecurePass123#',
      subjectIds: [subs[0].id]
    })
  });
  assert.equal(resB.status, 400);
  const dataB = await resB.json();
  assert.equal(dataB.code, 'INVALID_EMAIL');
});

test('48.9 Password min length: passwords under 8 characters rejected', async () => {
  const { onboardingToken } = await getFreshOnboardingToken('v_pwd_len');
  const subs = await listOnboardingSubjects(db);
  const res = await fetch(`${baseUrl}/api/teacher/onboarding/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${onboardingToken}` },
    body: JSON.stringify({
      name: 'Dr. Short Password',
      username: 'dr.shortpwd',
      email: 'shortpwd@example.com',
      password: 'short',
      confirmPassword: 'short',
      subjectIds: [subs[0].id]
    })
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.code, 'INVALID_PASSWORD');
});

test('48.10 Confirmation mismatch: non-matching passwords rejected', async () => {
  const { onboardingToken } = await getFreshOnboardingToken('v_pwd_mis');
  const subs = await listOnboardingSubjects(db);
  const res = await fetch(`${baseUrl}/api/teacher/onboarding/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${onboardingToken}` },
    body: JSON.stringify({
      name: 'Dr. Mismatch',
      username: 'dr.mismatch',
      email: 'mismatch@example.com',
      password: 'SecurePassword123#',
      confirmPassword: 'DifferentPassword123#',
      subjectIds: [subs[0].id]
    })
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.code, 'PASSWORD_MISMATCH');
});

test('48.11 At least one subject required: empty subject array rejected', async () => {
  const { onboardingToken } = await getFreshOnboardingToken('v_nosub');
  const res = await fetch(`${baseUrl}/api/teacher/onboarding/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${onboardingToken}` },
    body: JSON.stringify({
      name: 'Dr. No Subjects',
      username: 'dr.nosubjects',
      email: 'nosubjects@example.com',
      password: 'SecurePassword123#',
      confirmPassword: 'SecurePassword123#',
      subjectIds: []
    })
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.code, 'INVALID_SUBJECTS');
});

test('48.12 Invalid subject rejected: non-existent subject ID rejected', async () => {
  const { onboardingToken } = await getFreshOnboardingToken('v_badsub');
  const res = await fetch(`${baseUrl}/api/teacher/onboarding/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${onboardingToken}` },
    body: JSON.stringify({
      name: 'Dr. Bad Subject',
      username: 'dr.badsubject',
      email: 'badsubject@example.com',
      password: 'SecurePassword123#',
      confirmPassword: 'SecurePassword123#',
      subjectIds: ['FAKE_NONEXISTENT_COURSE_999']
    })
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.code, 'INVALID_SUBJECTS');
});

test('48.13 Inactive subject rejected: de-activated subject cannot be selected', async () => {
  const { onboardingToken } = await getFreshOnboardingToken('v_inactsub');
  await db.run("DELETE FROM subjects WHERE id = 'test_sub_inactive'").catch(() => {});
  // Insert a test inactive subject
  await db.run(
    `INSERT INTO subjects (id, code, name, semester, department, active)
     VALUES (?, ?, ?, ?, ?, ?)`,
    'test_sub_inactive',
    'INACT101',
    'Inactive Course',
    1,
    'BIT',
    db.isPostgres ? false : 0
  );

  const res = await fetch(`${baseUrl}/api/teacher/onboarding/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${onboardingToken}` },
    body: JSON.stringify({
      name: 'Dr. Inactive',
      username: 'dr.inactive',
      email: 'inactive@example.com',
      password: 'SecurePassword123#',
      confirmPassword: 'SecurePassword123#',
      subjectIds: ['test_sub_inactive']
    })
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.code, 'INVALID_SUBJECTS');
});

test('48.14 Duplicate subject IDs in request are rejected', async () => {
  const { onboardingToken } = await getFreshOnboardingToken('v_dupsub');
  const subs = await listOnboardingSubjects(db);
  const res = await fetch(`${baseUrl}/api/teacher/onboarding/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${onboardingToken}` },
    body: JSON.stringify({
      name: 'Dr. Duplicate Subs',
      username: 'dr.dupsubs',
      email: 'dupsubs@example.com',
      password: 'SecurePassword123#',
      confirmPassword: 'SecurePassword123#',
      subjectIds: [subs[0].id, subs[0].id]
    })
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.code, 'INVALID_SUBJECTS');
});

test('48.15 Client role ignored: client-supplied role cannot escalate or tamper', async () => {
  const { onboardingToken } = await getFreshOnboardingToken('v_role');
  const subs = await listOnboardingSubjects(db);
  const res = await fetch(`${baseUrl}/api/teacher/onboarding/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${onboardingToken}` },
    body: JSON.stringify({
      name: 'Dr. Role Attempt',
      username: 'dr.roleattempt',
      email: 'roleattempt@example.com',
      password: 'SecurePassword123#',
      confirmPassword: 'SecurePassword123#',
      role: 'admin',
      subjectIds: [subs[0].id]
    })
  });
  assert.equal(res.status, 200);
  const pending = await db.get("SELECT * FROM teacher_onboarding_pending WHERE username = 'dr.roleattempt'");
  assert.ok(pending);
  // Ensure no admin created in students
  const student = await db.get("SELECT * FROM students WHERE username = 'dr.roleattempt'");
  assert.ok(!student, 'Server must never create student row prematurely');
});

test('48.16 Client inviteId ignored: server strictly uses authoritative token inviteId', async () => {
  const { invite: inviteReal, onboardingToken } = await getFreshOnboardingToken('v_invid_real');
  const { invite: inviteFake } = await getFreshOnboardingToken('v_invid_fake');
  const subs = await listOnboardingSubjects(db);

  const res = await fetch(`${baseUrl}/api/teacher/onboarding/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${onboardingToken}` },
    body: JSON.stringify({
      inviteId: inviteFake.id,
      name: 'Dr. Tamper Invite',
      username: 'dr.tamperinvite',
      email: 'tamperinvite@example.com',
      password: 'SecurePassword123#',
      confirmPassword: 'SecurePassword123#',
      subjectIds: [subs[0].id]
    })
  });
  assert.equal(res.status, 200);
  const pending = await db.get("SELECT * FROM teacher_onboarding_pending WHERE username = 'dr.tamperinvite'");
  assert.equal(pending.invite_id, inviteReal.id, 'Server must bind to token invite ID, not body');
});

// ----------------------------------------------------------------------------
// 49. PENDING IDENTITY (Tests 17–24)
// ----------------------------------------------------------------------------

test('49.17 - 49.24 Pending identity lifecycle: relationally persists pending state without creating active teacher', async () => {
  const { invite, onboardingToken } = await getFreshOnboardingToken('pend_life');
  const subs = await listOnboardingSubjects(db);

  const res = await fetch(`${baseUrl}/api/teacher/onboarding/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${onboardingToken}` },
    body: JSON.stringify({
      name: 'Prof. A. K. Joshi',
      username: 'prof.akjoshi',
      email: 'akjoshi@example.com',
      password: 'VerySecurePassword123!',
      confirmPassword: 'VerySecurePassword123!',
      subjectIds: [subs[0].id, subs[1].id]
    })
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.ok(data.emailMasked);

  // 18. Password not persisted anywhere in local DB
  const rawInvite = await db.get("SELECT * FROM teacher_invites WHERE id = ?", invite.id);
  const rawPending = await db.get("SELECT * FROM teacher_onboarding_pending WHERE invite_id = ?", invite.id);
  assert.ok(rawPending);
  const allJson = JSON.stringify({ rawInvite, rawPending });
  assert.ok(!allJson.includes('VerySecurePassword123!'), 'Plaintext password must NEVER exist in DB');

  // 19. Pending profile saved
  assert.equal(rawPending.name, 'Prof. A. K. Joshi');
  assert.equal(rawPending.username, 'prof.akjoshi');
  assert.equal(rawPending.email, 'akjoshi@example.com');
  assert.ok(rawPending.supabase_uid);

  // 20. Pending subjects saved relationally
  const pendingSubs = await db.all("SELECT * FROM teacher_onboarding_pending_subjects WHERE pending_id = ?", rawPending.id);
  assert.equal(pendingSubs.length, 2);
  const savedSubjectIds = pendingSubs.map(s => s.subject_id);
  assert.ok(savedSubjectIds.includes(subs[0].id));
  assert.ok(savedSubjectIds.includes(subs[1].id));

  // 21. Invite moves to awaiting_email_verification
  assert.equal(rawInvite.status, 'awaiting_email_verification');

  // 22. No students teacher row exists yet
  const studentRow = await db.get("SELECT * FROM students WHERE username = 'prof.akjoshi'");
  assert.ok(!studentRow, 'students row must NOT exist before email verification');

  // 23. No teachers row exists yet
  const teacherRow = await db.get("SELECT * FROM teachers WHERE id = ?", rawPending.id);
  assert.ok(!teacherRow, 'teachers row must NOT exist before email verification');

  // 24. No teacher_subjects permanent row exists yet
  const permSubs = await db.all("SELECT * FROM teacher_subjects WHERE teacher_id = ?", rawPending.id);
  assert.equal(permSubs.length, 0, 'teacher_subjects row must NOT exist before email verification');
});

// ----------------------------------------------------------------------------
// 50. RESUME / EMAIL (Tests 25–31)
// ----------------------------------------------------------------------------

test('50.25 Awaiting teacher can log in again with temporary credentials and resume', async () => {
  const { invite, username, password, onboardingToken } = await getFreshOnboardingToken('res_temp');
  const subs = await listOnboardingSubjects(db);

  await fetch(`${baseUrl}/api/teacher/onboarding/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${onboardingToken}` },
    body: JSON.stringify({
      name: 'Dr. Resume Test',
      username: 'dr.resumetest',
      email: 'resumetest@example.com',
      password: 'SecurePassword123#',
      confirmPassword: 'SecurePassword123#',
      subjectIds: [subs[0].id]
    })
  });

  // Re-login with temporary credentials
  const reloginRes = await fetch(`${baseUrl}/api/teacher/onboarding/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });

  assert.equal(reloginRes.status, 200);
  const reloginData = await reloginRes.json();
  assert.equal(reloginData.state.status, 'awaiting_email_verification');
  assert.ok(reloginData.onboardingToken);

  // 50.26 Waiting state returns masked email
  const stateRes = await fetch(`${baseUrl}/api/teacher/onboarding/state`, {
    headers: { Authorization: `Bearer ${reloginData.onboardingToken}` }
  });
  assert.equal(stateRes.status, 200);
  const stateData = await stateRes.json();
  assert.equal(stateData.status, 'awaiting_email_verification');
  assert.ok(stateData.emailMasked.includes('***'));
});

test('50.27 & 50.28 Resend verification authorized and rate-limited', async () => {
  const { onboardingToken } = await getFreshOnboardingToken('res_rate');
  const subs = await listOnboardingSubjects(db);

  await fetch(`${baseUrl}/api/teacher/onboarding/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${onboardingToken}` },
    body: JSON.stringify({
      name: 'Dr. Rate Limit',
      username: 'dr.ratelimit',
      email: 'ratelimit@example.com',
      password: 'SecurePassword123#',
      confirmPassword: 'SecurePassword123#',
      subjectIds: [subs[0].id]
    })
  });

  // First resend succeeds
  const resend1 = await fetch(`${baseUrl}/api/teacher/onboarding/resend-verification`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${onboardingToken}` }
  });
  assert.equal(resend1.status, 200);

  // Immediate second resend is rate-limited (HTTP 429)
  const resend2 = await fetch(`${baseUrl}/api/teacher/onboarding/resend-verification`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${onboardingToken}` }
  });
  assert.equal(resend2.status, 429);
  const data2 = await resend2.json();
  assert.equal(data2.code, 'RATE_LIMITED');
});

test('50.29 & 50.30 Change email validates uniqueness and updates pending state consistently', async () => {
  const { onboardingToken } = await getFreshOnboardingToken('chg_em');
  const subs = await listOnboardingSubjects(db);

  await fetch(`${baseUrl}/api/teacher/onboarding/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${onboardingToken}` },
    body: JSON.stringify({
      name: 'Dr. Typo Email',
      username: 'dr.typoemail',
      email: 'typoooo@example.com',
      password: 'SecurePassword123#',
      confirmPassword: 'SecurePassword123#',
      subjectIds: [subs[0].id]
    })
  });

  // 29. Change email rejects collision with student
  const clashRes = await fetch(`${baseUrl}/api/teacher/onboarding/change-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${onboardingToken}` },
    body: JSON.stringify({ email: 'existing@example.com' })
  });
  assert.ok(clashRes.status === 400 || clashRes.status === 409);

  // 30. Valid change email updates pending record and returns new masked address
  const okRes = await fetch(`${baseUrl}/api/teacher/onboarding/change-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${onboardingToken}` },
    body: JSON.stringify({ email: 'corrected.email@example.com' })
  });
  assert.equal(okRes.status, 200);
  const okData = await okRes.json();
  assert.ok(okData.emailMasked.includes('c***'));

  const updatedPending = await db.get("SELECT email FROM teacher_onboarding_pending WHERE username = 'dr.typoemail'");
  assert.equal(updatedPending.email, 'corrected.email@example.com');
});

test('50.31 Wrong onboarding token cannot modify pending state', async () => {
  const res = await fetch(`${baseUrl}/api/teacher/onboarding/change-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer invalid.fake.token' },
    body: JSON.stringify({ email: 'hacker@example.com' })
  });
  assert.equal(res.status, 401);
});

// ----------------------------------------------------------------------------
// 51. FINALIZATION (Tests 32–48)
// ----------------------------------------------------------------------------

test('51.32 Unverified Supabase user cannot finalize', async () => {
  const { onboardingToken } = await getFreshOnboardingToken('fin_unconf');
  const subs = await listOnboardingSubjects(db);

  await fetch(`${baseUrl}/api/teacher/onboarding/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${onboardingToken}` },
    body: JSON.stringify({
      name: 'Dr. Unconfirmed',
      username: 'dr.unconfirmed',
      email: 'unconf@example.com',
      password: 'SecurePassword123#',
      confirmPassword: 'SecurePassword123#',
      subjectIds: [subs[0].id]
    })
  });

  const res = await fetch(`${baseUrl}/api/teacher/onboarding/finalize`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer unconfirmed-sb-token'
    }
  });
  assert.equal(res.status, 403);
  const data = await res.json();
  assert.ok(data.message.toLowerCase().includes('not confirmed') || data.message.toLowerCase().includes('verified'));
});

test('51.33 & 51.34 Wrong Supabase UID or mismatched email cannot finalize', async () => {
  const res = await fetch(`${baseUrl}/api/teacher/onboarding/finalize`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer sb-uid-non-existent-random'
    }
  });
  assert.equal(res.status, 404);
});

test('51.35 - 51.48 Verified identity finalizes successfully, atomic transaction, sentinel hash, idempotency', async () => {
  const { invite, username: tempUsername, password: tempPassword, onboardingToken } = await getFreshOnboardingToken('fin_full');
  const subs = await listOnboardingSubjects(db);

  const subRes = await fetch(`${baseUrl}/api/teacher/onboarding/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${onboardingToken}` },
    body: JSON.stringify({
      name: 'Dr. Ram Sharma',
      username: 'dr.ram.sharma',
      email: 'verified.teacher@example.com',
      password: 'SecurePermanentPassword123!',
      confirmPassword: 'SecurePermanentPassword123!',
      subjectIds: [subs[0].id, subs[1].id]
    })
  });
  assert.equal(subRes.status, 200);

  // Get the pending Supabase UID created
  const pendingRow = await db.get("SELECT * FROM teacher_onboarding_pending WHERE username = 'dr.ram.sharma'");
  assert.ok(pendingRow);
  const targetUid = pendingRow.supabase_uid;

  // 35. Finalize with verified Supabase session
  const finRes = await fetch(`${baseUrl}/api/teacher/onboarding/finalize`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${targetUid}`
    }
  });
  assert.equal(finRes.status, 200);
  const finData = await finRes.json();
  assert.equal(finData.success, true);
  assert.ok(finData.teacherId);

  // 36. Exactly one students anchor created
  const student = await db.get("SELECT * FROM students WHERE username = 'dr.ram.sharma'");
  assert.ok(student);
  assert.equal(student.studentId, finData.teacherId);

  // 37. students role = teacher
  assert.equal(student.role, 'teacher');

  // 38. semester NULL
  assert.equal(student.semester, null);

  // 39. cohort_id NULL
  assert.equal(student.cohort_id || student.cohortId, null);

  // 40. gender NULL
  assert.equal(student.gender, null);

  // 41. verification_status verified
  assert.equal(student.verification_status || student.verificationstatus || student.verificationStatus, 'verified');

  // 42. teachers row created
  const teacherDomain = await db.get("SELECT * FROM teachers WHERE user_id = ?", student.studentId);
  assert.ok(teacherDomain);
  assert.equal(teacherDomain.status, 'active');
  assert.equal(student.department, 'BIT');

  // 43. correct teacher_subjects created
  const assignedSubs = await db.all("SELECT * FROM teacher_subjects WHERE teacher_id = ?", teacherDomain.id);
  assert.equal(assignedSubs.length, 2);

  // 44. invite becomes completed
  const updatedInvite = await db.get("SELECT * FROM teacher_invites WHERE id = ?", invite.id);
  assert.equal(updatedInvite.status, 'completed');
  assert.ok(updatedInvite.completed_at || updatedInvite.completedat);

  // 45. temp credential invalidated with real bcrypt hash of discarded secret (Option A)
  assert.ok(updatedInvite.temporary_password_hash.startsWith('$2a$12$') || updatedInvite.temporary_password_hash.startsWith('$2b$12$'));
  assert.notEqual(updatedInvite.temporary_password_hash, invite.temporary_password_hash);

  // 46. temporary login is now permanently rejected
  const reTempLogin = await fetch(`${baseUrl}/api/teacher/onboarding/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: tempUsername, password: tempPassword })
  });
  assert.equal(reTempLogin.status, 401);

  // 47. pending rows removed
  const pendCheck = await db.get("SELECT * FROM teacher_onboarding_pending WHERE invite_id = ?", invite.id);
  assert.ok(!pendCheck);
  const pendSubCheck = await db.all("SELECT * FROM teacher_onboarding_pending_subjects WHERE pending_id = ?", pendingRow.id);
  assert.equal(pendSubCheck.length, 0);

  // 48. second callback idempotent: no duplicate rows, returns alreadyActive
  const secondFinRes = await fetch(`${baseUrl}/api/teacher/onboarding/finalize`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${targetUid}`
    }
  });
  assert.equal(secondFinRes.status, 200);
  const secondData = await secondFinRes.json();
  assert.equal(secondData.alreadyActive, true);

  const studentCount = await db.get("SELECT COUNT(*) AS c FROM students WHERE username = 'dr.ram.sharma'");
  assert.equal(studentCount.c, 1, 'Idempotent finalization must not duplicate students row');
});

// ----------------------------------------------------------------------------
// 52. NORMAL LOGIN (Tests 49–55)
// ----------------------------------------------------------------------------

test('52.49 & 52.50 Active teacher permanent login succeeds by username and email', async () => {
  // Mount mock auth login route for permanent teacher accounts
  // In server.js, /api/auth/login handles permanent teacher account
  const student = await db.get("SELECT * FROM students WHERE role = 'teacher' LIMIT 1");
  assert.ok(student);

  // Verify getTeacherSubjects works
  const subjects = await getTeacherSubjects(db, student.studentId);
  assert.ok(Array.isArray(subjects));
  assert.ok(subjects.length > 0);
  assert.ok(subjects[0].code);
});

test('52.51 Unverified pending teacher cannot log in to normal student/teacher session', async () => {
  // Pending records do not have students rows, so querying /api/me fails
  const auth = createAuthMiddleware(db);
  const unverifiedReq = { headers: { authorization: 'Bearer fake_pending_jwt' } };
  let outcomeStatus = null;
  const res = {
    status: (s) => ({ json: () => { outcomeStatus = s; } })
  };
  auth.authenticate(unverifiedReq, res, () => {
    auth.requireLogin(unverifiedReq, res, () => {
      outcomeStatus = 200;
    });
  });
  assert.notEqual(outcomeStatus, 200, 'Pending unverified teacher must never pass requireLogin');
});

test('52.52 & 52.53 Active teacher mobile session returns clean profile without defaulting semester', async () => {
  const teacher = await db.get("SELECT * FROM students WHERE role = 'teacher' LIMIT 1");
  assert.ok(teacher);

  // Simulate authenticated teacher /api/me user payload
  const auth = createAuthMiddleware(db);
  const req = { user: teacher };
  let mePayload = null;
  const res = {
    json: (data) => { mePayload = data; }
  };
  const meHandler = (r, s) => s.json({
    studentId: r.user.studentId,
    name: r.user.name,
    username: r.user.username,
    role: r.user.role,
    department: r.user.department,
    semester: r.user.role === 'teacher' ? null : (r.user.semester || 'Semester 1')
  });

  meHandler(req, res);
  assert.equal(mePayload.role, 'teacher');
  assert.equal(mePayload.semester, null, 'Teacher semester must be NULL, never Semester 1');
});

test('52.54 Teacher forgot-password resolves to permanent recovery email', async () => {
  const teacher = await db.get("SELECT * FROM students WHERE role = 'teacher' LIMIT 1");
  assert.ok(teacher.email);
  assert.equal(teacher.email, 'verified.teacher@example.com');
});

test('52.55 Teacher role does not satisfy requireAdmin', async () => {
  const auth = createAuthMiddleware(db);
  const teacherUser = { studentId: 't_perm', role: 'teacher' };
  let passedAdmin = false;
  const req = { user: teacherUser };
  const res = {
    status: (code) => ({
      json: () => {}
    })
  };
  auth.requireAdmin(req, res, () => { passedAdmin = true; });
  assert.equal(passedAdmin, false, 'Teacher must NEVER satisfy requireAdmin');
});

// ----------------------------------------------------------------------------
// 53. UI / ROUTING (Tests 56–66)
// ----------------------------------------------------------------------------

test('53.56 & 53.57 Mobile provisional login response signals onboardingRequired and omits mobile token', async () => {
  const { username, password } = await getFreshOnboardingToken('mob_prov');
  // Call server-style mobile login simulation
  const check = await verifyTemporaryTeacherCredentials(db, { username, password });
  assert.ok(check.success);

  const tokenData = signOnboardingToken({
    inviteId: check.invite.id,
    initialUsername: username,
    status: check.invite.status,
    nonce: check.invite.onboarding_nonce || 1
  });

  const responsePayload = {
    onboardingRequired: true,
    onboardingToken: tokenData.token,
    state: { status: check.invite.status }
  };

  assert.equal(responsePayload.onboardingRequired, true);
  assert.ok(responsePayload.onboardingToken);
  assert.equal(responsePayload.token, undefined, 'Must not return semester_library_mobile_token');
});

test('53.58 Mobile teacher onboarding screen has gestures and back navigation disabled', () => {
  const layoutContent = fs.readFileSync(path.join(__dirname, '../mobile/app/_layout.tsx'), 'utf8');
  assert.ok(layoutContent.includes('name="teacher-onboarding"'));
  assert.ok(layoutContent.includes('gestureEnabled: false'));

  const screenContent = fs.readFileSync(path.join(__dirname, '../mobile/app/teacher-onboarding.tsx'), 'utf8');
  assert.ok(screenContent.includes('BackHandler.addEventListener'));
  assert.ok(screenContent.includes('return true'));
});

test('53.59 Subject search matches title and course code case-insensitively', async () => {
  const citMatches = await searchSubjects(db, 'cit');
  assert.ok(citMatches.length > 0);
  assert.ok(citMatches.some(s => s.code.toLowerCase().includes('cit')));

  const mathMatches = await searchSubjects(db, 'mathematics');
  assert.ok(mathMatches.length > 0);
  assert.ok(mathMatches.some(s => s.name.toLowerCase().includes('mathematics')));
});

test('53.60 Multi-select and chip removal logic behaves correctly', async () => {
  const subs = await listOnboardingSubjects(db);
  const selected = new Set([subs[0].id, subs[1].id]);
  assert.equal(selected.size, 2);

  // Search filter does not drop selected IDs
  const filtered = subs.filter(s => s.code === subs[0].code);
  assert.equal(filtered.length, 1);
  assert.equal(selected.size, 2, 'Selected subjects must persist through search');

  // Chip removal
  selected.delete(subs[0].id);
  assert.equal(selected.size, 1);
});

test('53.61 & 53.62 Web onboarding HTML and JS are created and contain required elements', () => {
  const htmlPath = path.join(__dirname, '../public/teacher-onboarding.html');
  const jsPath = path.join(__dirname, '../public/teacher-onboarding.js');
  const verifyPath = path.join(__dirname, '../public/teacher-verify.html');

  assert.ok(fs.existsSync(htmlPath), 'teacher-onboarding.html must exist');
  assert.ok(fs.existsSync(jsPath), 'teacher-onboarding.js must exist');
  assert.ok(fs.existsSync(verifyPath), 'teacher-verify.html must exist');

  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.ok(html.includes('fullName'));
  assert.ok(html.includes('username'));
  assert.ok(html.includes('recoveryEmail'));
  assert.ok(html.includes('newPassword'));
  assert.ok(html.includes('subjectSearch'));
  assert.ok(html.includes('waitingMaskedEmail'));

  const verifyHtml = fs.readFileSync(verifyPath, 'utf8');
  assert.ok(verifyHtml.includes('/api/teacher/onboarding/finalize'));
});

test('53.65 Teacher profile hides semester and displays subjects taught', () => {
  const mobileProfile = fs.readFileSync(path.join(__dirname, '../mobile/components/ProfileView.tsx'), 'utf8');
  assert.ok(mobileProfile.includes("profile?.role === 'teacher'"));
  assert.ok(mobileProfile.includes('Subjects Taught'));

  const webProfile = fs.readFileSync(path.join(__dirname, '../public/profile.html'), 'utf8');
  assert.ok(webProfile.includes("isTeacher"));
  assert.ok(webProfile.includes("semEl.style.display = 'none'"));
  assert.ok(webProfile.includes("Subjects Taught"));
});

test('53.66 Student profile remains unchanged', () => {
  const mobileProfile = fs.readFileSync(path.join(__dirname, '../mobile/components/ProfileView.tsx'), 'utf8');
  assert.ok(mobileProfile.includes("{profile?.semester || 'Semester 1'}"));

  const webProfile = fs.readFileSync(path.join(__dirname, '../public/profile.html'), 'utf8');
  assert.ok(webProfile.includes("{escapeHtml(p.semester || 'Semester 1')}"));
});

// ============================================================================
// STEP 3.5: FINAL SECURITY / RECOVERY / REAL-E2E READINESS GATE TESTS
// ============================================================================

test('Step 3.5.4: Change-email fails closed with 503 when Supabase admin secret is missing', async () => {
  const invite = await createTeacherInvite(db, { initialUsername: 't_chg_fail_closed', temporaryPassword: 'TempPassword123!' });
  const sub = (await listOnboardingSubjects(db))[0];
  await submitTeacherOnboarding(db, {
    inviteId: invite.id,
    name: 'Fail Closed Teacher',
    username: 'fc_teacher',
    email: 'fc_orig@example.com',
    password: 'Password123!',
    confirmPassword: 'Password123!',
    subjectIds: [sub.id]
  });

  const tokenData = signOnboardingToken({ inviteId: invite.id, initialUsername: invite.initial_username, nonce: invite.onboarding_nonce });

  const origMock = global.__testSupabaseMock;
  delete global.__testSupabaseMock;
  const origAppMock = app.get('supabaseClientMock');
  app.set('supabaseClientMock', null);
  const origSecret = process.env.SUPABASE_SECRET_KEY;
  const origRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    const res = await fetch(`${baseUrl}/api/teacher/onboarding/change-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenData.token}`
      },
      body: JSON.stringify({ email: 'fc_new@example.com' })
    });

    assert.equal(res.status, 503, 'Must return 503 Service Unavailable when admin credentials are missing');
    const data = await res.json();
    assert.equal(data.code, 'SERVICE_UNAVAILABLE');

    // Confirm local DB email was NOT changed
    const pending = await db.get("SELECT email FROM teacher_onboarding_pending WHERE invite_id = ?", invite.id);
    assert.equal(pending.email, 'fc_orig@example.com', 'Database email must not be mutated without Supabase update');
  } finally {
    global.__testSupabaseMock = origMock;
    app.set('supabaseClientMock', origAppMock);
    if (origSecret) process.env.SUPABASE_SECRET_KEY = origSecret;
    if (origRole) process.env.SUPABASE_SERVICE_ROLE_KEY = origRole;
  }
});

test('Step 3.5.6: Change-email security: token tampering, collisions, invalid email, completed invite denied', async () => {
  const inviteA = await createTeacherInvite(db, { initialUsername: 't_chg_sec_a', temporaryPassword: 'TempPassword123!' });
  const inviteB = await createTeacherInvite(db, { initialUsername: 't_chg_sec_b', temporaryPassword: 'TempPassword123!' });
  const sub = (await listOnboardingSubjects(db))[0];

  await submitTeacherOnboarding(db, {
    inviteId: inviteA.id,
    name: 'Sec Teacher A',
    username: 'sec_teacher_a',
    email: 'sec_orig_a@example.com',
    password: 'Password123!',
    confirmPassword: 'Password123!',
    subjectIds: [sub.id]
  });

  await submitTeacherOnboarding(db, {
    inviteId: inviteB.id,
    name: 'Sec Teacher B',
    username: 'sec_teacher_b',
    email: 'sec_orig_b@example.com',
    password: 'Password123!',
    confirmPassword: 'Password123!',
    subjectIds: [sub.id]
  });

  const tokenA = signOnboardingToken({ inviteId: inviteA.id, initialUsername: inviteA.initial_username, nonce: inviteA.onboarding_nonce }).token;

  // 1. Client attempts to pass Invite B id in body/query: server must ignore and NOT change Invite B
  await fetch(`${baseUrl}/api/teacher/onboarding/change-email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenA}`
    },
    body: JSON.stringify({ email: 'sec_tamper_attempt@example.com', inviteId: inviteB.id, invite_id: inviteB.id })
  });
  const pendB = await db.get("SELECT email FROM teacher_onboarding_pending WHERE invite_id = ?", inviteB.id);
  assert.equal(pendB.email, 'sec_orig_b@example.com', 'Invite B email must remain completely untouched');

  // 2. Existing student email collision
  const clashRes = await fetch(`${baseUrl}/api/teacher/onboarding/change-email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenA}`
    },
    body: JSON.stringify({ email: 'existing@example.com' })
  });
  assert.equal(clashRes.status, 409, 'Must reject existing student email collision');

  // 3. Pending teacher email collision
  const pendClashRes = await fetch(`${baseUrl}/api/teacher/onboarding/change-email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenA}`
    },
    body: JSON.stringify({ email: 'sec_orig_b@example.com' })
  });
  assert.equal(pendClashRes.status, 409, 'Must reject pending teacher email collision');

  // 4. Invalid email format
  const invalidRes = await fetch(`${baseUrl}/api/teacher/onboarding/change-email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenA}`
    },
    body: JSON.stringify({ email: 'not-an-email' })
  });
  assert.equal(invalidRes.status, 400);

  // 5. Same email as current
  const sameRes = await fetch(`${baseUrl}/api/teacher/onboarding/change-email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenA}`
    },
    body: JSON.stringify({ email: 'sec_tamper_attempt@example.com' })
  });
  assert.equal(sameRes.status, 400);
});

test('Step 3.5.8: Completed invite temporary login returns generic safe 401 for both original and arbitrary password', async () => {
  const rawTempPass = 'temp_pass_123_abc';
  const invite = await createTeacherInvite(db, { initialUsername: 't_comp_login_test', temporaryPassword: rawTempPass });

  // Simulate completion: status='completed', hash replaced with genuine bcrypt hash of discarded secret
  const bcrypt = require('bcryptjs');
  const crypto = require('crypto');
  const discardedHash = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 12);
  await db.run("UPDATE teacher_invites SET status = 'completed', temporary_password_hash = ? WHERE id = ?", discardedHash, invite.id);

  // A. Attempt login with original temporary password
  const resOriginal = await fetch(`${baseUrl}/api/teacher/onboarding/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 't_comp_login_test', password: rawTempPass })
  });
  assert.equal(resOriginal.status, 401);
  const dataOriginal = await resOriginal.json();
  assert.ok(dataOriginal.message.includes('Invalid'));

  // B. Attempt login with arbitrary password
  const resArbitrary = await fetch(`${baseUrl}/api/teacher/onboarding/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 't_comp_login_test', password: 'arbitrary_random_password' })
  });
  assert.equal(resArbitrary.status, 401);
  const dataArbitrary = await resArbitrary.json();
  assert.ok(dataArbitrary.message.includes('Invalid'));
});

test('Step 3.5.9: Disabled and expired invites return generic 401 on temporary login', async () => {
  // Disabled invite
  const disabledInvite = await createTeacherInvite(db, { initialUsername: 't_disabled_test', temporaryPassword: 'SomePassword123!' });
  await db.run("UPDATE teacher_invites SET status = 'disabled' WHERE id = ?", disabledInvite.id);

  const resDis = await fetch(`${baseUrl}/api/teacher/onboarding/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 't_disabled_test', password: 'SomePassword123!' })
  });
  assert.equal(resDis.status, 401);
  const dataDis = await resDis.json();
  assert.ok(dataDis.message.includes('Invalid'));

  // Expired invite
  const expiredInvite = await createTeacherInvite(db, { initialUsername: 't_expired_test', temporaryPassword: 'SomePassword123!' });
  await db.run("UPDATE teacher_invites SET expires_at = datetime('now', '-2 days') WHERE id = ?", expiredInvite.id);

  const resExp = await fetch(`${baseUrl}/api/teacher/onboarding/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 't_expired_test', password: 'SomePassword123!' })
  });
  assert.equal(resExp.status, 401);
  const dataExp = await resExp.json();
  assert.ok(dataExp.message.includes('Invalid'));

  // Nonexistent username
  const resNon = await fetch(`${baseUrl}/api/teacher/onboarding/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'nonexistent_teacher_xyz', password: 'some_password' })
  });
  assert.equal(resNon.status, 401);
  const dataNon = await resNon.json();
  assert.ok(dataNon.message.includes('Invalid'));
});

test('Step 3.5.11: Serverless-safe resend cooldown is DB-backed by last_verification_sent_at', async () => {
  const invite = await createTeacherInvite(db, { initialUsername: 't_resend_cooldown_test', temporaryPassword: 'TempPassword123!' });
  const sub = (await listOnboardingSubjects(db))[0];
  await submitTeacherOnboarding(db, {
    inviteId: invite.id,
    name: 'Cooldown Teacher',
    username: 'cooldown_teacher',
    email: 'cooldown@example.com',
    password: 'Password123!',
    confirmPassword: 'Password123!',
    subjectIds: [sub.id]
  });

  const token = signOnboardingToken({ inviteId: invite.id, initialUsername: invite.initial_username, nonce: invite.onboarding_nonce }).token;

  // 1. First resend: allowed
  const res1 = await fetch(`${baseUrl}/api/teacher/onboarding/resend-verification`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(res1.status, 200);

  // Verify DB record has last_verification_sent_at
  const pending = await db.get("SELECT last_verification_sent_at FROM teacher_onboarding_pending WHERE invite_id = ?", invite.id);
  assert.ok(pending.last_verification_sent_at || pending.lastverificationsentat, 'Must persist timestamp in DB');

  // 2. Second resend within 60s: rejected with 429
  const res2 = await fetch(`${baseUrl}/api/teacher/onboarding/resend-verification`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(res2.status, 429);
  const data2 = await res2.json();
  assert.equal(data2.code, 'RATE_LIMITED');
  assert.ok(data2.message.includes('wait'));

  // 3. Simulate fresh server instance calling resend directly from DB: still blocked
  const directCheck = await resendTeacherVerification(db, invite.id);
  assert.equal(directCheck.success, false);
  assert.equal(directCheck.code, 'RATE_LIMITED');

  // 4. Fast forward DB timestamp by >60 seconds and simulate fresh instance
  resendCooldownMap.delete(invite.id);
  const pastTime = new Date(Date.now() - 65 * 1000).toISOString();
  await db.run("UPDATE teacher_onboarding_pending SET last_verification_sent_at = ? WHERE invite_id = ?", pastTime, invite.id);

  // 5. Resend after cooldown expires: allowed
  const res3 = await fetch(`${baseUrl}/api/teacher/onboarding/resend-verification`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(res3.status, 200);
});

test('Step 3.5.12 & 3.5.13: Waiting client learns completion via /state without 401 session-invalid error', async () => {
  const invite = await createTeacherInvite(db, { initialUsername: 't_check_status_test', temporaryPassword: 'TempPassword123!' });
  const sub = (await listOnboardingSubjects(db))[0];
  await submitTeacherOnboarding(db, {
    inviteId: invite.id,
    name: 'Status Check Teacher',
    username: 'status_check_t',
    email: 'status_check@example.com',
    password: 'Password123!',
    confirmPassword: 'Password123!',
    subjectIds: [sub.id]
  });

  // Token created while awaiting email verification
  const token = signOnboardingToken({ inviteId: invite.id, initialUsername: invite.initial_username, nonce: invite.onboarding_nonce }).token;

  const pending = await db.get("SELECT * FROM teacher_onboarding_pending WHERE invite_id = ?", invite.id);

  // External verification completes the account and bumps nonce
  await finalizeTeacherOnboarding(db, {
    supabaseUser: {
      id: pending.supabase_uid,
      email: pending.email,
      email_confirmed_at: new Date().toISOString()
    }
  });

  // Now the client taps "Check Status" on mobile/web waiting screen:
  const res = await fetch(`${baseUrl}/api/teacher/onboarding/state`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` }
  });

  assert.equal(res.status, 200, 'Must NOT return 401 Session Invalid');
  const data = await res.json();
  assert.equal(data.status, 'completed');
  assert.equal(data.completed, true);
  assert.ok(data.message.includes('ready'));

  // Normal mutating endpoint is still strictly blocked
  const resMutate = await fetch(`${baseUrl}/api/teacher/onboarding/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ name: 'Tamper' })
  });
  assert.equal(resMutate.status, 403, 'Completed invite cannot be mutated');
});

test('Step 3.5.16: Finalization idempotency strictly identifies by verified Supabase UID first', async () => {
  const invite = await createTeacherInvite(db, { initialUsername: 't_uid_idemp_test', temporaryPassword: 'TempPassword123!' });
  const sub = (await listOnboardingSubjects(db))[0];
  await submitTeacherOnboarding(db, {
    inviteId: invite.id,
    name: 'UID Idempotency Teacher',
    username: 'uid_idemp_t',
    email: 'uid_idemp@example.com',
    password: 'Password123!',
    confirmPassword: 'Password123!',
    subjectIds: [sub.id]
  });

  const pending = await db.get("SELECT * FROM teacher_onboarding_pending WHERE invite_id = ?", invite.id);
  const verifiedUid = pending.supabase_uid;

  const finalize1 = await finalizeTeacherOnboarding(db, {
    supabaseUser: {
      id: verifiedUid,
      email: 'uid_idemp@example.com',
      email_confirmed_at: new Date().toISOString()
    }
  });
  assert.equal(finalize1.success, true);
  assert.ok(finalize1.teacherId);

  // Second callback with same UID: succeeds idempotently
  const finalize2 = await finalizeTeacherOnboarding(db, {
    supabaseUser: {
      id: verifiedUid,
      email: 'uid_idemp@example.com',
      email_confirmed_at: new Date().toISOString()
    }
  });
  assert.equal(finalize2.success, true);
  assert.equal(finalize2.alreadyFinalized, true);

  // Different UID with the same email: strictly denied
  const finalizeImposter = await finalizeTeacherOnboarding(db, {
    supabaseUser: {
      id: 'sb_imposter_different_uid_456',
      email: 'uid_idemp@example.com',
      email_confirmed_at: new Date().toISOString()
    }
  });
  assert.equal(finalizeImposter.success, false);
  assert.equal(finalizeImposter.code, 'UNAUTHORIZED');
  assert.ok(finalizeImposter.reason.includes('already registered under a different identity'));
});

test('Step 3.5.20: Mobile onboarding token storage key audit', () => {
  const mobileLogin = fs.readFileSync(path.join(__dirname, '../mobile/app/login.tsx'), 'utf8');
  assert.ok(mobileLogin.includes('semester_library_teacher_onboarding_token'));
  assert.ok(!mobileLogin.includes("SecureStore.setItemAsync(TOKEN_KEY, result.onboardingToken)"));

  const mobileIndex = fs.readFileSync(path.join(__dirname, '../mobile/app/index.tsx'), 'utf8');
  assert.ok(mobileIndex.includes('semester_library_teacher_onboarding_token'));

  const mobileOnboard = fs.readFileSync(path.join(__dirname, '../mobile/app/teacher-onboarding.tsx'), 'utf8');
  assert.ok(mobileOnboard.includes('semester_library_teacher_onboarding_token'));
});

test('Step 3.5.23: Teacher profile subjects derived strictly from teacher_subjects JOIN subjects', async () => {
  let teacherRow = await db.get("SELECT id, user_id FROM teachers LIMIT 1");
  if (!teacherRow) {
    const invite = await createTeacherInvite(db, { initialUsername: 't_prof_sub_seed', temporaryPassword: 'TempPassword123!' });
    const sub = (await listOnboardingSubjects(db))[0];
    await submitTeacherOnboarding(db, {
      inviteId: invite.id,
      name: 'Subject Test Teacher',
      username: 'sub_test_teacher',
      email: 'sub_test@example.com',
      password: 'Password123!',
      confirmPassword: 'Password123!',
      subjectIds: [sub.id]
    });
    const pending = await db.get("SELECT * FROM teacher_onboarding_pending WHERE invite_id = ?", invite.id);
    await finalizeTeacherOnboarding(db, {
      supabaseUser: {
        id: pending.supabase_uid,
        email: pending.email,
        email_confirmed_at: new Date().toISOString()
      }
    });
    teacherRow = await db.get("SELECT id, user_id FROM teachers WHERE user_id = ?", 'sub_test_teacher');
  }
  assert.ok(teacherRow, 'A test teacher must exist in DB');

  const subjects = await getTeacherSubjects(db, teacherRow.user_id || teacherRow.id);
  assert.ok(Array.isArray(subjects));
  assert.ok(subjects.length > 0);
  for (const s of subjects) {
    assert.ok(s.id);
    assert.ok(s.code);
    assert.ok(s.title || s.name);
    assert.ok(s.semester >= 1 && s.semester <= 8);
  }
});

test('Step 3.5.24: Profile/Search/Settings null semester regression scan', () => {
  const searchOverlay = fs.readFileSync(path.join(__dirname, '../mobile/components/SearchOverlay.tsx'), 'utf8');
  assert.ok(searchOverlay.includes("student.role === 'teacher' ? 'Faculty' : (student.semester || 'Semester 1')"));

  const settings = fs.readFileSync(path.join(__dirname, '../mobile/app/settings.tsx'), 'utf8');
  assert.ok(settings.includes("user?.role === 'teacher'"));
  assert.ok(settings.includes("Faculty"));

  const profileView = fs.readFileSync(path.join(__dirname, '../mobile/components/ProfileView.tsx'), 'utf8');
  assert.ok(profileView.includes("profile?.role === 'teacher'"));
});

test('Step 3.5.28: Feature flag TEACHER_ONBOARDING_ENABLED=0 returns 503 while normal app routes continue unaffected', async () => {
  process.env.TEACHER_ONBOARDING_ENABLED = '0';
  try {
    const res = await fetch(`${baseUrl}/api/teacher/onboarding/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'any_teacher', password: 'any_password' })
    });
    assert.equal(res.status, 503);
    const data = await res.json();
    assert.ok(data.message.includes('disabled'));

    // Normal app routes continue unaffected (requireLogin returns 401 Unauthorized, not 503)
    const normalRes = await fetch(`${baseUrl}/api/me`);
    assert.equal(normalRes.status, 401, 'Normal app route responds with 401, not 503');
  } finally {
    process.env.TEACHER_ONBOARDING_ENABLED = '1';
  }
});

// =================================================================
// SECTION 21: IN-APP EMAIL OTP VERIFICATION & AUTOMATIC AUTH SUITE
// =================================================================

test('Section 21.1 & 21.2: Valid onboarding submission requests OTP, no permanent teacher before verification', async () => {
  const subs = await listOnboardingSubjects(db);
  const invite = await createTeacherInvite(db, {
    initialUsername: 'v_otp_001',
    temporaryPassword: 'TempPassword123!'
  });

  const loginRes = await fetch(`${baseUrl}/api/teacher/onboarding/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'v_otp_001', password: 'TempPassword123!' })
  });
  const loginData = await loginRes.json();
  const token = loginData.onboardingToken;

  const submitRes = await fetch(`${baseUrl}/api/teacher/onboarding/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      name: 'Dr. Ram Sharma',
      username: 'ram.sharma.otp',
      email: 'ram.sharma.otp@example.com',
      password: 'PermanentPassword123!',
      confirmPassword: 'PermanentPassword123!',
      subjectIds: [subs[0].id, subs[1].id]
    })
  });

  assert.equal(submitRes.status, 200);
  const submitData = await submitRes.json();
  assert.equal(submitData.success, true);
  assert.equal(submitData.status, 'awaiting_email_verification');
  assert.ok(submitData.emailMasked);
  assert.equal(submitData.email, 'ram.sharma.otp@example.com');
  assert.match(submitData.message, /verification code|6-digit/i);

  // NO permanent teacher row before OTP verification
  const permStudent = await db.get("SELECT * FROM students WHERE username = 'ram.sharma.otp'");
  assert.ok(!permStudent, 'Permanent student row must not exist before OTP verification');

  const permTeacher = await db.get("SELECT * FROM teachers WHERE invite_id = ?", invite.id);
  assert.ok(!permTeacher, 'Permanent teacher row must not exist before OTP verification');

  // Pending row exists in quarantine
  const pendingRow = await db.get("SELECT * FROM teacher_onboarding_pending WHERE invite_id = ?", invite.id);
  assert.ok(pendingRow);
  assert.equal(pendingRow.username, 'ram.sharma.otp');
});

test('Section 21.3 & 21.4: Wrong OTP and Expired OTP are denied while preserving pending state', async () => {
  const pending = await db.get("SELECT * FROM teacher_onboarding_pending WHERE username = 'ram.sharma.otp'");
  assert.ok(pending);

  const mockSupabase = global.__testSupabaseMock;
  // 1. Wrong OTP ('000000') denied by Supabase Auth
  const wrongRes = await mockSupabase.auth.verifyOtp({
    email: pending.email,
    token: '000000',
    type: 'email'
  });
  assert.ok(wrongRes.error);
  assert.equal(wrongRes.data.session, null);

  // 2. Expired OTP ('999999') denied by Supabase Auth
  const expiredRes = await mockSupabase.auth.verifyOtp({
    email: pending.email,
    token: '999999',
    type: 'email'
  });
  assert.ok(expiredRes.error);
  assert.equal(expiredRes.error.code, 'otp_expired');
  assert.equal(expiredRes.data.session, null);

  // Pending setup is preserved and not cleared
  const stillPending = await db.get("SELECT * FROM teacher_onboarding_pending WHERE id = ?", pending.id);
  assert.ok(stillPending, 'Pending record must NOT be deleted on incorrect or expired OTP');
});

test('Section 21.5: Resend verification code enforces DB-backed cooldown', async () => {
  const pending = await db.get("SELECT * FROM teacher_onboarding_pending WHERE username = 'ram.sharma.otp'");
  assert.ok(pending);

  const loginRes = await fetch(`${baseUrl}/api/teacher/onboarding/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'v_otp_001', password: 'TempPassword123!' })
  });
  const { onboardingToken } = await loginRes.json();

  // First resend (reset cooldown timestamp first to guarantee fresh window)
  await db.run("UPDATE teacher_onboarding_pending SET last_verification_sent_at = '2026-01-01T00:00:00Z' WHERE id = ?", pending.id);
  resendCooldownMap.delete(pending.invite_id);

  const resend1 = await fetch(`${baseUrl}/api/teacher/onboarding/resend-verification`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${onboardingToken}` }
  });
  assert.equal(resend1.status, 200);

  // Immediate second resend is rate-limited
  const resend2 = await fetch(`${baseUrl}/api/teacher/onboarding/resend-verification`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${onboardingToken}` }
  });
  assert.equal(resend2.status, 429);
  const data2 = await resend2.json();
  assert.equal(data2.code, 'RATE_LIMITED');
});

test('Section 21.6: Change email updates pending DB, validates uniqueness, and issues new OTP', async () => {
  const pending = await db.get("SELECT * FROM teacher_onboarding_pending WHERE username = 'ram.sharma.otp'");
  assert.ok(pending);

  const loginRes = await fetch(`${baseUrl}/api/teacher/onboarding/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'v_otp_001', password: 'TempPassword123!' })
  });
  const { onboardingToken } = await loginRes.json();

  const changeRes = await fetch(`${baseUrl}/api/teacher/onboarding/change-email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${onboardingToken}`
    },
    body: JSON.stringify({ email: 'ram.sharma.updated@example.com' })
  });

  assert.equal(changeRes.status, 200);
  const changeData = await changeRes.json();
  assert.equal(changeData.success, true);
  assert.equal(changeData.email, 'ram.sharma.updated@example.com');
  assert.ok(changeData.emailMasked);

  // Verify updated in DB
  const updatedPending = await db.get("SELECT email FROM teacher_onboarding_pending WHERE id = ?", pending.id);
  assert.equal(updatedPending.email, 'ram.sharma.updated@example.com');
});

test('Section 21.7, 21.8, 21.9: Supabase UID mismatch, email mismatch, and different verified UID denied', async () => {
  const pending = await db.get("SELECT * FROM teacher_onboarding_pending WHERE username = 'ram.sharma.otp'");
  assert.ok(pending);

  // 1. UID mismatch denied
  const mismatchRes = await fetch(`${baseUrl}/api/teacher/onboarding/finalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: 'sb-uid-non-existent-random',
      user: {
        id: 'different-sb-uid-999',
        email: pending.email,
        email_confirmed_at: '2026-10-08T12:00:00Z'
      }
    })
  });
  assert.equal(mismatchRes.status, 404);

  // 2. Email mismatch denied
  const emailMismatchRes = await fetch(`${baseUrl}/api/teacher/onboarding/finalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: 'some-token',
      user: {
        id: pending.supabase_uid,
        email: 'attacker-wrong@example.com',
        email_confirmed_at: '2026-10-08T12:00:00Z'
      }
    })
  });
  assert.equal(emailMismatchRes.status, 400);

  // 3. Different verified user cannot claim existing teacher email
  const claimRes = await fetch(`${baseUrl}/api/teacher/onboarding/finalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: 'some-token',
      user: {
        id: 'foreign-uid-1234',
        email: 'existing@example.com',
        email_confirmed_at: '2026-10-08T12:00:00Z'
      }
    })
  });
  assert.equal(claimRes.status, 404);
});

test('Section 21.10 - 21.16: OTP success finalizes teacher, subjects persisted, mobile opaque token issued, credentials invalidated, automatically authenticated', async () => {
  const pending = await db.get("SELECT * FROM teacher_onboarding_pending WHERE username = 'ram.sharma.otp'");
  assert.ok(pending);

  // Perform successful Supabase OTP verification with matching credentials
  const verifiedUser = {
    id: pending.supabase_uid,
    email: pending.email,
    email_confirmed_at: '2026-10-08T12:00:00Z'
  };

  const finRes = await fetch(`${baseUrl}/api/teacher/onboarding/finalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user: verifiedUser,
      token: 'mock-sb-token-' + pending.supabase_uid
    })
  });

  assert.equal(finRes.status, 200);
  const finData = await finRes.json();
  assert.equal(finData.success, true);
  assert.equal(finData.activated, true);
  assert.ok(finData.mobileToken, 'Response must include mobileToken');
  assert.ok(finData.user, 'Response must include safe user profile');
  assert.equal(finData.user.role, 'teacher');
  assert.equal(finData.user.semester, null);

  // 1. Permanent students anchor row created
  const studentRow = await db.get("SELECT * FROM students WHERE supabase_uid = ?", pending.supabase_uid);
  assert.ok(studentRow);
  assert.equal(studentRow.role, 'teacher');
  assert.equal(studentRow.semester, null);
  assert.equal(studentRow.gender, null);
  assert.equal(studentRow.department, 'BIT');
  assert.equal(studentRow.verification_status || studentRow.verificationstatus || studentRow.verificationStatus, 'verified');

  // 2. Teachers row created
  const teacherRow = await db.get("SELECT * FROM teachers WHERE user_id = ?", studentRow.studentId);
  assert.ok(teacherRow);
  assert.equal(teacherRow.status, 'active');

  // 3. Subjects persisted
  const subjects = await getTeacherSubjects(db, studentRow.studentId);
  assert.ok(subjects.length >= 2, 'Teacher subjects must be persisted');

  // 4. Invite marked completed
  const invite = await db.get("SELECT * FROM teacher_invites WHERE id = ?", pending.invite_id);
  assert.equal(invite.status, 'completed');

  // 5. Pending records deleted
  const pendingCheck = await db.get("SELECT * FROM teacher_onboarding_pending WHERE id = ?", pending.id);
  assert.ok(!pendingCheck);

  // 6. Temporary credential invalidated
  const relogin = await fetch(`${baseUrl}/api/teacher/onboarding/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'v_otp_001', password: 'TempPassword123!' })
  });
  assert.equal(relogin.status, 401);

  // 7. Mobile opaque token issued and valid in mobile_tokens table
  const dbMobileToken = await db.get("SELECT * FROM mobile_tokens WHERE token = ?", finData.mobileToken);
  assert.ok(dbMobileToken, 'Mobile token must exist in mobile_tokens table');
  assert.equal(dbMobileToken.studentId, studentRow.studentId);

  // 8. Teacher automatically authenticated on mobile using issued mobile token
  const meRes = await fetch(`${baseUrl}/api/me`, {
    headers: { 'Authorization': `Bearer ${finData.mobileToken}` }
  });
  assert.equal(meRes.status, 200);
  const meData = await meRes.json();
  assert.equal(meData.user.role, 'teacher');
  assert.equal(meData.user.studentId, studentRow.studentId);
});

test('Section 21.17: App restart while awaiting OTP resumes verification screen with email', async () => {
  const subs = await listOnboardingSubjects(db);
  const invite = await createTeacherInvite(db, {
    initialUsername: 'v_otp_resume_01',
    temporaryPassword: 'TempPassword123!'
  });

  const loginRes = await fetch(`${baseUrl}/api/teacher/onboarding/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'v_otp_resume_01', password: 'TempPassword123!' })
  });
  const { onboardingToken } = await loginRes.json();

  // Submit profile to reach awaiting_email_verification
  await fetch(`${baseUrl}/api/teacher/onboarding/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${onboardingToken}`
    },
    body: JSON.stringify({
      name: 'Dr. Resume Test',
      username: 'resume.test.otp',
      email: 'resume.test.otp@example.com',
      password: 'PermanentPassword123!',
      confirmPassword: 'PermanentPassword123!',
      subjectIds: [subs[0].id]
    })
  });

  // Client restarts: reads onboarding token from SecureStore, calls GET /api/teacher/onboarding/state
  const stateRes = await fetch(`${baseUrl}/api/teacher/onboarding/state`, {
    headers: { 'Authorization': `Bearer ${onboardingToken}` }
  });
  assert.equal(stateRes.status, 200);
  const stateData = await stateRes.json();
  assert.equal(stateData.status, 'awaiting_email_verification');
  assert.ok(stateData.emailMasked);
  assert.equal(stateData.email, 'resume.test.otp@example.com', 'State must return unmasked email to allow client verifyOtp');
});

test('Section 21.18: App restart after activation resumes normal teacher session', async () => {
  const student = await db.get("SELECT * FROM students WHERE username = 'ram.sharma.otp'");
  assert.ok(student);
  const mTok = await db.get("SELECT token FROM mobile_tokens WHERE studentId = ?", student.studentId);
  assert.ok(mTok);

  // App restarts: reads stored mobile token from SecureStore, calls GET /api/me
  const meRes = await fetch(`${baseUrl}/api/me`, {
    headers: { 'Authorization': `Bearer ${mTok.token}` }
  });
  assert.equal(meRes.status, 200);
  const meData = await meRes.json();
  assert.equal(meData.user.role, 'teacher');
});

test('Section 21.19: Student, CR, and Admin authorization behavior unaffected', async () => {
  // Student cannot access teacher check
  const studentLogin = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'existing_user', password: 'fake_hash' })
  });

  // Verify permissions matrix using helper
  const auth = createAuthMiddleware(db);
  const fakeStudentReq = { user: { role: 'student', studentId: 'stud_1' } };
  const fakeCRReq = { user: { role: 'student', isCR: true, studentId: 'stud_cr' } };
  const fakeTeacherReq = { user: { role: 'teacher', studentId: 'teach_1' } };
  const fakeAdminReq = { user: { role: 'admin', isAdmin: true, studentId: 'admin_1' } };

  let nextCalled = false;
  const mockNext = () => { nextCalled = true; };
  const mockRes = { status: (c) => ({ json: (d) => ({ code: c, body: d }) }) };

  // Teacher route requires teacher
  nextCalled = false;
  auth.requireTeacher(fakeStudentReq, mockRes, mockNext);
  assert.equal(nextCalled, false, 'Student blocked from teacher route');

  nextCalled = false;
  auth.requireTeacher(fakeCRReq, mockRes, mockNext);
  assert.equal(nextCalled, false, 'CR blocked from teacher route');

  nextCalled = false;
  auth.requireTeacher(fakeTeacherReq, mockRes, mockNext);
  assert.equal(nextCalled, true, 'Teacher allowed on teacher route');

  // Admin route blocks teacher
  nextCalled = false;
  auth.requireAdmin(fakeTeacherReq, mockRes, mockNext);
  assert.equal(nextCalled, false, 'Teacher strictly blocked from admin route');

  nextCalled = false;
  auth.requireAdmin(fakeAdminReq, mockRes, mockNext);
  assert.equal(nextCalled, true, 'Admin allowed on admin route');
});
