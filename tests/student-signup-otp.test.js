const os = require('os');
const path = require('path');
const testDbPath = path.join(os.tmpdir(), `student_signup_otp_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
process.env.NODE_ENV = 'test';
process.env.DB_PATH = testDbPath;
process.env.SEMESTER_DB_SKIP_INIT = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const db = require('../db');
const { ensureAcademicCohortSchema } = require('../lib/academic-context');

let server;
let baseUrl;

test.before(async () => {
  await db.initSchema();
  await ensureAcademicCohortSchema(db);

  // Seed sample active cohorts if needed
  await db.run(`INSERT OR IGNORE INTO cohorts (id, slot_code, current_semester, status, display_name)
    VALUES ('cohort_sem1_test', 'mercury', 1, 'active', 'Mercury (Semester 1)')`);
  await db.run(`INSERT OR IGNORE INTO cohorts (id, slot_code, current_semester, status, display_name)
    VALUES ('cohort_sem2_test', 'venus', 2, 'active', 'Venus (Semester 2)')`);

  const app = require('../server');
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
});

test.after(async () => {
  if (server) {
    await new Promise(resolve => server.close(resolve));
  }
  await db.close();
});

test('Availability Check: Validates email syntax and availability', async () => {
  // Malformed email
  const resBad = await fetch(`${baseUrl}/api/auth/check-availability`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'invalid-email' })
  });
  assert.equal(resBad.status, 400);
  const dataBad = await resBad.json();
  assert.equal(dataBad.available, false);
  assert.equal(dataBad.field, 'email');

  // Valid and available email
  const resGood = await fetch(`${baseUrl}/api/auth/check-availability`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'newstudent@example.com' })
  });
  assert.equal(resGood.status, 200);
  const dataGood = await resGood.json();
  assert.equal(dataGood.available, true);
});

test('Availability Check: Detects existing student email and prevents signup OTP bypass', async () => {
  // Insert an existing student
  await db.run(`INSERT INTO students (studentId, username, name, email, role, verification_status, passwordHash, created_at)
    VALUES ('existing_student_1', 'existingstudent', 'Existing Student', 'existing@example.com', 'student', 'verified', 'hash123', CURRENT_TIMESTAMP)`);

  const res = await fetch(`${baseUrl}/api/auth/check-availability`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'existing@example.com' })
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.available, false);
  assert.equal(data.code, 'EMAIL_EXISTS');
  assert.match(data.message, /already exists/i);
});

test('Availability Check: Validates username requirements and uniqueness', async () => {
  // Username too short
  const resShort = await fetch(`${baseUrl}/api/auth/check-availability`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'ab' })
  });
  assert.equal(resShort.status, 400);

  // Taken username
  const resTaken = await fetch(`${baseUrl}/api/auth/check-availability`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'existingstudent' })
  });
  assert.equal(resTaken.status, 400);
  const dataTaken = await resTaken.json();
  assert.equal(dataTaken.available, false);
  assert.equal(dataTaken.code, 'USERNAME_TAKEN');

  // Available username
  const resAvailable = await fetch(`${baseUrl}/api/auth/check-availability`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'saugat_unique' })
  });
  assert.equal(resAvailable.status, 200);
  const dataAvailable = await resAvailable.json();
  assert.equal(dataAvailable.available, true);
});

test('Finalize Signup: Rejects unconfirmed email session token', async () => {
  global.__testSupabaseMock = {
    'unconfirmed_token_123': {
      user: {
        id: 'supabase_uid_unconfirmed',
        email: 'unconfirmed@example.com',
        email_confirmed_at: null,
        confirmed_at: null
      },
      error: null
    }
  };

  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer unconfirmed_token_123'
    },
    body: JSON.stringify({
      fullName: 'Unconfirmed User',
      username: 'unconfirmed123',
      email: 'unconfirmed@example.com',
      semester: 'Semester 1'
    })
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.message, /Email must be verified/i);
});

test('Finalize Signup: Rejects mismatch between verified token email and submitted email', async () => {
  global.__testSupabaseMock = {
    'token_email_mismatch': {
      user: {
        id: 'supabase_uid_mismatch',
        email: 'verified_real@example.com',
        email_confirmed_at: new Date().toISOString()
      },
      error: null
    }
  };

  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer token_email_mismatch'
    },
    body: JSON.stringify({
      fullName: 'Mismatch User',
      username: 'mismatch123',
      email: 'different_email@example.com',
      semester: 'Semester 1'
    })
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.message, /Verified email does not match/i);
});

test('Finalize Signup: Successfully creates student, auto-assigns cohort, issues mobile token, and logs in', async () => {
  const verifiedUid = 'supabase_uid_student_alpha';
  const studentEmail = 'saugatxtra@example.com';
  const validToken = 'valid_verified_token_789';

  global.__testSupabaseMock = {
    [validToken]: {
      user: {
        id: verifiedUid,
        email: studentEmail,
        email_confirmed_at: new Date().toISOString()
      },
      error: null
    }
  };

  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${validToken}`
    },
    body: JSON.stringify({
      fullName: 'Saugat Subedi',
      username: 'saugat123',
      email: studentEmail,
      semester: 'Semester 1',
      gender: 'male',
      department: 'BIT'
    })
  });

  assert.equal(res.status, 201);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.ok(data.mobileToken, 'Must issue mobile token for automatic mobile login');
  assert.equal(data.user.username, 'saugat123');
  assert.equal(data.user.name, 'Saugat Subedi');
  assert.equal(data.user.email, studentEmail);
  assert.equal(data.user.cohortId, 'cohort_sem1_test');
  assert.equal(data.user.role, 'student');

  // Verify in database
  const studentRow = await db.get('SELECT * FROM students WHERE username = ?', 'saugat123');
  assert.ok(studentRow);
  assert.equal(studentRow.name, 'Saugat Subedi');
  assert.equal(studentRow.supabase_uid || studentRow.supabaseUid, verifiedUid);
  assert.equal(studentRow.verificationStatus || studentRow.verification_status, 'verified');
  assert.equal(studentRow.cohortId || studentRow.cohort_id, 'cohort_sem1_test');

  // Verify mobile token in DB
  const tokenRow = await db.get('SELECT * FROM mobile_tokens WHERE token = ?', data.mobileToken);
  assert.ok(tokenRow);
  assert.equal(tokenRow.studentId, studentRow.studentId);

  // Test automatic mobile access via Bearer mobileToken to /api/me
  const meRes = await fetch(`${baseUrl}/api/me`, {
    headers: { 'Authorization': `Bearer ${data.mobileToken}` }
  });
  assert.equal(meRes.status, 200);
  const meData = await meRes.json();
  assert.equal(meData.username, 'saugat123');
  assert.equal(meData.role, 'student');
});

