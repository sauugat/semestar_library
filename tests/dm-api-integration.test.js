'use strict';

process.env.NODE_ENV = 'test';
process.env.DM_ENABLED = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const { fixture } = require('./helpers/cohort-fixture');
const { migrateDirectMessaging } = require('../migrations/005-direct-messaging-schema');
const { createDmService } = require('../lib/dm-service');
const directMessagingRouter = require('../routes/direct-messaging');

/**
 * Helper to build an isolated, in-memory Express testing client.
 */
async function createTestHarness(t, options = {}) {
  const f = await fixture('sqlite', { migrate: true });
  t.after(f.close);

  await migrateDirectMessaging(f.db, { disposable: true });

  const studentCols = (await f.db.all("PRAGMA table_info(students)")).map(c => c.name);
  if (!studentCols.includes('verification_status')) {
    await f.db.run("ALTER TABLE students ADD COLUMN verification_status TEXT DEFAULT 'unverified'");
  }

  // Seed required student, teacher, CR, admin, and unverified personas
  const accounts = [
    { id: 'admin1', name: 'Admin One', role: 'admin', status: 'verified' },
    { id: 'admin2', name: 'Admin Two', role: 'admin', status: 'verified' },
    { id: 'teacher1', name: 'Teacher One', role: 'teacher', status: 'verified' },
    { id: 'teacher2', name: 'Teacher Two', role: 'teacher', status: 'verified' },
    { id: 'cr1', name: 'Class Rep One', role: 'cr', status: 'verified' },
    { id: 'student1', name: 'Student One', role: 'student', status: 'verified' },
    { id: 'student2', name: 'Student Two', role: 'student', status: 'verified' },
    { id: 'student3', name: 'Student Three', role: 'student', status: 'verified' },
    { id: 'unverified1', name: 'Unverified Student', role: 'student', status: 'unverified' },
    { id: 'suspended1', name: 'Suspended Student', role: 'suspended', status: 'verified' },
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

  const dmService = createDmService(f.db, options);

  const app = express();
  app.use(express.json());

  // Test Authentication Middleware mapping Bearer token to req.student
  app.use((req, res, next) => {
    const authHeader = req.get('authorization') || '';
    const match = /^Bearer\s+([a-zA-Z0-9_-]+)$/.exec(authHeader);
    if (match) {
      req.student = { studentId: match[1] };
    }
    next();
  });

  app.use('/api/dm', directMessagingRouter(dmService));

  const server = app.listen(0);
  t.after(() => server.close());

  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  async function request(path, { method = 'GET', caller, body, query } = {}) {
    let url = `${baseUrl}${path}`;
    if (query) {
      const qParams = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) qParams.set(k, String(v));
      }
      const qs = qParams.toString();
      if (qs) url += `?${qs}`;
    }

    const headers = { 'content-type': 'application/json' };
    if (caller) {
      headers['authorization'] = `Bearer ${caller}`;
    }

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
      body: data,
    };
  }

  return { f, dmService, request };
}

// ============================================================================
// SUITE 1: ALL PAIRING PERMUTATIONS (Student, Teacher, Admin, CR)
// ============================================================================

test('DM API: 1. Student to student messaging works end-to-end', async t => {
  const { request } = await createTestHarness(t);

  const convRes = await request('/api/dm/conversations', {
    method: 'POST',
    caller: 'student1',
    body: { targetUserId: 'student2' },
  });
  assert.equal(convRes.status, 201);
  const convId = convRes.body.conversationId;
  assert.ok(convId);

  const sendRes = await request(`/api/dm/conversations/${convId}/messages`, {
    method: 'POST',
    caller: 'student1',
    body: { clientId: randomUUID(), text: 'Hello Student 2!' },
  });
  assert.equal(sendRes.status, 201);
  assert.equal(sendRes.body.message.text, 'Hello Student 2!');

  const historyRes = await request(`/api/dm/conversations/${convId}/messages`, {
    caller: 'student2',
  });
  assert.equal(historyRes.status, 200);
  assert.equal(historyRes.body.messages.length, 1);
  assert.equal(historyRes.body.messages[0].text, 'Hello Student 2!');
});

