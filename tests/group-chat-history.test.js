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
