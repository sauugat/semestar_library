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

test('unseen incoming message counter semantics: satisfies all 7 scenarios', () => {
  const currentUserId = 'student_me';
  const seenIds = new Set([10, 11, 12]); // historical loaded messages

  // Scenario 1: User at bottom, other person sends messages -> should NOT increment
  assert.equal(
    state.shouldIncrementUnseenCounter(message(13, { studentId: 'other' }), currentUserId, true, seenIds),
    false
  );

  // Scenario 2: User scrolls upward (isNearBottom = false), 3 new messages arrive from other -> increments each
  let counter = 0;
  const arrivals = [
    message(14, { studentId: 'other' }),
    message(15, { studentId: 'other' }),
    message(16, { studentId: 'other' })
  ];
  for (const m of arrivals) {
    if (state.shouldIncrementUnseenCounter(m, currentUserId, false, seenIds)) {
      seenIds.add(m.id);
      counter++;
    }
  }
  assert.equal(counter, 3);
  assert.equal(state.formatUnseenBadge(counter), '3');

  // Scenario 3: Returning to bottom resets counter
  counter = 0;
  assert.equal(state.formatUnseenBadge(counter), '');

  // Scenario 4: User scrolls up and sends own message -> does NOT increment
  assert.equal(
    state.shouldIncrementUnseenCounter(message(17, { studentId: currentUserId }), currentUserId, false, seenIds),
    false
  );

  // Scenario 5: Historical messages from initial load / reconnect / restart -> does NOT increment
  assert.equal(
    state.shouldIncrementUnseenCounter(message(11, { studentId: 'other' }), currentUserId, false, seenIds),
    false
  );

  // Scenario 6: Pagination / older message loads or negative pending ID -> does NOT increment
  assert.equal(
    state.shouldIncrementUnseenCounter(message(-99, { studentId: 'other' }), currentUserId, false, seenIds),
    false
  );

  // Scenario 7: Duplicate realtime event arrives for already-seen message -> does NOT increment
  assert.equal(
    state.shouldIncrementUnseenCounter(message(14, { studentId: 'other' }), currentUserId, false, seenIds),
    false
  );
});

test('formatUnseenBadge: formats counts into clean pill labels', () => {
  assert.equal(state.formatUnseenBadge(0), '');
  assert.equal(state.formatUnseenBadge(-1), '');
  assert.equal(state.formatUnseenBadge(1), '1');
  assert.equal(state.formatUnseenBadge(7), '7');
  assert.equal(state.formatUnseenBadge(99), '99');
  assert.equal(state.formatUnseenBadge(100), '99+');
  assert.equal(state.formatUnseenBadge(999), '99+');
});

test('safeChatFilename: sanitizes spaces and special characters for URI safety', () => {
  assert.equal(state.safeChatFilename('my assignment photo.jpg'), 'my_assignment_photo.jpg');
  assert.equal(state.safeChatFilename('notes [chapter 1] (final).pdf'), 'notes__chapter_1___final_.pdf');
  assert.equal(state.safeChatFilename('normal-file_name.123.png'), 'normal-file_name.123.png');
});

test('formatFileSize: formats bytes into human-readable B, KB, MB, GB and avoids fake 0 KB', () => {
  // Undefined, null, zero or invalid sizes must return null
  assert.equal(state.formatFileSize(undefined), null);
  assert.equal(state.formatFileSize(null), null);
  assert.equal(state.formatFileSize(0), null);
  assert.equal(state.formatFileSize(-100), null);
  assert.equal(state.formatFileSize(NaN), null);

  // Bytes
  assert.equal(state.formatFileSize(512), '512 B');

  // KB
  assert.equal(state.formatFileSize(500 * 1024), '500 KB');
  assert.equal(state.formatFileSize(824 * 1024), '824 KB');
  assert.equal(state.formatFileSize(1024), '1 KB');

  // MB (exact examples from specification)
  assert.equal(state.formatFileSize(Math.round(2.4 * 1024 * 1024)), '2.4 MB');
  assert.equal(state.formatFileSize(15 * 1024 * 1024), '15 MB');
  assert.equal(state.formatFileSize(Math.round(18.7 * 1024 * 1024)), '18.7 MB');

  // GB
  assert.equal(state.formatFileSize(Math.round(1.5 * 1024 * 1024 * 1024)), '1.5 GB');
});

