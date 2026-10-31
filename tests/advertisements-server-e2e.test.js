'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');

const testDbPath = path.join(os.tmpdir(), `ads_server_e2e_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
process.env.NODE_ENV = 'test';
process.env.DB_PATH = testDbPath;
process.env.TEACHER_ONBOARDING_ENABLED = 'false';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const bcrypt = require('bcryptjs');
const app = require('../server');
const db = require('../db');
const { ensurePostsSchema } = require('../lib/posts');
const { ensureAdvertisementsSchema } = require('../lib/advertisements');

let server;
let baseUrl;

const adminPassword = 'AdminPass123!_Ads';
const studentPassword = 'StudentPass123!_Ads';
const teacherPassword = 'TeacherPass123!_Ads';
const crPassword = 'CrPass123!_Ads';

let adminToken = '';
let studentToken = '';
let teacherToken = '';
let crToken = '';

const testPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1S8AAAAASUVORK5CYII=',
  'base64'
);

const testMp4 = Buffer.from(
  '00000018667479706d703432000000006d70343269736f6d000000086d646174',
  'hex'
);

function buildMultipartPayload(fields = {}, files = []) {
  const boundary = '----AdServerE2EBoundary' + Math.random().toString(16).slice(2);
  const chunks = [];

  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    chunks.push(
      Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${key}"\r\n\r\n` +
        `${String(value)}\r\n`
      )
    );
  }

  for (const file of files) {
    const fieldName = file.field || 'file';
    const filename = file.filename || 'upload.png';
    const contentType = file.contentType || 'image/png';
    const dataBuf = Buffer.isBuffer(file.data) ? file.data : Buffer.from(String(file.data || ''));
    chunks.push(
      Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n` +
        `Content-Type: ${contentType}\r\n\r\n`
      )
    );
    chunks.push(dataBuf);
    chunks.push(Buffer.from('\r\n'));
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    buffer: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`
  };
}

