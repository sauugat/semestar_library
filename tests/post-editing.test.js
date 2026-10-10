const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createClient } = require('@libsql/client');
const { ensurePostsSchema, cleanupAbandonedStagedAttachments } = require('../lib/posts');
const createPostsRouter = require('../routes/posts');

const testPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);
const testPdf = Buffer.from('%PDF-1.4\n%test pdf content\n%%EOF');

async function fixture(t) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'post-edit-tests-'));
  const uploadDir = path.join(tempDir, 'posts');
  const client = createClient({ url: ':memory:' });
  const blobs = new Map();
  const pushNotificationsEnqueued = [];

  const db = {
    saveFileBlob: async (filename, fileData, mimeType) => {
      blobs.set(filename, { fileData, mimeType });
      return true;
    },
    getFileBlob: async (filename) => blobs.get(filename),
    deleteFileBlob: async (filename) => {
      blobs.delete(filename);
      return true;
    },
    isPostgres: false,
    exec: (sql) => client.executeMultiple(sql),
    all: async (sql, ...args) => (await client.execute({ sql, args })).rows,
    get: async (sql, ...args) => (await client.execute({ sql, args })).rows[0],
    run: async (sql, ...args) => {
      const result = await client.execute({ sql, args });
      return { lastInsertRowid: Number(result.lastInsertRowid), changes: result.rowsAffected };
    },
    withTransaction: async (callback) => {
      await client.execute('BEGIN');
      try {
        const res = await callback(db);
        await client.execute('COMMIT');
        return res;
      } catch (err) {
        try { await client.execute('ROLLBACK'); } catch (_) {}
        throw err;
      }
    },
    initSchema: async () => {},
  };

  await db.exec(`
    CREATE TABLE students (
      studentId TEXT PRIMARY KEY,
      name TEXT,
      role TEXT,
      avatarUrl TEXT,
      semester TEXT
    );
    INSERT INTO students VALUES
      ('author1', 'Author One', 'student', '/avatar1.png', '4th Semester'),
      ('author2', 'Author Two', 'student', '/avatar2.png', '4th Semester'),
      ('admin', 'Admin User', 'admin', '/admin.png', 'Faculty');
  `);
  await ensurePostsSchema(db);

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { studentId: req.headers['x-test-user'] };
    next();
  });
  const requireLogin = (req, res, next) =>
    req.session.studentId ? next() : res.status(401).json({ message: 'Authentication required.' });

  function verifyTestCron(req, res, next) {
    const secret = process.env.CRON_SECRET || 'test-cron-secret';
    const authHeader = req.headers['authorization'];
    const cronHeader = req.headers['x-cron-secret'];
    if (secret && ((authHeader && authHeader === `Bearer ${secret}`) || (cronHeader && cronHeader === secret))) {
      return next();
    }
    return res.status(401).json({ message: 'Unauthorized internal worker request.' });
  }

  app.all('/api/internal/posts/cleanup-staging', verifyTestCron, async (req, res) => {
    try {
      const ttlHours = req.query?.ttlHours !== undefined ? Number(req.query.ttlHours) : (req.body?.ttlHours !== undefined ? Number(req.body.ttlHours) : 24);
      const result = await cleanupAbandonedStagedAttachments(db, { ttlHours, uploadDir });
      return res.json({ success: true, ...result });
    } catch (err) {
      return res.status(500).json({ message: 'Staging cleanup failed.', error: err.message });
    }
  });

  app.use('/api/posts', createPostsRouter(db, requireLogin, { uploadDir }));
  app.use('/uploads/posts', express.static(uploadDir));

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    client.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function request(method, urlPath = '', body, user = 'author1') {
    const isForm = body instanceof FormData;
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/posts${urlPath}`, {
      method,
      headers: {
        ...(isForm ? {} : { 'Content-Type': 'application/json' }),
        ...(user ? { 'x-test-user': user } : {}),
      },
      body: isForm ? body : body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await response.json().catch(() => ({}));
    return { status: response.status, body: json };
  }

  async function rawRequest(method, fullUrlPath = '', body, headers = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${fullUrlPath}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await response.json().catch(() => ({}));
    return { status: response.status, body: json };
  }

  return { db, blobs, request, rawRequest, uploadDir, pushNotificationsEnqueued };
}

test('1. text-only post edit updates content and preserves post ID and author', async (t) => {
  const { request } = await fixture(t);
  const created = await request('POST', '', { content: 'Original caption' }, 'author1');
  assert.equal(created.status, 201);
  const postId = created.body.id;
  const originalCreated = created.body.created_at;

  const edited = await request('PUT', `/${postId}`, { content: 'Updated caption' }, 'author1');
  assert.equal(edited.status, 200);
  assert.equal(edited.body.id, postId);
  assert.equal(edited.body.content, 'Updated caption');
  assert.equal(edited.body.user_id, 'author1');
  assert.equal(edited.body.created_at, originalCreated);
  assert.equal(edited.body.edited, true);
  assert.ok(edited.body.edited_at);
});

test('2. change caption while keeping existing photos untouched', async (t) => {
  const { request } = await fixture(t);
  const form = new FormData();
  form.append('content', 'Initial photo caption');
  form.append('images', new Blob([testPng], { type: 'image/png' }), 'photo1.png');

  const created = await request('POST', '', form, 'author1');
  assert.equal(created.status, 201);
  const postId = created.body.id;
  const photoUrl = created.body.media[0].url;

  // Change caption, preserve photo
  const editForm = new FormData();
  editForm.append('content', 'Changed photo caption');
  editForm.append('keepMediaUrls', JSON.stringify([photoUrl]));

  const edited = await request('PUT', `/${postId}`, editForm, 'author1');
  assert.equal(edited.status, 200);
  assert.equal(edited.body.content, 'Changed photo caption');
  assert.equal(edited.body.media.length, 1);
  assert.equal(edited.body.media[0].url, photoUrl);
});

test('3. remove caption succeeds when media exists, but fails when post is completely empty', async (t) => {
  const { request } = await fixture(t);
  const form = new FormData();
  form.append('content', 'Photo caption to remove');
  form.append('images', new Blob([testPng], { type: 'image/png' }), 'keep_this.png');

  const created = await request('POST', '', form, 'author1');
  const postId = created.body.id;
  const photoUrl = created.body.media[0].url;

  // Remove caption, keep photo -> Should succeed
  const editForm = new FormData();
  editForm.append('content', '');
  editForm.append('keepMediaUrls', JSON.stringify([photoUrl]));

  const edited = await request('PUT', `/${postId}`, editForm, 'author1');
  assert.equal(edited.status, 200);
  assert.equal(edited.body.content, '');
  assert.equal(edited.body.media.length, 1);

  // Remove photo as well -> Completely empty -> Should fail with 400
  const emptyForm = new FormData();
  emptyForm.append('content', '');
  emptyForm.append('keepMediaUrls', JSON.stringify([]));

  const emptyEdit = await request('PUT', `/${postId}`, emptyForm, 'author1');
  assert.equal(emptyEdit.status, 400);
  assert.match(emptyEdit.body.message, /either text content or at least one photo or file/i);
});

test('4. single-photo post creation and rendering', async (t) => {
  const { request } = await fixture(t);
  const form = new FormData();
  form.append('content', 'Single photo test');
  form.append('images', new Blob([testPng], { type: 'image/png' }), 'single.png');

  const res = await request('POST', '', form, 'author1');
  assert.equal(res.status, 201);
  assert.equal(res.body.media.length, 1);
  assert.equal(res.body.media[0].media_type, 'image');
  assert.ok(res.body.attachment_url);
});

test('5. 2 photos post creation and balanced media order', async (t) => {
  const { request } = await fixture(t);
  const form = new FormData();
  form.append('content', 'Two photos post');
  form.append('images', new Blob([testPng], { type: 'image/png' }), 'p1.png');
  form.append('images', new Blob([testPng], { type: 'image/png' }), 'p2.png');

  const res = await request('POST', '', form, 'author1');
  assert.equal(res.status, 201);
  assert.equal(res.body.media.length, 2);
  assert.equal(res.body.media[0].sort_order, 0);
  assert.equal(res.body.media[1].sort_order, 1);
});

test('6. 5+ photos (6 photos) creation under 10-image limit', async (t) => {
  const { request } = await fixture(t);
  const form = new FormData();
  form.append('content', 'Six photos album');
  for (let i = 0; i < 6; i++) {
    form.append('images', new Blob([testPng], { type: 'image/png' }), `album_${i}.png`);
  }

  const res = await request('POST', '', form, 'author1');
  assert.equal(res.status, 201);
  assert.equal(res.body.media.length, 6);
  assert.equal(res.body.media[5].sort_order, 5);
});

test('7. add photo during edit without re-uploading existing photo', async (t) => {
  const { request } = await fixture(t);
  const form = new FormData();
  form.append('content', 'Initial 1 photo');
  form.append('images', new Blob([testPng], { type: 'image/png' }), 'initial.png');

  const created = await request('POST', '', form, 'author1');
  const postId = created.body.id;
  const initialUrl = created.body.media[0].url;

  // Edit: keep initial, add second
  const editForm = new FormData();
  editForm.append('content', 'Now 2 photos');
  editForm.append('keepMediaUrls', JSON.stringify([initialUrl]));
  editForm.append('images', new Blob([testPng], { type: 'image/png' }), 'second.png');

  const edited = await request('PUT', `/${postId}`, editForm, 'author1');
  assert.equal(edited.status, 200);
  assert.equal(edited.body.media.length, 2);
  assert.equal(edited.body.media[0].url, initialUrl);
  assert.notEqual(edited.body.media[1].url, initialUrl);
});

test('8. remove photo during edit safely deletes unkept blob', async (t) => {
  const { request, blobs } = await fixture(t);
  const form = new FormData();
  form.append('content', 'Two photos');
  form.append('images', new Blob([testPng], { type: 'image/png' }), 'keep_me.png');
  form.append('images', new Blob([testPng], { type: 'image/png' }), 'delete_me.png');

  const created = await request('POST', '', form, 'author1');
  const postId = created.body.id;
  const keepUrl = created.body.media[0].url;
  const deleteUrl = created.body.media[1].url;
  const deleteFilename = path.basename(deleteUrl);
  assert.equal(blobs.has(deleteFilename), true);

  // Edit: keep only first photo
  const editForm = new FormData();
  editForm.append('content', 'One photo remains');
  editForm.append('keepMediaUrls', JSON.stringify([keepUrl]));

  const edited = await request('PUT', `/${postId}`, editForm, 'author1');
  assert.equal(edited.status, 200);
  assert.equal(edited.body.media.length, 1);
  assert.equal(edited.body.media[0].url, keepUrl);

  // Unkept blob was purged safely
  assert.equal(blobs.has(deleteFilename), false);
});

test('9. replace photo replaces media in post_media and cleans up old blob', async (t) => {
  const { request, blobs } = await fixture(t);
  const form = new FormData();
  form.append('content', 'Original photo');
  form.append('images', new Blob([testPng], { type: 'image/png' }), 'photoA.png');

  const created = await request('POST', '', form, 'author1');
  const postId = created.body.id;
  const oldUrl = created.body.media[0].url;
  const oldFilename = path.basename(oldUrl);

  // Edit: drop old photo, upload photoB
  const editForm = new FormData();
  editForm.append('content', 'Replaced photo');
  editForm.append('keepMediaUrls', JSON.stringify([]));
  editForm.append('images', new Blob([testPng], { type: 'image/png' }), 'photoB.png');

  const edited = await request('PUT', `/${postId}`, editForm, 'author1');
  assert.equal(edited.status, 200);
  assert.equal(edited.body.media.length, 1);
  assert.notEqual(edited.body.media[0].url, oldUrl);

  // Old blob cleaned up
  assert.equal(blobs.has(oldFilename), false);
});

test('10. add and remove file attachments alongside photos', async (t) => {
  const { request, blobs } = await fixture(t);
  const form = new FormData();
  form.append('content', 'Lecture Notes Post');
  form.append('files', new Blob([testPdf], { type: 'application/pdf' }), 'lecture_notes.pdf');

  const created = await request('POST', '', form, 'author1');
  assert.equal(created.status, 201);
  assert.equal(created.body.media.length, 1);
  assert.equal(created.body.media[0].media_type, 'file');
  assert.equal(created.body.media[0].file_name, 'lecture_notes.pdf');
  const oldPdfUrl = created.body.media[0].url;
  const oldPdfFilename = path.basename(oldPdfUrl);
  assert.equal(blobs.has(oldPdfFilename), true);

  // Edit: remove old pdf and upload new docx
  const editForm = new FormData();
  editForm.append('content', 'Updated Lecture Material');
  editForm.append('keepMediaUrls', JSON.stringify([]));
  editForm.append('files', new Blob([Buffer.from('docx content')], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 'revised_slides.docx');

  const edited = await request('PUT', `/${created.body.id}`, editForm, 'author1');
  assert.equal(edited.status, 200);
  assert.equal(edited.body.media.length, 1);
  assert.equal(edited.body.media[0].media_type, 'file');
  assert.equal(edited.body.media[0].file_name, 'revised_slides.docx');
  assert.equal(blobs.has(oldPdfFilename), false);
});

test('11. existing post with comments, likes, replies retains all engagement after edit', async (t) => {
  const { request, db } = await fixture(t);
  const created = await request('POST', '', { content: 'Post with high engagement' }, 'author1');
  const postId = created.body.id;

  // Add likes from author1 and author2
  await request('POST', `/${postId}/like`, undefined, 'author1');
  await request('POST', `/${postId}/like`, undefined, 'author2');

  // Add root comment and reply
  const c1 = await request('POST', `/${postId}/comments`, { content: 'First great comment!' }, 'author2');
  const commentId = c1.body.comment?.id || c1.body.id;
  await request('POST', `/${postId}/comments/${commentId}/replies`, { content: 'Author reply' }, 'author1');
  await request('POST', `/${postId}/comments/${commentId}/like`, undefined, 'author1');

  // Fetch post stats before edit
  const before = await request('GET', `/${postId}`, undefined, 'author1');
  assert.equal(before.body.like_count, 2);
  assert.equal(before.body.comment_count, 2);

  // Author edits caption and adds photo
  const editForm = new FormData();
  editForm.append('content', 'Edited caption with newly added photo');
  editForm.append('images', new Blob([testPng], { type: 'image/png' }), 'new_photo.png');

  const edited = await request('PUT', `/${postId}`, editForm, 'author1');
  assert.equal(edited.status, 200);
  assert.equal(edited.body.id, postId);
  assert.equal(edited.body.content, 'Edited caption with newly added photo');

  // Fetch post after edit and assert ID and all engagement survived untouched!
  const after = await request('GET', `/${postId}`, undefined, 'author1');
  assert.equal(after.body.id, postId);
  assert.equal(after.body.like_count, 2);
  assert.equal(after.body.comment_count, 2);
  assert.equal(after.body.liked_by_me, true);

  // Fetch comments to verify comment IDs and replies still intact
  const commentsRes = await request('GET', `/${postId}/comments`, undefined, 'author1');
  const comments = Array.isArray(commentsRes.body) ? commentsRes.body : commentsRes.body.comments;
  assert.equal(comments.length, 1);
  assert.equal(comments[0].content, 'First great comment!');
  assert.equal(comments[0].replyCount, 1);
});

test('12. unauthorized student attempting to edit someone else post is rejected with 403', async (t) => {
  const { request } = await fixture(t);
  const created = await request('POST', '', { content: 'Author1 private post' }, 'author1');
  const postId = created.body.id;

  // Author 2 tries to edit, attempting to spoof userId or ownerId in body
  const spoofAttempt = await request(
    'PUT',
    `/${postId}`,
    {
      content: 'Hacked caption',
      userId: 'author1',
      studentId: 'author1',
      ownerId: 'author1'
    },
    'author2'
  );
  assert.equal(spoofAttempt.status, 403);
  assert.match(spoofAttempt.body.message, /Only the original post author can edit this post/i);

  // Verify post in database was NOT changed
  const check = await request('GET', `/${postId}`, undefined, 'author1');
  assert.equal(check.body.content, 'Author1 private post');
});

test('13. edit failure preserves old post content and attachments cleanly', async (t) => {
  const { request, blobs } = await fixture(t);
  const form = new FormData();
  form.append('content', 'Safe old caption');
  form.append('images', new Blob([testPng], { type: 'image/png' }), 'existing.png');

  const created = await request('POST', '', form, 'author1');
  const postId = created.body.id;
  const initialMediaUrl = created.body.media[0].url;
  const initialFilename = path.basename(initialMediaUrl);

  // Attempt edit with content exceeding 1,000,000 characters
  const badEdit = await request('PUT', `/${postId}`, { content: 'A'.repeat(1000001) }, 'author1');
  assert.equal(badEdit.status, 400);

  // Verify old post and blobs are completely intact
  const postCheck = await request('GET', `/${postId}`, undefined, 'author1');
  assert.equal(postCheck.body.content, 'Safe old caption');
  assert.equal(postCheck.body.media[0].url, initialMediaUrl);
  assert.equal(blobs.has(initialFilename), true);
});

test('14. old production post without post_media rows renders as one-item media list', async (t) => {
  const { db, request } = await fixture(t);
  // Insert legacy post with only attachment_url and no rows in post_media
  const insertLegacy = await db.run(
    `INSERT INTO posts (user_id, content, type, attachment_url, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    'author1', 'Legacy post', 'status', '/uploads/posts/legacy_image_123.jpg', new Date().toISOString()
  );
  const legacyId = insertLegacy.lastInsertRowid;

  const res = await request('GET', `/${legacyId}`, undefined, 'author1');
  assert.equal(res.status, 200);
  assert.equal(res.body.media.length, 1);
  assert.equal(res.body.media[0].url, '/uploads/posts/legacy_image_123.jpg');
  assert.equal(res.body.media[0].media_type, 'image');
});

