'use strict';

process.env.NODE_ENV = 'test';
process.env.DM_ENABLED = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { fixture } = require('./helpers/cohort-fixture');
const { migrateDirectMessaging } = require('../migrations/005-direct-messaging-schema');
const { createDmService } = require('../lib/dm-service');
const { verifySupabaseToken } = require('../lib/supabase');

function makeJwt(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

async function setupTestHarness(t) {
  const f = await fixture('sqlite', { migrate: true });
  t.after(f.close);

  await migrateDirectMessaging(f.db, { disposable: true });

  const studentCols = (await f.db.all('PRAGMA table_info(students)')).map(c => c.name);
  if (!studentCols.includes('verification_status')) {
    await f.db.run("ALTER TABLE students ADD COLUMN verification_status TEXT DEFAULT 'verified'");
  }

  // Ensure push notification tables exist
  await f.db.exec(`
    CREATE TABLE IF NOT EXISTS student_notification_preferences (
      student_id TEXT PRIMARY KEY,
      mute_chat INTEGER DEFAULT 0,
      hide_lockscreen_preview INTEGER DEFAULT 0,
      delivery_messages TEXT DEFAULT 'all'
    );
    CREATE TABLE IF NOT EXISTS push_notification_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      event_id TEXT NOT NULL,
      recipient_student_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      idempotency_key TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT NOT NULL,
      sent_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Seed two verified student accounts
  const students = [
    { id: 'student_alice', name: 'Alice Test', role: 'student', status: 'verified' },
    { id: 'student_bob', name: 'Bob Test', role: 'student', status: 'verified' },
    { id: 'student_charlie', name: 'Charlie Test', role: 'student', status: 'verified' },
  ];

  for (const s of students) {
    const existing = await f.db.get('SELECT studentId FROM students WHERE studentId = ?', s.id);
    if (existing) {
      await f.db.run('UPDATE students SET verification_status = ?, role = ? WHERE studentId = ?', s.status, s.role, s.id);
    } else {
      await f.db.run(
        'INSERT INTO students (studentId, name, username, role, department, semester, verification_status) VALUES (?, ?, ?, ?, ?, ?, ?)',
        s.id, s.name, s.id, s.role, 'BIT', 1, s.status
      );
    }
  }

  const dmService = createDmService(f.db, {
    skipRateLimits: true
  });

  return { f, db: f.db, dmService };
}

test('M2.3B DM Send Transaction Verification & Concurrency Suite', async t => {
  const { db, dmService } = await setupTestHarness(t);

  // Create conversation between Alice and Bob
  const conv = await dmService.getOrCreateConversation('student_alice', 'student_bob');
  const convId = conv.conversationId;

  await t.test('1. Two users sending simultaneously', async () => {
    const [sendA, sendB] = await Promise.all([
      dmService.sendMessage('student_alice', convId, { clientId: 'conc_a_1', text: 'Concurrent message from Alice' }),
      dmService.sendMessage('student_bob', convId, { clientId: 'conc_b_1', text: 'Concurrent message from Bob' })
    ]);

    assert.ok(sendA.message && sendA.message.id > 0, 'Alice message must succeed');
    assert.ok(sendB.message && sendB.message.id > 0, 'Bob message must succeed');
    assert.notEqual(sendA.message.id, sendB.message.id, 'Message IDs must be distinct');

    // Verify both rows exist in dm_messages
    const messages = await db.all('SELECT id, sender_id, client_id, text FROM dm_messages WHERE conversation_id = ? ORDER BY id ASC', convId);
    assert.equal(messages.length, 2, 'Exactly 2 messages must be recorded');

    // Verify outbox has records for both
    const outboxRows = await db.all('SELECT id, event_type, parent_message_id FROM dm_realtime_outbox WHERE conversation_id = ?', convId);
    assert.equal(outboxRows.length, 2, 'Both messages must have realtime outbox records');
  });

  await t.test('2. Duplicate clientMessageId (idempotency)', async () => {
    const original = await dmService.sendMessage('student_alice', convId, { clientId: 'idemp_msg_1', text: 'Idempotent test message' });
    assert.equal(original.duplicate, false);

    const duplicate = await dmService.sendMessage('student_alice', convId, { clientId: 'idemp_msg_1', text: 'Different text should be ignored' });
    assert.equal(duplicate.duplicate, true, 'Duplicate clientMessageId must return duplicate: true');
    assert.equal(duplicate.message.id, original.message.id, 'Must return original message ID');
    assert.equal(duplicate.message.text, 'Idempotent test message', 'Must return original message text');

    // Confirm no extra message row was inserted
    const countRow = await db.get('SELECT COUNT(*) as c FROM dm_messages WHERE client_id = ?', 'idemp_msg_1');
    assert.equal(countRow.c, 1, 'Only exactly 1 row must exist for clientId');
  });

  await t.test('3. Retrying after network timeout', async () => {
    const retryClientId = 'retry_timeout_client_id_999';
    const firstAttempt = await dmService.sendMessage('student_bob', convId, { clientId: retryClientId, text: 'Network retry test' });
    assert.equal(firstAttempt.duplicate, false);

    // Simulate second attempt (client re-transmitting after assumed timeout)
    const secondAttempt = await dmService.sendMessage('student_bob', convId, { clientId: retryClientId, text: 'Network retry test' });
    assert.equal(secondAttempt.duplicate, true);
    assert.equal(secondAttempt.message.id, firstAttempt.message.id);
  });

  await t.test('4. Concurrent blocking', async () => {
    // Alice blocks Bob
    await dmService.blockUser('student_alice', 'student_bob');

    // Bob attempts to send message to Alice -> must fail with 403
    await assert.rejects(
      async () => {
        await dmService.sendMessage('student_bob', convId, { clientId: 'blocked_send_1', text: 'Trying to send while blocked' });
      },
      err => {
        assert.equal(err.status, 403);
        assert.match(err.message, /Cannot send messages to this user/i);
        return true;
      }
    );

    // Alice also cannot send while conversation is blocked
    await assert.rejects(
      async () => {
        await dmService.sendMessage('student_alice', convId, { clientId: 'blocked_send_2', text: 'Alice trying while blocked' });
      },
      err => {
        assert.equal(err.status, 403);
        return true;
      }
    );

    // Unblock for remaining tests
    await dmService.unblockUser('student_alice', 'student_bob');
  });

  await t.test('5. Message ordering and monotonically increasing IDs', async () => {
    const msg1 = await dmService.sendMessage('student_alice', convId, { clientId: 'order_1', text: 'Order 1' });
    const msg2 = await dmService.sendMessage('student_bob', convId, { clientId: 'order_2', text: 'Order 2' });
    const msg3 = await dmService.sendMessage('student_alice', convId, { clientId: 'order_3', text: 'Order 3' });

    assert.ok(msg2.message.id > msg1.message.id, 'Message 2 ID must be greater than Message 1');
    assert.ok(msg3.message.id > msg2.message.id, 'Message 3 ID must be greater than Message 2');

    const history = await dmService.getMessages('student_alice', convId, { limit: 10 });
    const ids = history.messages.map(m => m.id);
    for (let i = 0; i < ids.length - 1; i++) {
      assert.ok(ids[i] < ids[i + 1], 'Returned history must be sorted chronologically');
    }
  });

  await t.test('6. Rate limits enforcement', async () => {
    const limitedService = createDmService(db, {
      rateLimits: { sendMaxRequests: 2, sendWindowSeconds: 60 },
      skipRateLimits: false
    });

    const convCharlie = await limitedService.getOrCreateConversation('student_charlie', 'student_bob');
    const cId = convCharlie.conversationId;

    await limitedService.sendMessage('student_charlie', cId, { clientId: 'rl_1', text: 'RL 1' });
    await limitedService.sendMessage('student_charlie', cId, { clientId: 'rl_2', text: 'RL 2' });

    await assert.rejects(
      async () => {
        await limitedService.sendMessage('student_charlie', cId, { clientId: 'rl_3', text: 'RL 3 should be limited' });
      },
      err => {
        assert.equal(err.status, 429);
        assert.match(err.message, /Too many requests/i);
        return true;
      }
    );
  });

  await t.test('7. Reply target validation', async () => {
    // Non-existent message ID
    await assert.rejects(
      async () => {
        await dmService.sendMessage('student_alice', convId, { clientId: 'reply_bad_1', text: 'Reply to ghost', replyToId: 999999 });
      },
      err => {
        assert.equal(err.status, 400);
        assert.match(err.message, /Reply target message does not exist/i);
        return true;
      }
    );

    // Cross-conversation reply (create second conv with Charlie)
    const convCharlie = await dmService.getOrCreateConversation('student_alice', 'student_charlie');
    const msgCharlie = await dmService.sendMessage('student_alice', convCharlie.conversationId, {
      clientId: 'charlie_msg_1',
      text: 'Message for Charlie'
    });

    // Try replying to Charlie's message inside Bob's conversation
    await assert.rejects(
      async () => {
        await dmService.sendMessage('student_alice', convId, {
          clientId: 'reply_cross_conv',
          text: 'Cross reply',
          replyToId: msgCharlie.message.id
        });
      },
      err => {
        assert.equal(err.status, 400);
        assert.match(err.message, /Reply target message does not exist in this conversation/i);
        return true;
      }
    );
  });

  await t.test('8. Conversation pointer and timestamp correctness', async () => {
    const sent = await dmService.sendMessage('student_alice', convId, { clientId: 'ptr_check_1', text: 'Pointer check' });
    const convRow = await db.get('SELECT last_message_id, last_message_at, updated_at FROM dm_conversations WHERE id = ?', convId);

    assert.equal(convRow.last_message_id, sent.message.id, 'last_message_id must match newly sent message ID');
    assert.ok(convRow.last_message_at, 'last_message_at must be populated');
    assert.ok(convRow.updated_at, 'updated_at must be populated');
  });

  await t.test('9. Sender read cursor correctness', async () => {
    const sent = await dmService.sendMessage('student_bob', convId, { clientId: 'cursor_check_1', text: 'Sender cursor check' });
    const senderPart = await db.get('SELECT last_read_message_id FROM dm_participants WHERE conversation_id = ? AND student_id = ?', convId, 'student_bob');

    assert.equal(senderPart.last_read_message_id, sent.message.id, "Sender's last_read_message_id must automatically advance to their own message");
  });

  await t.test('10. Realtime outbox insertion', async () => {
    const sent = await dmService.sendMessage('student_alice', convId, { clientId: 'outbox_rt_1', text: 'Outbox RT check' });
    const outboxRow = await db.get(
      'SELECT id, event_id, event_type, payload_json, parent_message_id, status FROM dm_realtime_outbox WHERE parent_message_id = ?',
      sent.message.id
    );

    assert.ok(outboxRow, 'Outbox row must exist');
    assert.equal(outboxRow.event_type, 'dm:message:new');
    assert.equal(outboxRow.status, 'pending');
    assert.equal(outboxRow.parent_message_id, sent.message.id);

    const payload = JSON.parse(outboxRow.payload_json);
    assert.equal(payload.messageId, sent.message.id);
    assert.equal(payload.clientId, 'outbox_rt_1');
    assert.equal(payload.senderId, 'student_alice');
  });

  await t.test('11. Push outbox insertion (and mute behavior)', async () => {
    // Normal send: Bob receives push outbox item
    const sent = await dmService.sendMessage('student_alice', convId, { clientId: 'push_check_1', text: 'Push outbox check' });
    const pushRow = await db.get(
      'SELECT * FROM push_notification_outbox WHERE event_type = ? AND event_id = ?',
      'dm', String(sent.message.id)
    );

    assert.ok(pushRow, 'Push notification outbox entry must be created for recipient');
    assert.equal(pushRow.recipient_student_id, 'student_bob');
    assert.equal(pushRow.status, 'pending');

    // Muted peer: Mute Bob and Alice sends another message
    await db.run('UPDATE dm_participants SET is_muted = 1 WHERE conversation_id = ? AND student_id = ?', convId, 'student_bob');
    const sentMuted = await dmService.sendMessage('student_alice', convId, { clientId: 'push_check_muted', text: 'Muted push check' });

    const pushMutedRow = await db.get(
      'SELECT * FROM push_notification_outbox WHERE event_type = ? AND event_id = ?',
      'dm', String(sentMuted.message.id)
    );
    assert.equal(pushMutedRow, null, 'No push outbox entry should be enqueued when peer has muted the conversation');
  });

  await t.test('12. Rollback on database failure (atomicity guarantee)', async () => {
    const preCount = (await db.get('SELECT COUNT(*) as c FROM dm_messages WHERE conversation_id = ?', convId)).c;
    const preConv = await db.get('SELECT last_message_id FROM dm_conversations WHERE id = ?', convId);

    // Mock an unexpected DB crash during transaction
    const failingDb = {
      ...db,
      async withTransaction(fn) {
        return db.withTransaction(async tx => {
          const originalRun = tx.run.bind(tx);
          tx.run = async (sql, ...params) => {
            if (sql.includes('UPDATE dm_conversations')) {
              throw new Error('SIMULATED_DB_CRASH_DURING_UPDATE');
            }
            return originalRun(sql, ...params);
          };
          return fn(tx);
        });
      }
    };

    const failingService = createDmService(failingDb);

    await assert.rejects(
      async () => {
        await failingService.sendMessage('student_alice', convId, { clientId: 'failing_msg_1', text: 'Will fail and rollback' });
      },
      err => {
        assert.match(err.message, /SIMULATED_DB_CRASH/);
        return true;
      }
    );

    // Verify rollback: count and conversation pointers must be completely unmodified
    const postCount = (await db.get('SELECT COUNT(*) as c FROM dm_messages WHERE conversation_id = ?', convId)).c;
    const postConv = await db.get('SELECT last_message_id FROM dm_conversations WHERE id = ?', convId);

    assert.equal(postCount, preCount, 'No message should remain in dm_messages after rollback');
    assert.equal(postConv.last_message_id, preConv.last_message_id, 'Conversation pointer must remain unchanged');
  });
});

test('M2.3B Cryptographic JWT Security & OIDC Claim Verification', async t => {
  const secret = 'super-secure-production-ready-jwt-secret-key-32chars!';
  process.env.SUPABASE_JWT_SECRET = secret;

  await t.test('1. Valid token with all mandatory claims passes', async () => {
    const token = makeJwt({
      sub: '550e8400-e29b-41d4-a716-446655440000',
      email: 'verified.user@gandaki.edu.np',
      aud: 'authenticated',
      role: 'authenticated',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    }, secret);

    const { user, error } = await verifySupabaseToken(token);
    assert.equal(error, null);
    assert.ok(user);
    assert.equal(user.id, '550e8400-e29b-41d4-a716-446655440000');
    assert.equal(user.aud, 'authenticated');
  });

  await t.test('2. Corrupted signature is rejected', async () => {
    const valid = makeJwt({
      sub: '550e8400-e29b-41d4-a716-446655440000',
      aud: 'authenticated',
      role: 'authenticated',
      exp: Math.floor(Date.now() / 1000) + 3600,
    }, secret);

    const parts = valid.split('.');
    const tampered = `${parts[0]}.${parts[1]}.tampered_signature_bytes`;
    const { user, error } = await verifySupabaseToken(tampered);
    assert.equal(user, null);
  });

  await t.test('3. Expired token is rejected with 401 status', async () => {
    const expiredToken = makeJwt({
      sub: '550e8400-e29b-41d4-a716-446655440000',
      aud: 'authenticated',
      role: 'authenticated',
      exp: Math.floor(Date.now() / 1000) - 60, // 60 seconds ago
    }, secret);

    const { user, error } = await verifySupabaseToken(expiredToken);
    assert.equal(user, null);
    assert.ok(error);
    assert.equal(error.status, 401);
    assert.match(error.message, /expired/i);
  });

  await t.test('4. Token without exp claim is rejected', async () => {
    const unexpiringToken = makeJwt({
      sub: '550e8400-e29b-41d4-a716-446655440000',
      aud: 'authenticated',
      role: 'authenticated',
    }, secret);

    const { user } = await verifySupabaseToken(unexpiringToken);
    assert.equal(user, null);
  });

  await t.test('5. Non-authenticated audience (e.g. anon key) is rejected', async () => {
    const anonToken = makeJwt({
      sub: '550e8400-e29b-41d4-a716-446655440000',
      aud: 'anon',
      role: 'anon',
      exp: Math.floor(Date.now() / 1000) + 3600,
    }, secret);

    const { user } = await verifySupabaseToken(anonToken);
    assert.equal(user, null, 'Tokens with aud=anon must never authenticate as user');
  });

  await t.test('6. Non-authenticated role is rejected', async () => {
    const serviceToken = makeJwt({
      sub: '550e8400-e29b-41d4-a716-446655440000',
      aud: 'authenticated',
      role: 'service_role',
      exp: Math.floor(Date.now() / 1000) + 3600,
    }, secret);

    const { user } = await verifySupabaseToken(serviceToken);
    assert.equal(user, null, 'Tokens without role=authenticated must be rejected');
  });

  await t.test('7. Token with empty sub is rejected', async () => {
    const emptySubToken = makeJwt({
      sub: '   ',
      aud: 'authenticated',
      role: 'authenticated',
      exp: Math.floor(Date.now() / 1000) + 3600,
    }, secret);

    const { user } = await verifySupabaseToken(emptySubToken);
    assert.equal(user, null, 'Empty or whitespace sub must be rejected');
  });

  await t.test('8. Alg "none" attack is rejected', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({
      sub: '550e8400-e29b-41d4-a716-446655440000',
      aud: 'authenticated',
      role: 'authenticated',
      exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString('base64url');
    const noneToken = `${header}.${body}.`;

    const { user } = await verifySupabaseToken(noneToken);
    assert.equal(user, null, 'alg: none must be rejected immediately');
  });
});
