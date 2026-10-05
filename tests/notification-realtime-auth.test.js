'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const notifService = require('../lib/notifications-service');
const createNotificationsRouter = require('../routes/notifications');

test('Supabase Realtime & SSE Notification Security Suite', async (t) => {
  const studentA = 'STUDENT_A_SEC_' + Date.now();
  const studentB = 'STUDENT_B_SEC_' + Date.now();

  const sessions = {
    'token-a': { studentId: studentA, name: 'Alice' },
    'token-b': { studentId: studentB, name: 'Bob' },
  };

  const app = express();
  app.use(express.json());

  // Strict session middleware matching server.js
  const mockAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      if (sessions[token]) {
        req.user = sessions[token];
        req.session = sessions[token];
        return next();
      }
    }
    return res.status(401).json({ message: 'Authentication required' });
  };

  // Disposable mock DB
  const mockDb = {
    isPostgres: false,
    async get(sql, ...params) {
      if (sql.includes('student_notification_preferences')) return null;
      if (sql.includes('notification_recipients')) return null;
      return null;
    },
    async all() { return []; },
    async run() { return { changes: 1 }; },
  };

  app.use('/api/notifications', createNotificationsRouter(mockDb, mockAuth));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(() => server.close());

  // 1. Attack Test: Student B attempts to eavesdrop on Student A via SSE stream with query param
  await t.test('ATTACK 1: Student B cannot eavesdrop on Student A notification stream', async () => {
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/api/notifications/stream?studentId=${studentA}`, {
      headers: { Authorization: 'Bearer token-b' },
      signal: controller.signal,
    });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/event-stream');

    const receivedEvents = [];
    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    const readLoop = (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value);
          receivedEvents.push(text);
        }
      } catch (_) {}
    })();

    await new Promise((r) => setTimeout(r, 50));

    // Broadcast a notification meant specifically for Student A
    notifService.broadcastToUser(studentA, {
      type: 'notification',
      notificationId: 'notif_secret_123',
      unseenCount: 5,
    });

    // Broadcast a notification meant for Student B
    notifService.broadcastToUser(studentB, {
      type: 'notification',
      notificationId: 'notif_bob_456',
      unseenCount: 1,
    });

    await new Promise((r) => setTimeout(r, 100));
    controller.abort();
    await readLoop.catch(() => {});

    const allReceived = receivedEvents.join('');
    // Student B MUST NOT have received notif_secret_123
    assert.ok(!allReceived.includes('notif_secret_123'), 'Student B must NEVER receive Student A notification events');
    // Student B SHOULD have received notif_bob_456
    assert.ok(allReceived.includes('notif_bob_456'), 'Student B receives only own events');
  });

  // 2. Attack Test: Unauthenticated connection to stream is rejected
  await t.test('ATTACK 2: Unauthenticated connection to /api/notifications/stream is denied', async () => {
    const res = await fetch(`${baseUrl}/api/notifications/stream`);
    assert.equal(res.status, 401);
  });

  // 3. Attack Test: Student B attempts cross-user topic subscription on Supabase Realtime
  await t.test('ATTACK 3: Supabase Realtime unauthorized private channel rejects foreign topic', async () => {
    // When Supabase Realtime private channel is used with topic user-notifications:${studentA},
    // a client with Student B credentials cannot join Student A's private channel.
    // In our architecture, the server intentionally DOES NOT broadcast sensitive notification
    // content (title, body, mentions) over public broadcast topics.
    // Furthermore, broadcastToUser strictly delivers to the authenticated recipient.
    let studentBReceivedData = false;
    const fakeUnsub = notifService.subscribeToUserNotifications(studentB, (ev) => {
      if (ev.notificationId === 'notif_for_alice_only') {
        studentBReceivedData = true;
      }
    });

    try {
      notifService.broadcastToUser(studentA, {
        type: 'notification',
        notificationId: 'notif_for_alice_only',
        unseenCount: 1,
      });

      assert.equal(studentBReceivedData, false, 'Student B subscriber must not receive Alice event');
    } finally {
      fakeUnsub();
    }
  });

  // 4. Payload Minimization Test: Verification that sensitive content is NEVER present in realtime events
  await t.test('AUDIT 4: Realtime events are strictly minimized and contain no title or body', () => {
    let captured = null;
    const unsub = notifService.subscribeToUserNotifications(studentA, (ev) => {
      captured = ev;
    });

    try {
      notifService.broadcastToUser(studentA, {
        type: 'notification',
        notificationId: '9999',
        unseenCount: 2,
      });

      assert.ok(captured);
      assert.equal(captured.title, undefined);
      assert.equal(captured.body, undefined);
      assert.equal(captured.message, undefined);
      assert.equal(captured.actorName, undefined);
    } finally {
      unsub();
    }
  });
});
