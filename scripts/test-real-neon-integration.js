const fs = require('fs');
const path = require('path');
const assert = require('assert');

// 1. Load .env
const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.substring(0, eqIdx).trim();
      const val = trimmed.substring(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  });
}

const db = require('../db');
const { createDmService } = require('../lib/dm-service');
const { drainDmRealtimeOutbox } = require('../lib/dm-realtime');

async function runRealNeonIntegration() {
  console.log('===============================================================');
  console.log('STARTING REAL NEON POSTGRESQL & BACKEND INTEGRATION TEST SUITE');
  console.log('===============================================================');

  const testResults = [];
  const testPersonas = [
    { id: 'test_dm_student_a', name: 'Alice Student', role: 'student' },
    { id: 'test_dm_student_b', name: 'Bob Student', role: 'student' },
    { id: 'test_dm_cr', name: 'Charlie CR', role: 'cr' },
    { id: 'test_dm_teacher', name: 'Dr. Xavier', role: 'teacher' },
    { id: 'test_dm_admin', name: 'Admin Dave', role: 'admin' },
  ];

  try {
    // -------------------------------------------------------------
    // SCENARIO 1: Seed Synthetic Test Accounts into Neon
    // -------------------------------------------------------------
    console.log('[Scenario 1] Seeding synthetic test accounts into Neon...');
    for (const acc of testPersonas) {
      await db.run(
        `INSERT INTO students (studentId, name, username, passwordHash, role, department, semester, verification_status)
         VALUES (?, ?, ?, 'dummy_hash', ?, 'BIT', 1, 'verified')
         ON CONFLICT (studentId) DO UPDATE
         SET name = EXCLUDED.name, role = EXCLUDED.role, verification_status = 'verified'`,
        acc.id, acc.name, acc.id, acc.role
      );
      if (acc.role === 'teacher') {
        await db.run(
          `INSERT INTO teachers (id, user_id, designation, status)
           VALUES (?, ?, 'Professor', 'active')
           ON CONFLICT (id) DO UPDATE SET status = 'active'`,
          't_' + acc.id, acc.id
        );
      }
    }
    testResults.push({ id: 1, name: 'Seed synthetic personas into Neon', status: 'PASS' });
    console.log('  -> PASS');

    // Setup DM Service with real Neon DB and captured realtime provider
    const capturedBroadcasts = [];
    const providers = {
      realtime: {
        send: async (msg) => {
          capturedBroadcasts.push(msg);
          return { ok: true };
        },
        publicConnection: {
          url: process.env.SUPABASE_URL || 'https://mock.supabase.co',
          key: process.env.SUPABASE_ANON_KEY || 'mock_key',
        }
      },
      credentials: {
        issue: async ({ subject, conversationId, realtimeEpoch, expiry }) => {
          return `mock_scoped_token_${subject}_${conversationId}_${realtimeEpoch}`;
        },
        subject: async (caller) => caller.studentId,
      }
    };
    const dmService = createDmService(db, { providers });

    // -------------------------------------------------------------
    // SCENARIO 2: Canonical Conversation Pairing (Deterministic)
    // -------------------------------------------------------------
    console.log('[Scenario 2] Canonical conversation creation in Neon...');
    const conv1 = await dmService.getOrCreateConversation('test_dm_student_a', 'test_dm_student_b');
    const convId = conv1.conversationId;
    assert.ok(convId, 'Conversation ID must be generated');

    // Reverse initiation must return exact same conversation
    const conv2 = await dmService.getOrCreateConversation('test_dm_student_b', 'test_dm_student_a');
    assert.equal(conv2.conversationId, convId, 'Must return identical conversation ID');

    // Verify row in Neon
    const convRow = await db.get('SELECT * FROM dm_conversations WHERE id = ?', convId);
    assert.ok(convRow, 'Conversation row exists in Neon dm_conversations');
    testResults.push({ id: 2, name: 'Deterministic canonical conversation pairing', status: 'PASS' });
    console.log('  -> PASS: ' + convId);

    // -------------------------------------------------------------
    // SCENARIO 3: Message Sending & Neon Outbox Generation
    // -------------------------------------------------------------
    console.log('[Scenario 3] Message sending: Student A -> Student B...');
    const sendResult = await dmService.sendMessage('test_dm_student_a', convId, {
      clientId: 'client_real_msg_001',
      text: 'Hello from Semester Library!'
    });
    const msgId = sendResult.message.id;
    assert.ok(msgId, 'Message ID must be returned');
    assert.equal(sendResult.message.text, 'Hello from Semester Library!');

    const msgRow = await db.get('SELECT * FROM dm_messages WHERE id = ?', msgId);
    assert.ok(msgRow, 'Message stored in Neon dm_messages');
    assert.equal(msgRow.sender_id, 'test_dm_student_a');

    // Verify outbox record
    const outboxRow = await db.get(
      'SELECT * FROM dm_realtime_outbox WHERE conversation_id = ? AND parent_message_id = ?',
      convId, msgId
    );
    assert.ok(outboxRow, 'Outbox row created in Neon dm_realtime_outbox');
    assert.equal(outboxRow.status, 'pending');
    testResults.push({ id: 3, name: 'Message stored in dm_messages and outbox queued', status: 'PASS' });
    console.log('  -> PASS: Message #' + msgId);

    // -------------------------------------------------------------
    // SCENARIO 4: Outbox Worker Atomic Drain
    // -------------------------------------------------------------
    console.log('[Scenario 4] Atomic outbox drain worker execution...');
    const drainResult = await drainDmRealtimeOutbox(db, providers);
    assert.ok(drainResult.drained >= 1, 'At least 1 outbox message drained');

    const updatedOutbox = await db.get('SELECT status, attempts FROM dm_realtime_outbox WHERE id = ?', outboxRow.id);
    assert.equal(updatedOutbox.status, 'sent', 'Outbox status transitioned to sent in Neon');
    assert.ok(capturedBroadcasts.length >= 1, 'Broadcast sent via Realtime provider');
    assert.equal(capturedBroadcasts[0].event, 'dm:message:new');
    testResults.push({ id: 4, name: 'Outbox worker atomic draining and status transition', status: 'PASS' });
    console.log('  -> PASS: ' + drainResult.drained + ' event(s) drained');

    // -------------------------------------------------------------
    // SCENARIO 5: Bidirectional Reply: Student B -> Student A
    // -------------------------------------------------------------
    console.log('[Scenario 5] Bidirectional reply: Student B -> Student A...');
    const replyResult = await dmService.sendMessage('test_dm_student_b', convId, {
      clientId: 'client_real_reply_002',
      text: 'Hello back Alice!',
      replyToId: msgId
    });
    const replyId = replyResult.message.id;
    assert.equal(replyResult.message.replyToId, msgId);

    const replyRow = await db.get('SELECT * FROM dm_messages WHERE id = ?', replyId);
    assert.equal(replyRow.reply_to_id, msgId);
    testResults.push({ id: 5, name: 'Bidirectional message and reply link in Neon', status: 'PASS' });
    console.log('  -> PASS: Reply #' + replyId + ' -> Message #' + msgId);

    // -------------------------------------------------------------
    // SCENARIO 6: Message Editing with Boolean Flag
    // -------------------------------------------------------------
    console.log('[Scenario 6] Message editing (Student A edits their message)...');
    const editResult = await dmService.editMessage('test_dm_student_a', convId, msgId, {
      text: 'Hello from Semester Library! (edited text)'
    });
    assert.equal(editResult.messageId, msgId);

    const editedRow = await db.get('SELECT text, is_edited, edited_at FROM dm_messages WHERE id = ?', msgId);
    assert.equal(editedRow.text, 'Hello from Semester Library! (edited text)');
    assert.equal(Boolean(editedRow.is_edited), true, 'is_edited must be true in Neon');
    testResults.push({ id: 6, name: 'Message editing with boolean flag in Neon', status: 'PASS' });
    console.log('  -> PASS');

    // -------------------------------------------------------------
    // SCENARIO 7: Monotonic Read Receipt Cursor
    // -------------------------------------------------------------
    console.log('[Scenario 7] Monotonic read receipt: Student B reads up to replyId...');
    const readResult = await dmService.markRead('test_dm_student_b', convId, {
      lastReadMessageId: replyId
    });
    assert.equal(readResult.lastReadMessageId, replyId);

    const partRow = await db.get(
      'SELECT last_read_message_id FROM dm_participants WHERE conversation_id = ? AND student_id = ?',
      convId, 'test_dm_student_b'
    );
    assert.equal(partRow.last_read_message_id, replyId);
    testResults.push({ id: 7, name: 'Monotonic read receipt cursor in Neon', status: 'PASS' });
    console.log('  -> PASS');

    // -------------------------------------------------------------
    // SCENARIO 8: Three-tier Deletion (Delete for me vs Delete for everyone)
    // -------------------------------------------------------------
    console.log('[Scenario 8] Message deletion isolation...');
    // A sends another message to test delete for me
    const m3 = await dmService.sendMessage('test_dm_student_a', convId, {
      clientId: 'client_real_del_003',
      text: 'Message to delete for me'
    });
    await dmService.deleteMessage('test_dm_student_a', convId, m3.message.id, { mode: 'for_me' });
    const delRecord = await db.get(
      'SELECT * FROM dm_message_deletions WHERE message_id = ? AND student_id = ?',
      m3.message.id, 'test_dm_student_a'
    );
    assert.ok(delRecord, 'Per-user deletion stored in dm_message_deletions');

    // Delete for everyone on replyId (sent by B, deleted by B)
    await dmService.deleteMessage('test_dm_student_b', convId, replyId, { mode: 'for_everyone' });
    const tombstoneRow = await db.get('SELECT text, deleted_for_all FROM dm_messages WHERE id = ?', replyId);
    assert.equal(tombstoneRow.text, null, 'Text cleared on delete for everyone');
    assert.equal(Boolean(tombstoneRow.deleted_for_all), true, 'deleted_for_all is true in Neon');
    testResults.push({ id: 8, name: 'Three-tier message deletion in Neon', status: 'PASS' });
    console.log('  -> PASS');

    // -------------------------------------------------------------
    // SCENARIO 9: Cross-Role Persona Messaging Matrix in Neon
    // -------------------------------------------------------------
    console.log('[Scenario 9] Testing cross-role communication matrix...');
    const pairings = [
      ['test_dm_student_a', 'test_dm_teacher', 'Student <-> Teacher'],
      ['test_dm_student_a', 'test_dm_admin', 'Student <-> Admin'],
      ['test_dm_teacher', 'test_dm_admin', 'Teacher <-> Admin'],
      ['test_dm_cr', 'test_dm_student_a', 'CR <-> Student'],
    ];

    for (const [u1, u2, label] of pairings) {
      const c = await dmService.getOrCreateConversation(u1, u2);
      const m = await dmService.sendMessage(u1, c.conversationId, {
        clientId: 'pair_' + Date.now() + '_' + Math.random(),
        text: 'Hello from ' + label
      });
      assert.ok(m.message.id, 'Message sent successfully for ' + label);
    }
    testResults.push({ id: 9, name: 'Role matrix (Student, CR, Teacher, Admin) pairings', status: 'PASS' });
    console.log('  -> PASS: All pairings verified');

    // -------------------------------------------------------------
    // SCENARIO 10: Non-destructive Blocking & Message Suppression
    // -------------------------------------------------------------
    console.log('[Scenario 10] Testing blocking and message suppression in Neon...');
    await dmService.blockUser('test_dm_student_a', 'test_dm_student_b');
    const blockRow = await db.get(
      'SELECT * FROM dm_blocks WHERE blocker_id = ? AND blocked_id = ?',
      'test_dm_student_a', 'test_dm_student_b'
    );
    assert.ok(blockRow, 'Block record active in Neon dm_blocks');

    // Attempt to send message while blocked should be rejected
    let blockedSendFailed = false;
    try {
      await dmService.sendMessage('test_dm_student_b', convId, {
        clientId: 'blocked_attempt',
        text: 'This should fail'
      });
    } catch (err) {
      blockedSendFailed = true;
      assert.equal(err.status, 403);
    }
    assert.ok(blockedSendFailed, 'Sending while blocked was rejected with 403');

    // Unblock
    await dmService.unblockUser('test_dm_student_a', 'test_dm_student_b');
    const unblockedRow = await db.get(
      'SELECT * FROM dm_blocks WHERE blocker_id = ? AND blocked_id = ?',
      'test_dm_student_a', 'test_dm_student_b'
    );
    assert.equal(unblockedRow, undefined, 'Block record removed on unblock');
    testResults.push({ id: 10, name: 'Non-destructive blocking and suppression', status: 'PASS' });
    console.log('  -> PASS');

    // -------------------------------------------------------------
    // SCENARIO 11: Sync Endpoint (Missed Messages & Recovery)
    // -------------------------------------------------------------
    console.log('[Scenario 11] Testing sync API and reconnection recovery in Neon...');
    const syncRes = await dmService.syncConversation('test_dm_student_a', convId, {
      sinceMessageId: 0,
      sinceTimestamp: new Date(Date.now() - 3600000).toISOString()
    });
    assert.ok(Array.isArray(syncRes.messages), 'Sync returns messages array');
    assert.ok(syncRes.messages.length > 0, 'Sync recovers stored messages');
    testResults.push({ id: 11, name: 'Reconnection sync and offline recovery', status: 'PASS' });
    console.log('  -> PASS: ' + syncRes.messages.length + ' messages synced');

    // -------------------------------------------------------------
    // SCENARIO 12: Cleanup Synthetic Test Records from Neon
    // -------------------------------------------------------------
    console.log('[Scenario 12] Cleaning up synthetic test data from Neon...');
    const testIds = testPersonas.map(p => p.id);
    
    // Clean DM tables for test personas
    await db.run(
      `DELETE FROM dm_message_deletions WHERE student_id IN (${testIds.map(() => '?').join(',')})`,
      ...testIds
    );
    await db.run(
      `DELETE FROM dm_blocks WHERE blocker_id IN (${testIds.map(() => '?').join(',')}) OR blocked_id IN (${testIds.map(() => '?').join(',')})`,
      ...testIds, ...testIds
    );
    await db.run(
      `DELETE FROM dm_reports WHERE reporter_id IN (${testIds.map(() => '?').join(',')}) OR reported_id IN (${testIds.map(() => '?').join(',')})`,
      ...testIds, ...testIds
    );
    await db.run(
      `DELETE FROM dm_realtime_outbox WHERE conversation_id IN (
         SELECT conversation_id FROM dm_participants WHERE student_id IN (${testIds.map(() => '?').join(',')})
       )`,
      ...testIds
    );
    await db.run(
      `DELETE FROM dm_messages WHERE sender_id IN (${testIds.map(() => '?').join(',')})`,
      ...testIds
    );
    await db.run(
      `DELETE FROM dm_participants WHERE student_id IN (${testIds.map(() => '?').join(',')})`,
      ...testIds
    );
    await db.run(
      `DELETE FROM dm_conversations WHERE user_one_id IN (${testIds.map(() => '?').join(',')}) OR user_two_id IN (${testIds.map(() => '?').join(',')})`,
      ...testIds, ...testIds
    );
    await db.run(
      `DELETE FROM teachers WHERE user_id IN (${testIds.map(() => '?').join(',')})`,
      ...testIds
    );
    await db.run(
      `DELETE FROM students WHERE studentId IN (${testIds.map(() => '?').join(',')})`,
      ...testIds
    );

    // Verify cleanup
    const remainingTestStudents = await db.get(
      `SELECT COUNT(*) as count FROM students WHERE studentId LIKE 'test_dm_%'`
    );
    assert.equal(Number(remainingTestStudents.count), 0, 'All synthetic accounts cleaned up');

    testResults.push({ id: 12, name: 'Synthetic test records cleaned up from Neon', status: 'PASS' });
    console.log('  -> PASS: All synthetic test data cleanly removed');

    console.log('===============================================================');
    console.log('ALL 12 REAL NEON POSTGRESQL INTEGRATION SCENARIOS PASSED!');
    console.log('===============================================================');
    return { success: true, testResults };
  } catch (err) {
    console.error('REAL NEON INTEGRATION FAILED:', err);
    throw err;
  }
}

runRealNeonIntegration().then(() => {
  process.exit(0);
}).catch(() => {
  process.exit(1);
});
