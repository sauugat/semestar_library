const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createClient } = require('@libsql/client');
const { ensurePostsSchema } = require('../lib/posts');
const createPostsRouter = require('../routes/posts');

const testPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

async function fixture(t) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'phase2a-posts-'));
  const uploadDir = path.join(tempDir, 'posts');
  const client = createClient({ url: ':memory:' });
  const blobs = new Map();
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

  return { db, blobs, request, uploadDir };
}

test('1. Creating text-only post succeeds and returns empty media array', async (t) => {
  const { request } = await fixture(t);
  const res = await request('POST', '', { content: 'Just a text post' }, 'author1');
  assert.equal(res.status, 201);
  assert.equal(res.body.content, 'Just a text post');
  assert.equal(res.body.attachment_url, null);
  assert.deepEqual(res.body.media, []);
});

test('2. Creating post with one image succeeds and populates media and attachment_url', async (t) => {
  const { request, blobs } = await fixture(t);
  const form = new FormData();
  form.append('content', 'Post with 1 photo');
  form.append('images', new Blob([testPng], { type: 'image/png' }), 'photo1.png');

  const res = await request('POST', '', form, 'author1');
  assert.equal(res.status, 201);
  assert.equal(res.body.content, 'Post with 1 photo');
  assert.ok(res.body.attachment_url?.startsWith('/uploads/posts/'));
  assert.equal(res.body.media.length, 1);
  assert.equal(res.body.media[0].sort_order, 0);
  assert.equal(res.body.media[0].url, res.body.attachment_url);
  assert.equal(blobs.size, 1);
});

test('3. Creating post with multiple images populates post_media with stable ordering', async (t) => {
  const { request, blobs } = await fixture(t);
  const form = new FormData();
  form.append('content', 'Post with 3 photos');
  form.append('images', new Blob([testPng], { type: 'image/png' }), 'img1.png');
  form.append('images', new Blob([testPng], { type: 'image/png' }), 'img2.png');
  form.append('images', new Blob([testPng], { type: 'image/png' }), 'img3.png');

  const res = await request('POST', '', form, 'author1');
  assert.equal(res.status, 201);
  assert.equal(res.body.media.length, 3);
  assert.equal(res.body.media[0].sort_order, 0);
  assert.equal(res.body.media[1].sort_order, 1);
  assert.equal(res.body.media[2].sort_order, 2);
  // attachment_url points to the first image for backward compatibility
  assert.equal(res.body.attachment_url, res.body.media[0].url);
  assert.equal(blobs.size, 3);

  // Fetching the post directly via GET /:id returns the ordered media
  const getRes = await request('GET', `/${res.body.id}`);
  assert.equal(getRes.status, 200);
  assert.equal(getRes.body.media.length, 3);
  assert.equal(getRes.body.media[0].sort_order, 0);
  assert.equal(getRes.body.media[1].sort_order, 1);
  assert.equal(getRes.body.media[2].sort_order, 2);
});

test('4. Backward compatibility: legacy posts without post_media synthesize ordered media', async (t) => {
  const { db, request } = await fixture(t);
  // Insert legacy post with attachment_url directly into posts table
  const legacyPost = await db.run(
    `INSERT INTO posts (user_id, content, type, attachment_url, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    'author1',
    'Legacy single-image post',
    'status',
    '/uploads/posts/legacy_photo.jpg',
    new Date().toISOString()
  );

  const res = await request('GET', `/${legacyPost.lastInsertRowid}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.content, 'Legacy single-image post');
  assert.equal(res.body.attachment_url, '/uploads/posts/legacy_photo.jpg');
  assert.equal(res.body.media.length, 1);
  assert.equal(res.body.media[0].url, '/uploads/posts/legacy_photo.jpg');
  assert.equal(res.body.media[0].sort_order, 0);

  // Also in feed listing GET /
  const feedRes = await request('GET', '');
  assert.equal(feedRes.status, 200);
  const found = feedRes.body.posts.find((p) => p.id === legacyPost.lastInsertRowid);
  assert.ok(found);
  assert.equal(found.media.length, 1);
  assert.equal(found.media[0].url, '/uploads/posts/legacy_photo.jpg');
});

