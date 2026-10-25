'use strict';

process.env.NODE_ENV = 'test';
process.env.DM_ENABLED = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { fixture } = require('./helpers/cohort-fixture');
const { migrateDirectMessaging } = require('../migrations/005-direct-messaging-schema');
const { createDmService, VALID_REPORT_REASONS } = require('../lib/dm-service');
const ts = require('../mobile/node_modules/typescript');

async function createRealServiceFixture(t) {
  const f = await fixture('sqlite', { migrate: true });
  t.after(f.close);

  await migrateDirectMessaging(f.db, { disposable: true });

  const studentCols = (await f.db.all('PRAGMA table_info(students)')).map(c => c.name);
  if (!studentCols.includes('verification_status')) {
    await f.db.run("ALTER TABLE students ADD COLUMN verification_status TEXT DEFAULT 'unverified'");
  }

  for (const [id, name, role] of [
    ['student_a', 'Alice Student', 'student'],
    ['student_b', 'Bob Student', 'student'],
    ['teacher_a', 'Prof Teacher', 'teacher'],
  ]) {
    await f.db.run(
      'INSERT OR REPLACE INTO students (studentId, name, username, role, department, semester, verification_status, supabase_uid) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      id, name, id, role, 'BIT', 1, 'verified', `00000000-0000-4000-8000-${id.padEnd(12, '0').slice(0, 12)}`
    );
  }

  const dmService = createDmService(f.db);
  return { db: f.db, dmService };
}

test('Contract B1: getOrCreateConversation returns BOTH flat fields and nested conversation object without hardcoded unreadCount', async t => {
  const { dmService } = await createRealServiceFixture(t);

  const created = await dmService.getOrCreateConversation('student_a', 'student_b');

  // Flat fields
  assert.ok(typeof created.conversationId === 'string' && created.conversationId.length > 0);
  assert.equal(created.isNew, true);
  assert.equal(created.participant.studentId, 'student_b');
  assert.equal(created.participant.name, 'Bob Student');
  assert.equal(typeof created.isBlockedByCaller, 'boolean');
  assert.equal(typeof created.isBlockedByPeer, 'boolean');
  assert.equal(typeof created.realtimeEpoch, 'number');

  // Nested conversation object consumed by web and mobile clients
  assert.ok(created.conversation && typeof created.conversation === 'object');
  assert.equal(created.conversation.id, created.conversationId);
  assert.deepEqual(created.conversation.participant, created.participant);
  assert.equal(created.conversation.isBlocked, false);
  assert.equal(created.conversation.isBlockedByCaller, false);
  assert.equal(created.conversation.isBlockedByPeer, false);
  assert.equal(created.conversation.realtimeEpoch, created.realtimeEpoch);
  assert.equal('unreadCount' in created.conversation, false, 'Must not hard-code unreadCount on new conversation object');

  // Second call returns existing conversation with identical ID in both shapes
  const existing = await dmService.getOrCreateConversation('student_b', 'student_a');
  assert.equal(existing.isNew, false);
  assert.equal(existing.conversationId, created.conversationId);
  assert.equal(existing.conversation.id, created.conversationId);
});

test('Contract B2: editMessage returns BOTH flat fields and nested message object; clients never replace state with undefined', async t => {
  const { dmService } = await createRealServiceFixture(t);

  const { conversationId } = await dmService.getOrCreateConversation('student_a', 'student_b');
  const sent = await dmService.sendMessage('student_a', conversationId, {
    clientId: randomUUID(),
    text: 'Initial message text',
  });
  const msgId = sent.message.id;

  const edited = await dmService.editMessage('student_a', conversationId, msgId, {
    text: 'Edited message text',
  });

  // Flat fields
  assert.equal(edited.success, true);
  assert.equal(edited.messageId, msgId);
  assert.equal(edited.text, 'Edited message text');
  assert.ok(typeof edited.editedAt === 'string');

  // Nested message object
  assert.ok(edited.message && typeof edited.message === 'object');
  assert.equal(edited.message.id, msgId);
  assert.equal(edited.message.conversationId, conversationId);
  assert.equal(edited.message.senderId, 'student_a');
  assert.equal(edited.message.text, 'Edited message text');
  assert.equal(edited.message.isEdited, true);
  assert.equal(edited.message.editedAt, edited.editedAt);
  assert.ok(edited.message.createdAt);

  // Verify mobile dm.ts editDmMessage tolerance for flat-only response
  const dmTsSource = fs.readFileSync(path.join(__dirname, '../mobile/services/dm.ts'), 'utf8');
  const dmJs = ts.transpileModule(dmTsSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;

  let mockResponsePayload = { success: true, messageId: msgId, text: 'Fallback flat edit', editedAt: edited.editedAt };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', dmJs)(
    (id) => {
      if (id === './api') {
        return {
          ApiError: class extends Error {},
          apiFetch: async () => ({
            ok: true,
            json: async () => mockResponsePayload,
          }),
        };
      }
      throw new Error(`Unexpected import: ${id}`);
    },
    mod,
    mod.exports
  );

  const fallbackResult = await mod.exports.editDmMessage(conversationId, msgId, 'Fallback flat edit');
  assert.ok(fallbackResult, 'editDmMessage must never return undefined even if server omits data.message');
  assert.equal(fallbackResult.id, msgId);
  assert.equal(fallbackResult.text, 'Fallback flat edit');
  assert.equal(fallbackResult.isEdited, true);
});

