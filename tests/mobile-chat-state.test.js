const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../mobile/node_modules/typescript');
function loadTs(file, imports = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../mobile/services', file), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', js)(name => { if (!imports[name]) throw Error(`Unexpected import ${name}`); return imports[name]; }, module, module.exports);
  return module.exports;
}
const state = loadTs('chat-state.ts');
const message = (id, overrides = {}) => ({ id, text: `Message ${id}`, studentId: 'alice', createdAt: '2026-09-28T00:00:00Z', ...overrides });
test('newest first, pagination preserves order, and send/broadcast duplicates merge', () => {
  const initial = state.mergeChatMessages([], [message(3), message(5), message(4)]);
  assert.deepEqual(initial.map(m => m.id), [5, 4, 3]);
  const older = state.mergeChatMessages(initial, [message(1), message(2), message(3)]);
  assert.deepEqual(older.map(m => m.id), [5, 4, 3, 2, 1]);
  const sent = state.mergeChatMessages(older, [message(6), message(5, { text: 'Updated' })]);
  assert.equal(sent.length, 6);
  assert.equal(sent[1].text, 'Updated');
  assert.deepEqual(older.map(m => m.id), [5, 4, 3, 2, 1]);
});
test('reaction update replaces one user reaction and duplicate broadcasts are idempotent', () => {
  const initial = [message(1, { reactions: [{ studentId: 'alice', emoji: '👍' }, { studentId: 'bob', emoji: '❤️' }] })];
  const updated = state.applyChatReaction(initial, 1, 'alice', '🎉', 'update');
  assert.deepEqual(updated[0].reactions, [{ studentId: 'bob', emoji: '❤️' }, { studentId: 'alice', emoji: '🎉' }]);
  assert.deepEqual(state.applyChatReaction(updated, 1, 'alice', '🎉', 'add'), updated);
  assert.deepEqual(state.applyChatReaction(updated, 1, 'alice', '🎉', 'remove')[0].reactions, [{ studentId: 'bob', emoji: '❤️' }]);
  assert.equal(initial[0].reactions[0].emoji, '👍');
});
test('SQLite UTC timestamps and server ISO timestamps represent the same instant', () => {
  assert.equal(state.parseChatDate('2026-09-28 00:15:30').toISOString(), '2026-09-28T00:15:30.000Z');
  assert.equal(state.parseChatDate('2026-09-28T06:00:30+05:45').toISOString(), '2026-09-28T00:15:30.000Z');
});
test('attachment names cannot escape cache directories', () => {
  assert.equal(state.safeChatFilename('notes.pdf'), 'notes.pdf');
  assert.ok(!state.safeChatFilename('../../notes.pdf').includes('/'));
  assert.ok(!state.safeChatFilename('..\\notes.pdf').includes('\\'));
  assert.equal(state.safeChatFilename(''), 'attachment');
});
test('service sends PostgreSQL-safe latest cursor and preserves explicit since=0', async () => {
  const calls = [];
  const chat = loadTs('chat.ts', { './api': { api: { get: async url => { calls.push(url); return { messages: [], readReceipts: [] }; } } } });
  await chat.fetchChatMessages({ before: chat.CHAT_LATEST_CURSOR, limit: chat.CHAT_PAGE_SIZE });
  await chat.fetchChatMessages({ since: 0 });
  assert.equal(calls[0], '/api/chat/messages?before=2147483647&limit=40');
  assert.equal(calls[1], '/api/chat/messages?since=0');
  assert.ok(chat.CHAT_LATEST_CURSOR <= 2147483647);
});

test('polling snapshot reconciles deletions and reactions without losing older pages or unpolled sends', () => {
  const existing = [message(100), message(50), message(49), message(48), message(5)];
  const snapshot = [message(50, { reactions: [{ studentId: 'bob', emoji: '👍' }] }), message(48)];
  const result = state.reconcileChatSnapshot(existing, snapshot, 50);
  assert.deepEqual(result.map(m => m.id), [100, 50, 48, 5]);
  assert.equal(result[1].reactions[0].emoji, '👍');
  assert.deepEqual(state.reconcileChatSnapshot([message(5)], [], 5), []);
});

test('pending sends stay newest and a broadcast cannot hide a disconnected history gap', () => {
  assert.deepEqual(state.mergeChatMessages([message(9)], [message(-1), message(-2)]).map(m => m.id), [-2, -1, 9]);
  const existing = [message(100), message(10), message(9)];
  const result = state.reconcileChatSnapshot(existing, [message(99), message(100)], 100, 10);
  assert.deepEqual(result.map(m => m.id), [100, 99]);
  assert.deepEqual(state.reconcileChatSnapshot(existing, [], 100, 10), []);
});

test('client-side clientId replaces pending temporary message in-place without duplicate bubbles', () => {
  const pending1 = { ...message(-101), clientId: 'c_abc_1', status: 'pending', text: 'Hello 1' };
  const pending2 = { ...message(-102), clientId: 'c_abc_2', status: 'pending', text: 'Hello 2' };
  const existing = [pending2, pending1, message(50)];

  // Server confirms pending1 with positive id 51 and matching clientId
  const confirmed1 = { ...message(51), clientId: 'c_abc_1', status: 'sent', text: 'Hello 1' };
  const updated = state.mergeChatMessages(existing, [confirmed1]);

  // Should have exactly 3 messages, with pending1 (-101) replaced by confirmed1 (51)
  assert.equal(updated.length, 3);
  assert.equal(updated.find(m => m.clientId === 'c_abc_1').id, 51);
  assert.equal(updated.find(m => m.clientId === 'c_abc_1').status, 'sent');
  assert.equal(updated.filter(m => m.clientId === 'c_abc_1').length, 1);
});

