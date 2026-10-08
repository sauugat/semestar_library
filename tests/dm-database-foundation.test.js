'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { fixture } = require('./helpers/cohort-fixture');
const { migrateDirectMessaging, MIGRATION_ID } = require('../migrations/005-direct-messaging-schema');
const { isDmEnabled, getDmConfig } = require('../lib/dm-config');

test('DM Foundation: Feature flag defaults to disabled', () => {
  assert.equal(isDmEnabled({}), false);
  assert.equal(isDmEnabled({ DM_ENABLED: '0' }), false);
  assert.equal(isDmEnabled({ DM_ENABLED: 'false' }), false);
  assert.equal(isDmEnabled({ DM_ENABLED: '1' }), true);
  assert.equal(isDmEnabled({ DM_ENABLED: 'true' }), true);
  const cfg = getDmConfig({});
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.maxMessageLength, 2000);
});

test('DM Foundation: Migration applies cleanly and is idempotent', async t => {
  const f = await fixture('sqlite', { migrate: true });
  t.after(f.close);

  const firstRun = await migrateDirectMessaging(f.db, { disposable: true });
  assert.equal(firstRun.applied, true);

  const secondRun = await migrateDirectMessaging(f.db, { disposable: true });
  assert.equal(secondRun.applied, false);

  const appliedMigration = await f.db.get('SELECT id FROM schema_migrations WHERE id = ?', MIGRATION_ID);
  assert.equal(appliedMigration.id, MIGRATION_ID);
});

test('DM Foundation: Canonical pairing and concurrent conversation creation safety', async t => {
  const f = await fixture('sqlite', { migrate: true });
  t.after(f.close);
  await migrateDirectMessaging(f.db, { disposable: true });

  const alice = 'm1';
  const bob = 'm2';
  const [userOne, userTwo] = [alice, bob].sort();
  assert.ok(userOne < userTwo);

  // Violating canonical ordering must fail CHECK constraint
  await assert.rejects(async () => {
    await f.db.run(
      'INSERT INTO dm_conversations (id, user_one_id, user_two_id) VALUES (?, ?, ?)',
      randomUUID(), userTwo, userOne
    );
  }, /CHECK constraint failed|dm_canonical_pair_check/i);

  // Simulate 20 concurrent creation attempts
  const results = await Promise.all(
    Array.from({ length: 20 }).map(async () => {
      const convId = randomUUID();
      try {
        await f.db.run(
          `INSERT INTO dm_conversations (id, user_one_id, user_two_id)
           VALUES (?, ?, ?)`,
          convId, userOne, userTwo
        );
        return { created: true, id: convId };
      } catch (err) {
        if (/UNIQUE constraint failed/i.test(err.message)) {
          const existing = await f.db.get(
            'SELECT id FROM dm_conversations WHERE user_one_id = ? AND user_two_id = ?',
            userOne, userTwo
          );
          return { created: false, id: existing.id };
        }
        throw err;
      }
    })
  );

  const successfulCreates = results.filter(r => r.created);
  assert.equal(successfulCreates.length, 1, 'Exactly one concurrent call must win creation');
  const canonicalId = successfulCreates[0].id;
  for (const r of results) {
    assert.equal(r.id, canonicalId, 'All concurrent calls must resolve to the identical conversation ID');
  }

  const count = (await f.db.all('SELECT id FROM dm_conversations WHERE user_one_id = ? AND user_two_id = ?', userOne, userTwo)).length;
  assert.equal(count, 1);
});

test('DM Foundation: Participant integrity rejects unauthorized third parties', async t => {
  const f = await fixture('sqlite', { migrate: true });
  t.after(f.close);
  await migrateDirectMessaging(f.db, { disposable: true });

  const convId = randomUUID();
  const alice = 'm1';
  const bob = 'm2';
  const [userOne, userTwo] = [alice, bob].sort();
  await f.db.run('INSERT INTO dm_conversations (id, user_one_id, user_two_id) VALUES (?, ?, ?)', convId, userOne, userTwo);

  // Correct participants in slot 1 and 2
  await f.db.run('INSERT INTO dm_participants (conversation_id, student_id, slot) VALUES (?, ?, ?)', convId, userOne, 1);
  await f.db.run('INSERT INTO dm_participants (conversation_id, student_id, slot) VALUES (?, ?, ?)', convId, userTwo, 2);

  // Attempting to insert third participant into slot 3 must fail slot CHECK
  await assert.rejects(async () => {
    await f.db.run('INSERT INTO dm_participants (conversation_id, student_id, slot) VALUES (?, ?, ?)', convId, 'admin', 3);
  }, /CHECK constraint failed/i);

  // Attempting to duplicate slot 1 must fail UNIQUE constraint
  await assert.rejects(async () => {
    await f.db.run('INSERT INTO dm_participants (conversation_id, student_id, slot) VALUES (?, ?, ?)', convId, userOne, 1);
  }, /UNIQUE constraint failed/i);

  // Attempting to insert a non-member into slot 1 or 2 must fail trigger check
  const convId2 = randomUUID();
  const [c1, c2] = ['m1', 'v1'].sort();
  await f.db.run('INSERT INTO dm_conversations (id, user_one_id, user_two_id) VALUES (?, ?, ?)', convId2, c1, c2);
  await assert.rejects(async () => {
    await f.db.run('INSERT INTO dm_participants (conversation_id, student_id, slot) VALUES (?, ?, ?)', convId2, 'admin', 1);
  }, /Participant integrity violation/i);
});