test.before(async () => {
  await db.initSchema();
  await ensurePostsSchema(db);
  await ensureAdvertisementsSchema(db);

  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  const hashAdmin = bcrypt.hashSync(adminPassword, 10);
  const hashStudent = bcrypt.hashSync(studentPassword, 10);
  const hashTeacher = bcrypt.hashSync(teacherPassword, 10);
  const hashCr = bcrypt.hashSync(crPassword, 10);

  await db.run(
    `INSERT INTO students (studentId, name, email, role, passwordHash, semester, department, account_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    'admin_e2e_user', 'Ad Admin User', 'admin_e2e@gandaki.edu.np', 'admin', hashAdmin, '1', 'BIT', 'active'
  );

  await db.run(
    `INSERT INTO students (studentId, name, email, role, passwordHash, semester, department, account_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    'student_e2e_user', 'Ad Student User', 'student_e2e@gandaki.edu.np', 'student', hashStudent, '2', 'BIT', 'active'
  );

  await db.run(
    `INSERT INTO students (studentId, name, email, role, passwordHash, semester, department, account_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    'teacher_e2e_user', 'Ad Teacher User', 'teacher_e2e@gandaki.edu.np', 'teacher', hashTeacher, '2', 'BIT', 'active'
  );

  await db.run(
    `INSERT INTO students (studentId, name, email, role, passwordHash, semester, department, account_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    'cr_e2e_user', 'Ad CR User', 'cr_e2e@gandaki.edu.np', 'cr', hashCr, '2', 'BIT', 'active'
  );

  // Authenticate mobile accounts to obtain JWT Bearer tokens
  const login = async (identifier, password) => {
    const res = await fetch(`${baseUrl}/api/mobile/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    return body.token;
  };

  adminToken = await login('admin_e2e_user', adminPassword);
  studentToken = await login('student_e2e_user', studentPassword);
  teacherToken = await login('teacher_e2e_user', teacherPassword);
  crToken = await login('cr_e2e_user', crPassword);
});

test.after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  if (fs.existsSync(testDbPath)) {
    try { fs.unlinkSync(testDbPath); } catch (_) {}
  }
});

test('server.js integration: /api/advertisements/media endpoint registration and admin authorization', async () => {
  const mp = buildMultipartPayload({}, [{ field: 'file', filename: 'banner.png', contentType: 'image/png', data: testPng }]);

  // 1. Unauthenticated request -> 401
  const unauthRes = await fetch(`${baseUrl}/api/advertisements/media`, {
    method: 'POST',
    headers: { 'Content-Type': mp.contentType },
    body: mp.buffer
  });
  assert.equal(unauthRes.status, 401, 'Unauthenticated request must receive 401');

  // 2. Non-admin roles (student, teacher, cr) -> 403 Forbidden
  for (const [role, token] of [['student', studentToken], ['teacher', teacherToken], ['cr', crToken]]) {
    const forbiddenRes = await fetch(`${baseUrl}/api/advertisements/media`, {
      method: 'POST',
      headers: {
        'Content-Type': mp.contentType,
        'Authorization': `Bearer ${token}`
      },
      body: mp.buffer
    });
    assert.equal(forbiddenRes.status, 403, `Non-admin role ${role} must be rejected with 403`);
  }
});

test('server.js integration: admin image and video upload, file_blobs persistence, and immediate retrieval', async () => {
  // 1. Upload Image Creative
  const imgPayload = buildMultipartPayload({}, [{ field: 'file', filename: 'ad_promo.png', contentType: 'image/png', data: testPng }]);
  const imgRes = await fetch(`${baseUrl}/api/advertisements/media`, {
    method: 'POST',
    headers: {
      'Content-Type': imgPayload.contentType,
      'Authorization': `Bearer ${adminToken}`
    },
    body: imgPayload.buffer
  });
  assert.equal(imgRes.status, 201, 'Admin upload must return 201 Created');
  const imgBody = await imgRes.json();
  assert.equal(imgBody.media_type, 'image');
  assert.equal(imgBody.mime_type, 'image/png');
  assert.match(imgBody.url, /^\/uploads\/posts\/[a-f0-9-]+\.png$/);

  // Check file_blobs database table
  const imgBlob = await db.getFileBlob(imgBody.filename);
  assert.ok(imgBlob, 'Uploaded image must exist in file_blobs table');
  assert.deepEqual(imgBlob.fileData, testPng);

  // Immediate retrieval via GET /uploads/posts/:filename
  const imgGetRes = await fetch(`${baseUrl}${imgBody.url}`);
  assert.equal(imgGetRes.status, 200);
  assert.equal(imgGetRes.headers.get('content-type'), 'image/png');
  const imgGetBuf = Buffer.from(await imgGetRes.arrayBuffer());
  assert.deepEqual(imgGetBuf, testPng);

  // 2. Upload Video Creative
  const vidPayload = buildMultipartPayload({}, [{ field: 'file', filename: 'ad_clip.mp4', contentType: 'video/mp4', data: testMp4 }]);
  const vidRes = await fetch(`${baseUrl}/api/advertisements/media`, {
    method: 'POST',
    headers: {
      'Content-Type': vidPayload.contentType,
      'Authorization': `Bearer ${adminToken}`
    },
    body: vidPayload.buffer
  });
  assert.equal(vidRes.status, 201, 'Admin video upload must return 201 Created');
  const vidBody = await vidRes.json();
  assert.equal(vidBody.media_type, 'video');
  assert.equal(vidBody.mime_type, 'video/mp4');
  assert.match(vidBody.url, /^\/uploads\/posts\/[a-f0-9-]+\.mp4$/);

  // Check file_blobs database table
  const vidBlob = await db.getFileBlob(vidBody.filename);
  assert.ok(vidBlob, 'Uploaded video must exist in file_blobs table');
  assert.deepEqual(vidBlob.fileData, testMp4);

  // Immediate retrieval of video via GET /uploads/posts/:filename
  const vidGetRes = await fetch(`${baseUrl}${vidBody.url}`);
  assert.equal(vidGetRes.status, 200);
  assert.equal(vidGetRes.headers.get('content-type'), 'video/mp4');
  const vidGetBuf = Buffer.from(await vidGetRes.arrayBuffer());
  assert.deepEqual(vidGetBuf, testMp4);

  // 3. Create full advertisement referencing the uploaded media
  const createAdRes = await fetch(`${baseUrl}/api/advertisements`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      advertiser_name: 'Coursera Campus',
      advertiser_logo_url: imgBody.url,
      primary_text: 'Level up your software engineering skills with certified courses.',
      headline: 'Free Cloud Computing Certifications',
      description: 'Available for all BIT students',
      media_url: vidBody.url,
      media_type: vidBody.media_type,
      mime_type: vidBody.mime_type,
      cta_label: 'Enroll Now',
      destination_url: 'https://www.coursera.org',
      status: 'active',
      is_active: true
    })
  });
  assert.equal(createAdRes.status, 201);
  const createdAd = await createAdRes.json();
  assert.equal(createdAd.media_url, vidBody.url);
  assert.equal(createdAd.media_type, 'video');

  // 4. Retrieve eligible advertisements as a student
  const eligibleRes = await fetch(`${baseUrl}/api/advertisements/eligible`, {
    headers: { 'Authorization': `Bearer ${studentToken}` }
  });
  assert.equal(eligibleRes.status, 200);
  const eligibleData = await eligibleRes.json();
  const matchedAd = eligibleData.advertisements.find(a => a.id === createdAd.id);
  assert.ok(matchedAd, 'Created advertisement must appear in eligible advertisements feed');
  assert.equal(matchedAd.media_url, vidBody.url);
});

test('server.js integration: ordinary post uploads and retrievals are unaffected', async () => {
  // Student uploads an attachment to /api/posts/attachments
  const postFilePayload = buildMultipartPayload({}, [{ field: 'file', filename: 'student_notes.png', contentType: 'image/png', data: testPng }]);
  const attRes = await fetch(`${baseUrl}/api/posts/attachments`, {
    method: 'POST',
    headers: {
      'Content-Type': postFilePayload.contentType,
      'Authorization': `Bearer ${studentToken}`
    },
    body: postFilePayload.buffer
  });
  assert.equal(attRes.status, 201);
  const attBody = await attRes.json();
  assert.match(attBody.url, /^\/uploads\/posts\/[a-f0-9-]+\.png$/);

  // Student publishes a post with this attachment
  const createPostRes = await fetch(`${baseUrl}/api/posts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${studentToken}`
    },
    body: JSON.stringify({
      content: 'Here are my notes for semester 2!',
      category: 'general',
      attachments: [attBody]
    })
  });
  assert.equal(createPostRes.status, 201);
  const post = await createPostRes.json();
  assert.equal(post.attachment_url, attBody.url);

  // Verify attachment retrieval
  const attGetRes = await fetch(`${baseUrl}${attBody.url}`, {
    headers: { 'Authorization': `Bearer ${studentToken}` }
  });
  assert.equal(attGetRes.status, 200);
  const attBuf = Buffer.from(await attGetRes.arrayBuffer());
  assert.deepEqual(attBuf, testPng);
});
