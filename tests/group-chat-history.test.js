const test = require('node:test');
const assert = require('node:assert/strict');
// Isolate the integration fixture from developer and production data.
process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';
const app = require('../server');
const db = require('../db');
const bcrypt = require('bcryptjs');

test('group chat starts at the latest page and paginates older/newer messages without gaps', async t => {
  await db.initSchema();
  await db.run('INSERT INTO students (studentId, name, passwordHash, role) VALUES (?, ?, ?, ?)',
    'chat_history_test', 'History Tester', bcrypt.hashSync('fixture-password', 4), 'student');
  for (let i = 1; i <= 45; i++) {
    await db.run('INSERT INTO chat_messages (studentId, text, createdAt) VALUES (?, ?, CURRENT_TIMESTAMP)', 'chat_history_test', `Message ${i}`);
  }
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${base}/api/mobile/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: 'chat_history_test', password: 'fixture-password' })
  });
  assert.equal(login.status, 200);
  const { token } = await login.json();
  const get = async path => {
    const response = await fetch(base + path, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    return response.json();
  };
  const initial = await get(`/api/chat/messages?before=2147483647&limit=40`);
  const defaultInitial = await get('/api/chat/messages?since=0&limit=40');
  assert.deepEqual(defaultInitial.messages.map(m => m.id), initial.messages.map(m => m.id));
  assert.equal(initial.messages.length, 40);
  assert.equal(initial.messages[0].text, 'Message 6');
  assert.equal(initial.messages.at(-1).text, 'Message 45');
  const older = await get(`/api/chat/messages?before=${initial.messages[0].id}&limit=30`);
  assert.deepEqual(older.messages.map(m => m.text), ['Message 1', 'Message 2', 'Message 3', 'Message 4', 'Message 5']);
  await db.run('INSERT INTO chat_messages (studentId, text, createdAt) VALUES (?, ?, CURRENT_TIMESTAMP)', 'chat_history_test', 'New arrival');
  const newer = await get(`/api/chat/messages?since=${initial.messages.at(-1).id}`);
  assert.deepEqual(newer.messages.map(m => m.text), ['New arrival']);
  const members = await get('/api/chat/members');
  assert.ok(Array.isArray(members.members));
  assert.equal(members.members.find(m => m.studentId === 'chat_history_test').name, 'History Tester');
});

test('browser and app photo uploads share authenticated durable attachments; storage failures do not create messages', async t => {
  const fs = require('node:fs');
  const path = require('node:path');
  await db.initSchema();
  await db.run('INSERT INTO students (studentId, name, passwordHash, role) VALUES (?, ?, ?, ?)',
    'chat_photo_test', 'Photo Tester', bcrypt.hashSync('fixture-password', 4), 'student');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${base}/api/mobile/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ studentId: 'chat_photo_test', password: 'fixture-password' }) });
  const { token } = await login.json();
  const headers = { Authorization: `Bearer ${token}` };
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4XcAAAAASUVORK5CYII=', 'base64');
  const upload = async field => {
    const body = new FormData();
    body.append(field, new Blob([png], { type: 'image/png' }), 'photo.png');
    return fetch(`${base}/api/chat/messages`, { method: 'POST', headers, body });
  };
  for (const field of ['attachment', 'file']) {
    const sent = await upload(field);
    assert.equal(sent.status, 200);
    const { data } = await sent.json();
    assert.equal(data.attachmentMimeType, 'image/png');
    const filePath = path.join(__dirname, '../uploads', data.attachmentName);
    t.after(() => fs.rmSync(filePath, { force: true }));
    fs.rmSync(filePath, { force: true }); // Simulate another instance / ephemeral disk restart.
    const image = await fetch(`${base}/api/chat/attachment/${data.attachmentName}`, { headers });
    assert.equal(image.status, 200);
    assert.match(image.headers.get('content-type'), /image\/png/);
    assert.match(image.headers.get('cache-control'), /^private/);
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
    const unauth = await fetch(`${base}/api/chat/attachment/${data.attachmentName}`, { redirect: 'manual' });
    assert.notEqual(unauth.status, 200);
  }
  const before = await db.get('SELECT COUNT(*) AS count FROM chat_messages');
  const originalSave = db.saveFileBlob;
  db.saveFileBlob = async () => false;
  try { assert.equal((await upload('attachment')).status, 503); }
  finally { db.saveFileBlob = originalSave; }
  const after = await db.get('SELECT COUNT(*) AS count FROM chat_messages');
  assert.equal(after.count, before.count);
});