test('DM Foundation: Message sender integrity enforces conversation membership', async t => {
  const f = await fixture('sqlite', { migrate: true });
  t.after(f.close);
  await migrateDirectMessaging(f.db, { disposable: true });

  const convId = randomUUID();
  const alice = 'm1';
  const bob = 'm2';
  const [userOne, userTwo] = [alice, bob].sort();
  await f.db.run('INSERT INTO dm_conversations (id, user_one_id, user_two_id) VALUES (?, ?, ?)', convId, userOne, userTwo);
  await f.db.run('INSERT INTO dm_participants (conversation_id, student_id, slot) VALUES (?, ?, ?)', convId, userOne, 1);
  await f.db.run('INSERT INTO dm_participants (conversation_id, student_id, slot) VALUES (?, ?, ?)', convId, userTwo, 2);

  // Valid message from authorized member
  const msg1 = await f.db.run(
    'INSERT INTO dm_messages (conversation_id, sender_id, client_id, text) VALUES (?, ?, ?, ?)',
    convId, userOne, randomUUID(), 'Hello Bob'
  );
  assert.ok(msg1.lastInsertRowid > 0);

  // Unauthorized outsider attempting to send message into this conversation
  await assert.rejects(async () => {
    await f.db.run(
      'INSERT INTO dm_messages (conversation_id, sender_id, client_id, text) VALUES (?, ?, ?, ?)',
      convId, 'outsider', randomUUID(), 'Spying'
    );
  }, /FOREIGN KEY constraint failed/i);
});

test('DM Foundation: Message reply integrity rejects cross-conversation replies', async t => {
  const f = await fixture('sqlite', { migrate: true });
  t.after(f.close);
  await migrateDirectMessaging(f.db, { disposable: true });

  // Conversation 1 (Alice & Bob)
  const conv1 = randomUUID();
  const [u1, u2] = ['m1', 'm2'].sort();
  await f.db.run('INSERT INTO dm_conversations (id, user_one_id, user_two_id) VALUES (?, ?, ?)', conv1, u1, u2);
  await f.db.run('INSERT INTO dm_participants (conversation_id, student_id, slot) VALUES (?, ?, ?)', conv1, u1, 1);
  await f.db.run('INSERT INTO dm_participants (conversation_id, student_id, slot) VALUES (?, ?, ?)', conv1, u2, 2);
  const msgInConv1 = await f.db.run('INSERT INTO dm_messages (conversation_id, sender_id, client_id, text) VALUES (?, ?, ?, ?)', conv1, u1, randomUUID(), 'In Conv 1');

  // Conversation 2 (Alice & Charlie)
  const conv2 = randomUUID();
  const [v1, v2] = ['m1', 'v1'].sort();
  await f.db.run('INSERT INTO dm_conversations (id, user_one_id, user_two_id) VALUES (?, ?, ?)', conv2, v1, v2);
  await f.db.run('INSERT INTO dm_participants (conversation_id, student_id, slot) VALUES (?, ?, ?)', conv2, v1, 1);
  await f.db.run('INSERT INTO dm_participants (conversation_id, student_id, slot) VALUES (?, ?, ?)', conv2, v2, 2);

  // Attempt reply in Conv 2 referencing message from Conv 1
  await assert.rejects(async () => {
    await f.db.run(
      'INSERT INTO dm_messages (conversation_id, sender_id, client_id, text, reply_to_id) VALUES (?, ?, ?, ?, ?)',
      conv2, v1, randomUUID(), 'Cross-reply', msgInConv1.lastInsertRowid
    );
  }, /Cross-conversation reply rejected/i);

  // Valid reply in Conv 1 referencing message from Conv 1
  const replyInConv1 = await f.db.run(
    'INSERT INTO dm_messages (conversation_id, sender_id, client_id, text, reply_to_id) VALUES (?, ?, ?, ?, ?)',
    conv1, u2, randomUUID(), 'Valid reply', msgInConv1.lastInsertRowid
  );
  assert.ok(replyInConv1.lastInsertRowid > 0);

  // Safe ON DELETE SET NULL behavior: Deleting replied-to message must null reply_to_id without touching conversation_id
  await f.db.run('DELETE FROM dm_messages WHERE id = ?', msgInConv1.lastInsertRowid);
  const updatedReply = await f.db.get('SELECT id, conversation_id, reply_to_id FROM dm_messages WHERE id = ?', replyInConv1.lastInsertRowid);
  assert.equal(updatedReply.reply_to_id, null);
  assert.equal(updatedReply.conversation_id, conv1);
});

