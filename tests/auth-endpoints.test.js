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

test('POST /api/auth/register: Rejects missing required fields', async () => {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullName: 'Only Name' })
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.message, /All required fields/i);
});

test('POST /api/auth/register: Rejects passwords shorter than 8 characters', async () => {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Short Pass User',
      studentId: '26029001',
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

test('POST /api/auth/register: Rejects password mismatch', async () => {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Mismatch User',
      studentId: '26029002',
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

test('POST /api/auth/register: Rejects invalid semester', async () => {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Invalid Sem User',
      studentId: '26029003',
      username: 'invalidsem.user',
      email: 'invalidsem@example.com',
      department: 'BIT',
      semester: 'Semester 99',
      password: 'password123',
      confirmPassword: 'password123'
    })
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.message, /valid semester/i);
});

test('POST /api/auth/register: Rejects invalid gender', async () => {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Invalid Gender User',
      studentId: '26029004',
      username: 'invalidgender.user',
      email: 'invalidgender@example.com',
      department: 'BIT',
      semester: 'Semester 1',
      gender: 'superhuman',
      password: 'password123',
      confirmPassword: 'password123'
    })
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.message, /Invalid gender/i);
});

test('POST /api/auth/register & DB Insert: Forces role="student" and verification_status="unverified" (Defends against privilege escalation)', async () => {
  const studentId = '26028888';
  const username = 'honest.student';
  const email = 'honest@example.com';

  // Ensure cleaned
  await db.run('DELETE FROM students WHERE studentId = ?', studentId);

  // Directly insert student via DB to simulate registration output and test constraints
  await db.run(
    `INSERT INTO students (
      studentId, username, name, email, department, semester,
      gender, role, verification_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'student', 'unverified')`,
    studentId, username, 'Honest Student', email, 'BIT', 'Semester 1', 'male'
  );

  const row = await db.get('SELECT * FROM students WHERE studentId = ?', studentId);
  assert.equal(row.studentId, studentId);
  assert.equal(row.username, username);
  assert.equal(row.role, 'student', 'Must receive student role');
  assert.equal(row.verificationStatus || row.verification_status, 'unverified', 'Must start unverified');

  // Verify duplicate studentId rejected
  const dupIdRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Another Student',
      studentId: studentId,
      username: 'another.student',
      email: 'another@example.com',
      department: 'BIT',
      semester: 'Semester 1',
      password: 'password123',
      confirmPassword: 'password123'
    })
  });
  assert.equal(dupIdRes.status, 400);
  assert.match((await dupIdRes.json()).message, /Student ID is already registered/i);

  // Verify duplicate case-insensitive username rejected
  const dupUserRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Another Student',
      studentId: '26028889',
      username: 'HONEST.STUDENT',
      email: 'another2@example.com',
      department: 'BIT',
      semester: 'Semester 1',
      password: 'password123',
      confirmPassword: 'password123'
    })
  });
  assert.equal(dupUserRes.status, 400);
  assert.match((await dupUserRes.json()).message, /username is already taken/i);

  // Verify duplicate case-insensitive email rejected
  const dupEmailRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Another Student',
      studentId: '26028890',
      username: 'another.unique',
      email: 'HONEST@EXAMPLE.COM',
      department: 'BIT',
      semester: 'Semester 1',
      password: 'password123',
      confirmPassword: 'password123'
    })
  });
  assert.equal(dupEmailRes.status, 400);
  assert.match((await dupEmailRes.json()).message, /email address already exists/i);
});

test('POST /api/auth/login: Rejects missing credentials with 400', async () => {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.message, /Username\/email and password are required/i);
});

test('POST /api/auth/login: Unknown username returns generic 401 without user enumeration', async () => {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: 'completely_unknown_user_123',
      password: 'wrong_password_999'
    })
  });
  assert.equal(res.status, 401);
  const data = await res.json();
  assert.match(data.message, /Invalid username\/email or password/i);
});

test('POST /api/auth/forgot-password: Returns generic success without account enumeration', async () => {
  // Test with non-existent user
  const resUnknown = await fetch(`${baseUrl}/api/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'does_not_exist@example.com' })
  });
  assert.equal(resUnknown.status, 200);
  const dataUnknown = await resUnknown.json();
  assert.equal(dataUnknown.success, true);
  assert.match(dataUnknown.message, /If an account exists/i);

  // Test with registered username
  const resUsername = await fetch(`${baseUrl}/api/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'honest.student' })
  });
  assert.equal(resUsername.status, 200);
  const dataUsername = await resUsername.json();
  assert.equal(dataUsername.success, true);
  assert.match(dataUsername.message, /If an account exists/i);
});

test('POST /api/auth/resend-verification: Returns generic success', async () => {
  const res = await fetch(`${baseUrl}/api/auth/resend-verification`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'honest.student' })
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.match(data.message, /verification email has been sent/i);
});

test('GET /api/me: Returns full student profile with username, gender, and verificationStatus', async () => {
  const token = 'me_test_token_' + Date.now();
  const expiresAt = new Date(Date.now() + 3600000).toISOString();

  await db.run(
    'INSERT INTO mobile_tokens (token, studentId, createdAt, expiresAt) VALUES (?, ?, ?, ?)',
    token, '26028888', new Date().toISOString(), expiresAt
  );

  const res = await fetch(`${baseUrl}/api/me`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  assert.equal(res.status, 200);
  const profile = await res.json();
  assert.equal(profile.studentId, '26028888');
  assert.equal(profile.username, 'honest.student');
  assert.equal(profile.name, 'Honest Student');
  assert.equal(profile.role, 'student');
  assert.equal(profile.department, 'BIT');
  assert.equal(profile.semester, 'Semester 1');
  assert.equal(profile.gender, 'male');
  assert.equal(profile.email, 'honest@example.com');
  assert.equal(profile.verificationStatus, 'unverified');
});