test('chat actions validate targets, enforce ownership and remove deleted pins', async t => {
  await db.initSchema();
  for (const [id, role] of [['chat_owner_test', 'student'], ['chat_other_test', 'student'], ['chat_admin_test', 'admin']]) {
    await db.run('INSERT INTO students (studentId,name,passwordHash,role) VALUES (?,?,?,?)', id, id, bcrypt.hashSync('fixture-password', 4), role);
  }
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const tokens = {};
  for (const id of ['chat_owner_test', 'chat_other_test', 'chat_admin_test']) {
    const response = await fetch(`${base}/api/mobile/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ studentId: id, password: 'fixture-password' }) });
    tokens[id] = (await response.json()).token;
  }
  const request = (id, endpoint, method = 'GET', body) => fetch(base + endpoint, {
    method, headers: { Authorization: `Bearer ${tokens[id]}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const owner = 'chat_owner_test', other = 'chat_other_test', admin = 'chat_admin_test';
  assert.equal((await request(owner, '/api/chat/messages', 'POST', { text: ' ' })).status, 400);
  assert.equal((await request(owner, '/api/chat/messages', 'POST', { text: 'x'.repeat(2001) })).status, 400);
  const sent = await (await request(owner, '/api/chat/messages', 'POST', { text: 'Hello 👋\nhttps://example.com' })).json();
  const id = sent.data.id;
  const reply = await (await request(other, '/api/chat/messages', 'POST', { text: 'Reply', replyToId: id })).json();
  assert.equal(reply.data.replyToId, id);
  for (const [emoji, action] of [['👍', 'add'], ['❤️', 'update'], ['❤️', 'remove']]) {
    const result = await (await request(other, '/api/chat/reactions', 'POST', { messageId: id, emoji })).json();
    assert.equal(result.action, action);
  }
  assert.equal((await request(other, `/api/chat/messages/${id}`, 'DELETE')).status, 403);
  assert.equal((await request(other, `/api/chat/pinned/${id}`, 'POST')).status, 403);
  assert.equal((await request(admin, `/api/chat/pinned/${id}`, 'POST')).status, 200);
  assert.equal((await request(owner, '/api/chat/read', 'POST', { lastReadMessageId: -1 })).status, 400);
  await request(other, '/api/chat/read', 'POST', { lastReadMessageId: reply.data.id });
  const receipt = await (await request(other, '/api/chat/read', 'POST', { lastReadMessageId: id })).json();
  assert.equal(receipt.lastReadMessageId, reply.data.id);
  await request(owner, '/api/chat/typing', 'POST', {});
  const delta = await (await request(other, `/api/chat/messages?since=${reply.data.id}&recent=40`)).json();
  assert.ok(delta.recentMessages.some(m => m.id === id));
  assert.ok(delta.typing.some(t => t.studentId === owner));
  assert.equal((await request(owner, `/api/chat/messages/${id}`, 'DELETE')).status, 200);
  assert.equal((await (await request(other, '/api/chat/pinned')).json()).pinned, null);
  assert.equal((await request(other, '/api/chat/reactions', 'POST', { messageId: id, emoji: '👍' })).status, 404);
  assert.equal((await request(other, '/api/chat/messages', 'POST', { text: 'Reply', replyToId: id })).status, 404);
  const history = await (await request(other, '/api/chat/messages')).json();
  assert.equal(history.messages.find(m => m.id === reply.data.id).replyToId, null);
});