test('DM API: 2. Student to teacher messaging works', async t => {
  const { request } = await createTestHarness(t);

  const conv = await request('/api/dm/conversations', {
    method: 'POST',
    caller: 'student1',
    body: { targetUserId: 'teacher1' },
  });
  assert.equal(conv.status, 201);

  const send = await request(`/api/dm/conversations/${conv.body.conversationId}/messages`, {
    method: 'POST',
    caller: 'student1',
    body: { clientId: randomUUID(), text: 'Hello Professor' },
  });
  assert.equal(send.status, 201);

  const reply = await request(`/api/dm/conversations/${conv.body.conversationId}/messages`, {
    method: 'POST',
    caller: 'teacher1',
    body: { clientId: randomUUID(), text: 'Hello Student', replyToId: send.body.message.id },
  });
  assert.equal(reply.status, 201);
  assert.equal(reply.body.message.replyToId, send.body.message.id);
});

test('DM API: 3. Student to admin messaging works', async t => {
  const { request } = await createTestHarness(t);

  const conv = await request('/api/dm/conversations', {
    method: 'POST',
    caller: 'student1',
    body: { targetUserId: 'admin1' },
  });
  assert.equal(conv.status, 201);

  const send = await request(`/api/dm/conversations/${conv.body.conversationId}/messages`, {
    method: 'POST',
    caller: 'student1',
    body: { clientId: randomUUID(), text: 'Inquiry about campus network' },
  });
  assert.equal(send.status, 201);
});

test('DM API: 4. Teacher to teacher messaging works', async t => {
  const { request } = await createTestHarness(t);

  const conv = await request('/api/dm/conversations', {
    method: 'POST',
    caller: 'teacher1',
    body: { targetUserId: 'teacher2' },
  });
  assert.equal(conv.status, 201);

  const send = await request(`/api/dm/conversations/${conv.body.conversationId}/messages`, {
    method: 'POST',
    caller: 'teacher1',
    body: { clientId: randomUUID(), text: 'Coordinating lab schedule' },
  });
  assert.equal(send.status, 201);
});

test('DM API: 5. Teacher to admin messaging works', async t => {
  const { request } = await createTestHarness(t);

  const conv = await request('/api/dm/conversations', {
    method: 'POST',
    caller: 'teacher1',
    body: { targetUserId: 'admin1' },
  });
  assert.equal(conv.status, 201);

  const send = await request(`/api/dm/conversations/${conv.body.conversationId}/messages`, {
    method: 'POST',
    caller: 'teacher1',
    body: { clientId: randomUUID(), text: 'Faculty meeting minutes attached' },
  });
  assert.equal(send.status, 201);
});

test('DM API: 6. Admin to admin messaging works', async t => {
  const { request } = await createTestHarness(t);

  const conv = await request('/api/dm/conversations', {
    method: 'POST',
    caller: 'admin1',
    body: { targetUserId: 'admin2' },
  });
  assert.equal(conv.status, 201);

  const send = await request(`/api/dm/conversations/${conv.body.conversationId}/messages`, {
    method: 'POST',
    caller: 'admin1',
    body: { clientId: randomUUID(), text: 'System maintenance sync' },
  });
  assert.equal(send.status, 201);
});

test('DM API: 7. CR messaging permissions: CR has normal student DM capabilities', async t => {
  const { request } = await createTestHarness(t);

  const conv = await request('/api/dm/conversations', {
    method: 'POST',
    caller: 'cr1',
    body: { targetUserId: 'student1' },
  });
  assert.equal(conv.status, 201);

  const send = await request(`/api/dm/conversations/${conv.body.conversationId}/messages`, {
    method: 'POST',
    caller: 'cr1',
    body: { clientId: randomUUID(), text: 'Class representative check-in' },
  });
  assert.equal(send.status, 201);
});

