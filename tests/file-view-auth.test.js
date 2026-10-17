const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('http');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const app = require('../server');
const db = require('../db');

let server;
let baseUrl;
let testStudentId;
let testMobileToken;
let testFileId;
let testFileBuffer;

test.before(async () => {
  await db.initSchema();

  const uniqueSuffix = Date.now();
  testStudentId = 'stu_file_view_test_' + uniqueSuffix;
  const testUsername = 'fileview_' + uniqueSuffix;
  const testEmail = 'fileview_' + uniqueSuffix + '@example.com';
  const testHash = bcrypt.hashSync('testPass123', 10);
  const activeCohort = await db.get("SELECT id FROM cohorts WHERE status = 'active' LIMIT 1").catch(() => null);
  const cohortId = activeCohort ? activeCohort.id : null;

  if (db.isPostgres) {
    await db.run(
      `INSERT INTO students (studentId, username, name, email, passwordHash, role, semester, cohort_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (studentId) DO UPDATE SET passwordHash = EXCLUDED.passwordHash`,
      testStudentId, testUsername, 'File View User', testEmail, testHash, 'student', 'Semester 1', cohortId
    );
  } else {
    await db.run(
      `INSERT INTO students (studentId, username, name, email, passwordHash, role, semester, cohort_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      testStudentId, testUsername, 'File View User', testEmail, testHash, 'student', 'Semester 1', cohortId
    );
  }

  // Create test mobile token
  testMobileToken = 'token_file_view_' + crypto.randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + 3600000).toISOString();
  await db.run(
    'INSERT INTO mobile_tokens (token, studentId, createdAt, expiresAt) VALUES (?, ?, ?, ?)',
    testMobileToken, testStudentId, new Date().toISOString(), expiresAt
  );

  // Create test PDF file fixture
  const uploadDir = path.join(__dirname, '../public/uploads');
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  testFileBuffer = Buffer.from('%PDF-1.4 Mock PDF content for file view tests');
  const fileStoredName = `test_${crypto.randomBytes(8).toString('hex')}.pdf`;
  fs.writeFileSync(path.join(uploadDir, fileStoredName), testFileBuffer);
  await db.saveFileBlob(fileStoredName, testFileBuffer, 'application/pdf');

  const fileRes = await db.run(
    `INSERT INTO files (originalName, storedName, title, semester, subject, chapter, sizeBytes, uploadedBy, uploadedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    'Sample_Document.pdf', fileStoredName, 'Sample Document', 'Semester 1', 'Computer Science', 'Unit 1', testFileBuffer.length, testStudentId
  );
  testFileId = fileRes.lastInsertRowid || fileRes.lastID || (await db.get('SELECT id FROM files WHERE storedName = ?', fileStoredName)).id;

  // Start test server
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

test('File View & Download Authentication Suite', async (t) => {
  let sessionCookie = null;

  await t.test('1. Unauthenticated request to /api/files/:id/view fails with 401 and authentication required message', async () => {
    const res = await fetch(`${baseUrl}/api/files/${testFileId}/view`);
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.equal(data.message, 'Authentication required. Please sign in.');
  });

  await t.test('2. Unauthenticated request to /api/files/:id/download fails with 401 and authentication required message', async () => {
    const res = await fetch(`${baseUrl}/api/files/${testFileId}/download`);
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.equal(data.message, 'Authentication required. Please sign in.');
  });

  await t.test('3. POST /api/auth/sync-session with Bearer token sets __gu_session cookie', async () => {
    const res = await fetch(`${baseUrl}/api/auth/sync-session`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${testMobileToken}`,
        'Content-Type': 'application/json'
      }
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.studentId, testStudentId);

    const setCookie = res.headers.get('set-cookie');
    assert.ok(setCookie, 'Must set __gu_session cookie on sync-session');
    assert.ok(setCookie.includes('__gu_session'), 'Cookie name must be __gu_session');
    sessionCookie = setCookie.split(';')[0];
  });

  await t.test('4. GET /api/files/:id/view with valid __gu_session cookie serves file inline (HTTP 200)', async () => {
    assert.ok(sessionCookie, 'Must have sessionCookie from previous test');
    const res = await fetch(`${baseUrl}/api/files/${testFileId}/view`, {
      headers: {
        'Cookie': sessionCookie
      }
    });
    assert.equal(res.status, 200);
    const contentType = res.headers.get('content-type');
    assert.match(contentType, /pdf/i);
    const buffer = Buffer.from(await res.arrayBuffer());
    assert.equal(buffer.toString('utf8'), testFileBuffer.toString('utf8'));
  });

  await t.test('5. GET /api/files/:id/download with valid __gu_session cookie serves file download (HTTP 200)', async () => {
    assert.ok(sessionCookie, 'Must have sessionCookie');
    const res = await fetch(`${baseUrl}/api/files/${testFileId}/download`, {
      headers: {
        'Cookie': sessionCookie
      }
    });
    assert.equal(res.status, 200);
    const contentDisposition = res.headers.get('content-disposition');
    assert.match(contentDisposition, /attachment/i);
  });

  await t.test('6. GET /api/files/:id/view with ?token= query parameter serves file inline (HTTP 200)', async () => {
    const res = await fetch(`${baseUrl}/api/files/${testFileId}/view?token=${testMobileToken}`);
    assert.equal(res.status, 200);
    const contentType = res.headers.get('content-type');
    assert.match(contentType, /pdf/i);
    const buffer = Buffer.from(await res.arrayBuffer());
    assert.equal(buffer.toString('utf8'), testFileBuffer.toString('utf8'));
  });

  await t.test('7. GET /api/files/:id/download with ?token= query parameter serves file download (HTTP 200)', async () => {
    const res = await fetch(`${baseUrl}/api/files/${testFileId}/download?token=${testMobileToken}`);
    assert.equal(res.status, 200);
    const contentDisposition = res.headers.get('content-disposition');
    assert.match(contentDisposition, /attachment/i);
  });

  await t.test('8. Legacy POST /api/login sets __gu_session cookie and allows subsequent file view without token', async () => {
    const loginRes = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: testStudentId, password: 'testPass123' })
    });
    assert.equal(loginRes.status, 200);
    const cookieHeader = loginRes.headers.get('set-cookie');
    assert.ok(cookieHeader, 'Must set cookie on login');
    const cookieVal = cookieHeader.split(';')[0];

    const viewRes = await fetch(`${baseUrl}/api/files/${testFileId}/view`, {
      headers: { 'Cookie': cookieVal }
    });
    assert.equal(viewRes.status, 200);
  });
});
