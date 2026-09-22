const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createClient } = require('@libsql/client');
const { ensurePostsSchema } = require('../lib/posts');
const createPostsRouter = require('../routes/posts');

async function fixture(t) {
  const client = createClient({ url: ':memory:' });
  const db = {
    isPostgres: false,
    exec: sql => client.executeMultiple(sql),
    all: async (sql, ...args) => (await client.execute({ sql, args })).rows,
    get: async (sql, ...args) => (await client.execute({ sql, args })).rows[0],
    run: async (sql, ...args) => {
      const result = await client.execute({ sql, args });
      return { lastInsertRowid: Number(result.lastInsertRowid), changes: result.rowsAffected };
    },
    initSchema: async () => {}
  };
  await db.exec(`CREATE TABLE students (studentId TEXT PRIMARY KEY, name TEXT, role TEXT, avatarUrl TEXT);
    INSERT INTO students VALUES ('owner', 'Post Author', 'student', '/avatar.png'),
      ('other', 'Other Student', 'cr', NULL), ('admin', 'Admin', 'admin', NULL);`);
  await ensurePostsSchema(db);
  await ensurePostsSchema(db);
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { studentId: req.headers['x-test-user'] };
    next();
  });
  const requireLogin = (req, res, next) => req.session.studentId
    ? next() : res.status(401).json({ message: 'Authentication required.' });
  app.use('/api/posts', createPostsRouter(db, requireLogin));
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    client.close();
  });
  async function request(method, path = '', body, user = 'owner') {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/posts${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(user ? { 'x-test-user': user } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  }
  return { db, request };
}

test('posts require login; guests and stale accounts cannot mutate', async t => {
  const { request } = await fixture(t);
  for (const [method, path] of [['GET', ''], ['POST', ''], ['POST', '/1/like'], ['DELETE', '/1/like'], ['DELETE', '/1']]) {
    assert.equal((await request(method, path, undefined, null)).status, 401);
  }
  for (const user of ['guest', 'missing']) {
    assert.equal((await request('POST', '', { content: 'hello' }, user)).status, 403);
    assert.equal((await request('POST', '/1/like', undefined, user)).status, 403);
    assert.equal((await request('DELETE', '/1', undefined, user)).status, 403);
  }
});

test('create validates content, type and attachment and derives identity from the session', async t => {
  const { request } = await fixture(t);
  for (const body of [{}, { content: '   ' }, { content: 42 }, { content: 'x'.repeat(5001) },
    { content: 'ok', type: 'invalid' }, { content: 'ok', attachment_url: 'javascript:alert(1)' },
    { content: 'ok', attachment_url: {} }]) {
    assert.equal((await request('POST', '', body)).status, 400);
  }
  for (const type of ['status', 'assignment', 'notice']) {
    const result = await request('POST', '', {
      content: '  Hello\nclass <script>alert(1)</script>  ', type,
      attachment_url: 'https://example.com/notes.pdf', user_id: 'admin'
    });
    assert.equal(result.status, 201);
    assert.equal(result.body.user_id, 'owner');
    assert.equal(result.body.studentId, 'owner');
    assert.equal(result.body.name, 'Post Author');
    assert.equal(result.body.avatarUrl, '/avatar.png');
    assert.equal(result.body.role, 'student');
    assert.equal(result.body.content, 'Hello\nclass <script>alert(1)</script>');
    assert.equal(result.body.type, type);
    assert.equal(result.body.liked_by_me, false);
    assert.equal(result.body.like_count, 0);
    assert.equal(result.body.submission_count, 0);
    assert.equal(result.body.liked, false);
    assert.equal(result.body.likeCount, 0);
    assert.equal(result.body.submittedCount, 0);
    assert.equal(result.body.canDelete, true);
    assert.ok(Number.isFinite(Date.parse(result.body.created_at)));
  }
  const result = await request('POST', '', { content: 'Default status' });
  assert.equal(result.body.type, 'status');
  assert.equal(result.body.attachment_url, null);
});

test('cursor pagination is newest first without duplicates when new posts arrive', async t => {
  const { request } = await fixture(t);
  for (let i = 0; i < 5; i++) await request('POST', '', { content: `Post ${i}` });
  const first = (await request('GET', '?limit=2')).body;
  assert.deepEqual(first.posts.map(p => p.id), [5, 4]);
  assert.equal(first.nextCursor, 4);
  await request('POST', '', { content: 'Arrived between pages' });
  const second = (await request('GET', '?limit=2&before=4')).body;
  assert.deepEqual(second.posts.map(p => p.id), [3, 2]);
  const third = (await request('GET', '?limit=2&before=2')).body;
  assert.deepEqual(third.posts.map(p => p.id), [1]);
  assert.equal(third.nextCursor, null);
  assert.equal((await request('GET', '')).body.posts.length, 6);
  assert.deepEqual((await request('GET', '?before=1')).body, { posts: [], nextCursor: null });
  for (const query of ['?limit=0', '?limit=101', '?limit=abc', '?limit=1.5', '?before=0', '?before=-1', '?before=1 OR 1=1', '?limit=2&limit=3']) {
    assert.equal((await request('GET', query)).status, 400);
  }
});

test('likes are idempotent, isolated by user and counted separately from submissions', async t => {
  const { db, request } = await fixture(t);
  await request('POST', '', { content: 'Assignment', type: 'assignment' });
  const results = await Promise.all(Array.from({ length: 4 }, () => request('POST', '/1/like')));
  results.forEach(result => assert.deepEqual(result.body, { liked_by_me: true, like_count: 1, liked: true, likeCount: 1 }));
  assert.deepEqual((await request('POST', '/1/like', undefined, 'other')).body, { liked_by_me: true, like_count: 2, liked: true, likeCount: 2 });
  await db.run('INSERT INTO post_submissions (post_id, user_id) VALUES (?, ?)', 1, 'owner');
  await db.run('INSERT INTO post_submissions (post_id, user_id) VALUES (?, ?)', 1, 'other');
  const post = (await request('GET')).body.posts[0];
  assert.equal(post.like_count, 2);
  assert.equal(post.submission_count, 2);
  assert.equal(post.liked_by_me, true);
  assert.equal(post.likeCount, 2);
  assert.equal(post.submittedCount, 2);
  assert.equal(post.liked, true);
  assert.equal((await request('GET', '', undefined, 'admin')).body.posts[0].liked_by_me, false);
  for (let i = 0; i < 2; i++) {
    assert.deepEqual((await request('DELETE', '/1/like')).body, { liked_by_me: false, like_count: 1, liked: false, likeCount: 1 });
  }
  assert.equal((await request('GET')).body.posts[0].liked, false);
});

test('only owner or database-verified admin can delete; related rows cascade', async t => {
  const { db, request } = await fixture(t);
  await request('POST', '', { content: 'Owner post' });
  await request('POST', '/1/like', undefined, 'other');
  await db.run('INSERT INTO post_submissions (post_id, user_id) VALUES (?, ?)', 1, 'other');
  assert.equal((await request('GET', '', undefined, 'other')).body.posts[0].canDelete, false);
  assert.equal((await request('DELETE', '/1', undefined, 'other')).status, 403);
  assert.equal((await request('GET', '', undefined, 'admin')).body.posts[0].canDelete, true);
  assert.equal((await request('DELETE', '/1', undefined, 'admin')).status, 200);
  assert.equal(Number((await db.get('SELECT COUNT(*) AS c FROM post_likes')).c), 0);
  assert.equal(Number((await db.get('SELECT COUNT(*) AS c FROM post_submissions')).c), 0);
  const next = await request('POST', '', { content: 'Another post' });
  assert.equal((await request('DELETE', `/${next.body.id}`)).status, 200);
});

test('invalid and missing IDs are rejected; constraints reject orphan and duplicate rows', async t => {
  const { db, request } = await fixture(t);
  for (const method of ['POST', 'DELETE']) {
    assert.equal((await request(method, '/abc/like')).status, 400);
    assert.equal((await request(method, '/999/like')).status, 404);
  }
  assert.equal((await request('DELETE', '/999')).status, 404);
  assert.equal((await request('DELETE', '/-1')).status, 400);
  await assert.rejects(db.run('INSERT INTO post_likes VALUES (?, ?)', 999, 'owner'));
  await assert.rejects(db.run('INSERT INTO posts (user_id, content, type) VALUES (?, ?, ?)', 'owner', 'ok', 'bad'));
  await request('POST', '', { content: 'Test' });
  await db.run('INSERT INTO post_submissions (post_id, user_id) VALUES (?, ?)', 1, 'owner');
  await assert.rejects(db.run('INSERT INTO post_submissions (post_id, user_id) VALUES (?, ?)', 1, 'owner'));
});


test('submission counts apply only to assignments and joining counts does not multiply rows', async t => {
  const { db, request } = await fixture(t);
  for (const type of ['status', 'notice', 'assignment']) {
    const created = await request('POST', '', { content: type, type });
    const id = created.body.id;
    for (const user of ['owner', 'other']) {
      await request('POST', `/${id}/like`, undefined, user);
      await db.run('INSERT INTO post_submissions (post_id, user_id) VALUES (?, ?)', id, user);
    }
  }
  const posts = (await request('GET')).body.posts;
  assert.equal(posts.length, 3);
  posts.forEach(post => {
    assert.equal(post.like_count, 2);
    assert.equal(post.liked_by_me, true);
    assert.equal(post.submission_count, post.type === 'assignment' ? 2 : 0);
  });
});

test('schema initialization preserves existing posts and engagement', async t => {
  const { db, request } = await fixture(t);
  await request('POST', '', { content: 'Keep me', type: 'assignment' });
  await request('POST', '/1/like');
  await db.run('INSERT INTO post_submissions (post_id, user_id) VALUES (?, ?)', 1, 'other');
  await ensurePostsSchema(db);
  const post = (await request('GET')).body.posts[0];
  assert.equal(post.content, 'Keep me');
  assert.equal(post.like_count, 1);
  assert.equal(post.submission_count, 1);
});
