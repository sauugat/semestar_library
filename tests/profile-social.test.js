// Test isolation: unique temp file DB — clean schema every run, no persistent state
// NOTE: @libsql/client's :memory: mode is unstable with batch exec; use a temp file instead
const os = require('os');
const path = require('path');
const fs = require('fs');
const testDbPath = path.join(os.tmpdir(), `profile_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
process.env.NODE_ENV = 'test';
process.env.DB_PATH = testDbPath;

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const db = require('../db');

let server;
let baseUrl;

// Sample 1x1 transparent PNG buffer
const validPngBuffer = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

const studentA = {
  studentId: 'prof_alice',
  name: 'Student Alice',
  username: 'alice_prof',
  email: 'alice@test.example',
  role: 'student',
  department: 'BIT',
  semester: 'Semester 4',
  bio: 'Alice bio description'
};

const studentB = {
  studentId: 'prof_bob',
  name: 'Student Bob',
  username: 'bob_prof',
  email: 'bob@test.example',
  role: 'cr',
  department: 'BIT',
  semester: 'Semester 4',
  bio: 'Bob bio description'
};

const tokenA = 'tok_alice_profile_test';
const tokenB = 'tok_bob_profile_test';

test.before(async () => {
  process.env.SEMESTER_DB_SKIP_INIT = '1';
  await db.initSchema();

  const app = require('../server');
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;

  // Seed students A and B (in-memory DB: fresh schema, passwordHash is nullable)
  await db.run(
    `INSERT INTO students (studentId, name, username, email, role, department, semester, bio)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    studentA.studentId, studentA.name, studentA.username, studentA.email, studentA.role, studentA.department, studentA.semester, studentA.bio
  );
  await db.run(
    `INSERT INTO students (studentId, name, username, email, role, department, semester, bio)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    studentB.studentId, studentB.name, studentB.username, studentB.email, studentB.role, studentB.department, studentB.semester, studentB.bio
  );

  const expiresAt = new Date(Date.now() + 86400000).toISOString();
  await db.run(
    'INSERT INTO mobile_tokens (token, studentId, createdAt, expiresAt) VALUES (?, ?, ?, ?)',
    tokenA, studentA.studentId, new Date().toISOString(), expiresAt
  );
  await db.run(
    'INSERT INTO mobile_tokens (token, studentId, createdAt, expiresAt) VALUES (?, ?, ?, ?)',
    tokenB, studentB.studentId, new Date().toISOString(), expiresAt
  );
});

test.after(async () => {
  if (server) {
    await new Promise(resolve => server.close(resolve));
  }
  // Clean up temp test database file
  try { fs.unlinkSync(testDbPath); } catch (_) {}
});

// 1. Own profile load
test('GET /api/profile: Own profile loads successfully and includes private email and isSelf=true', async () => {
  const res = await fetch(`${baseUrl}/api/profile`, {
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.studentId, studentA.studentId);
  assert.equal(data.name, studentA.name);
  assert.equal(data.email, studentA.email);
  assert.equal(data.isSelf, true);
  assert.ok(data.stats, 'Profile must have stats');
  assert.equal(typeof data.stats.postsCount, 'number');
  assert.equal(typeof data.stats.photosCount, 'number');
  assert.equal(typeof data.stats.filesCount, 'number');
});

// 2. Other student profile load
test('GET /api/profile/:studentId: Other student profile loads with isSelf=false', async () => {
  const res = await fetch(`${baseUrl}/api/profile/${studentB.studentId}`, {
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.studentId, studentB.studentId);
  assert.equal(data.name, studentB.name);
  assert.equal(data.isSelf, false);
});

// 3. Privacy boundary: private fields never exposed on public profile
test('Privacy boundary: Other student profile NEVER exposes email, passwordHash, or tokens', async () => {
  const res = await fetch(`${baseUrl}/api/profile/${studentB.studentId}`, {
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.email, undefined, 'Public profile must NOT expose email address');
  assert.equal(data.passwordHash, undefined, 'Must not expose passwordHash');
  assert.equal(data.supabase_uid, undefined, 'Must not expose supabase_uid');
  assert.equal(data.token, undefined, 'Must not expose tokens');
});

// 4. Avatar upload
test('POST /api/profile/avatar: Successfully uploads and persists profile picture', async () => {
  const form = new FormData();
  form.append('avatar', new Blob([validPngBuffer], { type: 'image/png' }), 'avatar.png');

  const res = await fetch(`${baseUrl}/api/profile/avatar`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` },
    body: form
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.avatarUrl, 'Must return avatarUrl');
  assert.match(data.avatarUrl, /^\/api\/avatar\//);

  // Check database updated
  const row = await db.get('SELECT avatarUrl FROM students WHERE studentId = ?', studentA.studentId);
  assert.equal(row.avatarUrl, data.avatarUrl);
});