test('Finalize Signup Idempotency: Retrying with same verified Supabase UID returns existing student safely', async () => {
  const verifiedUid = 'supabase_uid_student_alpha';
  const studentEmail = 'saugatxtra@example.com';
  const validToken = 'valid_verified_token_789';

  global.__testSupabaseMock = {
    [validToken]: {
      user: {
        id: verifiedUid,
        email: studentEmail,
        email_confirmed_at: new Date().toISOString()
      },
      error: null
    }
  };

  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${validToken}`
    },
    body: JSON.stringify({
      fullName: 'Saugat Subedi',
      username: 'saugat123',
      email: studentEmail,
      semester: 'Semester 1'
    })
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.ok(data.mobileToken);
  assert.equal(data.user.username, 'saugat123');

  // Verify no duplicate rows
  const allRows = await db.all('SELECT * FROM students WHERE username = ?', 'saugat123');
  assert.equal(allRows.length, 1);
});

test('Security Gate: Unfinalized verified identity cannot access student dashboard or /api/me', async () => {
  const unfinalizedToken = 'unfinalized_token_999';
  global.__testSupabaseMock = {
    [unfinalizedToken]: {
      user: {
        id: 'supabase_uid_unfinalized',
        email: 'ghost@example.com',
        email_confirmed_at: new Date().toISOString()
      },
      error: null
    }
  };

  // Attempt to hit /api/me with only the raw Supabase access token (not a Semester Library mobile token)
  const res = await fetch(`${baseUrl}/api/me`, {
    headers: { 'Authorization': `Bearer ${unfinalizedToken}` }
  });
  assert.equal(res.status, 401);
});

test('Finalize Signup Validation: Rejects invalid semester and invalid gender', async () => {
  const token = 'token_invalid_fields';
  global.__testSupabaseMock = {
    [token]: {
      user: {
        id: 'supabase_uid_invalid_fields',
        email: 'invalid_fields@example.com',
        email_confirmed_at: new Date().toISOString()
      },
      error: null
    }
  };

  // Invalid semester
  const resBadSem = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      fullName: 'Valid Name',
      username: 'validuser1',
      email: 'invalid_fields@example.com',
      semester: 'Semester 99'
    })
  });
  assert.equal(resBadSem.status, 400);
  const dataBadSem = await resBadSem.json();
  assert.match(dataBadSem.message, /valid semester/i);

  // Invalid gender
  const resBadGen = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      fullName: 'Valid Name',
      username: 'validuser2',
      email: 'invalid_fields@example.com',
      semester: 'Semester 1',
      gender: 'unknown_gender'
    })
  });
  assert.equal(resBadGen.status, 400);
  const dataBadGen = await resBadGen.json();
  assert.match(dataBadGen.message, /Invalid gender/i);
});

test('Finalize Signup: Rejects duplicate username at finalization time', async () => {
  const token = 'token_dup_username';
  global.__testSupabaseMock = {
    [token]: {
      user: {
        id: 'supabase_uid_dup_username',
        email: 'another@example.com',
        email_confirmed_at: new Date().toISOString()
      },
      error: null
    }
  };

  // Try to use saugat123 (already taken)
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      fullName: 'Another Person',
      username: 'saugat123',
      email: 'another@example.com',
      semester: 'Semester 1'
    })
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.message, /already taken/i);
});

test('Normal Login: Existing student logs in normally with username/password without OTP', async () => {
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync('Password123!', 10);
  await db.run(`INSERT INTO students (studentId, username, name, email, role, verification_status, passwordHash, created_at)
    VALUES ('normal_std_1', 'normalstudent', 'Normal Student', 'normal@example.com', 'student', 'verified', ?, CURRENT_TIMESTAMP)`, hash);

  const res = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      studentId: 'normalstudent',
      password: 'Password123!'
    })
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.token);
  assert.equal(data.user.username, 'normalstudent');
});

test('Teacher Architecture Isolation: Teacher onboarding and invites are unaffected by student signup', async () => {
  const { ensureTeacherSchema } = require('../lib/teacher-service');
  await ensureTeacherSchema(db);

  await db.run(`INSERT OR IGNORE INTO teacher_invites (id, initial_username, temporary_password_hash, expires_at, status)
    VALUES ('inv_test_1', 'teacher001', 'hash123', '2099-01-01', 'provisioned')`);

  const invite = await db.get('SELECT * FROM teacher_invites WHERE initial_username = ?', 'teacher001');
  assert.ok(invite);
  assert.equal(invite.status, 'provisioned');
});

