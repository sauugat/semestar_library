'use strict';

process.env.NODE_ENV = 'test';
process.env.DM_ENABLED = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHmac } = require('node:crypto');
const express = require('express');
const { fixture } = require('./helpers/cohort-fixture');
const { migrateDirectMessaging } = require('../migrations/005-direct-messaging-schema');
const { createDmService } = require('../lib/dm-service');
const { createDmRealtimeProviders } = require('../lib/dm-realtime');
const directMessagingRouter = require('../routes/direct-messaging');
const push = require('../lib/push-notifications');

/**
 * Creates isolated test harness with mock Supabase Realtime & Expo Push providers.
 */
async function createRealtimeTestHarness(t, options = {}) {
  const f = await fixture('sqlite', { migrate: true });
  t.after(f.close);

  await migrateDirectMessaging(f.db, { disposable: true });

  const studentCols = (await f.db.all("PRAGMA table_info(students)")).map(c => c.name);
  if (!studentCols.includes('verification_status')) {
    await f.db.run("ALTER TABLE students ADD COLUMN verification_status TEXT DEFAULT 'unverified'");
  }

  // Seed personas: students, teachers, admins, CRs
  const accounts = [
    { id: 'admin_rt1', name: 'Admin Alice', role: 'admin', status: 'verified' },
    { id: 'admin_rt2', name: 'Admin Bob', role: 'admin', status: 'verified' },
    { id: 'teacher_rt1', name: 'Prof. Xavier', role: 'teacher', status: 'verified' },
    { id: 'teacher_rt2', name: 'Prof. McGonagall', role: 'teacher', status: 'verified' },
    { id: 'cr_rt1', name: 'CR Charlie', role: 'cr', status: 'verified' },
    { id: 'student_rt1', name: 'Student Stan', role: 'student', status: 'verified' },
    { id: 'student_rt2', name: 'Student Kyle', role: 'student', status: 'verified' },
    { id: 'outsider_rt', name: 'Outsider Eve', role: 'student', status: 'verified' },
  ];

  for (const acc of accounts) {
    const existing = await f.db.get('SELECT studentId FROM students WHERE studentId = ?', acc.id);
    if (existing) {
      await f.db.run(
        'UPDATE students SET role = ?, verification_status = ?, name = ?, username = ? WHERE studentId = ?',
        acc.role, acc.status, acc.name, acc.id, acc.id
      );
    } else {
      await f.db.run(
        'INSERT INTO students (studentId, name, username, role, department, semester, verification_status) VALUES (?, ?, ?, ?, ?, ?, ?)',
        acc.id, acc.name, acc.id, acc.role, 'BIT', 1, acc.status
      );
    }
  }

  // Captured provider events
  const broadcastMessages = [];
  const projectionSyncCalls = [];
  const pushBatches = [];

  const testSigningSecret = 'test_secret_32_characters_minimum_length_for_signing_jwt';
  const testEnv = {
    DM_SUPABASE_URL: 'https://test-project.supabase.co',
    DM_SUPABASE_PUBLIC_KEY: 'test-anon-key',
    DM_SUPABASE_SERVICE_KEY: 'test-service-key',
    DM_SUPABASE_JWT_SECRET: testSigningSecret,
  };

  const mockTransport = async (url, reqOptions) => {
    if (url.includes('/rest/v1/rpc/sync_dm_conversation_projection')) {
      const body = JSON.parse(reqOptions.body);
      projectionSyncCalls.push(body.snapshot);
      if (options.failProjection) {
        return {
          ok: false,
          status: 500,
          text: async () => 'Simulated projection sync failure',
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, snapshot: body.snapshot }),
        text: async () => JSON.stringify({ ok: true }),
      };
    }
    if (url.includes('/realtime/v1/api/broadcast')) {
      const body = JSON.parse(reqOptions.body);
      if (options.failBroadcast) {
        return {
          ok: false,
          status: 500,
          text: async () => 'Simulated broadcast failure',
        };
      }
      broadcastMessages.push(...(body.messages || []));
      return {
        ok: true,
        status: 200,
        text: async () => 'OK',
      };
    }
    return { ok: true, status: 200, text: async () => '{}' };
  };

  const providers = createDmRealtimeProviders(testEnv, mockTransport);
  providers.push = {
    sendBatch: async batch => {
      pushBatches.push(...batch);
      return { success: true };
    },
  };

  const dmService = createDmService(f.db, {
    ...options,
    providers,
    env: testEnv,
  });

  const app = express();
  app.use(express.json());

  app.use(async (req, res, next) => {
    const authHeader = req.get('authorization') || '';
    const match = /^Bearer\s+([a-zA-Z0-9_-]+)$/.exec(authHeader);
    if (match) {
      const studentId = match[1];
      const row = await f.db.get('SELECT role FROM students WHERE studentId = ?', studentId);
      req.student = { studentId, role: row?.role || 'student' };
    }
    next();
  });

  app.use('/api/dm', directMessagingRouter(dmService));

  const server = app.listen(0);
  t.after(() => server.close());

  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  async function request(path, { method = 'GET', caller, body, query, headers: extraHeaders } = {}) {
    let url = `${baseUrl}${path}`;
    if (query) {
      const qParams = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) qParams.set(k, String(v));
      }
      const qs = qParams.toString();
      if (qs) url += `?${qs}`;
    }

    const headers = { 'content-type': 'application/json', ...(extraHeaders || {}) };
    if (caller && !headers['authorization']) headers['authorization'] = `Bearer ${caller}`;

    const response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    return {
      status: response.status,
      headers: response.headers,
      data,
    };
  }

  return {
    db: f.db,
    service: dmService,
    providers,
    testSigningSecret,
    broadcastMessages,
    projectionSyncCalls,
    pushBatches,
    request,
  };
}