// 5. Avatar replacement cleans up old blob
test('POST /api/profile/avatar: Replacing avatar removes previous custom avatar blob', async () => {
  const firstAvatar = (await db.get('SELECT avatarUrl FROM students WHERE studentId = ?', studentA.studentId)).avatarUrl;
  const oldFilename = path.basename(firstAvatar);

  const form = new FormData();
  form.append('avatar', new Blob([validPngBuffer], { type: 'image/png' }), 'avatar2.png');

  const res = await fetch(`${baseUrl}/api/profile/avatar`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` },
    body: form
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.notEqual(data.avatarUrl, firstAvatar);

  // Old blob should be deleted
  const oldBlob = await db.getFileBlob(oldFilename);
  assert.equal(oldBlob, null, 'Old avatar blob must be pruned on replacement');
});

// 6. Avatar removal
test('DELETE /api/profile/avatar: Removes avatar from profile and sets avatarUrl to null', async () => {
  const currentAvatar = (await db.get('SELECT avatarUrl FROM students WHERE studentId = ?', studentA.studentId)).avatarUrl;
  const filename = path.basename(currentAvatar);

  const res = await fetch(`${baseUrl}/api/profile/avatar`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert.equal(res.status, 200);

  const row = await db.get('SELECT avatarUrl FROM students WHERE studentId = ?', studentA.studentId);
  assert.equal(row.avatarUrl, null);

  const blob = await db.getFileBlob(filename);
  assert.equal(blob, null, 'Avatar blob must be deleted when avatar is removed');
});

// 7. Cover upload
test('POST /api/profile/cover: Uploads and persists cover photo with secure blob', async () => {
  const form = new FormData();
  form.append('cover', new Blob([validPngBuffer], { type: 'image/png' }), 'cover.png');
  form.append('coverPosition', JSON.stringify({ y: 0.5 }));

  const res = await fetch(`${baseUrl}/api/profile/cover`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` },
    body: form
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.coverUrl, 'Must return coverUrl');
  assert.match(data.coverUrl, /^\/api\/cover\//);

  const row = await db.get('SELECT coverUrl, coverPosition FROM students WHERE studentId = ?', studentA.studentId);
  assert.equal(row.coverUrl, data.coverUrl);
});

// 8. Cover reposition
test('POST /api/profile/cover/position: Updates cover vertical reposition metadata', async () => {
  const res = await fetch(`${baseUrl}/api/profile/cover/position`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenA}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ position: { y: 0.25 } })
  });
  assert.equal(res.status, 200);

  const row = await db.get('SELECT coverPosition FROM students WHERE studentId = ?', studentA.studentId);
  const parsed = JSON.parse(row.coverPosition);
  assert.equal(parsed.y, 0.25);
});