test('5. Editing own post text updates in-place and preserves comments & likes', async (t) => {
  const { request } = await fixture(t);
  const created = await request('POST', '', { content: 'Original text' }, 'author1');
  const postId = created.body.id;

  // Add a like and a comment
  await request('POST', `/${postId}/like`, undefined, 'author2');
  const commentRes = await request('POST', `/${postId}/comments`, { content: 'Nice post!' }, 'author2');
  assert.equal(commentRes.status, 201);

  // Edit caption
  const editRes = await request('PUT', `/${postId}`, { content: 'Updated post text' }, 'author1');
  assert.equal(editRes.status, 200);
  assert.equal(editRes.body.content, 'Updated post text');
  assert.equal(editRes.body.id, postId);
  assert.equal(editRes.body.like_count, 1);
  assert.equal(editRes.body.comment_count, 1);

  // Verify comments are still present
  const commentsList = await request('GET', `/${postId}/comments`, undefined, 'author1');
  assert.equal(commentsList.status, 200);
  assert.equal(commentsList.body.length, 1);
  assert.equal(commentsList.body[0].content, 'Nice post!');
});

test('6. Editing own post: removing existing photos and adding new photos', async (t) => {
  const { request, blobs } = await fixture(t);
  // Create post with 2 images
  const form = new FormData();
  form.append('content', 'Initial 2 photos');
  form.append('images', new Blob([testPng], { type: 'image/png' }), 'first.png');
  form.append('images', new Blob([testPng], { type: 'image/png' }), 'second.png');

  const created = await request('POST', '', form, 'author1');
  const postId = created.body.id;
  const originalMedia = created.body.media;
  assert.equal(originalMedia.length, 2);
  const keptUrl = originalMedia[0].url;
  const removedUrl = originalMedia[1].url;

  // Edit: keep first image, drop second image, upload new image
  const editForm = new FormData();
  editForm.append('content', 'Now has kept image and newly added image');
  editForm.append('keepMediaUrls', JSON.stringify([keptUrl]));
  editForm.append('images', new Blob([testPng], { type: 'image/png' }), 'third_new.png');

  const editRes = await request('PUT', `/${postId}`, editForm, 'author1');
  assert.equal(editRes.status, 200);
  assert.equal(editRes.body.content, 'Now has kept image and newly added image');
  assert.equal(editRes.body.media.length, 2);
  assert.equal(editRes.body.media[0].url, keptUrl);
  assert.notEqual(editRes.body.media[1].url, removedUrl);

  // Removed blob should have been cleaned up from storage safely
  const removedFilename = path.basename(removedUrl);
  assert.equal(blobs.has(removedFilename), false);
});

test('7. Unauthorized user cannot edit another author post', async (t) => {
  const { request } = await fixture(t);
  const created = await request('POST', '', { content: 'Author1 post' }, 'author1');
  const postId = created.body.id;

  // Author 2 tries to edit
  const unauthorizedEdit = await request('PUT', `/${postId}`, { content: 'Hacked caption' }, 'author2');
  assert.equal(unauthorizedEdit.status, 403);
  assert.equal(unauthorizedEdit.body.message, 'Only the original post author can edit this post.');

  // Check post content was not changed
  const check = await request('GET', `/${postId}`);
  assert.equal(check.body.content, 'Author1 post');
});

test('8. Admin can edit posts for moderation', async (t) => {
  const { request } = await fixture(t);
  const created = await request('POST', '', { content: 'Inappropriate content' }, 'author1');
  const postId = created.body.id;

  const adminEdit = await request('PUT', `/${postId}`, { content: '[Content moderated by Admin]' }, 'admin');
  assert.equal(adminEdit.status, 200);
  assert.equal(adminEdit.body.content, '[Content moderated by Admin]');
});

test('9. Deleting post cleans up all associated post media safely', async (t) => {
  const { db, request, blobs } = await fixture(t);
  const form = new FormData();
  form.append('content', 'Post to be deleted');
  form.append('images', new Blob([testPng], { type: 'image/png' }), 'del1.png');
  form.append('images', new Blob([testPng], { type: 'image/png' }), 'del2.png');

  const created = await request('POST', '', form, 'author1');
  const postId = created.body.id;
  assert.equal(blobs.size, 2);

  const deleteRes = await request('DELETE', `/${postId}`, undefined, 'author1');
  assert.equal(deleteRes.status, 200);

  // Confirm database records are deleted
  const postInDb = await db.get('SELECT * FROM posts WHERE id = ?', postId);
  assert.equal(postInDb, undefined);
  const mediaInDb = await db.all('SELECT * FROM post_media WHERE post_id = ?', postId);
  assert.equal(mediaInDb.length, 0);

  // Confirm blobs are removed
  assert.equal(blobs.size, 0);
});

test('10. Reject more than 10 images with clear error and cleanup', async (t) => {
  const { request, blobs } = await fixture(t);
  const form = new FormData();
  form.append('content', 'Too many photos');
  for (let i = 0; i < 11; i++) {
    form.append('images', new Blob([testPng], { type: 'image/png' }), `overflow_${i}.png`);
  }

  const res = await request('POST', '', form, 'author1');
  assert.equal(res.status, 400);
  assert.equal(blobs.size, 0);
});