test('DM Foundation: Three-tier message deletion isolation', async t => {
  const f = await fixture('sqlite', { migrate: true });
  t.after(f.close);
  await migrateDirectMessaging(f.db, { disposable: true });

  const convId = randomUUID();
  const [u1, u2] = ['m1', 'm2'].sort();
  await f.db.run('INSERT INTO dm_conversations (id, user_one_id, user_two_id) VALUES (?, ?, ?)', convId, u1, u2);
  await f.db.run('INSERT INTO dm_participants (conversation_id, student_id, slot) VALUES (?, ?, ?)', convId, u1, 1);
  await f.db.run('INSERT INTO dm_participants (conversation_id, student_id, slot) VALUES (?, ?, ?)', convId, u2, 2);

  const m1 = await f.db.run('INSERT INTO dm_messages (conversation_id, sender_id, client_id, text) VALUES (?, ?, ?, ?)', convId, u1, randomUUID(), 'Message 1');
  const m2 = await f.db.run('INSERT INTO dm_messages (conversation_id, sender_id, client_id, text) VALUES (?, ?, ?, ?)', convId, u2, randomUUID(), 'Message 2');
  const m3 = await f.db.run('INSERT INTO dm_messages (conversation_id, sender_id, client_id, text) VALUES (?, ?, ?, ?)', convId, u1, randomUUID(), 'Message 3');

  // Tier 1: Delete For Me (u1 deletes m1 for themselves only)
  await f.db.run('INSERT INTO dm_message_deletions (message_id, student_id) VALUES (?, ?)', m1.lastInsertRowid, u1);

  // Query as u1: m1 is omitted
  const u1Messages = await f.db.all(`
    SELECT m.id, m.text FROM dm_messages m
    LEFT JOIN dm_message_deletions d ON d.message_id = m.id AND d.student_id = ?
    WHERE m.conversation_id = ? AND d.message_id IS NULL
    ORDER BY m.id ASC
  `, u1, convId);
  assert.deepEqual(u1Messages.map(m => m.id), [m2.lastInsertRowid, m3.lastInsertRowid]);

  // Query as u2: m1 remains fully visible!
  const u2Messages = await f.db.all(`
    SELECT m.id, m.text FROM dm_messages m
    LEFT JOIN dm_message_deletions d ON d.message_id = m.id AND d.student_id = ?
    WHERE m.conversation_id = ? AND d.message_id IS NULL
    ORDER BY m.id ASC
  `, u2, convId);
  assert.deepEqual(u2Messages.map(m => m.id), [m1.lastInsertRowid, m2.lastInsertRowid, m3.lastInsertRowid]);

  // Tier 2: Delete For Everyone (u2 deletes m2 for everyone)
  await f.db.run('UPDATE dm_messages SET deleted_for_all = 1, text = NULL, deleted_at = CURRENT_TIMESTAMP WHERE id = ?', m2.lastInsertRowid);
  const tombstone = await f.db.get('SELECT text, deleted_for_all FROM dm_messages WHERE id = ?', m2.lastInsertRowid);
  assert.equal(tombstone.deleted_for_all, 1);
  assert.equal(tombstone.text, null);

  // Tier 3: Clear Conversation (u1 clears conversation before m3)
  await f.db.run('UPDATE dm_participants SET cleared_before_message_id = ? WHERE conversation_id = ? AND student_id = ?', m3.lastInsertRowid, convId, u1);

  const u1AfterClear = await f.db.all(`
    SELECT m.id FROM dm_messages m
    JOIN dm_participants p ON p.conversation_id = m.conversation_id AND p.student_id = ?
    LEFT JOIN dm_message_deletions d ON d.message_id = m.id AND d.student_id = ?
    WHERE m.conversation_id = ? AND m.id > p.cleared_before_message_id AND d.message_id IS NULL
  `, u1, u1, convId);
  assert.equal(u1AfterClear.length, 0, 'u1 view has no messages prior to cleared boundary');

  const u2AfterClear = await f.db.all(`
    SELECT m.id FROM dm_messages m
    JOIN dm_participants p ON p.conversation_id = m.conversation_id AND p.student_id = ?
    LEFT JOIN dm_message_deletions d ON d.message_id = m.id AND d.student_id = ?
    WHERE m.conversation_id = ? AND m.id > p.cleared_before_message_id AND d.message_id IS NULL
  `, u2, u2, convId);
  assert.equal(u2AfterClear.length, 3, 'u2 view remains 100% intact');
});