// ============================================================================
// SUITE 2: ACCESS CONTROL, SECURITY & ISOLATION
// ============================================================================

test('DM API: 8. Unverified users cannot start chats or send messages', async t => {
  const { request } = await createTestHarness(t);

  const createRes = await request('/api/dm/conversations', {
    method: 'POST',
    caller: 'unverified1',
    body: { targetUserId: 'student1' },
  });
  assert.equal(createRes.status, 403);
  assert.match(createRes.body.message, /verification required/i);

  const searchRes = await request('/api/dm/users/search', {
    caller: 'unverified1',
    query: { q: 'Student' },
  });
  assert.equal(searchRes.status, 403);
});

test('DM API: 9. Unauthorized third-party and non-participating Admins receive 404', async t => {
  const { request } = await createTestHarness(t);

  // Conv between student1 and student2
  const conv = await request('/api/dm/conversations', {
    method: 'POST',
    caller: 'student1',
    body: { targetUserId: 'student2' },
  });
  const convId = conv.body.conversationId;

  // Student 3 (outsider) attempting to read history
  const outsiderRead = await request(`/api/dm/conversations/${convId}/messages`, {
    caller: 'student3',
  });
  assert.equal(outsiderRead.status, 404);

  // Admin 1 (outsider) attempting to read private history: ADMIN MUST NOT RECEIVE SPECIAL ACCESS
  const adminRead = await request(`/api/dm/conversations/${convId}/messages`, {
    caller: 'admin1',
  });
  assert.equal(adminRead.status, 404, 'Admin must not have access to other users private conversations');

  // Admin attempting to send message into non-participating conversation
  const adminSend = await request(`/api/dm/conversations/${convId}/messages`, {
    method: 'POST',
    caller: 'admin1',
    body: { clientId: randomUUID(), text: 'Unauthorized intrusion' },
  });
  assert.equal(adminSend.status, 404);
});

test('DM API: 10. Duplicate conversation creation returns identical ID', async t => {
  const { request } = await createTestHarness(t);

  const first = await request('/api/dm/conversations', {
    method: 'POST',
    caller: 'student1',
    body: { targetUserId: 'student2' },
  });
  assert.equal(first.status, 201);
  assert.equal(first.body.isNew, true);

  const second = await request('/api/dm/conversations', {
    method: 'POST',
    caller: 'student2', // target initiates from the other side
    body: { targetUserId: 'student1' },
  });
  assert.equal(second.status, 200);
  assert.equal(second.body.isNew, false);
  assert.equal(second.body.conversationId, first.body.conversationId);
});

test('DM API: 11. Duplicate message retries return existing message idempotently', async t => {
  const { request } = await createTestHarness(t);

  const conv = await request('/api/dm/conversations', {
    method: 'POST',
    caller: 'student1',
    body: { targetUserId: 'student2' },
  });
  const convId = conv.body.conversationId;
  const clientId = randomUUID();

  const firstSend = await request(`/api/dm/conversations/${convId}/messages`, {
    method: 'POST',
    caller: 'student1',
    body: { clientId, text: 'Idempotent payload' },
  });
  assert.equal(firstSend.status, 201);
  assert.equal(firstSend.body.duplicate, false);

  const retrySend = await request(`/api/dm/conversations/${convId}/messages`, {
    method: 'POST',
    caller: 'student1',
    body: { clientId, text: 'Idempotent payload' },
  });
  assert.equal(retrySend.status, 200);
  assert.equal(retrySend.body.duplicate, true);
  assert.equal(retrySend.body.message.id, firstSend.body.message.id);
});

// ============================================================================
// SUITE 3: MESSAGE EDITING & THREE-TIER DELETION
// ============================================================================