test('15. duplicate save does not duplicate attachments or media records', async (t) => {
  const { request, db } = await fixture(t);
  const form = new FormData();
  form.append('content', 'Post to save twice');
  form.append('images', new Blob([testPng], { type: 'image/png' }), 'dup1.png');

  const created = await request('POST', '', form, 'author1');
  const postId = created.body.id;
  const imgUrl = created.body.media[0].url;

  // First Save: keep media
  const save1 = await request('PUT', `/${postId}`, { content: 'Save 1', keepMediaUrls: [imgUrl] }, 'author1');
  assert.equal(save1.status, 200);
  assert.equal(save1.body.media.length, 1);

  // Second immediate Save with same keepMediaUrls
  const save2 = await request('PUT', `/${postId}`, { content: 'Save 2', keepMediaUrls: [imgUrl] }, 'author1');
  assert.equal(save2.status, 200);
  assert.equal(save2.body.media.length, 1);

  // Query DB directly to ensure no duplicate rows created
  const rows = await db.all('SELECT * FROM post_media WHERE post_id = ?', postId);
  assert.equal(rows.length, 1);
});

test('16. post edit does not enqueue new post push notifications', async (t) => {
  const { request, db } = await fixture(t);
  // Ensure notification outbox table exists to track events
  await db.exec(`
    CREATE TABLE IF NOT EXISTS push_notification_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT,
      event_id INTEGER
    );
  `);

  const created = await request('POST', '', { content: 'Fresh post' }, 'author1');
  const postId = created.body.id;

  const jobsBefore = await db.all('SELECT COUNT(*) AS c FROM push_notification_jobs');
  const initialJobCount = Number(jobsBefore[0].c || 0);

  // Edit the post
  const edited = await request('PUT', `/${postId}`, { content: 'Edited post without spamming' }, 'author1');
  assert.equal(edited.status, 200);

  const jobsAfter = await db.all('SELECT COUNT(*) AS c FROM push_notification_jobs');
  const afterJobCount = Number(jobsAfter[0].c || 0);

  // Confirm NO push notification was enqueued on edit
  assert.equal(afterJobCount, initialJobCount);
});