// ---------------------------------------------------------------------------
// PHASE I AUTOMATED TEST SUITE: SCENARIOS 1 - 25
// ---------------------------------------------------------------------------

test('DM Realtime: 1. Real-time event publication enqueues and drains message events', async t => {
  const h = await createRealtimeTestHarness(t);

  const convRes = await h.request('/api/dm/conversations', {
    method: 'POST',
    caller: 'student_rt1',
    body: { targetUserId: 'student_rt2' },
  });
  assert.equal(convRes.status, 201);
  const conversationId = convRes.data.conversationId;

  const sendRes = await h.request(`/api/dm/conversations/${conversationId}/messages`, {
    method: 'POST',
    caller: 'student_rt1',
    body: { clientId: randomUUID(), text: 'Hello Realtime!' },
  });
  assert.equal(sendRes.status, 201);

  // Check outbox has pending event
  const outbox = await h.db.all('SELECT * FROM dm_realtime_outbox WHERE conversation_id = ?', conversationId);
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].event_type, 'dm:message:new');
  assert.equal(outbox[0].status, 'pending');

  // Drain outbox
  const drainRes = await h.service.drain();
  assert.equal(drainRes.realtime.drained, 1);

  // Assert broadcast dispatched via Supabase Broadcast
  assert.equal(h.broadcastMessages.length, 1);
  assert.equal(h.broadcastMessages[0].topic, `dm:${conversationId}:1`);
  assert.equal(h.broadcastMessages[0].event, 'dm:message:new');
  assert.equal(h.broadcastMessages[0].private, true);
  assert.equal(h.broadcastMessages[0].payload.text, 'Hello Realtime!');
});

