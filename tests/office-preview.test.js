const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('http');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const app = require('../server');
const db = require('../db');
const officePreview = require('../lib/office-preview');

let server;
let baseUrl;
let authToken;
let testPptxId;
let testPptxBuffer;
let testNonPptId;

test.before(async () => {
  await db.initSchema();

  // Create test student
  const testHash = bcrypt.hashSync('previewPass123', 10);
  const studentId = 'stu_office_test_' + Date.now();
  if (db.isPostgres) {
    await db.run(
      `INSERT INTO students (studentId, name, passwordHash, role)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (studentId) DO UPDATE SET passwordHash = EXCLUDED.passwordHash`,
      studentId, 'Office Test Student', testHash, 'student'
    );
  } else {
    await db.run(
      'INSERT OR REPLACE INTO students (studentId, name, passwordHash, role) VALUES (?, ?, ?, ?)',
      studentId, 'Office Test Student', testHash, 'student'
    );
  }

  // Create test PPTX file fixture
  const uploadDir = path.join(__dirname, '../public/uploads');
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  // Mock valid binary PPTX content (PK zip header signature 50 4B 03 04)
  testPptxBuffer = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00, 0x54, 0x65, 0x73, 0x74, 0x50, 0x50, 0x54, 0x58]);
  const pptxStoredName = `test_${crypto.randomBytes(8).toString('hex')}.pptx`;
  fs.writeFileSync(path.join(uploadDir, pptxStoredName), testPptxBuffer);
  await db.saveFileBlob(pptxStoredName, testPptxBuffer, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');

  const pptxRes = await db.run(
    `INSERT INTO files (originalName, storedName, title, semester, subject, chapter, sizeBytes, uploadedBy, uploadedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    'Lecture_Deck.pptx', pptxStoredName, 'Lecture Deck', 'Semester 1', 'Computer Science', 'Unit 1', testPptxBuffer.length, studentId
  );
  testPptxId = pptxRes.lastInsertRowid || pptxRes.lastID || (await db.get('SELECT id FROM files WHERE storedName = ?', pptxStoredName)).id;

  // Create non-office file fixture (.txt)
  const txtBuffer = Buffer.from('Plain text note content');
  const txtStoredName = `test_${crypto.randomBytes(8).toString('hex')}.txt`;
  fs.writeFileSync(path.join(uploadDir, txtStoredName), txtBuffer);
  await db.saveFileBlob(txtStoredName, txtBuffer, 'text/plain');

  const txtRes = await db.run(
    `INSERT INTO files (originalName, storedName, title, semester, subject, chapter, sizeBytes, uploadedBy, uploadedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    'Notes.txt', txtStoredName, 'Plain Note', 'Semester 1', 'Computer Science', 'Unit 1', txtBuffer.length, studentId
  );
  testNonPptId = txtRes.lastInsertRowid || txtRes.lastID || (await db.get('SELECT id FROM files WHERE storedName = ?', txtStoredName)).id;

  // Start HTTP test server
  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  // Login as student
  const loginRes = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId, password: 'previewPass123' })
  });
  assert.equal(loginRes.status, 200, 'Mobile login must succeed');
  const loginData = await loginRes.json();
  authToken = loginData.token;
});