test('formatFileExtension: extracts clean uppercase extension from filename or mime type', () => {
  assert.equal(state.formatFileExtension('Web_Technology_Notes.pdf'), 'PDF');
  assert.equal(state.formatFileExtension('assignment.docx'), 'DOCX');
  assert.equal(state.formatFileExtension('lecture_slides.pptx'), 'PPTX');
  assert.equal(state.formatFileExtension('archive.zip'), 'ZIP');
  assert.equal(state.formatFileExtension('data.xlsx'), 'XLSX');
  assert.equal(state.formatFileExtension('readme.txt'), 'TXT');
  assert.equal(state.formatFileExtension('unknown_file'), 'FILE');
  assert.equal(state.formatFileExtension(null, 'application/pdf'), 'PDF');
  assert.equal(state.formatFileExtension(null, 'application/zip'), 'ZIP');
});

test('formatFileSubtitle: formats "size • type" or gracefully omits size for historical messages', () => {
  // New messages with size
  assert.equal(
    state.formatFileSubtitle('Web_Technology_Notes.pdf', Math.round(2.4 * 1024 * 1024)),
    '2.4 MB • PDF'
  );
  assert.equal(
    state.formatFileSubtitle('assignment.docx', 824 * 1024),
    '824 KB • DOCX'
  );
  assert.equal(
    state.formatFileSubtitle('presentation.pptx', Math.round(18.7 * 1024 * 1024)),
    '18.7 MB • PPTX'
  );

  // Old messages without size: gracefully shows type only, NOT fake "0 KB • PDF"
  assert.equal(state.formatFileSubtitle('Web_Technology_Notes.pdf', undefined), 'PDF');
  assert.equal(state.formatFileSubtitle('notes.pdf', null), 'PDF');
  assert.equal(state.formatFileSubtitle('archive.zip', 0), 'ZIP');
  assert.equal(state.formatFileSubtitle('file_without_size.pdf'), 'PDF');
});

test('double tap heart toggle and reaction dedupe semantics', () => {
  const currentUserId = 'student_alice';
  const initial = [message(10, { reactions: [] })];

  // First double tap: adds ❤️
  const heartAdded = state.applyChatReaction(initial, 10, currentUserId, '❤️', 'add');
  assert.deepEqual(heartAdded[0].reactions, [{ studentId: currentUserId, emoji: '❤️' }]);

  // Second double tap by same user: removes ❤️
  const heartRemoved = state.applyChatReaction(heartAdded, 10, currentUserId, '❤️', 'remove');
  assert.deepEqual(heartRemoved[0].reactions, []);

  // Long-press reaction picker: user chooses 😂 -> updates rather than duplicating
  const reAdded = state.applyChatReaction(initial, 10, currentUserId, '❤️', 'add');
  const switchedToLaugh = state.applyChatReaction(reAdded, 10, currentUserId, '😂', 'update');
  assert.equal(switchedToLaugh[0].reactions.length, 1);
  assert.deepEqual(switchedToLaugh[0].reactions[0], { studentId: currentUserId, emoji: '😂' });

  // Another user also reacts: both reactions are tracked separately
  const otherUserReacts = state.applyChatReaction(switchedToLaugh, 10, 'student_bob', '❤️', 'add');
  assert.equal(otherUserReacts[0].reactions.length, 2);
  assert.deepEqual(otherUserReacts[0].reactions, [
    { studentId: currentUserId, emoji: '😂' },
    { studentId: 'student_bob', emoji: '❤️' },
  ]);
});