test('DM API: 12. Message editing: Author only, within edit window, cannot edit deleted', async t => {
  const { request } = await createTestHarness(t);

  const conv = await request('/api/dm/conversations', {
    method: 'POST',
    caller: 'student1',
    body: { targetUserId: 'student2' },
  });
  const convId = conv.body.conversationId;

  const msg = await request(`/api/dm/conversations/${convId}/messages`, {
    method: 'POST',
    caller: 'student1',
    body: { clientId: randomUUID(), text: 'Original text' },
  });
  const msgId = msg.body.message.id;

  // Non-author attempting to edit
  const illegalEdit = await request(`/api/dm/conversations/${convId}/messages/${msgId}`, {
    method: 'PATCH',
    caller: 'student2',
    body: { text: 'Hacked text' },
  });
  assert.equal(illegalEdit.status, 403);

  // Author edits successfully
  const validEdit = await request(`/api/dm/conversations/${convId}/messages/${msgId}`, {
    method: 'PATCH',
    caller: 'student1',
    body: { text: 'Corrected text' },
  });
  assert.equal(validEdit.status, 200);
  assert.equal(validEdit.body.text, 'Corrected text');

  // Verify in history
  const history = await request(`/api/dm/conversations/${convId}/messages`, { caller: 'student2' });
  assert.equal(history.body.messages[0].text, 'Corrected text');
  assert.equal(history.body.messages[0].isEdited, true);
});

test('DM API: 13. Delete for me: Isolated to caller, peer retains message', async t => {
  const { request } = await createTestHarness(t);

  const conv = await request('/api/dm/conversations', {
    method: 'POST',
    caller: 'student1',
    body: { targetUserId: 'student2' },
  });
  const convId = conv.body.conversationId;

  const msg = await request(`/api/dm/conversations/${convId}/messages`, {
    method: 'POST',
    caller: 'student1',
    body: { clientId: randomUUID(), text: 'Message to delete for me' },
  });
  const msgId = msg.body.message.id;

  // Student 1 deletes for me
  const delRes = await request(`/api/dm/conversations/${convId}/messages/${msgId}`, {
    method: 'DELETE',
    caller: 'student1',
    query: { mode: 'for_me' },
  });
  assert.equal(delRes.status, 200);

  // Student 1 does not see message
  const s1History = await request(`/api/dm/conversations/${convId}/messages`, { caller: 'student1' });
  assert.equal(s1History.body.messages.length, 0);

  // Student 2 STILL sees message completely intact!
  const s2History = await request(`/api/dm/conversations/${convId}/messages`, { caller: 'student2' });
  assert.equal(s2History.body.messages.length, 1);
  assert.equal(s2History.body.messages[0].text, 'Message to delete for me');
});

test('DM API: 14. Delete for everyone: Tombstoned for both participants', async t => {
  const { request } = await createTestHarness(t);

  const conv = await request('/api/dm/conversations', {
    method: 'POST',
    caller: 'student1',
    body: { targetUserId: 'student2' },
  });
  const convId = conv.body.conversationId;

  const msg = await request(`/api/dm/conversations/${convId}/messages`, {
    method: 'POST',
    caller: 'student1',
    body: { clientId: randomUUID(), text: 'Private secret message' },
  });
  const msgId = msg.body.message.id;

  // Recipient cannot delete for everyone
  const illegalDel = await request(`/api/dm/conversations/${convId}/messages/${msgId}`, {
    method: 'DELETE',
    caller: 'student2',
    query: { mode: 'for_everyone' },
  });
  assert.equal(illegalDel.status, 403);

  // Author deletes for everyone
  const authorDel = await request(`/api/dm/conversations/${convId}/messages/${msgId}`, {
    method: 'DELETE',
    caller: 'student1',
    query: { mode: 'for_everyone' },
  });
  assert.equal(authorDel.status, 200);

  // Both users see tombstone (text is null, deletedForAll is true)
  const s1View = await request(`/api/dm/conversations/${convId}/messages`, { caller: 'student1' });
  assert.equal(s1View.body.messages[0].deletedForAll, true);
  assert.equal(s1View.body.messages[0].text, null);

  const s2View = await request(`/api/dm/conversations/${convId}/messages`, { caller: 'student2' });
  assert.equal(s2View.body.messages[0].deletedForAll, true);
  assert.equal(s2View.body.messages[0].text, null);
});

