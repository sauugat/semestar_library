'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { createClient } = require('@supabase/supabase-js');

// Load .env
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
const { createDmRealtimeProviders, drainDmRealtimeOutbox } = require('../lib/dm-realtime');

async function testLiveE2ePipeline() {
  console.log('=====================================================================');
  console.log('STARTING COMPLETE LIVE END-TO-END PIPELINE INTEGRATION TEST');
  console.log('Neon DB + Express DM Service + Live Supabase Realtime Outbox Delivery');
  console.log('=====================================================================');

  const testSenderId = 'test_e2e_student_alice';
  const testRecipientId = 'test_e2e_student_bob';
  const testPersonaIds = [testSenderId, testRecipientId];

  // Synthetic UUIDs for Supabase identity linking
  const uuidAlice = '00000000-0000-4000-8000-000000000001';
  const uuidBob   = '00000000-0000-4000-8000-000000000002';

  try {
    // 1. Seed synthetic verified students in Neon
    console.log('\n[1] Seeding synthetic test accounts in Neon...');
    await db.run(
      `INSERT INTO students (studentId, name, username, passwordHash, role, department, semester, verification_status, supabase_uid)
       VALUES (?, 'Alice E2E', 'alice_e2e', 'hash', 'student', 'BIT', 1, 'verified', ?)
       ON CONFLICT (studentId) DO UPDATE SET verification_status = 'verified', supabase_uid = EXCLUDED.supabase_uid`,
      testSenderId, uuidAlice
    );
    await db.run(
      `INSERT INTO students (studentId, name, username, passwordHash, role, department, semester, verification_status, supabase_uid)
       VALUES (?, 'Bob E2E', 'bob_e2e', 'hash', 'student', 'BIT', 1, 'verified', ?)
       ON CONFLICT (studentId) DO UPDATE SET verification_status = 'verified', supabase_uid = EXCLUDED.supabase_uid`,
      testRecipientId, uuidBob
    );
    console.log('    Accounts seeded with canonical UUIDs in Neon.');

    // 2. Instantiate live providers and service
    const providers = createDmRealtimeProviders(process.env);
    const dmService = createDmService(db, {
      providers,
      requireProjectionSync: true,
      realtimeTokenTtlSeconds: 120
    });

    // 3. Create or fetch conversation
    console.log('\n[2] Creating DM conversation via dmService...');
    const convInfo = await dmService.getOrCreateConversation(testSenderId, testRecipientId);
    const convId = convInfo.conversationId;
    console.log('    Conversation ID:', convId, 'epoch:', convInfo.realtimeEpoch);

    // 4. Bob fetches Realtime Config (authoritatively synchronizes projection with Supabase and issues scoped JWT)
    console.log('\n[3] Bob requests Realtime Config (synchronizes projection with live Supabase & signs scoped token)...');
    const bobConfig = await dmService.getRealtimeConfig(testRecipientId, convId);
    console.log('    Topic:', bobConfig.topic);
    console.log('    Epoch:', bobConfig.epoch);
    console.log('    Token issued with expiry:', bobConfig.expiry);

    // 5. Bob connects to Supabase Realtime using scoped JWT
    console.log('\n[4] Bob connects WebSocket to Supabase Realtime and subscribes to private channel...');
    const bobClient = createClient(bobConfig.supabaseUrl, bobConfig.key, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    await bobClient.realtime.setAuth(bobConfig.token);
    const bobChannel = bobClient.channel(bobConfig.topic, {
      config: { broadcast: { ack: true, self: false }, private: true }
    });

    const messagesReceivedByBob = [];
    bobChannel.on('broadcast', { event: 'dm:message:new' }, payload => {
      messagesReceivedByBob.push(payload);
    });

    const bobSubStatus = await new Promise(resolve => bobChannel.subscribe(s => resolve(s)));
    console.log('    Bob Realtime subscription status:', bobSubStatus);
    assert.equal(bobSubStatus, 'SUBSCRIBED', 'Bob must be successfully subscribed to live private channel');

    // 6. Alice sends a message via dmService (writes to Neon dm_messages and queues in dm_realtime_outbox)
    console.log('\n[5] Alice sends message through dmService...');
    const sendResult = await dmService.sendMessage(testSenderId, convId, {
      clientId: 'e2e_msg_' + Date.now(),
      text: 'Live End-to-End Test Message across Neon and Supabase!'
    });
    const messageId = sendResult.message.id;
    console.log('    Message inserted into Neon dm_messages with ID:', messageId);

    // Verify outbox queued in Neon
    const outboxRow = await db.get(
      'SELECT id, status, event_type, realtime_epoch FROM dm_realtime_outbox WHERE conversation_id = ? AND parent_message_id = ?',
      convId, messageId
    );
    console.log('    Neon Outbox row queued:', outboxRow.id, 'status:', outboxRow.status);
    assert.equal(outboxRow.status, 'pending');

    // 7. Drain Outbox Worker: Neon Outbox -> Live Supabase Realtime Broadcast
    console.log('\n[6] Running Outbox worker: draining Neon outbox to Supabase Realtime Broadcast...');
    const drainResult = await drainDmRealtimeOutbox(db, providers);
    console.log('    Outbox drained count:', drainResult.drained);
    assert.ok(drainResult.drained >= 1, 'At least 1 outbox row must be drained');

    const updatedOutbox = await db.get('SELECT status, sent_at FROM dm_realtime_outbox WHERE id = ?', outboxRow.id);
    console.log('    Updated Neon outbox status:', updatedOutbox.status, 'sent_at:', updatedOutbox.sent_at);
    assert.equal(updatedOutbox.status, 'sent');

    // 8. Verify Bob receives message over live WebSocket
    console.log('\n[7] Verifying live WebSocket message receipt on Bob client...');
    await new Promise(r => setTimeout(r, 1500));
    console.log('    Messages received by Bob:', messagesReceivedByBob.length);
    assert.equal(messagesReceivedByBob.length, 1, 'Bob must receive exactly 1 message payload');
    const receivedEvent = messagesReceivedByBob[0].payload || messagesReceivedByBob[0];
    assert.equal(receivedEvent.messageId, messageId, 'Received messageId must match sent messageId');
    assert.equal(receivedEvent.text, 'Live End-to-End Test Message across Neon and Supabase!');
    console.log('    CONFIRMED: Bob received the real message delivered via Supabase Realtime!');

    // 9. Test Blocking: Alice blocks Bob
    console.log('\n[8] Testing Block enforcement: Alice blocks Bob...');
    await dmService.blockUser(testSenderId, testRecipientId);
    const blockedConv = await db.get('SELECT realtime_epoch FROM dm_conversations WHERE id = ?', convId);
    console.log('    Conversation epoch bumped to:', blockedConv.realtime_epoch);

    // Bob trying to get new realtime config should be rejected with 403
    let blockRejected = false;
    try {
      await dmService.getRealtimeConfig(testRecipientId, convId);
    } catch (err) {
      blockRejected = true;
      console.log('    Bob getRealtimeConfig rejected with error:', err.status, err.message);
    }
    assert.ok(blockRejected, 'Bob must be rejected when conversation is blocked');

    // Clean up WebSocket
    await bobClient.removeAllChannels();

    // 10. Clean up all synthetic records from Neon
    console.log('\n[9] Cleaning up synthetic test data from Neon...');
    await db.run('DELETE FROM dm_blocks WHERE blocker_id IN (?, ?) OR blocked_id IN (?, ?)', ...testPersonaIds, ...testPersonaIds);
    await db.run('DELETE FROM dm_realtime_outbox WHERE conversation_id = ?', convId);
    await db.run('DELETE FROM dm_messages WHERE conversation_id = ?', convId);
    await db.run('DELETE FROM dm_participants WHERE conversation_id = ?', convId);
    await db.run('DELETE FROM dm_conversations WHERE id = ?', convId);
    await db.run('DELETE FROM students WHERE studentId IN (?, ?)', ...testPersonaIds);

    const remaining = await db.get("SELECT COUNT(*) AS c FROM students WHERE studentId LIKE 'test_e2e_%'");
    assert.equal(Number(remaining.c), 0, 'No synthetic records left in Neon');
    console.log('    Neon cleanup complete.');

    // Clean up Supabase projection
    await providers.projection.sync({
      conversationId: convId,
      realtimeEpoch: 999,
      status: 'closed',
      participants: []
    });
    console.log('    Supabase projection closed and cleaned up.');

    console.log('\n=====================================================================');
    console.log('LIVE END-TO-END PIPELINE VERIFICATION PASSED WITH 100% SUCCESS!');
    console.log('=====================================================================');
  } catch (err) {
    console.error('\nLIVE PIPELINE TEST FAILED:', err);
    throw err;
  } finally {
    // Guaranteed cleanup of synthetic test data from Neon
    try {
      await db.run('DELETE FROM dm_blocks WHERE blocker_id IN (?, ?) OR blocked_id IN (?, ?)', ...testPersonaIds, ...testPersonaIds);
      if (convId) {
        await db.run('DELETE FROM dm_realtime_outbox WHERE conversation_id = ?', convId);
        await db.run('DELETE FROM dm_messages WHERE conversation_id = ?', convId);
        await db.run('DELETE FROM dm_participants WHERE conversation_id = ?', convId);
        await db.run('DELETE FROM dm_conversations WHERE id = ?', convId);
      }
      await db.run('DELETE FROM students WHERE studentId IN (?, ?)', ...testPersonaIds);
    } catch (_) {}
  }
}

testLiveE2ePipeline().then(() => {
  process.exit(0);
}).catch(() => {
  process.exit(1);
});