test('Contract B3: Mobile report reasons match VALID_REPORT_REASONS and DB CHECK constraint', async t => {
  const { db, dmService } = await createRealServiceFixture(t);
  const { conversationId } = await dmService.getOrCreateConversation('student_a', 'student_b');

  const mobileDmSource = fs.readFileSync(path.join(__dirname, '../mobile/app/dm/[id].tsx'), 'utf8');
  assert.ok(!mobileDmSource.includes("'HARASSMENT'"), 'Must not contain uppercase HARASSMENT');
  assert.ok(!mobileDmSource.includes("'INAPPROPRIATE'"), 'Must not contain uppercase INAPPROPRIATE');

  const arrayMatch = mobileDmSource.match(/\[\s*'harassment'\s*,\s*'spam'\s*,\s*'inappropriate_content'\s*,\s*'other'\s*\]/);
  assert.ok(arrayMatch, 'Mobile report modal must use lowercase reasons with inappropriate_content');

  const mobileReasons = ['harassment', 'spam', 'inappropriate_content', 'other'];
  for (const reason of mobileReasons) {
    assert.ok(VALID_REPORT_REASONS.includes(reason), `Reason ${reason} must be in VALID_REPORT_REASONS`);
    const res = await dmService.reportMessage('student_a', {
      conversationId,
      reportedUserId: 'student_b',
      reason,
      description: `Test report for ${reason}`,
    });
    assert.ok(res.reportId);
    assert.equal(res.status, 'pending');
  }

  // Verify DB CHECK constraint rejects uppercase reason directly
  await assert.rejects(
    () =>
      db.run(
        `INSERT INTO dm_reports (id, reporter_id, reported_id, conversation_id, reason, message_snapshot_text, status)
         VALUES (?, 'student_a', 'student_b', ?, 'INAPPROPRIATE', 'snap', 'pending')`,
        randomUUID(),
        conversationId
      ),
    /CHECK constraint failed/i
  );
});

test('Contract B5: markRead and syncConversation return exact shapes consumed by web and mobile clients', async t => {
  const { db, dmService } = await createRealServiceFixture(t);

  const { conversationId } = await dmService.getOrCreateConversation('student_a', 'student_b');
  const sent1 = await dmService.sendMessage('student_a', conversationId, {
    clientId: randomUUID(),
    text: 'Message 1',
  });
  const sent2 = await dmService.sendMessage('student_a', conversationId, {
    clientId: randomUUID(),
    text: 'Message 2',
  });

  // Student B marks message 2 as read
  const readRes = await dmService.markRead('student_b', conversationId, {
    lastReadMessageId: sent2.message.id,
  });
  assert.equal(readRes.conversationId, conversationId);
  assert.equal(readRes.lastReadMessageId, sent2.message.id);

  // Verify outbox event for read receipt uses studentId
  const outboxEvent = await db.get(
    "SELECT payload_json FROM dm_realtime_outbox WHERE conversation_id = ? AND event_type = 'dm:read:updated' ORDER BY created_at DESC LIMIT 1",
    conversationId
  );
  assert.ok(outboxEvent);
  const parsedEvent = JSON.parse(outboxEvent.payload_json);
  assert.equal(parsedEvent.studentId, 'student_b');
  assert.equal(parsedEvent.lastReadMessageId, sent2.message.id);

  // Student A calls syncConversation
  const syncRes = await dmService.syncConversation('student_a', conversationId, {
    sinceMessageId: sent1.message.id,
  });
  assert.equal(syncRes.conversationId, conversationId);
  assert.equal(syncRes.peerLastReadMessageId, sent2.message.id);
  assert.ok(syncRes.readCursor);
  assert.equal(syncRes.readCursor.peerLastReadMessageId, sent2.message.id);
  assert.equal(syncRes.readCursor.callerLastReadMessageId, sent2.message.id);
  assert.equal(syncRes.messages.length, 1);
  assert.equal(syncRes.messages[0].id, sent2.message.id);
});