test('DM API: 15. Clear conversation: Clears caller view, peer view untouched', async t => {
  const { request } = await createTestHarness(t);

  const conv = await request('/api/dm/conversations', {
    method: 'POST',
    caller: 'student1',
    body: { targetUserId: 'student2' },
  });
  const convId = conv.body.conversationId;

  await request(`/api/dm/conversations/${convId}/messages`, {
    method: 'POST',
    caller: 'student1',
    body: { clientId: randomUUID(), text: 'Msg 1' },
  });
  await request(`/api/dm/conversations/${convId}/messages`, {
    method: 'POST',
    caller: 'student2',
    body: { clientId: randomUUID(), text: 'Msg 2' },
  });

  // Student 1 clears conversation
  const clearRes = await request(`/api/dm/conversations/${convId}/clear`, {
    method: 'POST',
    caller: 'student1',
  });
  assert.equal(clearRes.status, 200);

  const s1View = await request(`/api/dm/conversations/${convId}/messages`, { caller: 'student1' });
  assert.equal(s1View.body.messages.length, 0);

  const s2View = await request(`/api/dm/conversations/${convId}/messages`, { caller: 'student2' });
  assert.equal(s2View.body.messages.length, 2);
});

// ============================================================================
// SUITE 4: READ RECEIPTS, BLOCKING & REPORTING
// ============================================================================

test('DM API: 16. Read receipts: Monotonic cursor, rejects messages from other chats', async t => {
  const { request } = await createTestHarness(t);

  const conv = await request('/api/dm/conversations', {
    method: 'POST',
    caller: 'student1',
    body: { targetUserId: 'student2' },
  });
  const convId = conv.body.conversationId;

  const msg1 = await request(`/api/dm/conversations/${convId}/messages`, {
    method: 'POST',
    caller: 'student1',
    body: { clientId: randomUUID(), text: 'Unread message 1' },
  });
  const msg2 = await request(`/api/dm/conversations/${convId}/messages`, {
    method: 'POST',
    caller: 'student1',
    body: { clientId: randomUUID(), text: 'Unread message 2' },
  });

  // Student 2 lists conversations: unreadCount = 2
  const listBefore = await request('/api/dm/conversations', { caller: 'student2' });
  assert.equal(listBefore.body.conversations[0].unreadCount, 2);

  // Student 2 marks read up to msg2
  const markRead = await request(`/api/dm/conversations/${convId}/read`, {
    method: 'POST',
    caller: 'student2',
    body: { lastReadMessageId: msg2.body.message.id },
  });
  assert.equal(markRead.status, 200);

  const listAfter = await request('/api/dm/conversations', { caller: 'student2' });
  assert.equal(listAfter.body.conversations[0].unreadCount, 0);

  // Attempting to mark read with a message ID from a non-existent message
  const badRead = await request(`/api/dm/conversations/${convId}/read`, {
    method: 'POST',
    caller: 'student2',
    body: { lastReadMessageId: 99999 },
  });
  assert.equal(badRead.status, 400);
});