test('17. database rollback on edit failure preserves post caption, old media, sort order, engagement, and leaves 0 new rows and 0 new blobs', async (t) => {
  const { request, db, blobs } = await fixture(t);

  // 1. Create initial post with 2 photos
  const form = new FormData();
  form.append('content', 'Original Caption Before Rollback');
  form.append('images', new Blob([testPng], { type: 'image/png' }), 'orig1.png');
  form.append('images', new Blob([testPng], { type: 'image/png' }), 'orig2.png');

  const created = await request('POST', '', form, 'author1');
  assert.equal(created.status, 201);
  const postId = created.body.id;
  assert.equal(created.body.media.length, 2);
  const origMediaUrls = created.body.media.map(m => m.url);
  const origBlobsCount = blobs.size;

  // 2. Add likes and comments to establish engagement
  await request('POST', `/${postId}/like`, undefined, 'author1');
  await request('POST', `/${postId}/like`, undefined, 'author2');
  const commentRes = await request('POST', `/${postId}/comments`, { content: 'Engagement comment' }, 'author2');
  assert.equal(commentRes.status, 201);

  const beforeEdit = await request('GET', `/${postId}`, undefined, 'author1');
  assert.equal(beforeEdit.body.like_count, 2);
  assert.equal(beforeEdit.body.comment_count, 1);

  // 3. Inject deliberate database failure inside the transaction
  // When UPDATE posts runs during edit, throw an error
  const originalRun = db.run;
  let failInjected = false;
  db.run = async (sql, ...args) => {
    if (typeof sql === 'string' && sql.startsWith('UPDATE posts SET content =')) {
      failInjected = true;
      throw new Error('Simulated Database Crash During Post Update');
    }
    return originalRun(sql, ...args);
  };

  // Attempt to edit: drop 1 old photo, keep 1, add 1 new photo
  const editForm = new FormData();
  editForm.append('content', 'Corrupted Caption That Must Roll Back');
  editForm.append('keepMediaUrls', JSON.stringify([origMediaUrls[0]]));
  editForm.append('images', new Blob([testPng], { type: 'image/png' }), 'new_aborted_photo.png');

  const editRes = await request('PUT', `/${postId}`, editForm, 'author1');
  db.run = originalRun; // Restore original run

  assert.equal(failInjected, true);
  assert.equal(editRes.status, 500);

  // 4. Verify Database State was completely rolled back
  const postAfterRollback = await request('GET', `/${postId}`, undefined, 'author1');
  // Caption unchanged
  assert.equal(postAfterRollback.body.content, 'Original Caption Before Rollback');
  // Old media count unchanged (both photos restored)
  assert.equal(postAfterRollback.body.media.length, 2);
  assert.equal(postAfterRollback.body.media[0].url, origMediaUrls[0]);
  assert.equal(postAfterRollback.body.media[1].url, origMediaUrls[1]);
  // Sort order unchanged
  assert.equal(postAfterRollback.body.media[0].sort_order, 0);
  assert.equal(postAfterRollback.body.media[1].sort_order, 1);
  // Engagement unchanged
  assert.equal(postAfterRollback.body.like_count, 2);
  assert.equal(postAfterRollback.body.comment_count, 1);

  // Query post_media directly
  const mediaRows = await db.all('SELECT * FROM post_media WHERE post_id = ? ORDER BY sort_order ASC', postId);
  assert.equal(mediaRows.length, 2);
  assert.equal(mediaRows[0].url, origMediaUrls[0]);
  assert.equal(mediaRows[1].url, origMediaUrls[1]);

  // No new blobs remain (temporary saved blobs pruned)
  assert.equal(blobs.size, origBlobsCount);
});