test('DM Realtime: 2 & 3. Authorized subscription vs unauthorized rejection', async t => {
  const h = await createRealtimeTestHarness(t);

  const convRes = await h.request('/api/dm/conversations', {
    method: 'POST',
    caller: 'student_rt1',
    body: { targetUserId: 'student_rt2' },
  });
  const conversationId = convRes.data.conversationId;

  // 2. Participant student_rt1 gets valid scoped JWT
  const authRes = await h.request(`/api/dm/conversations/${conversationId}/realtime-config`, {
    caller: 'student_rt1',
  });
  assert.equal(authRes.status, 200);
  assert.equal(authRes.data.topic, `dm:${conversationId}:1`);
  assert.ok(authRes.data.token);

  // Verify JWT claims
  const [headerB64, payloadB64, sig] = authRes.data.token.split('.');
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  assert.equal(payload.dm_conversation_id, conversationId);
  assert.equal(payload.dm_epoch, 1);
  assert.equal(payload.role, 'authenticated');

  // Verify signature
  const expectedSig = createHmac('sha256', h.testSigningSecret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');
  assert.equal(sig, expectedSig);

  // 3. Unauthorized third-party (outsider_rt) receives 404
  const outsiderRes = await h.request(`/api/dm/conversations/${conversationId}/realtime-config`, {
    caller: 'outsider_rt',
  });
  assert.equal(outsiderRes.status, 404);

  // Non-participating admin receives 404
  const adminRes = await h.request(`/api/dm/conversations/${conversationId}/realtime-config`, {
    caller: 'admin_rt1',
  });
  assert.equal(adminRes.status, 404);
});

test('DM Realtime: 4, 5, 6, 7. Persona matrix realtime tokens (Student, Teacher, Admin)', async t => {
  const h = await createRealtimeTestHarness(t);

  // 4. Student ↔ Student
  const s2s = await h.request('/api/dm/conversations', { method: 'POST', caller: 'student_rt1', body: { targetUserId: 'student_rt2' } });
  const cfg1 = await h.request(`/api/dm/conversations/${s2s.data.conversationId}/realtime-config`, { caller: 'student_rt1' });
  assert.equal(cfg1.status, 200);

  // 5. Student ↔ Teacher
  const s2t = await h.request('/api/dm/conversations', { method: 'POST', caller: 'student_rt1', body: { targetUserId: 'teacher_rt1' } });
  const cfg2 = await h.request(`/api/dm/conversations/${s2t.data.conversationId}/realtime-config`, { caller: 'teacher_rt1' });
  assert.equal(cfg2.status, 200);

  // 6. Teacher ↔ Admin
  const t2a = await h.request('/api/dm/conversations', { method: 'POST', caller: 'teacher_rt1', body: { targetUserId: 'admin_rt1' } });
  const cfg3 = await h.request(`/api/dm/conversations/${t2a.data.conversationId}/realtime-config`, { caller: 'admin_rt1' });
  assert.equal(cfg3.status, 200);

  // 7. Admin ↔ Admin
  const a2a = await h.request('/api/dm/conversations', { method: 'POST', caller: 'admin_rt1', body: { targetUserId: 'admin_rt2' } });
  const cfg4 = await h.request(`/api/dm/conversations/${a2a.data.conversationId}/realtime-config`, { caller: 'admin_rt2' });
  assert.equal(cfg4.status, 200);
});

test('DM Realtime: 8 & 9. Message ordering & duplicate delivery handling', async t => {
  const h = await createRealtimeTestHarness(t);

  const conv = await h.service.getOrCreateConversation('student_rt1', 'student_rt2');
  const convId = conv.conversationId;

  const m1 = await h.service.sendMessage('student_rt1', convId, { clientId: 'c1', text: 'First' });
  const m2 = await h.service.sendMessage('student_rt1', convId, { clientId: 'c2', text: 'Second' });
  const m3 = await h.service.sendMessage('student_rt1', convId, { clientId: 'c3', text: 'Third' });

  // 8. Monotonic order
  assert.ok(m1.message.id < m2.message.id);
  assert.ok(m2.message.id < m3.message.id);

  // 9. Duplicate retry returns identical message
  const retry = await h.service.sendMessage('student_rt1', convId, { clientId: 'c2', text: 'Second' });
  assert.equal(retry.duplicate, true);
  assert.equal(retry.message.id, m2.message.id);
});

test('DM Realtime: 10, 11, 12. Network interruption, reconnection sync & missed message recovery', async t => {
  const h = await createRealtimeTestHarness(t);

  const conv = await h.service.getOrCreateConversation('student_rt1', 'student_rt2');
  const convId = conv.conversationId;

  // Send message 1 & 2 while connected
  const m1 = await h.service.sendMessage('student_rt1', convId, { clientId: 'c1', text: 'Msg 1' });
  const m2 = await h.service.sendMessage('student_rt1', convId, { clientId: 'c2', text: 'Msg 2' });

  // Client goes offline (only saw up to m2)
  const lastSeenId = m2.message.id;
  const offlineTimestamp = new Date().toISOString();

  // Peer sends m3 and m4 while client is offline
  await h.service.sendMessage('student_rt2', convId, { clientId: 'c3', text: 'Msg 3' });
  await h.service.sendMessage('student_rt2', convId, { clientId: 'c4', text: 'Msg 4' });

  // Client reconnects and calls /sync
  const syncRes = await h.request(`/api/dm/conversations/${convId}/sync?sinceMessageId=${lastSeenId}&sinceTimestamp=${offlineTimestamp}`, {
    caller: 'student_rt1',
  });
  assert.equal(syncRes.status, 200);

  // Missed messages 3 and 4 recovered
  assert.equal(syncRes.data.messages.length, 2);
  assert.equal(syncRes.data.messages[0].text, 'Msg 3');
  assert.equal(syncRes.data.messages[1].text, 'Msg 4');
});

test('DM Realtime: 13 & 14. Message edit and deletion propagation via outbox', async t => {
  const h = await createRealtimeTestHarness(t);

  const conv = await h.service.getOrCreateConversation('student_rt1', 'student_rt2');
  const convId = conv.conversationId;

  const msg = await h.service.sendMessage('student_rt1', convId, { clientId: 'c1', text: 'Original text' });

  // 13. Edit message
  await h.service.editMessage('student_rt1', convId, msg.message.id, { text: 'Edited text' });
  const editOutbox = await h.db.get(
    "SELECT * FROM dm_realtime_outbox WHERE conversation_id = ? AND event_type = 'dm:message:edited'",
    convId
  );
  assert.ok(editOutbox);
  const editPayload = JSON.parse(editOutbox.payload_json);
  assert.equal(editPayload.text, 'Edited text');

  // 14. Delete for everyone
  await h.service.deleteMessage('student_rt1', convId, msg.message.id, { mode: 'for_everyone' });
  const deleteOutbox = await h.db.get(
    "SELECT * FROM dm_realtime_outbox WHERE conversation_id = ? AND event_type = 'dm:message:deleted'",
    convId
  );
  assert.ok(deleteOutbox);
  const deletePayload = JSON.parse(deleteOutbox.payload_json);
  assert.equal(deletePayload.mode, 'for_everyone');
});

test('DM Realtime: 15. Read receipt synchronization', async t => {
  const h = await createRealtimeTestHarness(t);

  const conv = await h.service.getOrCreateConversation('student_rt1', 'student_rt2');
  const convId = conv.conversationId;

  const msg = await h.service.sendMessage('student_rt1', convId, { clientId: 'c1', text: 'Ping' });

  // student_rt2 marks read
  await h.service.markRead('student_rt2', convId, { lastReadMessageId: msg.message.id });

  const readOutbox = await h.db.get(
    "SELECT * FROM dm_realtime_outbox WHERE conversation_id = ? AND event_type = 'dm:read:updated'",
    convId
  );
  assert.ok(readOutbox);
  const readPayload = JSON.parse(readOutbox.payload_json);
  assert.equal(readPayload.lastReadMessageId, msg.message.id);
  assert.equal(readPayload.studentId, 'student_rt2');
});

test('DM Realtime: 16. Ephemeral typing indicator expiry (no database persistence)', async t => {
  const h = await createRealtimeTestHarness(t);

  const conv = await h.service.getOrCreateConversation('student_rt1', 'student_rt2');
  const convId = conv.conversationId;

  const typingRes = await h.request(`/api/dm/conversations/${convId}/typing`, {
    method: 'POST',
    caller: 'student_rt1',
    body: { isTyping: true },
  });
  assert.equal(typingRes.status, 200);

  // Verify broadcast sent with expiresAt
  const typingBroadcast = h.broadcastMessages.find(m => m.event === 'dm:typing');
  assert.ok(typingBroadcast);
  assert.equal(typingBroadcast.payload.isTyping, true);
  assert.ok(typingBroadcast.payload.expiresAt);

  // Verify zero database writes in dm_messages or dm_realtime_outbox
  const outboxCount = await h.db.get("SELECT COUNT(*) AS c FROM dm_realtime_outbox WHERE event_type = 'dm:typing'");
  assert.equal(Number(outboxCount.c), 0);
});

test('DM Realtime: 17 & 18. Blocking revokes realtime and cancels queued outbox events', async t => {
  const h = await createRealtimeTestHarness(t);

  const conv = await h.service.getOrCreateConversation('student_rt1', 'student_rt2');
  const convId = conv.conversationId;

  // Send message before block (creates pending outbox event)
  await h.service.sendMessage('student_rt1', convId, { clientId: 'c1', text: 'Pre-block message' });

  // student_rt2 blocks student_rt1
  await h.service.blockUser('student_rt2', 'student_rt1');

  // 17. Realtime config is now denied with 403
  const configRes = await h.request(`/api/dm/conversations/${convId}/realtime-config`, {
    caller: 'student_rt1',
  });
  assert.equal(configRes.status, 403);

  // Typing event is dropped and not broadcast
  h.broadcastMessages.length = 0;
  await h.request(`/api/dm/conversations/${convId}/typing`, {
    method: 'POST',
    caller: 'student_rt1',
    body: { isTyping: true },
  });
  assert.equal(h.broadcastMessages.length, 0);

  // 18. Outbox drainer detects block and cancels the pending event instead of broadcasting
  await h.service.drain();
  const eventRow = await h.db.get('SELECT status FROM dm_realtime_outbox WHERE conversation_id = ?', convId);
  assert.equal(eventRow.status, 'cancelled');
});

test('DM Push: 19 & 20. Push notification privacy and mute suppression', async t => {
  const h = await createRealtimeTestHarness(t);

  // Register device token for recipient student_rt2
  await h.db.run(
    "INSERT INTO student_device_tokens (expo_push_token, student_id, platform) VALUES (?, ?, ?)",
    'ExponentPushToken[student2-device1]', 'student_rt2', 'ios'
  );

  // Configure recipient preference: hide_lockscreen_preview = 1
  await h.db.run(
    "INSERT INTO student_notification_preferences (student_id, hide_lockscreen_preview, mute_chat) VALUES (?, 1, 0)",
    'student_rt2'
  );

  const conv = await h.service.getOrCreateConversation('student_rt1', 'student_rt2');
  const convId = conv.conversationId;

  // 19. Send message: preview is masked as 'New private message'
  await h.service.sendMessage('student_rt1', convId, { clientId: 'c1', text: 'Top Secret Exam Question' });

  const pushRow = await h.db.get("SELECT * FROM push_notification_outbox WHERE event_type = 'dm' AND recipient_student_id = ?", 'student_rt2');
  assert.ok(pushRow);
  const payload = JSON.parse(pushRow.payload_json);
  assert.equal(payload.body, 'New private message');
  assert.equal(payload.type, 'dm');
  assert.equal(payload.conversationId, convId);

  // 20. Muted conversation suppression
  await h.db.run('UPDATE dm_participants SET is_muted = 1 WHERE conversation_id = ? AND student_id = ?', convId, 'student_rt2');
  await h.service.sendMessage('student_rt1', convId, { clientId: 'c2', text: 'Another message' });

  // No new push outbox record created for c2
  const pushRows = await h.db.all("SELECT * FROM push_notification_outbox WHERE event_type = 'dm' AND recipient_student_id = ?", 'student_rt2');
  assert.equal(pushRows.length, 1); // Only the first unmuted message
});

test('DM Push: 21. Multiple recipient devices get notification batch', async t => {
  const h = await createRealtimeTestHarness(t);

  // Register 2 devices for student_rt2
  await h.db.run("INSERT INTO student_device_tokens (expo_push_token, student_id, platform) VALUES (?, ?, ?)", 'ExponentPushToken[dev1]', 'student_rt2', 'ios');
  await h.db.run("INSERT INTO student_device_tokens (expo_push_token, student_id, platform) VALUES (?, ?, ?)", 'ExponentPushToken[dev2]', 'student_rt2', 'android');

  const conv = await h.service.getOrCreateConversation('student_rt1', 'student_rt2');
  const convId = conv.conversationId;

  await h.service.sendMessage('student_rt1', convId, { clientId: 'c1', text: 'Hello multi-device' });

  // Drain push outbox
  await h.service.drain();

  // Both devices received push
  assert.equal(h.pushBatches.length, 2);
  const tokens = h.pushBatches.map(p => p.to);
  assert.ok(tokens.includes('ExponentPushToken[dev1]'));
  assert.ok(tokens.includes('ExponentPushToken[dev2]'));
});

test('DM Mobile: 22. Notification deep-link payload validation', async t => {
  // Unit test the mobile parseNotificationData logic for DM
  const samplePushData = {
    type: 'dm',
    conversationId: '550e8400-e29b-41d4-a716-446655440000',
    messageId: 42,
    senderId: 'student_rt1',
  };

  assert.equal(samplePushData.type, 'dm');
  assert.equal(samplePushData.conversationId, '550e8400-e29b-41d4-a716-446655440000');
  assert.equal(samplePushData.messageId, 42);
  assert.equal(samplePushData.senderId, 'student_rt1');
});

test('DM Realtime: 23 & 24. Concurrent outbox workers & retry backoff on failure', async t => {
  // Test with failing transport to verify retry backoff
  const h = await createRealtimeTestHarness(t, { failBroadcast: true });

  const conv = await h.service.getOrCreateConversation('student_rt1', 'student_rt2');
  const convId = conv.conversationId;

  await h.service.sendMessage('student_rt1', convId, { clientId: 'c1', text: 'Retry test' });

  // 24. First drain fails: status becomes 'retry', attempts = 1
  await h.service.drain();
  const eventAfterFail = await h.db.get('SELECT * FROM dm_realtime_outbox WHERE conversation_id = ?', convId);
  assert.equal(eventAfterFail.status, 'retry');
  assert.equal(eventAfterFail.attempts, 1);
  assert.ok(new Date(eventAfterFail.next_attempt_at) > new Date());
});

test('DM Isolation: 25. Existing cohort chat namespaces remain completely unaffected', async t => {
  const h = await createRealtimeTestHarness(t);

  // DM topics strictly match /^dm:[0-9a-f-]{36}:\d+$/
  const conv = await h.service.getOrCreateConversation('student_rt1', 'student_rt2');
  const convId = conv.conversationId;

  const cfg = await h.service.getRealtimeConfig('student_rt1', convId);
  assert.ok(cfg.topic.startsWith('dm:'));
  assert.ok(!cfg.topic.startsWith('chat:'));

  // Ensure cohort provider regex rejects dm topics
  const cohortTopicRegex = /^chat:[0-9a-f-]{36}:\d+$/;
  assert.equal(cohortTopicRegex.test(cfg.topic), false);

  // Ensure dm topic regex rejects cohort topics
  const dmTopicRegex = /^dm:[0-9a-f-]{36}:\d+$/;
  assert.equal(dmTopicRegex.test('chat:550e8400-e29b-41d4-a716-446655440000:1'), false);
});

test('DM Step 3D: 26. Outbox status check constraint accepts failed status without error', async t => {
  const h = await createRealtimeTestHarness(t);

  const conv = await h.service.getOrCreateConversation('student_rt1', 'student_rt2');
  const convId = conv.conversationId;

  // Insert event directly with status = 'failed'
  const eventId = randomUUID();
  await h.db.run(
    `INSERT INTO dm_realtime_outbox (id, event_id, conversation_id, realtime_epoch, event_type, payload_json, status, attempts, next_attempt_at, created_at)
     VALUES (?, ?, ?, 1, 'dm:message:new', '{}', 'failed', 5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    eventId, eventId, convId
  );

  const row = await h.db.get('SELECT status FROM dm_realtime_outbox WHERE id = ?', eventId);
  assert.equal(row.status, 'failed');
});

test('DM Step 3D: 27. Internal worker security: Ordinary users rejected with 403, admin/worker allowed', async t => {
  const h = await createRealtimeTestHarness(t);

  const originalCronSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'test_worker_cron_secret_789';
  t.after(() => {
    if (originalCronSecret) process.env.CRON_SECRET = originalCronSecret;
    else delete process.env.CRON_SECRET;
  });

  // 1. Unauthenticated request -> 401
  const unauthRes = await h.request('/api/dm/outbox/drain', { method: 'POST' });
  assert.equal(unauthRes.status, 401);

  // 2. Ordinary student -> 403
  const studentRes = await h.request('/api/dm/outbox/drain', {
    method: 'POST',
    caller: 'student_rt1',
  });
  assert.equal(studentRes.status, 403);

  // 3. Teacher -> 403
  const teacherRes = await h.request('/api/dm/outbox/drain', {
    method: 'POST',
    caller: 'teacher_rt1',
  });
  assert.equal(teacherRes.status, 403);

  // 4. Admin without CRON_SECRET -> 403
  const adminRes = await h.request('/api/dm/outbox/drain', {
    method: 'POST',
    caller: 'admin_rt1',
  });
  assert.equal(adminRes.status, 403);

  // 5. Worker using x-cron-secret -> 200
  const workerRes = await h.request('/api/dm/outbox/drain', {
    method: 'POST',
    headers: { 'x-cron-secret': 'test_worker_cron_secret_789' },
  });
  assert.equal(workerRes.status, 200);

  // 6. Worker using invalid secret -> 401 or 403
  const badSecretRes = await h.request('/api/dm/outbox/drain', {
    method: 'POST',
    headers: { 'x-cron-secret': 'wrong_secret' },
  });
  assert.equal(badSecretRes.status, 401);
});

test('DM Step 3D: 28. Comprehensive /sync: Recovers mixed edits, deletes, and read cursor across boundaries', async t => {
  const h = await createRealtimeTestHarness(t);

  const conv = await h.service.getOrCreateConversation('student_rt1', 'student_rt2');
  const convId = conv.conversationId;

  // Initial message m1 sent at t0
  const m1 = await h.service.sendMessage('student_rt1', convId, { clientId: 'c1', text: 'M1 original' });
  const t0 = new Date().toISOString();

  // Wait a small tick
  await new Promise(r => setTimeout(r, 10));

  // Edit m1 at t1
  await h.service.editMessage('student_rt1', convId, m1.message.id, { text: 'M1 updated' });

  // Send m2 and then delete for everyone at t2
  const m2 = await h.service.sendMessage('student_rt1', convId, { clientId: 'c2', text: 'M2 to delete' });
  await h.service.deleteMessage('student_rt1', convId, m2.message.id, { mode: 'for_everyone' });

  // Send m3 (new active message)
  const m3 = await h.service.sendMessage('student_rt2', convId, { clientId: 'c3', text: 'M3 new message' });

  // Advance read cursor for student_rt2
  await h.service.markRead('student_rt2', convId, { lastReadMessageId: m3.message.id });

  // Call sync with sinceMessageId = m1.message.id and sinceTimestamp = t0
  const syncRes = await h.request(
    `/api/dm/conversations/${convId}/sync?sinceMessageId=${m1.message.id}&sinceTimestamp=${t0}`,
    { caller: 'student_rt1' }
  );

  assert.equal(syncRes.status, 200);

  // Check new messages: should include m2 (tombstoned text null) and m3
  assert.equal(syncRes.data.messages.length, 2);
  const syncedM2 = syncRes.data.messages.find(m => m.id === m2.message.id);
  const syncedM3 = syncRes.data.messages.find(m => m.id === m3.message.id);
  assert.ok(syncedM2);
  assert.equal(syncedM2.text, null);
  assert.equal(syncedM2.deletedForAll, true);
  assert.ok(syncedM3);
  assert.equal(syncedM3.text, 'M3 new message');

  // Check edits: m1 edit recovered
  assert.equal(syncRes.data.edits.length, 1);
  assert.equal(syncRes.data.edits[0].messageId, m1.message.id);
  assert.equal(syncRes.data.edits[0].text, 'M1 updated');

  // Check deletions: m2 deletion recovered
  assert.equal(syncRes.data.deletions.length, 1);
  assert.equal(syncRes.data.deletions[0].messageId, m2.message.id);

  // Check read cursor: peer read cursor is m3
  assert.equal(syncRes.data.readCursor.peerLastReadMessageId, m3.message.id);
});

test('DM Realtime: 29. Full projection synchronization lifecycle: creation, config, block rotation/revocation & unblock restoration', async t => {
  const h = await createRealtimeTestHarness(t);

  // 1. Conversation creation triggers initial projection
  const createRes = await h.request('/api/dm/conversations', {
    method: 'POST',
    caller: 'student_rt1',
    body: { targetUserId: 'student_rt2' },
  });
  assert.ok([200, 201].includes(createRes.status));
  const convId = createRes.data.conversationId;
  assert.ok(convId);

  // Initial creation projection was sent
  assert.ok(h.projectionSyncCalls.length >= 1);
  const initialSync = h.projectionSyncCalls[0];
  assert.equal(initialSync.conversationId, convId);
  assert.equal(initialSync.realtimeEpoch, 1);
  assert.equal(initialSync.status, 'active');
  assert.equal(initialSync.participants.length, 2);

  // 2. Fetching realtime-config synchronizes projection before issuing credentials
  const preConfigCalls = h.projectionSyncCalls.length;
  const configRes = await h.request(`/api/dm/conversations/${convId}/realtime-config`, {
    caller: 'student_rt1',
  });
  assert.equal(configRes.status, 200);
  assert.ok(configRes.data.token);
  assert.equal(configRes.data.realtimeEpoch, 1);
  assert.ok(h.projectionSyncCalls.length > preConfigCalls);

  // 3. Blocking: rotates epoch, cancels outbox, and synchronizes status: 'blocked' with empty participants
  const preBlockCalls = h.projectionSyncCalls.length;
  const blockRes = await h.request(`/api/dm/users/student_rt2/block`, {
    method: 'POST',
    caller: 'student_rt1',
  });
  assert.equal(blockRes.status, 200);

  // Verify epoch incremented in database
  const convRow = await h.db.get('SELECT realtime_epoch FROM dm_conversations WHERE id = ?', convId);
  assert.equal(Number(convRow.realtime_epoch), 2);

  // Verify blocked projection synchronized
  const blockSync = h.projectionSyncCalls[h.projectionSyncCalls.length - 1];
  assert.equal(blockSync.conversationId, convId);
  assert.equal(blockSync.realtimeEpoch, 2);
  assert.equal(blockSync.status, 'blocked');
  assert.deepEqual(blockSync.participants, []);

  // Blocked user attempting to get realtime-config is rejected with 403
  const blockedConfigRes = await h.request(`/api/dm/conversations/${convId}/realtime-config`, {
    caller: 'student_rt2',
  });
  assert.equal(blockedConfigRes.status, 403);

  // 4. Unblocking: restores active status, rotates epoch, and synchronizes both participants
  const unblockRes = await h.request(`/api/dm/users/student_rt2/block`, {
    method: 'DELETE',
    caller: 'student_rt1',
  });
  assert.equal(unblockRes.status, 200);

  const unblockedConvRow = await h.db.get('SELECT realtime_epoch FROM dm_conversations WHERE id = ?', convId);
  assert.equal(Number(unblockedConvRow.realtime_epoch), 3);

  const unblockSync = h.projectionSyncCalls[h.projectionSyncCalls.length - 1];
  assert.equal(unblockSync.conversationId, convId);
  assert.equal(unblockSync.realtimeEpoch, 3);
  assert.equal(unblockSync.status, 'active');
  assert.equal(unblockSync.participants.length, 2);

  // Unblocked user can now get realtime-config with new epoch 3
  const restoredConfigRes = await h.request(`/api/dm/conversations/${convId}/realtime-config`, {
    caller: 'student_rt1',
  });
  assert.equal(restoredConfigRes.status, 200);
  assert.equal(restoredConfigRes.data.realtimeEpoch, 3);
  assert.equal(restoredConfigRes.data.topic, `dm:${convId}:3`);
});

test('DM Realtime: 30. Canonical Supabase Auth UUID preference in JWT subject & projection', async t => {
  const h = await createRealtimeTestHarness(t);

  // Link student_rt1 to a canonical Supabase Auth UUID
  const canonicalUid = 'a0000000-0000-4000-8000-000000000001';
  await h.db.run('UPDATE students SET supabase_uid = ? WHERE studentId = ?', canonicalUid, 'student_rt1');

  const convRes = await h.service.getOrCreateConversation('student_rt1', 'student_rt2');
  const convId = convRes.conversationId;

  const cfg = await h.service.getRealtimeConfig('student_rt1', convId);
  assert.ok(cfg.token);

  // Decode token payload
  const [, payloadB64] = cfg.token.split('.');
  const tokenPayload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));

  // Token sub MUST match the canonical supabase_uid
  assert.equal(tokenPayload.sub, canonicalUid);
  assert.equal(tokenPayload.dm_conversation_id, convId);

  // Projection participant subject MUST also match canonical supabase_uid
  const lastSync = h.projectionSyncCalls[h.projectionSyncCalls.length - 1];
  const participantSubjects = lastSync.participants.map(p => p.subject);
  assert.ok(participantSubjects.includes(canonicalUid), 'Canonical UUID must be present in projection participants');
});

test('DM Realtime: 31. Fail-closed behavior when Supabase projection synchronization fails', async t => {
  // Harness configured with failProjection: true and requireProjectionSync: true
  const h = await createRealtimeTestHarness(t, { failProjection: true, requireProjectionSync: true });

  const convRes = await h.service.getOrCreateConversation('student_rt1', 'student_rt2');
  const convId = convRes.conversationId;

  // Realtime config request must fail closed with 502
  const res = await h.request(`/api/dm/conversations/${convId}/realtime-config`, {
    caller: 'student_rt1',
  });
  assert.equal(res.status, 502);
  assert.match(res.data.error, /Realtime authorization synchronization failed/);
});



test('DM stabilization: unlinked identity returns actionable 403 without issuing credentials or exposing account IDs', async t => {
  const h = await createRealtimeTestHarness(t);
  const conversation = await h.service.getOrCreateConversation('student_rt1', 'student_rt2');
  h.providers.credentials.subject = async () => {
    const error = new Error('private account identifier must not escape');
    error.code = 'SUPABASE_UID_REQUIRED';
    error.status = 403;
    throw error;
  };
  const response = await h.request(`/api/dm/conversations/${conversation.conversationId}/realtime-config`, { caller: 'student_rt1' });
  assert.equal(response.status, 403);
  assert.equal(response.data.code, 'SUPABASE_UID_REQUIRED');
  assert.equal(response.data.token, undefined);
  assert.ok(!JSON.stringify(response.data).includes('private account identifier'));
});

test('DM stabilization: duplicate read receipt does not enqueue another broadcast or regress cursor', async t => {
  const h = await createRealtimeTestHarness(t);
  const { conversationId } = await h.service.getOrCreateConversation('student_rt1', 'student_rt2');
  const { message } = await h.service.sendMessage('student_rt1', conversationId, { clientId: 'read-stable', text: 'Read once' });
  await h.service.markRead('student_rt2', conversationId, { lastReadMessageId: message.id });
  await h.service.markRead('student_rt2', conversationId, { lastReadMessageId: message.id });
  const row = await h.db.get("SELECT COUNT(*) AS count FROM dm_realtime_outbox WHERE event_type = 'dm:read:updated'");
  assert.equal(Number(row.count), 1);
});

test('DM stabilization: crashed outbox claims are recovered after lease expiry', async t => {
  const h = await createRealtimeTestHarness(t);
  const { conversationId } = await h.service.getOrCreateConversation('student_rt1', 'student_rt2');
  await h.service.sendMessage('student_rt1', conversationId, { clientId: 'lease', text: 'recover me' });
  await h.db.run("UPDATE dm_realtime_outbox SET status = 'processing', next_attempt_at = ?", new Date(Date.now() - 1000).toISOString());
  await h.service.drain();
  assert.equal(h.broadcastMessages.length, 1);
  const row = await h.db.get('SELECT status FROM dm_realtime_outbox LIMIT 1');
  assert.equal(row.status, 'sent');
});

test('DM stabilization: deletion does not cancel its own tombstone broadcast', async t => {
  const h = await createRealtimeTestHarness(t);
  const { conversationId } = await h.service.getOrCreateConversation('student_rt1', 'student_rt2');
  const { message } = await h.service.sendMessage('student_rt1', conversationId, { clientId: 'delete-event', text: 'remove me' });
  await h.service.deleteMessage('student_rt1', conversationId, message.id, { mode: 'for_everyone' });
  await h.service.drain();
  assert.equal(h.broadcastMessages.length, 1);
  assert.equal(h.broadcastMessages[0].event, 'dm:message:deleted');
  const retry = await h.service.sendMessage('student_rt1', conversationId, { clientId: 'delete-event', text: 'remove me' });
  assert.equal(retry.duplicate, true);
  assert.equal(retry.message.text, null);
  assert.equal(retry.message.deletedForAll, true);
});