test('DM Foundation: Non-destructive blocking preserves history', async t => {
  const f = await fixture('sqlite', { migrate: true });
  t.after(f.close);
  await migrateDirectMessaging(f.db, { disposable: true });

  const convId = randomUUID();
  const [u1, u2] = ['m1', 'm2'].sort();
  await f.db.run('INSERT INTO dm_conversations (id, user_one_id, user_two_id) VALUES (?, ?, ?)', convId, u1, u2);
  await f.db.run('INSERT INTO dm_participants (conversation_id, student_id, slot) VALUES (?, ?, ?)', convId, u1, 1);
  await f.db.run('INSERT INTO dm_participants (conversation_id, student_id, slot) VALUES (?, ?, ?)', convId, u2, 2);

  await f.db.run('INSERT INTO dm_messages (conversation_id, sender_id, client_id, text) VALUES (?, ?, ?, ?)', convId, u1, randomUUID(), 'Before block');

  // u1 blocks u2
  await f.db.run('INSERT INTO dm_blocks (blocker_id, blocked_id) VALUES (?, ?)', u1, u2);

  // Self-blocking check
  await assert.rejects(async () => {
    await f.db.run('INSERT INTO dm_blocks (blocker_id, blocked_id) VALUES (?, ?)', u1, u1);
  }, /CHECK constraint failed/i);

  // Verify conversation and message history are NOT deleted
  const conv = await f.db.get('SELECT id FROM dm_conversations WHERE id = ?', convId);
  assert.ok(conv);
  const msgCount = (await f.db.all('SELECT id FROM dm_messages WHERE conversation_id = ?', convId)).length;
  assert.equal(msgCount, 1);

  // Application block check
  const isBlocked = !!(await f.db.get(
    'SELECT 1 FROM dm_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)',
    u1, u2, u2, u1
  ));
  assert.equal(isBlocked, true);

  // Unblock restores status
  await f.db.run('DELETE FROM dm_blocks WHERE blocker_id = ? AND blocked_id = ?', u1, u2);
  const isBlockedAfter = !!(await f.db.get(
    'SELECT 1 FROM dm_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)',
    u1, u2, u2, u1
  ));
  assert.equal(isBlockedAfter, false);
});

test('DM Foundation: Report cross-conversation validation', async t => {
  const f = await fixture('sqlite', { migrate: true });
  t.after(f.close);
  await migrateDirectMessaging(f.db, { disposable: true });

  const conv1 = randomUUID();
  const [u1, u2] = ['m1', 'm2'].sort();
  await f.db.run('INSERT INTO dm_conversations (id, user_one_id, user_two_id) VALUES (?, ?, ?)', conv1, u1, u2);
  await f.db.run('INSERT INTO dm_participants (conversation_id, student_id, slot) VALUES (?, ?, ?)', conv1, u1, 1);
  await f.db.run('INSERT INTO dm_participants (conversation_id, student_id, slot) VALUES (?, ?, ?)', conv1, u2, 2);
  const msgInConv1 = await f.db.run('INSERT INTO dm_messages (conversation_id, sender_id, client_id, text) VALUES (?, ?, ?, ?)', conv1, u1, randomUUID(), 'Message in Conv 1');

  const conv2 = randomUUID();
  const [v1, v2] = ['m1', 'v1'].sort();
  await f.db.run('INSERT INTO dm_conversations (id, user_one_id, user_two_id) VALUES (?, ?, ?)', conv2, v1, v2);
  await f.db.run('INSERT INTO dm_participants (conversation_id, student_id, slot) VALUES (?, ?, ?)', conv2, v1, 1);
  await f.db.run('INSERT INTO dm_participants (conversation_id, student_id, slot) VALUES (?, ?, ?)', conv2, v2, 2);

  // Reporting in Conv 2 but pointing to message in Conv 1 must fail trigger check
  await assert.rejects(async () => {
    await f.db.run(`
      INSERT INTO dm_reports (id, reporter_id, reported_id, conversation_id, reported_message_id, reason, message_snapshot_text)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, randomUUID(), v2, v1, conv2, msgInConv1.lastInsertRowid, 'harassment', 'Offensive content');
  }, /Report message cross-conversation violation/i);

  // Valid report within Conv 1
  const validReport = await f.db.run(`
    INSERT INTO dm_reports (id, reporter_id, reported_id, conversation_id, reported_message_id, reason, message_snapshot_text)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, randomUUID(), u2, u1, conv1, msgInConv1.lastInsertRowid, 'harassment', 'Offensive content');
  assert.ok(validReport);
});