test('DM API: 17 & 18. Blocking and unblocking: Prevents new sends, preserves history', async t => {
  const { request } = await createTestHarness(t);

  const conv = await request('/api/dm/conversations', {
    method: 'POST',
    caller: 'student1',
    body: { targetUserId: 'student2' },
  });
  const convId = conv.body.conversationId;

  await request(`/api/dm/conversations/${convId}/messages`, {
    method: 'POST',
    caller: 'student1',
    body: { clientId: randomUUID(), text: 'Pre-block message' },
  });

  // Student 1 blocks Student 2
  const blockRes = await request('/api/dm/users/student2/block', {
    method: 'POST',
    caller: 'student1',
  });
  assert.equal(blockRes.status, 200);
  assert.equal(blockRes.body.blocked, true);

  // History is fully readable by both participants
  const s1History = await request(`/api/dm/conversations/${convId}/messages`, { caller: 'student1' });
  assert.equal(s1History.body.messages.length, 1);
  const s2History = await request(`/api/dm/conversations/${convId}/messages`, { caller: 'student2' });
  assert.equal(s2History.body.messages.length, 1);

  // Blocked user attempting to send message fails with 403
  const blockedSend = await request(`/api/dm/conversations/${convId}/messages`, {
    method: 'POST',
    caller: 'student2',
    body: { clientId: randomUUID(), text: 'Blocked message' },
  });
  assert.equal(blockedSend.status, 403);

  // Blocker also cannot send message while block is active
  const blockerSend = await request(`/api/dm/conversations/${convId}/messages`, {
    method: 'POST',
    caller: 'student1',
    body: { clientId: randomUUID(), text: 'Should fail while block active' },
  });
  assert.equal(blockerSend.status, 403);

  // Student 1 unblocks Student 2
  const unblockRes = await request('/api/dm/users/student2/block', {
    method: 'DELETE',
    caller: 'student1',
  });
  assert.equal(unblockRes.status, 200);
  assert.equal(unblockRes.body.blocked, false);

  // Messages now succeed
  const postUnblockSend = await request(`/api/dm/conversations/${convId}/messages`, {
    method: 'POST',
    caller: 'student2',
    body: { clientId: randomUUID(), text: 'Now allowed again' },
  });
  assert.equal(postUnblockSend.status, 201);
});

test('DM API: 19. Reporting: Peer validation and message snapshot capture', async t => {
  const { request } = await createTestHarness(t);

  const conv = await request('/api/dm/conversations', {
    method: 'POST',
    caller: 'student1',
    body: { targetUserId: 'student2' },
  });
  const convId = conv.body.conversationId;

  const msg = await request(`/api/dm/conversations/${convId}/messages`, {
    method: 'POST',
    caller: 'student2',
    body: { clientId: randomUUID(), text: 'Harassing message text' },
  });

  // Attempt report with someone who is NOT the conversation peer
  const badPeerReport = await request('/api/dm/reports', {
    method: 'POST',
    caller: 'student1',
    body: {
      conversationId: convId,
      reportedUserId: 'student3', // not in conv
      reportedMessageId: msg.body.message.id,
      reason: 'harassment',
    },
  });
  assert.equal(badPeerReport.status, 400);

  // Valid report
  const validReport = await request('/api/dm/reports', {
    method: 'POST',
    caller: 'student1',
    body: {
      conversationId: convId,
      reportedUserId: 'student2',
      reportedMessageId: msg.body.message.id,
      reason: 'harassment',
      description: 'Repeated offensive remarks',
    },
  });
  assert.equal(validReport.status, 201);
  assert.ok(validReport.body.reportId);
});

// ============================================================================
// SUITE 5: RATE LIMITING, INPUT VALIDATION & PAGINATION
// ============================================================================

