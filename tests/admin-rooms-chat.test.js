'use strict';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { fixture } = require('./helpers/cohort-fixture');
const cohortChatRouter = require('../routes/cohort-chat');

async function createServer(f) {
  const app = express();
  app.use(express.json());
  app.use('/api/chat', async (req, res, next) => {
    const auth = req.get('authorization') || '';
    const match = /^Bearer fixture-([a-z0-9]+)$/.exec(auth);
    if (!match) return res.status(401).json({ message: 'Authentication required.' });
    const student = await f.db.get('SELECT studentId, role FROM students WHERE studentId=?', match[1]);
    if (!student) return res.status(401).json({ message: 'Authentication required.' });
    req.student = student;
    next();
  }, cohortChatRouter(f.service));

  const server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  const request = async (method, path, body, studentId = 'admin') => {
    const headers = studentId ? { authorization: `Bearer fixture-${studentId}` } : {};
    let requestBody;
    if (body) {
      headers['content-type'] = 'application/json';
      requestBody = JSON.stringify(body);
    }
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/chat${path}`, {
      method,
      headers,
      body: requestBody
    });
    const text = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
    return { status: response.status, body: parsed };
  };

  return { server, request, close: () => new Promise(resolve => server.close(resolve)) };
}

test('Admin room summary, authorization, and isolation suite', async (t) => {
  const f = await fixture('sqlite');
  const seeded = await f.seed();
  for (const room of Object.values(seeded)) {
    await f.service.syncProjection(room.chatGroupId);
  }
  const s = await createServer(f);

  t.after(async () => {
    await s.close();
    await f.close();
  });

  await t.test('1. Admin gets exactly 4 active cohort rooms', async () => {
    const res = await s.request('GET', '/admin/rooms', null, 'admin');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.equal(res.body.length, 4);
    const codes = res.body.map(r => r.groupCode);
    assert.deepEqual(codes, ['MERCURY', 'VENUS', 'EARTH', 'MARS']);
    for (const r of res.body) {
      assert.ok(r.chatGroupId);
      assert.ok(r.cohortId);
      assert.ok(r.cohortDisplayName);
      assert.ok(Number.isInteger(r.currentSemester));
      assert.equal(r.roomStatus, 'active');
      assert.equal(r.latestMessage, null);
      assert.equal(r.latestMessageAt, null);
      assert.equal(r.unreadCount, 0);
    }
  });

  await t.test('2. Normal student is denied GET /admin/rooms (403)', async () => {
    const res = await s.request('GET', '/admin/rooms', null, 'm2');
    assert.equal(res.status, 403);
  });

  await t.test('3. CR is denied GET /admin/rooms (403)', async () => {
    const res = await s.request('GET', '/admin/rooms', null, 'm1');
    assert.equal(res.status, 403);
  });

  await t.test('4. Latest message and unread count scoped per room', async () => {
    // Send message in Mercury from m1
    await s.request('POST', '/messages', { text: 'Mercury message 1', clientId: 'c-merc-1' }, 'm1');
    await s.request('POST', '/messages', { text: 'Mercury message 2', clientId: 'c-merc-2' }, 'm1');

    // Send message in Venus from v1
    await s.request('POST', '/messages', { text: 'Venus greeting', clientId: 'c-ven-1' }, 'v1');

    const res = await s.request('GET', '/admin/rooms', null, 'admin');
    assert.equal(res.status, 200);

    const mercury = res.body.find(r => r.groupCode === 'MERCURY');
    const venus = res.body.find(r => r.groupCode === 'VENUS');
    const earth = res.body.find(r => r.groupCode === 'EARTH');
    const mars = res.body.find(r => r.groupCode === 'MARS');

    assert.ok(mercury.latestMessage.includes('Mercury message 2'));
    assert.equal(mercury.unreadCount, 2);

    assert.ok(venus.latestMessage.includes('Venus greeting'));
    assert.equal(venus.unreadCount, 1);

    assert.equal(earth.latestMessage, null);
    assert.equal(earth.unreadCount, 0);

    assert.equal(mars.latestMessage, null);
    assert.equal(mars.unreadCount, 0);

    // Sort order: Venus and Mercury (both active) before Earth and Mars
    assert.ok(res.body[0].groupCode === 'VENUS' || res.body[0].groupCode === 'MERCURY');
  });

  await t.test('5. Admin config for Mercury works', async () => {
    const mercuryId = seeded.MERCURY.chatGroupId;
    const res = await s.request('GET', `/admin/rooms/${mercuryId}/config`, null, 'admin');
    assert.equal(res.status, 200);
    assert.equal(res.body.chatGroupId, mercuryId);
    assert.equal(res.body.groupCode, 'MERCURY');
    assert.equal(res.body.currentSemester, 1);
    assert.equal(res.body.role, 'admin');
  });

  await t.test('6. Admin config for Venus works', async () => {
    const venusId = seeded.VENUS.chatGroupId;
    const res = await s.request('GET', `/admin/rooms/${venusId}/config`, null, 'admin');
    assert.equal(res.status, 200);
    assert.equal(res.body.chatGroupId, venusId);
    assert.equal(res.body.groupCode, 'VENUS');
    assert.equal(res.body.currentSemester, 3);
    assert.equal(res.body.role, 'admin');
  });

  await t.test('7. Student and CR denied admin room config (403)', async () => {
    const mercuryId = seeded.MERCURY.chatGroupId;
    const resStudent = await s.request('GET', `/admin/rooms/${mercuryId}/config`, null, 'm2');
    assert.equal(resStudent.status, 403);

    const resCR = await s.request('GET', `/admin/rooms/${mercuryId}/config`, null, 'm1');
    assert.equal(resCR.status, 403);
  });

  await t.test('8. Invalid room ID in admin config rejected (404)', async () => {
    const res = await s.request('GET', '/admin/rooms/00000000-0000-0000-0000-000000000000/config', null, 'admin');
    assert.equal(res.status, 404);
  });

  await t.test('9. Admin realtime token scoped strictly to selected room', async () => {
    const mercuryId = seeded.MERCURY.chatGroupId;
    const res = await s.request('GET', `/realtime-config?chatGroupId=${mercuryId}`, null, 'admin');
    assert.equal(res.status, 200);
    assert.equal(res.body.chatGroupId, mercuryId);
    assert.ok(res.body.topic.startsWith(`chat:${mercuryId}:`));
    assert.ok(res.body.token);
  });

  await t.test('10. Admin send scoped strictly to selected room', async () => {
    const venusId = seeded.VENUS.chatGroupId;
    const res = await s.request('POST', `/messages?chatGroupId=${venusId}`, {
      text: 'Admin announcement to Venus',
      clientId: 'c-admin-ven-1'
    }, 'admin');
    assert.equal(res.status, 200);
    assert.equal(res.body.data.chatGroupId, venusId);

    // Verify message appears in Venus history, NOT in Mercury history
    const venusHistory = await s.request('GET', `/messages?chatGroupId=${venusId}`, null, 'admin');
    assert.ok(venusHistory.body.messages.some(m => m.text === 'Admin announcement to Venus'));

    const mercuryId = seeded.MERCURY.chatGroupId;
    const mercuryHistory = await s.request('GET', `/messages?chatGroupId=${mercuryId}`, null, 'admin');
    assert.ok(!mercuryHistory.body.messages.some(m => m.text === 'Admin announcement to Venus'));
  });

  await t.test('11. Student cross-room isolation remains unchanged', async () => {
    const venusId = seeded.VENUS.chatGroupId;
    // Mercury student m1 attempting to access Venus messages
    const res = await s.request('GET', `/messages?chatGroupId=${venusId}`, null, 'm1');
    assert.equal(res.status, 404);

    // Mercury student m1 attempting to send to Venus
    const sendRes = await s.request('POST', `/messages?chatGroupId=${venusId}`, {
      text: 'Exploit attempt',
      clientId: 'c-exploit'
    }, 'm1');
    assert.equal(sendRes.status, 404);
  });

  await t.test('12. Admin push notification scoping is strictly room-confined', async () => {
    const mercuryId = seeded.MERCURY.chatGroupId;
    const venusId = seeded.VENUS.chatGroupId;

    // Admin sends to Mercury
    await s.request('POST', `/messages?chatGroupId=${mercuryId}`, {
      text: 'Admin to Mercury for push check',
      clientId: 'c-push-merc'
    }, 'admin');

    const mercPushes = await f.db.all('SELECT recipient_student_id FROM push_notification_outbox WHERE chat_group_id=?', mercuryId);
    const mercRecipients = mercPushes.map(p => p.recipient_student_id || p.recipient_student_id);
    assert.ok(mercRecipients.includes('m1') || mercRecipients.includes('m2'));
    assert.ok(!mercRecipients.includes('v1'));
    assert.ok(!mercRecipients.includes('e1'));
    assert.ok(!mercRecipients.includes('s1'));

    // Admin sends to Venus
    await s.request('POST', `/messages?chatGroupId=${venusId}`, {
      text: 'Admin to Venus for push check',
      clientId: 'c-push-ven'
    }, 'admin');

    const venPushes = await f.db.all('SELECT recipient_student_id FROM push_notification_outbox WHERE chat_group_id=?', venusId);
    const venRecipients = venPushes.map(p => p.recipient_student_id);
    assert.ok(venRecipients.includes('v1') || venRecipients.includes('v2'));
    assert.ok(!venRecipients.includes('m1'));
    assert.ok(!venRecipients.includes('e1'));
    assert.ok(!venRecipients.includes('s1'));
  });

  await t.test('13. Admin typing event scoping is strictly room-confined', async () => {
    const mercuryId = seeded.MERCURY.chatGroupId;
    const venusId = seeded.VENUS.chatGroupId;

    const res = await s.request('POST', `/typing?chatGroupId=${mercuryId}`, {}, 'admin');
    assert.equal(res.status, 200);

    const typingEvents = await f.db.all("SELECT chat_group_id, payload_json FROM chat_realtime_outbox WHERE event_type='typing' AND chat_group_id=?", mercuryId);
    assert.ok(typingEvents.length > 0);
    const mercTyping = typingEvents[typingEvents.length - 1];
    assert.equal(mercTyping.chat_group_id, mercuryId);

    // Verify no typing event was queued for Venus
    const venusTyping = await f.db.all("SELECT id FROM chat_realtime_outbox WHERE event_type='typing' AND chat_group_id=?", venusId);
    assert.equal(venusTyping.length, 0);
  });

  await t.test('14. Per-room read-state isolation', async () => {
    const mercuryId = seeded.MERCURY.chatGroupId;
    const venusId = seeded.VENUS.chatGroupId;

    // Send a message to Venus to guarantee an unread count
    await s.request('POST', `/messages?chatGroupId=${venusId}`, {
      text: 'New unread in Venus',
      clientId: 'c-ven-unread'
    }, 'v1');

    // Get current rooms
    let rooms = (await s.request('GET', '/admin/rooms', null, 'admin')).body;
    let mercury = rooms.find(r => r.groupCode === 'MERCURY');
    let venus = rooms.find(r => r.groupCode === 'VENUS');
    const venusUnreadBefore = venus.unreadCount;
    assert.ok(venusUnreadBefore > 0);

    // Fetch messages in Mercury to find latest message id
    const mercHistory = (await s.request('GET', `/messages?chatGroupId=${mercuryId}`, null, 'admin')).body;
    const maxMercId = Math.max(...mercHistory.messages.map(m => m.id));

    // Admin marks Mercury read
    const readRes = await s.request('POST', `/read?chatGroupId=${mercuryId}`, { lastReadMessageId: maxMercId }, 'admin');
    assert.equal(readRes.status, 200);

    // Re-check rooms summary
    rooms = (await s.request('GET', '/admin/rooms', null, 'admin')).body;
    mercury = rooms.find(r => r.groupCode === 'MERCURY');
    venus = rooms.find(r => r.groupCode === 'VENUS');

    // Mercury unread is zeroed, Venus unread remains untouched
    assert.equal(mercury.unreadCount, 0);
    assert.equal(venus.unreadCount, venusUnreadBefore);
  });
});
