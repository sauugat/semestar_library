'use strict';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../mobile/node_modules/typescript');
function load(file, imports = {}) {
  const js = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../mobile/services', file), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', js)(name => imports[name], module, module.exports);
  return module.exports;
}
const state = load('dm-state.ts');
const pending = { id: 'local1', clientId: 'local1', senderId: 'alice', conversationId: 'room', text: 'hello', createdAt: '2026-10-09T00:00:00Z', status: 'pending' };
const confirmed = { ...pending, id: 10, status: undefined };
test('history cannot erase pending; echo and acknowledgement reconcile in either order', () => {
  for (const incoming of [[confirmed, confirmed], [confirmed]]) {
    let messages = state.mergeDmMessages([pending], [{ ...confirmed, id: 9, clientId: 'older' }]);
    for (const message of incoming) messages = state.mergeDmMessages(messages, [message]);
    assert.equal(messages.length, 2);
    assert.equal(messages[0].id, 10);
    assert.equal(messages[0].status, 'sent');
    assert.equal(state.failDmMessage(messages, 'local1')[0].status, 'sent');
    assert.equal(state.mergeDmMessages(messages, [pending])[0].id, 10);
  }
});
test('sender-scoped client identity and descending pagination order', () => {
  const messages = state.mergeDmMessages([pending], [{ ...confirmed, senderId: 'bob' }, { ...confirmed, id: 8, clientId: 'other' }]);
  assert.equal(messages.length, 3);
  assert.deepEqual(state.mergeDmMessages([], [{ ...confirmed, id: 1 }, { ...confirmed, id: 3, clientId: '3' }, { ...confirmed, id: 2, clientId: '2' }]).map(m => m.id), [3,2,1]);
});
test('read coalescer suppresses duplicates, serializes progress and retries after failure', async () => {
  const calls = []; let release;
  const reader = state.createReadCoalescer(id => { calls.push(id); return new Promise(r => { release = r; }); }, 1);
  reader.request(10); reader.request(10); reader.request(9);
  await new Promise(r => setTimeout(r, 10));
  reader.request(11); reader.request(12);
  assert.deepEqual(calls, [10]); release();
  await new Promise(r => setTimeout(r, 10));
  assert.deepEqual(calls, [10,12]); release();
  await new Promise(r => setTimeout(r, 10)); reader.request(12); reader.stop();
  assert.deepEqual(calls, [10,12]);
  let attempts = 0;
  const retry = state.createReadCoalescer(async () => { if (++attempts === 1) throw Error('offline'); }, 1);
  retry.request(4); await new Promise(r => setTimeout(r, 10));
  retry.request(4); await new Promise(r => setTimeout(r, 10)); retry.stop();
  assert.equal(attempts, 2);
});
test('outbox survives restart, isolates accounts, and logout fences late writes', async () => {
  const memory = new Map();
  const storage = { getItem: async k => memory.get(k) || null, setItem: async (k,v) => memory.set(k,v), removeItem: async k => memory.delete(k), getAllKeys: async () => [...memory.keys()], multiRemove: async keys => keys.forEach(k => memory.delete(k)) };
  const imports = { '@react-native-async-storage/async-storage': { default: storage } };
  const outbox = load('dm-outbox.ts', imports);
  await outbox.updateDmOutbox('alice', 'room', pending, 0);
  assert.equal((await load('dm-outbox.ts', imports).readDmOutbox('alice', 'room')).length, 1);
  assert.equal((await outbox.readDmOutbox('bob', 'room')).length, 0);
  await outbox.updateDmOutbox('alice', 'room', confirmed, 0);
  assert.equal((await outbox.readDmOutbox('alice', 'room')).length, 0);
  await outbox.clearDmOutbox();
  await outbox.updateDmOutbox('alice', 'room', pending, 0);
  assert.equal(memory.size, 0);
});
test('server event shape, public API key and scoped JWT reach private client correctly', async () => {
  const handlers = {}; let received, reader, key, jwt, stopped = false;
  const channel = { on(_kind, filter, cb) { handlers[filter.event] = cb; return this; }, subscribe(cb) { cb('SUBSCRIBED'); return this; } };
  const rt = load('dm-realtime.ts', {
    './api': { ApiError: class extends Error {} },
    './dm': { fetchDmRealtimeConfig: async () => ({ topic: 'dm:room:1', token: 'scoped-token', key: 'public-key', supabaseUrl: 'https://example.supabase.co', expiresAt: new Date(Date.now()+120000).toISOString() }) },
    '@supabase/supabase-js': { createClient: (_url, apiKey) => { key = apiKey; return { realtime: { setAuth: async token => { jwt = token; } }, channel: (_topic, opts) => { assert.equal(opts.config.private, true); return channel; }, removeChannel: async () => { stopped = true; }, removeAllChannels: async () => {} }; } },
  });
  const cancel = rt.subscribeDmConversationRealtime('room', { onNewMessage: m => { received = m; }, onReadReceipt: p => { reader = p.readerId; } });
  await new Promise(r => setImmediate(r));
  handlers['dm:message:new']({ payload: { ...confirmed, id: undefined, messageId: 10 } });
  handlers['dm:read:updated']({ payload: { studentId: 'bob', lastReadMessageId: 10 } });
  assert.equal(received.id, 10); assert.equal(reader, 'bob'); assert.equal(key, 'public-key'); assert.equal(jwt, 'scoped-token');
  cancel(); assert.equal(stopped, true);
});

test('request timing emits only numeric durations and opaque correlation ID', async t => {
  const express = require('express');
  const { messagingTiming, measure } = require('../lib/request-timing');
  const app = express(); app.use(messagingTiming);
  app.get('/api/dm/test', async (_req, res) => {
    await measure('auth', () => measure('db', async () => new Promise(r => setTimeout(r, 2))));
    res.json({ ok: true });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/dm/test?token=must-not-appear`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('x-request-id'), /^[a-f0-9-]{36}$/);
  assert.match(response.headers.get('server-timing'), /auth;dur=[\d.]+, db;dur=[\d.]+, total;dur=[\d.]+, queries;desc="1"/);
  assert.ok(!JSON.stringify([...response.headers]).includes('must-not-appear'));
});