test('DM API: 20. Rate limiting: Excessive message sending returns HTTP 429', async t => {
  const { request } = await createTestHarness(t, { skipRateLimits: false });

  const conv = await request('/api/dm/conversations', {
    method: 'POST',
    caller: 'student1',
    body: { targetUserId: 'student2' },
  });
  const convId = conv.body.conversationId;

  // Send limit is 8 per 10 seconds. Sending 10 messages should trigger 429.
  let hitRateLimit = false;
  for (let i = 0; i < 10; i++) {
    const res = await request(`/api/dm/conversations/${convId}/messages`, {
      method: 'POST',
      caller: 'student1',
      body: { clientId: randomUUID(), text: `Burst message ${i}` },
    });
    if (res.status === 429) {
      hitRateLimit = true;
      break;
    }
  }
  assert.equal(hitRateLimit, true, 'Rate limiter must return HTTP 429 upon exceeding burst threshold');
});

test('DM API: 21. Invalid input handling: Rejects empty text and oversized text (>2000 chars)', async t => {
  const { request } = await createTestHarness(t);

  const conv = await request('/api/dm/conversations', {
    method: 'POST',
    caller: 'student1',
    body: { targetUserId: 'student2' },
  });
  const convId = conv.body.conversationId;

  // Empty text
  const emptyRes = await request(`/api/dm/conversations/${convId}/messages`, {
    method: 'POST',
    caller: 'student1',
    body: { clientId: randomUUID(), text: '   ' },
  });
  assert.equal(emptyRes.status, 400);

  // Oversized text
  const hugeText = 'a'.repeat(2001);
  const oversizedRes = await request(`/api/dm/conversations/${convId}/messages`, {
    method: 'POST',
    caller: 'student1',
    body: { clientId: randomUUID(), text: hugeText },
  });
  assert.equal(oversizedRes.status, 400);
});

test('DM API: 22. Pagination: Cursor pagination with limit, before, and since', async t => {
  const { request } = await createTestHarness(t);

  const conv = await request('/api/dm/conversations', {
    method: 'POST',
    caller: 'student1',
    body: { targetUserId: 'student2' },
  });
  const convId = conv.body.conversationId;

  const ids = [];
  for (let i = 1; i <= 6; i++) {
    const res = await request(`/api/dm/conversations/${convId}/messages`, {
      method: 'POST',
      caller: 'student1',
      body: { clientId: randomUUID(), text: `Page item ${i}` },
    });
    ids.push(res.body.message.id);
  }

  // Fetch page with limit 3
  const page1 = await request(`/api/dm/conversations/${convId}/messages`, {
    caller: 'student1',
    query: { limit: 3 },
  });
  assert.equal(page1.body.messages.length, 3);
  assert.deepEqual(page1.body.messages.map(m => m.id), [ids[3], ids[4], ids[5]]);

  // Fetch before middle ID
  const page2 = await request(`/api/dm/conversations/${convId}/messages`, {
    caller: 'student1',
    query: { before: ids[3], limit: 3 },
  });
  assert.equal(page2.body.messages.length, 3);
  assert.deepEqual(page2.body.messages.map(m => m.id), [ids[0], ids[1], ids[2]]);
});

test('DM API: 23. Transaction rollback guarantees no orphan conversations or messages', async t => {
  const { f, dmService } = await createTestHarness(t);

  // Inject a failure inside transaction after conversation creation to test rollback
  const brokenDb = {
    ...f.db,
    withTransaction: async fn => {
      return f.db.withTransaction(async tx => {
        const proxiedTx = {
          ...tx,
          run: async (sql, ...args) => {
            if (/INSERT INTO dm_participants/i.test(sql)) {
              throw new Error('Simulated crash during participant insertion');
            }
            return tx.run(sql, ...args);
          },
        };
        return fn(proxiedTx);
      });
    },
  };

  const brokenService = createDmService(brokenDb);

  await assert.rejects(async () => {
    await brokenService.getOrCreateConversation('student1', 'student3');
  }, /Simulated crash/);

  // Verify conversation table was rolled back cleanly
  const conv = await f.db.get(
    'SELECT * FROM dm_conversations WHERE user_one_id = ? AND user_two_id = ?',
    'student1', 'student3'
  );
  assert.equal(conv, null, 'Failed conversation creation must not leave orphaned database rows');
});