test('18. safe schema migration distinguishes duplicate columns vs real database failure', async (t) => {
  const { db } = await fixture(t);

  // Running ensurePostsSchema on already initialized schema must succeed gracefully
  await assert.doesNotReject(async () => {
    await ensurePostsSchema(db);
  });

  // A broken DB with fatal syntax/connection error must NOT be silently swallowed
  const brokenDb = {
    isPostgres: false,
    exec: async () => { throw new Error('FATAL: disk I/O error or broken database connection'); },
    run: async () => { throw new Error('FATAL: disk I/O error or broken database connection'); }
  };

  await assert.rejects(
    async () => {
      await ensurePostsSchema(brokenDb);
    },
    /FATAL: disk I\/O error/
  );
});

test('19. file-only, mixed, and legacy attachment backward compatibility', async (t) => {
  const { request, db } = await fixture(t);

  // 1. Text only (caption, no attachments)
  const textPost = await request('POST', '', { content: 'Text Only Post' }, 'author1');
  assert.equal(textPost.status, 201);
  assert.equal(textPost.body.attachment_url, null);
  assert.deepEqual(textPost.body.media, []);

  // 2. Image only (photo, empty caption)
  const imgOnlyForm = new FormData();
  imgOnlyForm.append('images', new Blob([testPng], { type: 'image/png' }), 'hero.png');
  const imgOnlyPost = await request('POST', '', imgOnlyForm, 'author1');
  assert.equal(imgOnlyPost.status, 201);
  assert.match(imgOnlyPost.body.attachment_url, /^\/uploads\/posts\//);
  assert.equal(imgOnlyPost.body.media.length, 1);
  assert.equal(imgOnlyPost.body.media[0].media_type, 'image');

  // 3. File only (document, empty caption)
  const fileOnlyForm = new FormData();
  fileOnlyForm.append('files', new Blob([testPdf], { type: 'application/pdf' }), 'syllabus.pdf');
  const fileOnlyPost = await request('POST', '', fileOnlyForm, 'author1');
  assert.equal(fileOnlyPost.status, 201);
  // attachment_url preserves the file URL for legacy clients
  assert.match(fileOnlyPost.body.attachment_url, /^\/uploads\/posts\//);
  // media array correctly identifies it as file, NOT image
  assert.equal(fileOnlyPost.body.media.length, 1);
  assert.equal(fileOnlyPost.body.media[0].media_type, 'file');
  assert.equal(fileOnlyPost.body.media[0].file_name, 'syllabus.pdf');

  // 4. Caption + Photos
  const capImgForm = new FormData();
  capImgForm.append('content', 'Campus event photos');
  capImgForm.append('images', new Blob([testPng], { type: 'image/png' }), 'p1.png');
  capImgForm.append('images', new Blob([testPng], { type: 'image/png' }), 'p2.png');
  const capImgPost = await request('POST', '', capImgForm, 'author1');
  assert.equal(capImgPost.status, 201);
  assert.equal(capImgPost.body.media.length, 2);
  assert.equal(capImgPost.body.media[0].media_type, 'image');
  assert.equal(capImgPost.body.media[1].media_type, 'image');

  // 5. Caption + Files
  const capFileForm = new FormData();
  capFileForm.append('content', 'Assignment 1 Reference Code');
  capFileForm.append('files', new Blob([Buffer.from('zip bytes')], { type: 'application/zip' }), 'starter_code.zip');
  const capFilePost = await request('POST', '', capFileForm, 'author1');
  assert.equal(capFilePost.status, 201);
  assert.equal(capFilePost.body.media.length, 1);
  assert.equal(capFilePost.body.media[0].media_type, 'file');
  assert.equal(capFilePost.body.media[0].file_name, 'starter_code.zip');

  // 6. Photos + Files (Mixed)
  const mixedForm = new FormData();
  mixedForm.append('content', 'Lab report with diagram');
  mixedForm.append('images', new Blob([testPng], { type: 'image/png' }), 'circuit_diagram.png');
  mixedForm.append('files', new Blob([testPdf], { type: 'application/pdf' }), 'lab_report.pdf');
  const mixedPost = await request('POST', '', mixedForm, 'author1');
  assert.equal(mixedPost.status, 201);
  assert.equal(mixedPost.body.media.length, 2);
  const images = mixedPost.body.media.filter(m => m.media_type === 'image');
  const files = mixedPost.body.media.filter(m => m.media_type === 'file');
  assert.equal(images.length, 1);
  assert.equal(files.length, 1);
  // attachment_url points to the image for legacy consumers
  assert.equal(mixedPost.body.attachment_url, images[0].url);

  // 7. Legacy post with document URL (e.g. https://example.com/handout.pdf)
  const legacyDocInsert = await db.run(
    `INSERT INTO posts (user_id, content, type, attachment_url, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    'author1', 'Legacy document post', 'status', 'https://example.com/handout.pdf', new Date().toISOString()
  );
  const legacyDocPost = await request('GET', `/${legacyDocInsert.lastInsertRowid}`, undefined, 'author1');
  assert.equal(legacyDocPost.status, 200);
  assert.equal(legacyDocPost.body.attachment_url, 'https://example.com/handout.pdf');
  assert.equal(legacyDocPost.body.media.length, 1);
  // Legacy PDF is correctly classified as a file, never misrendered as an image
  assert.equal(legacyDocPost.body.media[0].media_type, 'file');
  assert.equal(legacyDocPost.body.media[0].file_name, 'handout.pdf');
});

test('20. independent attachment upload architecture, 40 MB aggregate post support, and transaction safety', async (t) => {
  const { request, blobs, db } = await fixture(t);

  // 1. Independent upload: single photo <= 4 MB succeeds with metadata
  const formPhoto = new FormData();
  formPhoto.append('file', new Blob([Buffer.alloc(3.5 * 1024 * 1024)], { type: 'image/jpeg' }), 'photo1.jpg');
  const uploadPhotoRes = await request('POST', '/attachments', formPhoto, 'author1');
  assert.equal(uploadPhotoRes.status, 201);
  assert.match(uploadPhotoRes.body.url, /^\/uploads\/posts\//);
  assert.equal(uploadPhotoRes.body.media_type, 'image');
  assert.equal(uploadPhotoRes.body.mime_type, 'image/jpeg');
  assert.ok(uploadPhotoRes.body.filename);
  assert.equal(uploadPhotoRes.body.file_size, 3.5 * 1024 * 1024);

  // 2. Independent upload: single file > 4 MB is rejected with 413
  const blobsBeforeOversized = blobs.size;
  const formTooBig = new FormData();
  formTooBig.append('file', new Blob([Buffer.alloc(4.2 * 1024 * 1024)], { type: 'image/jpeg' }), 'huge.jpg');
  const uploadTooBigRes = await request('POST', '/attachments', formTooBig, 'author1');
  assert.equal(uploadTooBigRes.status, 413);
  assert.match(uploadTooBigRes.body.message, /4 MB/);
  // No leftover blob created for rejected upload
  assert.equal(blobs.size, blobsBeforeOversized);

  // 3. DELETE /attachments/:filename cleans up unattached blob
  const deleteRes = await request('DELETE', `/attachments/${uploadPhotoRes.body.filename}`, undefined, 'author1');
  assert.equal(deleteRes.status, 200);
  assert.equal(deleteRes.body.message, 'Attachment deleted successfully.');

  // 4. Up to 10 photos with ~35 MB total image data (each request ~3.5 MB <= 4 MB Vercel limit)
  // Each uploaded independently, followed by small JSON request to create the post
  const uploaded10Photos = [];
  for (let i = 0; i < 10; i++) {
    const f = new FormData();
    // 3.5 MB per photo -> 10 x 3.5 MB = 35 MB total image data!
    f.append('file', new Blob([Buffer.alloc(3.5 * 1024 * 1024)], { type: 'image/jpeg' }), `album_${i}.jpg`);
    const up = await request('POST', '/attachments', f, 'author1');
    assert.equal(up.status, 201);
    uploaded10Photos.push(up.body);
  }
  assert.equal(uploaded10Photos.length, 10);

  // Create post using JSON payload referencing the 10 pre-uploaded attachments
  const create10Res = await request('POST', '', {
    content: 'Album of 10 high-resolution photos (35 MB total image data)',
    attachments: uploaded10Photos,
  }, 'author1');
  assert.equal(create10Res.status, 201);
  assert.equal(create10Res.body.media.length, 10);
  const totalBytesInPost = create10Res.body.media.reduce((sum, m) => sum + (m.file_size || 0), 0);
  assert.equal(totalBytesInPost, 35 * 1024 * 1024);

  // 5. Attached blobs cannot be deleted via DELETE /attachments/:filename (active reference safety)
  const deleteAttachedRes = await request('DELETE', `/attachments/${uploaded10Photos[0].filename}`, undefined, 'author1');
  assert.equal(deleteAttachedRes.status, 409);
  assert.match(deleteAttachedRes.body.message, /Cannot delete attachment that is in use/);

  // 6. Multiple documents exceeding 4 MB total (e.g. 2 x 3.0 MB = 6.0 MB total)
  const uploadedDocs = [];
  for (let i = 0; i < 2; i++) {
    const f = new FormData();
    f.append('file', new Blob([Buffer.alloc(3.0 * 1024 * 1024)], { type: 'application/pdf' }), `large_doc_${i}.pdf`);
    const up = await request('POST', '/attachments', f, 'author1');
    assert.equal(up.status, 201);
    assert.equal(up.body.media_type, 'file');
    uploadedDocs.push(up.body);
  }
  const createDocsRes = await request('POST', '', {
    content: 'Two large lecture documents (6 MB total)',
    attachments: uploadedDocs,
  }, 'author1');
  assert.equal(createDocsRes.status, 201);
  assert.equal(createDocsRes.body.media.length, 2);
  assert.equal(createDocsRes.body.media[0].media_type, 'file');
  assert.equal(createDocsRes.body.media[1].media_type, 'file');

  // 7. Retained attachments during edit are NOT re-uploaded:
  // Post has 10 photos. Edit post: keep 9 existing photos, add 1 new photo via independent upload
  const basePostId = create10Res.body.id;
  const keptMediaUrls = create10Res.body.media.slice(0, 9).map(m => m.url);

  const fNew = new FormData();
  fNew.append('file', new Blob([Buffer.alloc(2.0 * 1024 * 1024)], { type: 'image/jpeg' }), 'replacement.jpg');
  const upNew = await request('POST', '/attachments', fNew, 'author1');
  assert.equal(upNew.status, 201);

  const editRes = await request('PUT', `/${basePostId}`, {
    content: 'Edited 10-photo post with 9 retained photos and 1 new photo',
    keepMediaUrls: keptMediaUrls,
    newAttachments: [upNew.body],
  }, 'author1');
  assert.equal(editRes.status, 200);
  assert.equal(editRes.body.media.length, 10);
  // Retained 9 photos preserved their URLs
  for (let i = 0; i < 9; i++) {
    assert.equal(editRes.body.media[i].url, keptMediaUrls[i]);
  }
  // 10th photo is the newly uploaded one
  assert.equal(editRes.body.media[9].url, upNew.body.url);

  // 8. If post creation or update fails, newly uploaded unattached blobs are cleaned up safely
  const blobsBeforeFailedPost = blobs.size;
  const fOrphan = new FormData();
  fOrphan.append('file', new Blob([Buffer.alloc(1024 * 1024)], { type: 'image/jpeg' }), 'orphan_candidate.jpg');
  const upOrphan = await request('POST', '/attachments', fOrphan, 'author1');
  assert.equal(upOrphan.status, 201);
  assert.equal(blobs.size, blobsBeforeFailedPost + 1);

  // Inject failure on post creation transaction
  const origRun = db.run;
  db.run = async (sql, ...args) => {
    if (typeof sql === 'string' && sql.startsWith('INSERT INTO posts')) {
      throw new Error('Simulated Database Failure on Post Creation');
    }
    return origRun(sql, ...args);
  };

  const failedCreateRes = await request('POST', '', {
    content: 'This post will fail to insert',
    attachments: [upOrphan.body],
  }, 'author1');
  db.run = origRun;

  assert.equal(failedCreateRes.status, 500);
  // The newly uploaded unattached blob was safely cleaned up by the server on transaction failure
  assert.equal(blobs.size, blobsBeforeFailedPost);
});

test('21. Attachment Ownership & Cross-User Hijacking Prevention (A uploads -> A creates PASS, B attempts to attach -> 403, B attempts to DELETE -> 403)', async (t) => {
  const { request, blobs, db } = await fixture(t);

  // 1. Author1 uploads attachment A via POST /attachments
  const formA = new FormData();
  formA.append('file', new Blob([Buffer.alloc(100 * 1024)], { type: 'image/png' }), 'author1_photo.png');
  const uploadARes = await request('POST', '/attachments', formA, 'author1');
  assert.equal(uploadARes.status, 201);
  assert.ok(uploadARes.body.id);
  assert.ok(uploadARes.body.filename);
  assert.match(uploadARes.body.url, /^\/uploads\/posts\//);

  // Verify staging record in database
  const stagingRow = await db.get('SELECT * FROM post_attachment_staging WHERE filename = ?', uploadARes.body.filename);
  assert.ok(stagingRow);
  assert.equal(stagingRow.uploader_student_id, 'author1');
  assert.equal(Number(stagingRow.is_committed), 0);

  // 2. Author2 (Student B) attempts to hijack Author1's attachment by creating a post with A's metadata
  const hijackRes = await request('POST', '', {
    content: 'Student B attempting to hijack Student A staged attachment',
    attachments: [uploadARes.body],
  }, 'author2');
  assert.equal(hijackRes.status, 403);
  assert.match(hijackRes.body.message, /own this attachment/i);

  // 3. Author2 (Student B) attempts DELETE /attachments/:filename on Author1's uncommitted staged upload
  const deleteHijackRes = await request('DELETE', `/attachments/${uploadARes.body.filename}`, undefined, 'author2');
  assert.equal(deleteHijackRes.status, 403);
  assert.match(deleteHijackRes.body.message, /permission to delete/i);
  // Author1's blob is preserved
  assert.ok(blobs.has(uploadARes.body.filename));

  // 4. Author1 (the legitimate uploader) creates a post with attachment A -> PASS (201)
  const createPassRes = await request('POST', '', {
    content: 'Student A creates post with their own staged attachment',
    attachments: [uploadARes.body],
  }, 'author1');
  assert.equal(createPassRes.status, 201);
  assert.equal(createPassRes.body.media.length, 1);
  assert.equal(createPassRes.body.media[0].url, uploadARes.body.url);

  // Verify staging record transitioned to committed in DB
  const committedStaging = await db.get('SELECT * FROM post_attachment_staging WHERE filename = ?', uploadARes.body.filename);
  assert.equal(Number(committedStaging.is_committed), 1);
  assert.equal(Number(committedStaging.post_id), createPassRes.body.id);

  // 5. Author2 creates own post, then attempts to attach Author1's attachment during PUT /:id
  const author2Post = await request('POST', '', { content: 'Author2 original post' }, 'author2');
  assert.equal(author2Post.status, 201);

  const editHijackRes = await request('PUT', `/${author2Post.body.id}`, {
    content: 'Author2 edit attempting to hijack Author1 attachment',
    newAttachments: [uploadARes.body],
  }, 'author2');
  assert.equal(editHijackRes.status, 403);
  assert.match(editHijackRes.body.message, /own this attachment/i);
});

test('22. Authoritative Server Metadata & Forged Input Rejection (arbitrary URL -> 400, tampered size/mime -> ignored in favor of server DB)', async (t) => {
  const { request, db } = await fixture(t);

  // 1. Forged arbitrary external URL submitted in attachments array -> REJECT (400)
  const forgedExternalRes = await request('POST', '', {
    content: 'Post with forged external malicious URL in attachments',
    attachments: [{ url: 'https://attacker.example.com/exploit.jpg' }],
  }, 'author1');
  assert.equal(forgedExternalRes.status, 400);
  assert.match(forgedExternalRes.body.message, /Invalid or expired attachment reference/i);

  // 2. Forged arbitrary non-existent local upload URL in attachments array -> REJECT (400)
  const forgedLocalRes = await request('POST', '', {
    content: 'Post with forged non-existent post upload URL',
    attachments: [{ url: '/uploads/posts/00000000-0000-0000-0000-000000000000.png' }],
  }, 'author1');
  assert.equal(forgedLocalRes.status, 400);
  assert.match(forgedLocalRes.body.message, /Invalid or expired attachment reference/i);

  // 3. Legitimate upload of 200 KB JPEG
  const formLegit = new FormData();
  formLegit.append('file', new Blob([Buffer.alloc(200 * 1024)], { type: 'image/jpeg' }), 'lecture_notes.jpg');
  const uploadLegitRes = await request('POST', '/attachments', formLegit, 'author1');
  assert.equal(uploadLegitRes.status, 201);
  assert.equal(uploadLegitRes.body.file_size, 200 * 1024);
  assert.equal(uploadLegitRes.body.mime_type, 'image/jpeg');

  // 4. Client attempts to submit tampered metadata (tampered MIME type, size: 1, wrong filename)
  const createTamperedRes = await request('POST', '', {
    content: 'Client submitting tampered metadata for valid staged upload',
    attachments: [{
      id: uploadLegitRes.body.id,
      filename: uploadLegitRes.body.filename,
      url: uploadLegitRes.body.url,
      mime_type: 'application/x-malware',
      file_size: 1,
      file_name: 'fake.exe',
      media_type: 'file',
    }],
  }, 'author1');
  assert.equal(createTamperedRes.status, 201);

  // Server ignores client JSON and loads authoritative metadata from server staging/database
  const postMedia = createTamperedRes.body.media[0];
  assert.equal(postMedia.mime_type, 'image/jpeg');
  assert.equal(postMedia.file_size, 200 * 1024);
  assert.equal(postMedia.media_type, 'image');
  assert.equal(postMedia.url, uploadLegitRes.body.url);
});

test('23. Staging Lifecycle & Abandoned Upload Server Garbage Collection (uncommitted past TTL -> cleaned, committed past TTL -> preserved)', async (t) => {
  const { request, blobs, db } = await fixture(t);

  // 1. Author1 uploads Attachment 1 (abandoned: phone crashes / never publishes)
  const form1 = new FormData();
  form1.append('file', new Blob([Buffer.alloc(50 * 1024)], { type: 'image/png' }), 'abandoned.png');
  const up1 = await request('POST', '/attachments', form1, 'author1');
  assert.equal(up1.status, 201);

  // 2. Author1 uploads Attachment 2 and publishes a real post with it
  const form2 = new FormData();
  form2.append('file', new Blob([Buffer.alloc(80 * 1024)], { type: 'image/jpeg' }), 'published.jpg');
  const up2 = await request('POST', '/attachments', form2, 'author1');
  assert.equal(up2.status, 201);

  const post2 = await request('POST', '', {
    content: 'Published post with attachment 2',
    attachments: [up2.body],
  }, 'author1');
  assert.equal(post2.status, 201);

  // Both blobs are currently present
  assert.ok(blobs.has(up1.body.filename));
  assert.ok(blobs.has(up2.body.filename));

  // 3. Simulate passage of time past TTL (e.g. 3 hours ago) for both staging rows
  await db.run(
    "UPDATE post_attachment_staging SET created_at = datetime('now', '-3 hours') WHERE filename IN (?, ?)",
    up1.body.filename, up2.body.filename
  );

  // 4. Run server garbage collection with TTL = 2 hours
  const gcResult = await cleanupAbandonedStagedAttachments(db, { ttlHours: 2 });
  assert.equal(gcResult.cleanedCount, 1);
  assert.ok(gcResult.cleanedFilenames.includes(up1.body.filename));
  assert.ok(!gcResult.cleanedFilenames.includes(up2.body.filename));

  // Uncommitted abandoned upload blob was safely deleted
  assert.equal(blobs.has(up1.body.filename), false);
  const staging1 = await db.get('SELECT * FROM post_attachment_staging WHERE filename = ?', up1.body.filename);
  assert.equal(staging1, undefined);

  // Committed upload blob past TTL is PRESERVED
  assert.equal(blobs.has(up2.body.filename), true);
  const staging2 = await db.get('SELECT * FROM post_attachment_staging WHERE filename = ?', up2.body.filename);
  assert.ok(staging2);
  assert.equal(Number(staging2.is_committed), 1);

  // Post 2 still serves its media normally
  const fetchPost2 = await request('GET', `/${post2.body.id}`, undefined, 'author1');
  assert.equal(fetchPost2.status, 200);
  assert.equal(fetchPost2.body.media.length, 1);
  assert.equal(fetchPost2.body.media[0].url, up2.body.url);
});

test('24. Committed Post Attachment Lifecycle & DELETE Staging Endpoint Guard (active post media rejects DELETE with 409)', async (t) => {
  const { request, blobs } = await fixture(t);

  // 1. Author1 uploads attachment and creates post
  const form = new FormData();
  form.append('file', new Blob([Buffer.alloc(64 * 1024)], { type: 'image/jpeg' }), 'active_photo.jpg');
  const up = await request('POST', '/attachments', form, 'author1');
  assert.equal(up.status, 201);

  const post = await request('POST', '', {
    content: 'Active post holding reference to attachment',
    attachments: [up.body],
  }, 'author1');
  assert.equal(post.status, 201);

  // 2. Author1 attempts DELETE /attachments/:filename on the committed attachment
  const deleteOwnRes = await request('DELETE', `/attachments/${up.body.filename}`, undefined, 'author1');
  assert.equal(deleteOwnRes.status, 409);
  assert.match(deleteOwnRes.body.message, /Cannot delete attachment that is in use/i);

  // 3. Author2 attempts DELETE on Author1's committed attachment
  const deleteOtherRes = await request('DELETE', `/attachments/${up.body.filename}`, undefined, 'author2');
  assert.equal(deleteOtherRes.status, 409);

  // Blob remains intact in storage
  assert.ok(blobs.has(up.body.filename));
});

test('25. Concurrency & Replay Protection (deduplication of repeated references in single post, reject replay of committed attachment to another post, transaction rollback leaves no orphan)', async (t) => {
  const { request, blobs, db } = await fixture(t);

  // 1. Same uploaded attachment reference submitted multiple times within one post
  const formA = new FormData();
  formA.append('file', new Blob([Buffer.alloc(120 * 1024)], { type: 'image/jpeg' }), 'single_photo.jpg');
  const upA = await request('POST', '/attachments', formA, 'author1');
  assert.equal(upA.status, 201);

  // Submit the same attachment 3 times in the same request payload
  const createDedupRes = await request('POST', '', {
    content: 'Post with repeated attachment reference',
    attachments: [upA.body, upA.body, { id: upA.body.id, filename: upA.body.filename, url: upA.body.url }],
  }, 'author1');
  assert.equal(createDedupRes.status, 201);
  // Deduplicated by server: exactly 1 media record created
  assert.equal(createDedupRes.body.media.length, 1);
  const mediaRows = await db.all('SELECT * FROM post_media WHERE post_id = ?', createDedupRes.body.id);
  assert.equal(mediaRows.length, 1);

  // 2. Replay prevention: single staged attachment cannot be attached to a second post
  const replayRes = await request('POST', '', {
    content: 'Second post attempting to reuse already committed attachment',
    attachments: [upA.body],
  }, 'author1');
  assert.equal(replayRes.status, 409);
  assert.match(replayRes.body.message, /already been committed to another post/i);

  // 3. Failed DB transaction leaves zero orphan staging records or blobs
  const blobsBeforeFailure = blobs.size;
  const formB = new FormData();
  formB.append('file', new Blob([Buffer.alloc(80 * 1024)], { type: 'image/jpeg' }), 'will_fail.jpg');
  const upB = await request('POST', '/attachments', formB, 'author1');
  assert.equal(upB.status, 201);
  assert.equal(blobs.size, blobsBeforeFailure + 1);

  // Inject failure on transaction commit
  const origRun = db.run;
  db.run = async (sql, ...args) => {
    if (typeof sql === 'string' && sql.startsWith('INSERT INTO posts')) {
      throw new Error('Forced DB Error for transaction rollback test');
    }
    return origRun(sql, ...args);
  };

  const failedRes = await request('POST', '', {
    content: 'Transaction failure test',
    attachments: [upB.body],
  }, 'author1');
  db.run = origRun;

  assert.equal(failedRes.status, 500);
  // Staging row cleaned up
  const failedStaging = await db.get('SELECT * FROM post_attachment_staging WHERE filename = ?', upB.body.filename);
  assert.equal(failedStaging, undefined);
  // Staged blob safely unlinked / removed
  assert.equal(blobs.size, blobsBeforeFailure);
  assert.ok(!blobs.has(upB.body.filename));
  // Existing retained post media from post 1 is still completely intact
  assert.ok(blobs.has(upA.body.filename));
});

test('26. Scheduled Cleanup Worker & Endpoint Authorization (unauthorized -> 401, authorized -> clean expired/unreferenced, preserve fresh/committed/active)', async (t) => {
  const { request, rawRequest, blobs, db } = await fixture(t);

  // 1. Verify unauthorized requests to cleanup endpoint are rejected
  const noAuthRes = await rawRequest('POST', '/api/internal/posts/cleanup-staging', { ttlHours: 24 });
  assert.equal(noAuthRes.status, 401);
  assert.match(noAuthRes.body.message, /Unauthorized internal worker request/i);

  const badAuthRes = await rawRequest('POST', '/api/internal/posts/cleanup-staging', { ttlHours: 24 }, {
    'Authorization': 'Bearer completely-invalid-cron-secret'
  });
  assert.equal(badAuthRes.status, 401);

  // 2. Set up test attachments in different states:
  // State A: staged + expired (26h ago) + unreferenced -> SHOULD BE DELETED
  const formA = new FormData();
  formA.append('file', new Blob([Buffer.alloc(10 * 1024)], { type: 'image/jpeg' }), 'expired_unref.jpg');
  const upA = await request('POST', '/attachments', formA, 'author1');
  assert.equal(upA.status, 201);
  await db.run("UPDATE post_attachment_staging SET created_at = datetime('now', '-26 hours') WHERE filename = ?", upA.body.filename);

  // State B: staged + not expired (2h ago) + unreferenced -> MUST BE PRESERVED
  const formB = new FormData();
  formB.append('file', new Blob([Buffer.alloc(10 * 1024)], { type: 'image/jpeg' }), 'fresh_unref.jpg');
  const upB = await request('POST', '/attachments', formB, 'author1');
  assert.equal(upB.status, 201);
  await db.run("UPDATE post_attachment_staging SET created_at = datetime('now', '-2 hours') WHERE filename = ?", upB.body.filename);

  // State C: committed attachment (26h ago) -> MUST BE PRESERVED
  const formC = new FormData();
  formC.append('file', new Blob([Buffer.alloc(10 * 1024)], { type: 'image/jpeg' }), 'committed_old.jpg');
  const upC = await request('POST', '/attachments', formC, 'author1');
  assert.equal(upC.status, 201);
  const postC = await request('POST', '', { content: 'Post with committed attachment', attachments: [upC.body] }, 'author1');
  assert.equal(postC.status, 201);
  await db.run("UPDATE post_attachment_staging SET created_at = datetime('now', '-26 hours') WHERE filename = ?", upC.body.filename);

  // State D: attachment referenced by active post via posts.attachment_url -> MUST BE PRESERVED
  const formD = new FormData();
  formD.append('file', new Blob([Buffer.alloc(10 * 1024)], { type: 'image/jpeg' }), 'active_ref.jpg');
  const upD = await request('POST', '/attachments', formD, 'author1');
  assert.equal(upD.status, 201);
  // Directly insert post referencing this url
  await db.run(
    `INSERT INTO posts (user_id, content, type, attachment_url, created_at)
     VALUES (?, ?, ?, ?, datetime('now', '-26 hours'))`,
    'author1', 'Direct ref post', 'status', upD.body.url
  );
  await db.run("UPDATE post_attachment_staging SET created_at = datetime('now', '-26 hours') WHERE filename = ?", upD.body.filename);

  // Verify all 4 blobs exist before scheduled cleanup
  assert.ok(blobs.has(upA.body.filename));
  assert.ok(blobs.has(upB.body.filename));
  assert.ok(blobs.has(upC.body.filename));
  assert.ok(blobs.has(upD.body.filename));

  // 3. Authenticated worker invocation with valid cron secret
  const cleanRes = await rawRequest('POST', '/api/internal/posts/cleanup-staging', { ttlHours: 24 }, {
    'Authorization': 'Bearer test-cron-secret'
  });
  assert.equal(cleanRes.status, 200);
  assert.equal(cleanRes.body.success, true);
  assert.equal(cleanRes.body.cleanedCount, 1);
  assert.ok(cleanRes.body.cleanedFilenames.includes(upA.body.filename));

  // 4. Verify storage and database after cleanup:
  // State A: deleted
  assert.equal(blobs.has(upA.body.filename), false);
  const stagingA = await db.get('SELECT * FROM post_attachment_staging WHERE filename = ?', upA.body.filename);
  assert.equal(stagingA, undefined);

  // State B: preserved
  assert.equal(blobs.has(upB.body.filename), true);
  const stagingB = await db.get('SELECT * FROM post_attachment_staging WHERE filename = ?', upB.body.filename);
  assert.ok(stagingB);

  // State C: preserved
  assert.equal(blobs.has(upC.body.filename), true);
  const stagingC = await db.get('SELECT * FROM post_attachment_staging WHERE filename = ?', upC.body.filename);
  assert.ok(stagingC);
  assert.equal(Number(stagingC.is_committed), 1);

  // State D: preserved
  assert.equal(blobs.has(upD.body.filename), true);
});