// 9. Cover replacement cleans up old blob
test('POST /api/profile/cover: Replacing cover removes previous cover blob', async () => {
  const rowA = await db.get('SELECT coverUrl FROM students WHERE studentId = ?', studentA.studentId);
  const firstCover = rowA.coverUrl;
  assert.ok(firstCover, 'First cover must exist before replacement');
  const oldFilename = path.basename(firstCover);

  const form = new FormData();
  form.append('cover', new Blob([validPngBuffer], { type: 'image/png' }), 'new_cover.png');

  const res = await fetch(`${baseUrl}/api/profile/cover`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` },
    body: form
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.notEqual(data.coverUrl, firstCover);

  const oldBlob = await db.getFileBlob(oldFilename);
  assert.equal(oldBlob, null, 'Old cover blob must be cleaned up on replacement');
});

// 10. Cover removal
test('DELETE /api/profile/cover: Removes cover photo and resets position', async () => {
  const rowA = await db.get('SELECT coverUrl FROM students WHERE studentId = ?', studentA.studentId);
  const currentCover = rowA.coverUrl;
  assert.ok(currentCover, 'Cover must exist before removal');
  const filename = path.basename(currentCover);

  const res = await fetch(`${baseUrl}/api/profile/cover`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert.equal(res.status, 200);

  const row = await db.get('SELECT coverUrl, coverPosition FROM students WHERE studentId = ?', studentA.studentId);
  assert.equal(row.coverUrl, null);
  assert.equal(row.coverPosition, null);

  const blob = await db.getFileBlob(filename);
  assert.equal(blob, null, 'Cover blob must be pruned on deletion');
});

// 11. Unauthorized cover/avatar modification rejected
test('Unauthorized profile modification: Requests without token are rejected with 401', async () => {
  const avatarRes = await fetch(`${baseUrl}/api/profile/avatar`, { method: 'DELETE' });
  assert.equal(avatarRes.status, 401);

  const coverRes = await fetch(`${baseUrl}/api/profile/cover`, { method: 'DELETE' });
  assert.equal(coverRes.status, 401);
});

// 12. Posts tab
test('GET /api/profile/:studentId/posts: Returns student posts in descending chronological order', async () => {
  // Create a post for student A
  const pRes = await fetch(`${baseUrl}/api/posts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenA}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ content: 'Post by Alice for profile test' })
  });
  assert.equal(pRes.status, 201);
  const created = await pRes.json();

  const res = await fetch(`${baseUrl}/api/profile/${studentA.studentId}/posts`, {
    headers: { Authorization: `Bearer ${tokenB}` }
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data.posts));
  const found = data.posts.find(p => p.id === created.id);
  assert.ok(found, 'Created post must be returned in student profile posts');
  assert.equal(found.content, 'Post by Alice for profile test');
});

// 13. Photos tab
test('GET /api/profile/:studentId/photos: Returns clean list of image attachments uploaded through posts', async () => {
  // Upload attachment for student A
  const form = new FormData();
  form.append('file', new Blob([validPngBuffer], { type: 'image/png' }), 'photo_test.png');
  const upRes = await fetch(`${baseUrl}/api/posts/attachments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` },
    body: form
  });
  assert.equal(upRes.status, 201);
  const att = await upRes.json();

  // Create post referencing this photo
  const postRes = await fetch(`${baseUrl}/api/posts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenA}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      content: 'Post with photo attachment',
      attachments: [{
        url: att.url,
        filename: att.filename,
        media_type: 'image',
        mime_type: 'image/png',
        file_name: 'photo_test.png',
        file_size: att.file_size
      }]
    })
  });
  assert.equal(postRes.status, 201);

  const res = await fetch(`${baseUrl}/api/profile/${studentA.studentId}/photos`, {
    headers: { Authorization: `Bearer ${tokenB}` }
  });
  assert.equal(res.status, 200);
  const photos = await res.json();
  assert.ok(Array.isArray(photos));
  assert.ok(photos.some(p => p.url === att.url), 'Photo attachment must be present in profile photos');
});

// 14. Files tab
test('GET /api/profile/:studentId/files: Returns materials uploaded by student', async () => {
  // Insert a test file for student A
  await db.run(
    `INSERT INTO files (storedName, originalName, title, subject, chapter, semester, uploadedBy, sizeBytes, uploadedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'test_file_stored.pdf', 'Alice_Notes.pdf', 'Algorithms Notes', 'Data Structures', 'Chapter 1', 'Semester 4', studentA.studentId, 1024, new Date().toISOString()
  );

  const res = await fetch(`${baseUrl}/api/profile/${studentA.studentId}/files`, {
    headers: { Authorization: `Bearer ${tokenB}` }
  });
  assert.equal(res.status, 200);
  const files = await res.json();
  assert.ok(Array.isArray(files));
  assert.ok(files.some(f => f.originalName === 'Alice_Notes.pdf'));
});

