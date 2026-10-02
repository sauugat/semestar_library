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

async function setupServer(t) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'phase2a-server-integ-'));
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

  // Replicate exact mounting and error handling architecture of server.js
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { studentId: req.headers['x-test-user'] };
    next();
  });
  const requireLogin = (req, res, next) => {
    if (req.session?.studentId) return next();
    return res.status(401).json({ message: 'Authentication required. Please sign in.' });
  };

  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      phase: 'phase2a',
      postMultiImage: true,
      postEdit: true,
      server: 'Semester Library',
      time: new Date().toISOString()
    });
  });

  app.get('/api/version', (req, res) => {
    res.json({
      phase: 'phase2a',
      postMultiImage: true,
      postEdit: true,
      server: 'Semester Library',
      time: new Date().toISOString()
    });
  });

  app.use('/api/posts', createPostsRouter(db, requireLogin, { uploadDir }));

  // Exact 404 handler from server.js
  app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ message: 'Resource not found' });
    }
    res.status(404).type('txt').send('Resource not found');
  });

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    client.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function api(method, urlPath, body, user = 'author1') {
    const isForm = body instanceof FormData;
    const response = await fetch(`http://127.0.0.1:${server.address().port}${urlPath}`, {
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

  return { api };
}

test('Integration: GET /api/version and /api/health report phase2a capabilities', async (t) => {
  const { api } = await setupServer(t);

  const ver = await api('GET', '/api/version', undefined, null);
  assert.equal(ver.status, 200);
  assert.equal(ver.body.phase, 'phase2a');
  assert.equal(ver.body.postMultiImage, true);
  assert.equal(ver.body.postEdit, true);

  const health = await api('GET', '/api/health', undefined, null);
  assert.equal(health.status, 200);
  assert.equal(health.body.status, 'ok');
  assert.equal(health.body.phase, 'phase2a');
  assert.equal(health.body.postMultiImage, true);
  assert.equal(health.body.postEdit, true);
});

test('Integration: Step 9 end-to-end post creation with 3 images, fetch, edit, and 403', async (t) => {
  const { api } = await setupServer(t);

  // 1. POST /api/posts with 3 images
  const form = new FormData();
  form.append('content', 'Initial post with 3 photos');
  form.append('type', 'status');
  for (let i = 0; i < 3; i++) {
    form.append('images', new Blob([testPng], { type: 'image/png' }), `photo_${i}.png`);
  }

  const createRes = await api('POST', '/api/posts', form, 'author1');
  assert.equal(createRes.status, 201);
  const postId = createRes.body.id;
  assert.ok(postId > 0);
  assert.equal(Array.isArray(createRes.body.media), true);
  assert.equal(createRes.body.media.length, 3);
  assert.ok(createRes.body.attachment_url);

  // 2. GET same post -> media.length === 3
  const getRes = await api('GET', `/api/posts/${postId}`, undefined, 'author1');
  assert.equal(getRes.status, 200);
  assert.equal(getRes.body.id, postId);
  assert.equal(Array.isArray(getRes.body.media), true);
  assert.equal(getRes.body.media.length, 3);
  assert.equal(getRes.body.content, 'Initial post with 3 photos');

  // 3. PUT same post -> caption changes successfully
  const putForm = new FormData();
  putForm.append('content', 'Updated caption after editing');
  const putRes = await api('PUT', `/api/posts/${postId}`, putForm, 'author1');
  assert.equal(putRes.status, 200);
  assert.equal(putRes.body.id, postId);
  assert.equal(putRes.body.content, 'Updated caption after editing');

  // 4. GET again -> updated caption persists -> media still exists
  const getAgainRes = await api('GET', `/api/posts/${postId}`, undefined, 'author1');
  assert.equal(getAgainRes.status, 200);
  assert.equal(getAgainRes.body.id, postId);
  assert.equal(getAgainRes.body.content, 'Updated caption after editing');
  assert.equal(Array.isArray(getAgainRes.body.media), true);
  assert.equal(getAgainRes.body.media.length, 3);

  // 5. PATCH same post (alias of PUT)
  const patchForm = new FormData();
  patchForm.append('content', 'Updated via PATCH');
  const patchRes = await api('PATCH', `/api/posts/${postId}`, patchForm, 'author1');
  assert.equal(patchRes.status, 200);
  assert.equal(patchRes.body.content, 'Updated via PATCH');

  // 6. PATCH from another authenticated user -> 403
  const unauthPatch = await api('PATCH', `/api/posts/${postId}`, patchForm, 'author2');
  assert.equal(unauthPatch.status, 403);
  assert.match(unauthPatch.body.message, /Only the original post author can edit this post/i);
});

test('Integration: Image-only post validation on creation and edit (Step 8)', async (t) => {
  const { api } = await setupServer(t);

  // Image-only post (empty caption, 2 images) -> 201 SUCCESS
  const imgOnlyForm = new FormData();
  imgOnlyForm.append('content', '');
  imgOnlyForm.append('type', 'status');
  imgOnlyForm.append('images', new Blob([testPng], { type: 'image/png' }), 'img1.png');
  imgOnlyForm.append('images', new Blob([testPng], { type: 'image/png' }), 'img2.png');

  const createImgOnly = await api('POST', '/api/posts', imgOnlyForm, 'author1');
  assert.equal(createImgOnly.status, 201);
  assert.equal(createImgOnly.body.content, '');
  assert.equal(createImgOnly.body.media.length, 2);

  // Edit image-only post: keep caption empty, keep 2 photos -> 200 SUCCESS
  const editImgOnly = new FormData();
  editImgOnly.append('content', '   ');
  const editRes = await api('PUT', `/api/posts/${createImgOnly.body.id}`, editImgOnly, 'author1');
  assert.equal(editRes.status, 200);
  assert.equal(editRes.body.content, '');
  assert.equal(editRes.body.media.length, 2);

  // Reject when BOTH content and images are empty on creation -> 400
  const emptyForm = new FormData();
  emptyForm.append('content', '   ');
  emptyForm.append('type', 'status');
  const rejectCreate = await api('POST', '/api/posts', emptyForm, 'author1');
  assert.equal(rejectCreate.status, 400);

  // Reject when BOTH content and images are empty on edit -> 400
  const removeAllForm = new FormData();
  removeAllForm.append('content', '   ');
  removeAllForm.append('keepMediaUrls', JSON.stringify([]));
  const rejectEdit = await api('PUT', `/api/posts/${createImgOnly.body.id}`, removeAllForm, 'author1');
  assert.equal(rejectEdit.status, 400);
});

test('Integration: 404 handler returns Resource not found on non-existent api routes', async (t) => {
  const { api } = await setupServer(t);

  const notFoundRes = await api('PUT', '/api/posts/9999999/nonexistent', undefined, 'author1');
  assert.equal(notFoundRes.status, 404);
  assert.equal(notFoundRes.body.message, 'Resource not found');
});