test.after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Office Preview Token & Endpoint Security Verification', { timeout: 120000 }, async (t) => {
  let generatedPreviewUrl;
  let parsedUrl;

  await t.test('1. Authenticated user can generate PPTX preview URL', async () => {
    const res = await fetch(`${baseUrl}/api/files/${testPptxId}/office-preview-url`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    assert.equal(res.status, 200, 'Authenticated request must return 200');
    const data = await res.json();

    assert.ok(data.previewFileUrl, 'Must return previewFileUrl');
    assert.ok(data.expiresAt, 'Must return expiresAt ISO string');
    assert.ok(data.expires, 'Must return numeric expires timestamp');

    generatedPreviewUrl = data.previewFileUrl;
    parsedUrl = new URL(generatedPreviewUrl);
    assert.match(parsedUrl.pathname, new RegExp(`/api/files/${testPptxId}/office-public`));
    assert.ok(parsedUrl.searchParams.get('expires'), 'Must have expires query param');
    assert.ok(parsedUrl.searchParams.get('signature'), 'Must have signature query param');
  });

  await t.test('2. Unauthenticated user cannot generate preview URL', async () => {
    const res = await fetch(`${baseUrl}/api/files/${testPptxId}/office-preview-url`);
    assert.equal(res.status, 401, 'Unauthenticated request must return 401');
    const data = await res.json();
    assert.match(data.message, /authentication/i);
  });

  await t.test('3. Valid signed URL returns HTTP 200 without authentication', async () => {
    // Note: Request is sent directly without ANY auth cookies or headers, mimicking Microsoft crawler
    const publicPath = parsedUrl.pathname + parsedUrl.search;
    const res = await fetch(`${baseUrl}${publicPath}`);
    assert.equal(res.status, 200, 'Unauthenticated request with valid signature must return 200 OK');
  });

  await t.test('4. Returned MIME type is PPTX and Content-Disposition is inline', async () => {
    const publicPath = parsedUrl.pathname + parsedUrl.search;
    const res = await fetch(`${baseUrl}${publicPath}`);
    assert.equal(res.status, 200);
    const contentType = res.headers.get('content-type');
    assert.equal(contentType, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    const contentDisposition = res.headers.get('content-disposition');
    assert.match(contentDisposition, /inline/);
    assert.match(contentDisposition, /Lecture_Deck\.pptx/);
  });

  await t.test('5. Invalid signature returns 403', async () => {
    const publicPath = `${parsedUrl.pathname}?expires=${parsedUrl.searchParams.get('expires')}&signature=bad_signature_12345`;
    const res = await fetch(`${baseUrl}${publicPath}`);
    assert.equal(res.status, 403, 'Tampered signature must be rejected with 403');
  });

  await t.test('6. Expired signature returns 403', async () => {
    // Generate signature for timestamp in the past
    const expiredTime = Date.now() - (60 * 1000); // 1 minute ago
    const expiredSig = officePreview.signOfficePreviewPayload(testPptxId, expiredTime);
    const publicPath = `/api/files/${testPptxId}/office-public?expires=${expiredTime}&signature=${expiredSig}`;
    const res = await fetch(`${baseUrl}${publicPath}`);
    assert.equal(res.status, 403, 'Expired URL must return 403');
    const data = await res.json();
    assert.match(data.message, /expired/i);
  });

  await t.test('7. Wrong file ID with copied signature returns 403', async () => {
    // Attempt to access a different file using the signature issued for testPptxId
    const otherFileId = testPptxId + 999;
    const publicPath = `/api/files/${otherFileId}/office-public?expires=${parsedUrl.searchParams.get('expires')}&signature=${parsedUrl.searchParams.get('signature')}`;
    const res = await fetch(`${baseUrl}${publicPath}`);
    assert.equal(res.status, 403, 'Signature copied to another file ID must fail with 403');
  });

  await t.test('8. Nonexistent file returns 404 when signature matches nonexistent ID', async () => {
    const nonExistentId = 987654;
    const expires = Date.now() + 60000;
    const sig = officePreview.signOfficePreviewPayload(nonExistentId, expires);
    const publicPath = `/api/files/${nonExistentId}/office-public?expires=${expires}&signature=${sig}`;
    const res = await fetch(`${baseUrl}${publicPath}`);
    assert.equal(res.status, 404, 'Nonexistent file with valid signature must return 404');
  });

  await t.test('9. Unsupported file type rejected with 400', async () => {
    // Attempt to generate preview URL for a .txt file
    const res = await fetch(`${baseUrl}/api/files/${testNonPptId}/office-preview-url`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    assert.equal(res.status, 400, 'Unsupported file format must return 400');
    const data = await res.json();
    assert.match(data.message, /not supported/i);
  });

  await t.test('10. File bytes returned exactly match stored file', async () => {
    const publicPath = parsedUrl.pathname + parsedUrl.search;
    const res = await fetch(`${baseUrl}${publicPath}`);
    assert.equal(res.status, 200);
    const arrayBuffer = await res.arrayBuffer();
    const downloadedBuffer = Buffer.from(arrayBuffer);
    assert.equal(downloadedBuffer.length, testPptxBuffer.length, 'File size must match');
    assert.ok(downloadedBuffer.equals(testPptxBuffer), 'File content bytes must match exactly');
  });

  await t.test('11. Security: Tampering fileId or expires in query string without recomputing HMAC fails', async () => {
    const originalExpires = parsedUrl.searchParams.get('expires');
    const originalSig = parsedUrl.searchParams.get('signature');

    // Tamper with expires (+1000ms)
    const tamperedExpires = String(Number(originalExpires) + 1000);
    const res1 = await fetch(`${baseUrl}/api/files/${testPptxId}/office-public?expires=${tamperedExpires}&signature=${originalSig}`);
    assert.equal(res1.status, 403, 'Tampered expiry must be rejected with 403');

    // Tamper with path ID
    const res2 = await fetch(`${baseUrl}/api/files/${testPptxId + 1}/office-public?expires=${originalExpires}&signature=${originalSig}`);
    assert.equal(res2.status, 403, 'Tampered file ID in URL must be rejected with 403');
  });
});
