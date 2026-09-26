const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const app = require('../server');
const db = require('../db');
const bcrypt = require('bcryptjs');

let server;
let baseUrl;

test.before(async () => {
  await db.initSchema();

  // Create a dedicated test student
  const testHash = bcrypt.hashSync('testMobilePass123', 10);
  await db.run(
    'INSERT OR REPLACE INTO students (studentId, name, passwordHash, role) VALUES (?, ?, ?, ?)',
    'stu_mobile_test', 'Mobile Student', testHash, 'student'
  );

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
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Mobile Auth: /api/mobile/login rejects missing or wrong credentials', async () => {
  // Missing fields
  const res1 = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: '' })
  });
  assert.equal(res1.status, 400);

  // Wrong password
  const res2 = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: 'stu_mobile_test', password: 'WrongPassword!' })
  });
  assert.equal(res2.status, 401);
});

test('Mobile Auth: /api/mobile/login returns opaque token and user info without Set-Cookie', async () => {
  const res = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: 'stu_mobile_test', password: 'testMobilePass123' })
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.token, 'Must return a token');
  assert.equal(typeof data.token, 'string');
  assert.equal(data.token.length, 64, 'Token must be a 64-character hex string');
  assert.equal(data.user.studentId, 'stu_mobile_test');
  assert.equal(data.user.name, 'Mobile Student');
  assert.equal(data.user.role, 'student');

  // Verify token is stored in database
  const record = await db.get('SELECT * FROM mobile_tokens WHERE token = ?', data.token);
  assert.ok(record, 'Token must be stored in mobile_tokens table');
  assert.equal(record.studentId, 'stu_mobile_test');
});

test('Mobile Auth: GET /api/me requires auth, succeeds with Bearer token, fails without it', async () => {
  // 1. Without token or cookie
  const unauthRes = await fetch(`${baseUrl}/api/me`);
  assert.equal(unauthRes.status, 401);

  // 2. Login to get token
  const loginRes = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: 'stu_mobile_test', password: 'testMobilePass123' })
  });
  const { token } = await loginRes.json();

  // 3. GET /api/me with Bearer token (no cookies)
  const authRes = await fetch(`${baseUrl}/api/me`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  assert.equal(authRes.status, 200);
  const user = await authRes.json();
  assert.equal(user.studentId, 'stu_mobile_test');
  assert.equal(user.name, 'Mobile Student');
  assert.equal(user.role, 'student');
  assert.equal(user.isAdmin, false);
});

test('Mobile Auth: Browser session cookie auth continues to work alongside mobile token auth', async () => {
  // 1. Browser login via /api/login
  const loginRes = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: 'stu_mobile_test', password: 'testMobilePass123' })
  });
  assert.equal(loginRes.status, 200);
  const cookieHeader = loginRes.headers.get('set-cookie');
  assert.ok(cookieHeader, 'Browser login must still set __gu_session cookie');

  const cookieVal = cookieHeader.split(';')[0];

  // 2. Browser calls /api/me with Cookie header
  const meRes = await fetch(`${baseUrl}/api/me`, {
    headers: { 'Cookie': cookieVal }
  });
  assert.equal(meRes.status, 200);
  const user = await meRes.json();
  assert.equal(user.studentId, 'stu_mobile_test');
});

test('Mobile Auth: /api/mobile/logout invalidates the token', async () => {
  // 1. Login
  const loginRes = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: 'stu_mobile_test', password: 'testMobilePass123' })
  });
  const { token } = await loginRes.json();

  // 2. Verify token works
  const beforeRes = await fetch(`${baseUrl}/api/me`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  assert.equal(beforeRes.status, 200);

  // 3. Logout
  const logoutRes = await fetch(`${baseUrl}/api/mobile/logout`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  assert.equal(logoutRes.status, 200);

  // 4. Token must no longer work
  const afterRes = await fetch(`${baseUrl}/api/me`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  assert.equal(afterRes.status, 401);

  // 5. Token must be removed from DB
  const tokenInDb = await db.get('SELECT * FROM mobile_tokens WHERE token = ?', token);
  assert.equal(tokenInDb, null);
});

test('Mobile Auth: Expired token is rejected and pruned', async () => {
  const expiredToken = 'expired_test_token_1234567890abcdef1234567890abcdef1234567890abcdef';
  const pastDate = new Date(Date.now() - 60 * 1000).toISOString();

  await db.run(
    'INSERT OR REPLACE INTO mobile_tokens (token, studentId, createdAt, expiresAt) VALUES (?, ?, ?, ?)',
    expiredToken, 'stu_mobile_test', pastDate, pastDate
  );

  const res = await fetch(`${baseUrl}/api/me`, {
    headers: { 'Authorization': `Bearer ${expiredToken}` }
  });
  assert.equal(res.status, 401);

  // Give asynchronous cleanup a moment
  await new Promise((r) => setTimeout(r, 50));
  const record = await db.get('SELECT * FROM mobile_tokens WHERE token = ?', expiredToken);
  assert.equal(record, null, 'Expired token must be deleted from database');
});