// 15. Assignments tab
test('GET /api/profile/:studentId/assignments: Returns assignments created by student', async () => {
  await db.run(
    `INSERT INTO assignments (title, description, language, subject, semester, createdBy, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    'Lab Assignment 1', 'Complete pointer lab', 'c', 'Programming', 'Semester 1', studentB.studentId, new Date().toISOString()
  );

  const res = await fetch(`${baseUrl}/api/profile/${studentB.studentId}/assignments`, {
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert.equal(res.status, 200);
  const assignments = await res.json();
  assert.ok(Array.isArray(assignments));
  assert.ok(assignments.some(a => a.title === 'Lab Assignment 1'));
});

// 16. Empty states
test('Empty states: A user with 0 posts, photos, files, assignments returns empty arrays cleanly', async () => {
  const freshStudentId = 'fresh_empty_' + Date.now();
  await db.run(
    `INSERT INTO students (studentId, name, role) VALUES (?, ?, 'student')`,
    freshStudentId, 'Fresh Empty Student'
  );

  const [postsRes, photosRes, filesRes, assignRes] = await Promise.all([
    fetch(`${baseUrl}/api/profile/${freshStudentId}/posts`, { headers: { Authorization: `Bearer ${tokenA}` } }),
    fetch(`${baseUrl}/api/profile/${freshStudentId}/photos`, { headers: { Authorization: `Bearer ${tokenA}` } }),
    fetch(`${baseUrl}/api/profile/${freshStudentId}/files`, { headers: { Authorization: `Bearer ${tokenA}` } }),
    fetch(`${baseUrl}/api/profile/${freshStudentId}/assignments`, { headers: { Authorization: `Bearer ${tokenA}` } }),
  ]);

  assert.equal(postsRes.status, 200);
  assert.deepEqual((await postsRes.json()).posts, []);

  assert.equal(photosRes.status, 200);
  assert.deepEqual(await photosRes.json(), []);

  assert.equal(filesRes.status, 200);
  assert.deepEqual(await filesRes.json(), []);

  assert.equal(assignRes.status, 200);
  assert.deepEqual(await assignRes.json(), []);

  await db.run('DELETE FROM students WHERE studentId = ?', freshStudentId);
});

// 17. Old profile with no cover still works
test('Old profile with no cover photo loads cleanly with coverUrl: null and default stats', async () => {
  const oldStudentId = 'old_stud_' + Date.now();
  await db.run(
    `INSERT INTO students (studentId, name, role, coverUrl, coverPosition) VALUES (?, ?, 'student', NULL, NULL)`,
    oldStudentId, 'Old Student Without Cover'
  );

  const res = await fetch(`${baseUrl}/api/profile/${oldStudentId}`, {
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.studentId, oldStudentId);
  assert.equal(data.coverUrl, null);
  assert.equal(data.coverPosition, null);

  await db.run('DELETE FROM students WHERE studentId = ?', oldStudentId);
});

// 18. Profile content ownership isolation (Zero cross-user leakage across Posts, Photos, Files, Assignments)
test('Profile content ownership isolation: User A sees only User A content, User B sees only User B content', async () => {
  const userXId = 'iso_user_x_' + Date.now();
  const userYId = 'iso_user_y_' + Date.now();

  await db.run(
    `INSERT INTO students (studentId, name, role) VALUES (?, ?, 'cr'), (?, ?, 'cr')`,
    userXId, 'Isolated User X', userYId, 'Isolated User Y'
  );  // User X post and User Y post
  const pX = await db.run(`INSERT INTO posts (user_id, content, type) VALUES (?, ?, 'status')`, userXId, 'Post by X only');
  const pY = await db.run(`INSERT INTO posts (user_id, content, type) VALUES (?, ?, 'status')`, userYId, 'Post by Y only');
  const pXId = pX.lastInsertRowid;
  const pYId = pY.lastInsertRowid;

  // User X photo and User Y photo
  await db.run(`INSERT INTO post_media (post_id, url, media_type, file_name, file_size) VALUES (?, ?, 'image', 'photo_x.png', 500)`, pXId, `/api/test/photo_x_${Date.now()}.png`);
  await db.run(`INSERT INTO post_media (post_id, url, media_type, file_name, file_size) VALUES (?, ?, 'image', 'photo_y.png', 600)`, pYId, `/api/test/photo_y_${Date.now()}.png`);

  // User X file and User Y file
  const nowIso = new Date().toISOString();
  await db.run(`INSERT INTO files (storedName, originalName, title, semester, subject, chapter, uploadedBy, sizeBytes, uploadedAt) VALUES (?, ?, ?, 'Semester 1', 'Math', 'Ch1', ?, 1000, ?)`, `fx_${Date.now()}`, 'X_Math.pdf', 'X Notes', userXId, nowIso);
  await db.run(`INSERT INTO files (storedName, originalName, title, semester, subject, chapter, uploadedBy, sizeBytes, uploadedAt) VALUES (?, ?, ?, 'Semester 1', 'Math', 'Ch1', ?, 1200, ?)`, `fy_${Date.now()}`, 'Y_Math.pdf', 'Y Notes', userYId, nowIso);

  // User X assignment and User Y assignment
  await db.run(`INSERT INTO assignments (title, description, language, subject, semester, createdBy, createdAt) VALUES (?, 'Desc X', 'c', 'CS', 'Semester 1', ?, ?)`, 'Assignment X Only', userXId, nowIso);
  await db.run(`INSERT INTO assignments (title, description, language, subject, semester, createdBy, createdAt) VALUES (?, 'Desc Y', 'c', 'CS', 'Semester 1', ?, ?)`, 'Assignment Y Only', userYId, nowIso);

  // Fetch User X's tabs
  const [xPostsRes, xPhotosRes, xFilesRes, xAssignRes] = await Promise.all([
    fetch(`${baseUrl}/api/profile/${userXId}/posts`, { headers: { Authorization: `Bearer ${tokenA}` } }),
    fetch(`${baseUrl}/api/profile/${userXId}/photos`, { headers: { Authorization: `Bearer ${tokenA}` } }),
    fetch(`${baseUrl}/api/profile/${userXId}/files`, { headers: { Authorization: `Bearer ${tokenA}` } }),
    fetch(`${baseUrl}/api/profile/${userXId}/assignments`, { headers: { Authorization: `Bearer ${tokenA}` } }),
  ]);

  const xPosts = (await xPostsRes.json()).posts;
  const xPhotos = await xPhotosRes.json();
  const xFiles = await xFilesRes.json();
  const xAssign = await xAssignRes.json();

  // Assert User X's tabs contain User X items and ZERO items from User Y
  assert.ok(xPosts.some(p => p.content === 'Post by X only'), 'User X posts must include User X post');
  assert.ok(!xPosts.some(p => p.content === 'Post by Y only'), 'User X posts must NOT leak User Y post');

  assert.ok(xPhotos.some(p => p.fileName === 'photo_x.png'), 'User X photos must include User X photo');
  assert.ok(!xPhotos.some(p => p.fileName === 'photo_y.png'), 'User X photos must NOT leak User Y photo');

  assert.ok(xFiles.some(f => f.originalName === 'X_Math.pdf'), 'User X files must include User X file');
  assert.ok(!xFiles.some(f => f.originalName === 'Y_Math.pdf'), 'User X files must NOT leak User Y file');

  assert.ok(xAssign.some(a => a.title === 'Assignment X Only'), 'User X assignments must include User X assignment');
  assert.ok(!xAssign.some(a => a.title === 'Assignment Y Only'), 'User X assignments must NOT leak User Y assignment');

  // Fetch User Y's tabs
  const [yPostsRes, yPhotosRes, yFilesRes, yAssignRes] = await Promise.all([
    fetch(`${baseUrl}/api/profile/${userYId}/posts`, { headers: { Authorization: `Bearer ${tokenA}` } }),
    fetch(`${baseUrl}/api/profile/${userYId}/photos`, { headers: { Authorization: `Bearer ${tokenA}` } }),
    fetch(`${baseUrl}/api/profile/${userYId}/files`, { headers: { Authorization: `Bearer ${tokenA}` } }),
    fetch(`${baseUrl}/api/profile/${userYId}/assignments`, { headers: { Authorization: `Bearer ${tokenA}` } }),
  ]);

  const yPosts = (await yPostsRes.json()).posts;
  const yPhotos = await yPhotosRes.json();
  const yFiles = await yFilesRes.json();
  const yAssign = await yAssignRes.json();

  // Assert User Y's tabs contain User Y items and ZERO items from User X
  assert.ok(yPosts.some(p => p.content === 'Post by Y only'), 'User Y posts must include User Y post');
  assert.ok(!yPosts.some(p => p.content === 'Post by X only'), 'User Y posts must NOT leak User X post');

  assert.ok(yPhotos.some(p => p.fileName === 'photo_y.png'), 'User Y photos must include User Y photo');
  assert.ok(!yPhotos.some(p => p.fileName === 'photo_x.png'), 'User Y photos must NOT leak User X photo');

  assert.ok(yFiles.some(f => f.originalName === 'Y_Math.pdf'), 'User Y files must include User Y file');
  assert.ok(!yFiles.some(f => f.originalName === 'X_Math.pdf'), 'User Y files must NOT leak User X file');

  assert.ok(yAssign.some(a => a.title === 'Assignment Y Only'), 'User Y assignments must include User Y assignment');
  assert.ok(!yAssign.some(a => a.title === 'Assignment X Only'), 'User Y assignments must NOT leak User X assignment');
});

// 19. Failed DB update during image replacement leaves old image intact and cleans up failed uncommitted blob
test('Image Replacement DB Failure: Preserves old image and unlinks failed new blob', async () => {
  // Set initial avatar for student B
  const initialFilename = `init_avatar_${Date.now()}.png`;
  await db.saveFileBlob(initialFilename, validPngBuffer, 'image/png');
  await db.run('UPDATE students SET avatarUrl = ? WHERE studentId = ?', `/api/avatar/${initialFilename}`, studentB.studentId);

  // Monkey-patch db.run to simulate DB failure specifically on avatar update
  const origRun = db.run;
  let simulatedErrorTriggered = false;
  db.run = async (sql, ...params) => {
    if (typeof sql === 'string' && sql.includes('UPDATE students SET avatarUrl')) {
      simulatedErrorTriggered = true;
      throw new Error('Simulated Database Crash During Avatar Update');
    }
    return origRun.call(db, sql, ...params);
  };

  try {
    const form = new FormData();
    form.append('avatar', new Blob([validPngBuffer], { type: 'image/png' }), 'failed_avatar.png');

    const res = await fetch(`${baseUrl}/api/profile/avatar`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenB}` },
      body: form
    });

    assert.equal(res.status, 500, 'Must return 500 on database update failure');
    assert.equal(simulatedErrorTriggered, true, 'Simulated failure must trigger');

    // 1. Verify old avatar remains in DB
    const student = await db.get('SELECT avatarUrl FROM students WHERE studentId = ?', studentB.studentId);
    assert.equal(student.avatarUrl, `/api/avatar/${initialFilename}`, 'Old avatarUrl must remain unchanged');

    // 2. Verify old blob still exists
    const oldBlob = await db.getFileBlob(initialFilename);
    assert.ok(oldBlob, 'Old avatar blob must still exist in storage');

    // 3. Verify no orphaned new blob was left behind in file_blobs
    const blobs = await db.all('SELECT filename FROM file_blobs WHERE filename != ?', initialFilename);
    for (const b of blobs) {
      const name = b.filename || b.fileName || '';
      assert.notEqual(name.includes('failed_avatar'), true);
    }
  } finally {
    db.run = origRun;
  }
});
