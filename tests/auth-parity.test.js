const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const db = require('../db');

let server;
let baseUrl;

test.before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.SEMESTER_DB_SKIP_INIT = '1';
  await db.initSchema();

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
});

test('Cross-Parity: Web and Mobile registration payload validation', async () => {
  // Mobile and Web send identical payload keys: fullName, studentId, username, email, department, semester, gender, password, confirmPassword
  const testId = '2602' + Math.floor(1000 + Math.random() * 9000);
  const testUser = 'user_' + Math.floor(1000 + Math.random() * 9000);
  const testEmail = `${testUser}@gmail.com`;

  const payload = {
    fullName: 'Test Parity Student',
    studentId: testId,
    username: testUser,
    email: testEmail,
    department: 'BIT',
    semester: 'Semester 1',
    gender: 'male',
    password: 'securePassword123!',
    confirmPassword: 'securePassword123!'
  };

  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  assert.equal(res.status, 201);
  assert.equal(data.success, true);
  assert.match(data.message, /confirmation email has been sent/i);

  // Verify stored in DB
  const row = await db.get('SELECT * FROM students WHERE studentId = ?', testId);
  assert.ok(row);
  assert.equal(row.studentId, testId);
  assert.equal(row.username, testUser);
  assert.equal(row.email, testEmail);
  assert.equal(row.role, 'student');
  assert.equal(row.verificationStatus || row.verification_status, 'unverified');
});

test('Cross-Parity: Unconfirmed email login produces EMAIL_NOT_CONFIRMED on both web and mobile', async () => {
  // Attempting to log in before verifying email in Supabase
  const testId = '2602' + Math.floor(1000 + Math.random() * 9000);
  const testUser = 'unconf_' + Math.floor(1000 + Math.random() * 9000);
  const testEmail = `${testUser}@example.com`;

  // Register
  await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Unconfirmed Student',
      studentId: testId,
      username: testUser,
      email: testEmail,
      department: 'BIT',
      semester: 'Semester 1',
      password: 'password12345',
      confirmPassword: 'password12345'
    })
  });

  // 1. Web Login attempt (POST /api/auth/login)
  const webRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: testUser, password: 'password12345' })
  });
  const webData = await webRes.json();
  assert.equal(webRes.status, 403);
  assert.equal(webData.code, 'EMAIL_NOT_CONFIRMED');
  assert.match(webData.message, /not been verified yet/i);

  // 2. Mobile Login attempt (POST /api/mobile/login) with studentId
  const mobileRes = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: testId, password: 'password12345' })
  });
  const mobileData = await mobileRes.json();
  assert.equal(mobileRes.status, 403);
  assert.equal(mobileData.code, 'EMAIL_NOT_CONFIRMED');
  assert.match(mobileData.message, /not been verified yet/i);
});

test('Cross-Parity: Mobile login succeeds by studentId, username, and email for active accounts', async () => {
  // Insert a verified test account with known password hash
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync('correctPassword123', 8);
  const sid = '26027777';
  const uname = 'active_student';
  const email = 'active.student@example.com';

  await db.run(
    `INSERT INTO students (studentId, username, name, email, passwordHash, role, department, semester, verification_status)
     VALUES (?, ?, ?, ?, ?, 'student', 'BIT', 'Semester 2', 'verified')
     ON CONFLICT (studentId) DO UPDATE SET passwordHash = EXCLUDED.passwordHash, username = EXCLUDED.username, email = EXCLUDED.email`,
    sid, uname, 'Active Student', email, hash
  );

  // 1. Mobile login by studentId
  const resSid = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: sid, password: 'correctPassword123' })
  });
  assert.equal(resSid.status, 200);
  const dataSid = await resSid.json();
  assert.ok(dataSid.token);
  assert.equal(dataSid.user.studentId, sid);
  assert.equal(dataSid.user.name, 'Active Student');

  // 2. Mobile login by username
  const resUname = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: uname, password: 'correctPassword123' })
  });
  assert.equal(resUname.status, 200);
  const dataUname = await resUname.json();
  assert.ok(dataUname.token);
  assert.equal(dataUname.user.studentId, sid);

  // 3. Mobile login by email
  const resEmail = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: email, password: 'correctPassword123' })
  });
  assert.equal(resEmail.status, 200);
  const dataEmail = await resEmail.json();
  assert.ok(dataEmail.token);
  assert.equal(dataEmail.user.studentId, sid);

  // 4. Mobile login with wrong password
  const resWrong = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: sid, password: 'wrongPassword999' })
  });
  assert.equal(resWrong.status, 401);
  const dataWrong = await resWrong.json();
  assert.match(dataWrong.message, /Invalid username\/email or password/i);

  // 5. Test Bearer token on /api/me
  const resMe = await fetch(`${baseUrl}/api/me`, {
    headers: { 'Authorization': `Bearer ${dataSid.token}` }
  });
  assert.equal(resMe.status, 200);
  const meData = await resMe.json();
  assert.equal(meData.studentId, sid);
  assert.equal(meData.department, 'BIT');
});

test('Cross-Parity: Password recovery accepts studentId on web and mobile', async () => {
  const res = await fetch(`${baseUrl}/api/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: '26027777' })
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
});
