const os = require('os');
const path = require('path');
const testDbPath = path.join(os.tmpdir(), `auth_audit_matrix_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
process.env.NODE_ENV = 'test';
process.env.DB_PATH = testDbPath;
process.env.SEMESTER_DB_SKIP_INIT = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { createAuthMiddleware } = require('../lib/auth-middleware');
const { getSupabaseConfig } = require('../lib/supabase');

let server;
let baseUrl;

test.before(async () => {
  await db.initSchema();

  // Create active cohort for Semester 1 and Semester 2
  const cohortId1 = 'cohort_test_sem1_' + Date.now();
  await db.run(
    `INSERT INTO academic_cohorts (id, currentSemester, slotCode, displayName, status, academicYear)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO NOTHING`,
    cohortId1, 1, 'SEM1_2026', 'Semester 1 Cohort', 'active', '2026'
  ).catch(() => {});

  const app = require('../server');
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;

  // Seed verified test student
  const testHash = bcrypt.hashSync('correctPassword123!', 8);
  await db.run(
    `INSERT INTO students (
      studentId, username, name, email, passwordHash, role, department, semester, gender, verification_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (studentId) DO UPDATE SET
      passwordHash = EXCLUDED.passwordHash,
      verification_status = EXCLUDED.verification_status,
      email = EXCLUDED.email,
      username = EXCLUDED.username`,
    'audit_stu_verified', 'audit.verified', 'Verified Student', 'verified_student@example.com',
    testHash, 'student', 'BIT', 'Semester 1', 'male', 'verified'
  );

  // Seed unverified test student
  await db.run(
    `INSERT INTO students (
      studentId, username, name, email, passwordHash, role, department, semester, gender, verification_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (studentId) DO UPDATE SET
      passwordHash = EXCLUDED.passwordHash,
      verification_status = EXCLUDED.verification_status,
      email = EXCLUDED.email,
      username = EXCLUDED.username`,
    'audit_stu_unverified', 'audit.unverified', 'Unverified Student', 'unverified_student@example.com',
    'supabase_auth', 'student', 'BIT', 'Semester 1', 'female', 'unverified'
  );
});

test.after(async () => {
  if (server) {
    await new Promise(resolve => server.close(resolve));
  }
  await db.close();
});

// 1. Auth Config Security
test('Auth Matrix 1: /api/auth/config exposes only public URL and anon key, never secrets', async () => {
  const res = await fetch(`${baseUrl}/api/auth/config`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.url, 'url must be returned');
  assert.ok(data.key, 'key must be returned');
  assert.equal(data.serviceRoleKey, undefined);
  assert.equal(data.secretKey, undefined);
  assert.equal(data.jwtSecret, undefined);
  assert.equal(data.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(data.SUPABASE_SECRET_KEY, undefined);
});

// 2. Verified Account Login (Mobile / Legacy Bcrypt)
test('Auth Matrix 2: Verified account login succeeds with valid credentials', async () => {
  const res = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'audit.verified', password: 'correctPassword123!' })
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.token, 'Must return mobile bearer token');
  assert.equal(data.user.studentId, 'audit_stu_verified');
  assert.equal(data.user.name, 'Verified Student');
  assert.equal(data.user.verificationStatus, 'verified');
});

// 3. Wrong Password Rejected
test('Auth Matrix 3: Wrong password rejected with 401', async () => {
  const res = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'audit.verified', password: 'WrongPassword999!' })
  });
  assert.equal(res.status, 401);
  const data = await res.json();
  assert.match(data.message, /Invalid username\/email or password/i);
});

// 4. Nonexistent Account Safe Failure
test('Auth Matrix 4: Nonexistent account returns safe generic 401 without enumeration', async () => {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'completely_nonexistent_user', password: 'AnyPassword123!' })
  });
  assert.equal(res.status, 401);
  const data = await res.json();
  assert.match(data.message, /Invalid username\/email or password/i);
});

// 5. Unverified Account Policy Enforced
test('Auth Matrix 5: Unverified account login enforces verification policy', async () => {
  const res = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'audit.unverified', password: 'AnyPassword123!' })
  });
  // Since passwordHash is 'supabase_auth' and Supabase credentials fail or reject unverified,
  // it either fails with 401 or 403 EMAIL_NOT_CONFIRMED, never granting access
  assert.ok([401, 403].includes(res.status));
});

// 6. Signup Field Validations
test('Auth Matrix 6: Signup rejects missing required fields', async () => {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullName: 'Only Name' })
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.message, /All required fields/i);
});

test('Auth Matrix 7: Signup rejects password shorter than 8 characters', async () => {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Short Pass User',
      studentId: '26027101',
      username: 'shortpass.user',
      email: 'shortpass@example.com',
      department: 'BIT',
      semester: 'Semester 1',
      password: '123',
      confirmPassword: '123'
    })
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.message, /at least 8 characters/i);
});

test('Auth Matrix 8: Signup rejects password mismatch', async () => {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Mismatch User',
      studentId: '26027102',
      username: 'mismatch.user',
      email: 'mismatch@example.com',
      department: 'BIT',
      semester: 'Semester 1',
      password: 'password123',
      confirmPassword: 'password456'
    })
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.message, /do not match/i);
});

test('Auth Matrix 9: Signup rejects invalid gender', async () => {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Invalid Gender',
      studentId: '26027103',
      username: 'invalidgender.user',
      email: 'invalidgender@example.com',
      department: 'BIT',
      semester: 'Semester 1',
      gender: 'alien',
      password: 'password123',
      confirmPassword: 'password123'
    })
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.message, /Invalid gender/i);
});

// 7. Duplicate Signup Safe
test('Auth Matrix 10: Duplicate studentId rejected with safe 400', async () => {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Duplicate Student ID',
      studentId: 'audit_stu_verified',
      username: 'unique.user.999',
      email: 'unique999@example.com',
      department: 'BIT',
      semester: 'Semester 1',
      password: 'password123',
      confirmPassword: 'password123'
    })
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.message, /Student ID is already registered/i);
});

test('Auth Matrix 11: Duplicate case-insensitive username rejected with safe 400', async () => {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Duplicate Username',
      studentId: '26027104',
      username: 'AUDIT.VERIFIED',
      email: 'unique998@example.com',
      department: 'BIT',
      semester: 'Semester 1',
      password: 'password123',
      confirmPassword: 'password123'
    })
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.message, /username is already taken/i);
});

test('Auth Matrix 12: Duplicate case-insensitive email rejected with safe 400', async () => {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Duplicate Email',
      studentId: '26027105',
      username: 'unique.user.997',
      email: 'VERIFIED_STUDENT@EXAMPLE.COM',
      department: 'BIT',
      semester: 'Semester 1',
      password: 'password123',
      confirmPassword: 'password123'
    })
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.message, /email address already exists/i);
});

// 8. Forgot Password Generic Privacy
test('Auth Matrix 13: Forgot password request succeeds generically without account enumeration', async () => {
  const res = await fetch(`${baseUrl}/api/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'audit.verified' })
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.match(data.message, /If an account exists/i);

  // Unknown user
  const resUnknown = await fetch(`${baseUrl}/api/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'nonexistent_account@example.com' })
  });
  assert.equal(resUnknown.status, 200);
  const dataUnknown = await resUnknown.json();
  assert.equal(dataUnknown.success, true);
  assert.match(dataUnknown.message, /If an account exists/i);
});

// 9. Resend Verification Safe
test('Auth Matrix 14: Resend verification request returns generic success', async () => {
  const res = await fetch(`${baseUrl}/api/auth/resend-verification`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'audit.unverified' })
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.match(data.message, /verification email has been sent/i);
});

// 10. Mobile Session Persistence and API Authorization
test('Auth Matrix 15: Mobile bearer token persists and authorizes /api/me', async () => {
  const loginRes = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'audit.verified', password: 'correctPassword123!' })
  });
  assert.equal(loginRes.status, 200);
  const { token, user } = await loginRes.json();
  assert.ok(token);

  const meRes = await fetch(`${baseUrl}/api/me`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  assert.equal(meRes.status, 200);
  const me = await meRes.json();
  assert.equal(me.studentId, 'audit_stu_verified');
  assert.equal(me.username, 'audit.verified');
  assert.equal(me.verificationStatus, 'verified');
});

// 11. Mobile Logout Pruning
test('Auth Matrix 16: Mobile logout invalidates token immediately', async () => {
  const loginRes = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'audit.verified', password: 'correctPassword123!' })
  });
  const { token } = await loginRes.json();

  const logoutRes = await fetch(`${baseUrl}/api/mobile/logout`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  assert.equal(logoutRes.status, 200);

  // Subsequent request must be 401
  const afterRes = await fetch(`${baseUrl}/api/me`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  assert.equal(afterRes.status, 401);
});

// 12. Expired Mobile Token Rejection
test('Auth Matrix 17: Expired mobile token rejected and pruned', async () => {
  const expiredToken = 'expired_test_token_' + Date.now();
  const pastDate = new Date(Date.now() - 3600000).toISOString();

  await db.run(
    'INSERT INTO mobile_tokens (token, studentId, createdAt, expiresAt) VALUES (?, ?, ?, ?)',
    expiredToken, 'audit_stu_verified', pastDate, pastDate
  );

  const res = await fetch(`${baseUrl}/api/me`, {
    headers: { 'Authorization': `Bearer ${expiredToken}` }
  });
  assert.equal(res.status, 401);

  // Record must be pruned
  const record = await db.get('SELECT * FROM mobile_tokens WHERE token = ?', expiredToken);
  assert.ok(!record, 'Expired token record must be pruned');
});

// 13. Password Reset Mobile Token Revocation
test('Auth Matrix 18: /api/auth/sync-password-reset revokes existing mobile tokens', async () => {
  // 1. Generate active mobile token
  const tokenToRevoke = 'token_to_be_revoked_' + Date.now();
  const futureDate = new Date(Date.now() + 3600000).toISOString();
  await db.run(
    'INSERT INTO mobile_tokens (token, studentId, createdAt, expiresAt) VALUES (?, ?, ?, ?)',
    tokenToRevoke, 'audit_stu_verified', new Date().toISOString(), futureDate
  );

  // Verify token works
  const checkBefore = await fetch(`${baseUrl}/api/me`, {
    headers: { 'Authorization': `Bearer ${tokenToRevoke}` }
  });
  assert.equal(checkBefore.status, 200);

  // 2. Call /api/auth/sync-password-reset
  const syncRes = await fetch(`${baseUrl}/api/auth/sync-password-reset`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${tokenToRevoke}` }
  });
  assert.equal(syncRes.status, 200);
  const syncData = await syncRes.json();
  assert.equal(syncData.success, true);

  // 3. The token must now be completely revoked
  const checkAfter = await fetch(`${baseUrl}/api/me`, {
    headers: { 'Authorization': `Bearer ${tokenToRevoke}` }
  });
  assert.equal(checkAfter.status, 401);
});

// 14. Verification Status Sync Endpoint
test('Auth Matrix 19: /api/auth/sync-verification marks student verified', async () => {
  const token = 'sync_ver_token_' + Date.now();
  const futureDate = new Date(Date.now() + 3600000).toISOString();
  await db.run(
    'INSERT INTO mobile_tokens (token, studentId, createdAt, expiresAt) VALUES (?, ?, ?, ?)',
    token, 'audit_stu_unverified', new Date().toISOString(), futureDate
  );

  const res = await fetch(`${baseUrl}/api/auth/sync-verification`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  assert.equal(res.status, 200);

  const student = await db.get('SELECT verification_status FROM students WHERE studentId = ?', 'audit_stu_unverified');
  assert.equal(student.verificationStatus || student.verification_status, 'verified');
});

// 15. Role Authorization Gate
test('Auth Matrix 20: requireAdmin strictly validates admin role from database row', async () => {
  const auth = createAuthMiddleware(db);

  const studentReq = { user: { studentId: 'audit_stu_verified', role: 'student' } };
  const studentRes = {
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
  let adminNext = false;
  auth.requireAdmin(studentReq, studentRes, () => { adminNext = true; });
  assert.equal(adminNext, false);
  assert.equal(studentRes.statusCode, 403);
});
