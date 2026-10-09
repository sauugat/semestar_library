'use strict';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { dmPostgresFixture } = require('./helpers/dm-postgres-fixture');
const { createDmService } = require('../lib/dm-service');

test('PostgreSQL: send, recipient history, retry, authorization and JSONB outbox', async t => {
  const f = await dmPostgresFixture(); t.after(f.close);
  const service = createDmService(f.db, { providers: {}, autoDrain: false });
  const { conversationId } = await service.getOrCreateConversation('alice', 'bob');
  const before = f.queryCount();
  const sent = await service.sendMessage('alice', conversationId, { clientId: 'pg-send', text: 'hello' });
  assert.equal(f.queryCount() - before, 7, 'send uses seven SQL statements including caller verification and push enqueue');
  const history = await service.getMessages('bob', conversationId);
  assert.equal(history.messages.length, 1);
  assert.equal(history.messages[0].id, sent.message.id);
  const outbox = await f.db.get('SELECT payload_json FROM dm_realtime_outbox WHERE parent_message_id = ?', sent.message.id);
  assert.equal(outbox.payload_json.messageId, sent.message.id);
  assert.equal(Number((await f.db.get('SELECT last_message_id FROM dm_conversations WHERE id = ?', conversationId)).last_message_id), sent.message.id);
  assert.equal(Number((await f.db.get('SELECT last_read_message_id FROM dm_participants WHERE conversation_id = ? AND student_id = ?', conversationId, 'alice')).last_read_message_id), sent.message.id);
  const retry = await service.sendMessage('alice', conversationId, { clientId: 'pg-send', text: 'hello' });
  assert.equal(retry.duplicate, true); assert.equal(retry.message.id, sent.message.id);
  await assert.rejects(service.getMessages('outsider', conversationId), { status: 404 });
  await assert.rejects(service.sendMessage('outsider', conversationId, { clientId: 'bad', text: 'bad' }), { status: 404 });
});

test('PostgreSQL: realtime enqueue failure atomically rolls back message and pointers', async t => {
  const f = await dmPostgresFixture(); t.after(f.close);
  const service = createDmService(f.db, { providers: {}, autoDrain: false });
  const { conversationId } = await service.getOrCreateConversation('alice', 'bob');
  await f.db.exec("ALTER TABLE dm_realtime_outbox ADD CONSTRAINT injected_failure CHECK (event_type <> 'dm:message:new')");
  await assert.rejects(service.sendMessage('alice', conversationId, { clientId: 'atomic-failure', text: 'hello' }));
  assert.equal((await f.db.get('SELECT count(*)::int AS n FROM dm_messages')).n, 0);
  assert.equal((await f.db.get('SELECT last_message_id FROM dm_conversations WHERE id = ?', conversationId)).last_message_id, null);
  assert.equal(Number((await f.db.get('SELECT last_read_message_id FROM dm_participants WHERE conversation_id = ? AND student_id = ?', conversationId, 'alice')).last_read_message_id), 0);
  assert.equal((await f.db.get('SELECT count(*)::int AS n FROM push_notification_outbox')).n, 0);
});

test('PostgreSQL: a push SQL error must not acknowledge a rolled-back message', async t => {
  const f = await dmPostgresFixture(); t.after(f.close);
  const service = createDmService(f.db, { providers: {}, autoDrain: false });
  const { conversationId } = await service.getOrCreateConversation('alice', 'bob');
  await f.db.exec("ALTER TABLE push_notification_outbox ADD CONSTRAINT injected_failure CHECK (event_type <> 'dm')");
  await assert.rejects(service.sendMessage('alice', conversationId, { clientId: 'retry-after-failure', text: 'hello' }));
  assert.equal((await f.db.get('SELECT count(*)::int AS n FROM dm_messages')).n, 0);
  assert.equal((await f.db.get('SELECT count(*)::int AS n FROM dm_realtime_outbox')).n, 0);
  await f.db.exec('ALTER TABLE push_notification_outbox DROP CONSTRAINT injected_failure');
  const sent = await service.sendMessage('alice', conversationId, { clientId: 'retry-after-failure', text: 'hello' });
  assert.equal(sent.duplicate, false);
  assert.equal((await service.getMessages('bob', conversationId)).messages[0].id, sent.message.id);
});

test('PostgreSQL: a stale conversation lookup resolves the winning insert without aborting', async t => {
  const f = await dmPostgresFixture(); t.after(f.close);
  const service = createDmService(f.db, { providers: {}, autoDrain: false });
  const first = await service.getOrCreateConversation('alice', 'bob');
  let stale = true;
  const racingDb = { ...f.db, withTransaction: fn => f.db.withTransaction(tx => fn({
    ...tx, get: async (sql, ...args) => {
      if (stale && sql.startsWith('SELECT id, user_one_id, user_two_id, realtime_epoch FROM dm_conversations WHERE user_one_id')) {
        stale = false; return null;
      }
      return tx.get(sql, ...args);
    },
  })) };
  const other = await createDmService(racingDb, { providers: {}, autoDrain: false }).getOrCreateConversation('bob', 'alice');
  assert.equal(other.conversationId, first.conversationId);
  assert.equal((await f.db.get('SELECT count(*)::int AS n FROM dm_conversations')).n, 1);
  assert.equal((await f.db.get('SELECT count(*)::int AS n FROM dm_participants')).n, 2);
});
