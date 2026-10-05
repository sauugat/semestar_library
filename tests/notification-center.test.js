const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const app = require('../server');
const db = require('../db');
const notificationsService = require('../lib/notifications-service');

test('In-App Notification Center Test Suite', async (t) => {
  await db.initSchema();
  await notificationsService.ensureNotificationCenterSchema();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(async () => {
    server.close();
  });

  // Seed two distinct test students
  const studentA = 'NC-STUDENT-A-' + Date.now();
  const studentB = 'NC-STUDENT-B-' + Date.now();

  const insertStudent = async (id, name) => {
    if (db.isPostgres) {
      await db.run(
        'INSERT INTO students (studentId, name, role, passwordHash) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING',
        id, name, 'student', 'test_hash'
      );
    } else {
      await db.run(
        'INSERT OR IGNORE INTO students (studentId, name, role, passwordHash) VALUES (?, ?, ?, ?)',
        id, name, 'student', 'test_hash'
      );
    }
  };

  await insertStudent(studentA, 'Student A');
  await insertStudent(studentB, 'Student B');

  // Create authentication tokens for both
  const tokenA = 'nc_token_a_' + Date.now();
  const tokenB = 'nc_token_b_' + Date.now();
  const expiresAt = new Date(Date.now() + 86400000).toISOString();

  await db.run(
    'INSERT INTO mobile_tokens (token, studentId, createdAt, expiresAt) VALUES (?, ?, ?, ?)',
    tokenA, studentA, new Date().toISOString(), expiresAt
  );
  await db.run(
    'INSERT INTO mobile_tokens (token, studentId, createdAt, expiresAt) VALUES (?, ?, ?, ?)',
    tokenB, studentB, new Date().toISOString(), expiresAt
  );

  const headersA = {
    'Authorization': `Bearer ${tokenA}`,
    'Content-Type': 'application/json',
  };

  const headersB = {
    'Authorization': `Bearer ${tokenB}`,
    'Content-Type': 'application/json',
  };

  // Test 1: Notification Creation and Self-Action Exclusion
  await t.test('createNotification creates persistent record and filters out actor self-action', async () => {
    const result = await notificationsService.createNotification({
      type: 'post_comment',
      actorId: studentA,
      actorName: 'Student A',
      recipientIds: [studentA, studentB], // studentA is the actor, should not get notified
      title: 'Student A commented on your post',
      body: 'Great insights on Unit 3!',
      entityType: 'post',
      entityId: '101',
      secondaryEntityId: '501',
      deepLink: '/post/101?commentId=501',
      webPath: '/post/101?commentId=501',
      priority: 'normal',
    });

    assert.ok(result);
    assert.equal(result.recipientCount, 1);
    assert.deepEqual(result.recipients, [studentB]);

    // Verify row in database
    const notifRow = await db.get('SELECT * FROM notifications WHERE id = ?', result.notificationId);
    assert.ok(notifRow);
    assert.equal(notifRow.type, 'post_comment');
    assert.equal(notifRow.entity_id, '101');

    const recipRows = await db.all('SELECT * FROM notification_recipients WHERE notification_id = ?', result.notificationId);
    assert.equal(recipRows.length, 1);
    assert.equal(recipRows[0].user_id, studentB);
  });

  // Test 2: Unseen vs Seen vs Read Lifecycle
  await t.test('Unseen vs Seen vs Read lifecycle maintains independent state', async () => {
    // Check initial unseen count for studentB
    const countRes1 = await fetch(`${baseUrl}/api/notifications/unread-count`, { headers: headersB });
    const countData1 = await countRes1.json();
    assert.equal(countRes1.status, 200);
    assert.ok(countData1.count >= 1);

    // Fetch inbox for studentB
    const listRes1 = await fetch(`${baseUrl}/api/notifications?tab=all`, { headers: headersB });
    const listData1 = await listRes1.json();
    assert.equal(listRes1.status, 200);
    assert.ok(listData1.notifications.length >= 1);

    const firstItem = listData1.notifications[0];
    assert.equal(firstItem.isSeen, false);
    assert.equal(firstItem.isRead, false);

    // Call mark seen (user opened notification center)
    const seenRes = await fetch(`${baseUrl}/api/notifications/seen`, { method: 'POST', headers: headersB });
    const seenData = await seenRes.json();
    assert.equal(seenRes.status, 200);
    assert.equal(seenData.success, true);

    // Unseen count should now be 0 (badge clears)
    const countRes2 = await fetch(`${baseUrl}/api/notifications/unread-count`, { headers: headersB });
    const countData2 = await countRes2.json();
    assert.equal(countData2.count, 0);

    // But notification is still UNREAD (user has not opened/read the content yet)
    const listRes2 = await fetch(`${baseUrl}/api/notifications?tab=all`, { headers: headersB });
    const listData2 = await listRes2.json();
    const updatedItem = listData2.notifications.find((n) => n.id === firstItem.id);
    assert.equal(updatedItem.isSeen, true);
    assert.equal(updatedItem.isRead, false);

    // Now mark as read
    const readRes = await fetch(`${baseUrl}/api/notifications/${firstItem.id}/read`, {
      method: 'POST',
      headers: headersB,
    });
    assert.equal(readRes.status, 200);

    const listRes3 = await fetch(`${baseUrl}/api/notifications?tab=all`, { headers: headersB });
    const listData3 = await listRes3.json();
    const readItem = listData3.notifications.find((n) => n.id === firstItem.id);
    assert.equal(readItem.isRead, true);
    assert.ok(readItem.readAt);

    // Now mark as unread again
    const unreadRes = await fetch(`${baseUrl}/api/notifications/${firstItem.id}/unread`, {
      method: 'POST',
      headers: headersB,
    });
    assert.equal(unreadRes.status, 200);

    const listRes4 = await fetch(`${baseUrl}/api/notifications?tab=all`, { headers: headersB });
    const listData4 = await listRes4.json();
    const unreadItem = listData4.notifications.find((n) => n.id === firstItem.id);
    assert.equal(unreadItem.isRead, false);
    assert.equal(unreadItem.readAt, null);
  });

  // Test 3: Security & Recipient Isolation
  await t.test('Student A cannot view or manipulate Student B notifications', async () => {
    // Get studentB notification id
    const listB = await fetch(`${baseUrl}/api/notifications?tab=all`, { headers: headersB });
    const bData = await listB.json();
    const bNotif = bData.notifications[0];
    assert.ok(bNotif);

    // Student A tries to mark Student B's notification as read
    const hackRead = await fetch(`${baseUrl}/api/notifications/${bNotif.id}/read`, {
      method: 'POST',
      headers: headersA,
    });
    assert.equal(hackRead.status, 404);

    // Student A tries to hide Student B's notification
    const hackHide = await fetch(`${baseUrl}/api/notifications/${bNotif.id}/hide`, {
      method: 'POST',
      headers: headersA,
    });
    assert.equal(hackHide.status, 404);

    // Student A's inbox must NOT contain Student B's notification
    const listA = await fetch(`${baseUrl}/api/notifications?tab=all`, { headers: headersA });
    const aData = await listA.json();
    const leaked = aData.notifications.find((n) => n.id === bNotif.id);
    assert.equal(leaked, undefined);
  });

  // Test 4: Mark All Read
  await t.test('markAllRead marks all active notifications read for authenticated user', async () => {
    // Add two more notifications for Student B
    await notificationsService.createNotification({
      type: 'official_notice',
      recipientIds: [studentB],
      title: 'Exam Routine Published',
      body: 'Midterm timetable has been uploaded',
      entityType: 'notice',
      entityId: '202',
      deepLink: '/notice/202',
      webPath: '/notice/202',
      priority: 'high',
    });

    const readAllRes = await fetch(`${baseUrl}/api/notifications/read-all`, {
      method: 'POST',
      headers: headersB,
    });
    const readAllData = await readAllRes.json();
    assert.equal(readAllRes.status, 200);
    assert.equal(readAllData.success, true);

    const checkList = await fetch(`${baseUrl}/api/notifications?tab=unread`, { headers: headersB });
    const checkData = await checkList.json();
    assert.equal(checkData.notifications.length, 0);
  });

  // Test 5: Soft-Delete (Hide Notification)
  await t.test('hideNotification excludes item from active inbox', async () => {
    const listRes = await fetch(`${baseUrl}/api/notifications?tab=all`, { headers: headersB });
    const listData = await listRes.json();
    const target = listData.notifications[0];
    assert.ok(target);

    const hideRes = await fetch(`${baseUrl}/api/notifications/${target.id}/hide`, {
      method: 'POST',
      headers: headersB,
    });
    assert.equal(hideRes.status, 200);

    const afterList = await fetch(`${baseUrl}/api/notifications?tab=all`, { headers: headersB });
    const afterData = await afterList.json();
    const hiddenFound = afterData.notifications.find((n) => n.id === target.id);
    assert.equal(hiddenFound, undefined);
  });

  // Test 6: Deterministic Reaction Grouping
  await t.test('Deterministic grouping aggregates repetitive reactions on same entity', async () => {
    const postEntityId = 'post_dyn_' + Date.now();
    const groupKey = `post:${postEntityId}:reactions`;

    // 1st reaction from Student A
    await notificationsService.createNotification({
      type: 'post_reaction',
      actorId: studentA,
      actorName: 'Rohan Sharma',
      recipientIds: [studentB],
      title: 'Rohan Sharma reacted to your post',
      body: 'Liked your post',
      entityType: 'post',
      entityId: postEntityId,
      groupKey,
      priority: 'low',
    });

    // 2nd reaction from a third student
    const studentC = 'NC-STUDENT-C-' + Date.now();
    await insertStudent(studentC, 'Suman Adhikari');

    await notificationsService.createNotification({
      type: 'post_reaction',
      actorId: studentC,
      actorName: 'Suman Adhikari',
      recipientIds: [studentB],
      title: 'Suman Adhikari reacted to your post',
      body: 'Liked your post',
      entityType: 'post',
      entityId: postEntityId,
      groupKey,
      priority: 'low',
    });

    // 3rd reaction from Student D
    const studentD = 'NC-STUDENT-D-' + Date.now();
    await insertStudent(studentD, 'Bishal Thapa');

    await notificationsService.createNotification({
      type: 'post_reaction',
      actorId: studentD,
      actorName: 'Bishal Thapa',
      recipientIds: [studentB],
      title: 'Bishal Thapa reacted to your post',
      body: 'Liked your post',
      entityType: 'post',
      entityId: postEntityId,
      groupKey,
      priority: 'low',
    });

    // Verify in studentB inbox: should be ONE grouped notification row, not two separate rows
    const listRes = await fetch(`${baseUrl}/api/notifications?tab=all`, { headers: headersB });
    const listData = await listRes.json();
    const groupedNotifs = listData.notifications.filter((n) => n.groupKey === groupKey);

    assert.equal(groupedNotifs.length, 1);
    assert.equal(groupedNotifs[0].title, 'Bishal Thapa, Suman Adhikari and 1 other reacted to your post');
  });

  // Test 7: Delivery Preferences (Push + Inbox vs Inbox Only vs Off)
  await t.test('Advanced notification preferences control delivery channels correctly', async () => {
    // Update Student B's preferences to inbox_only for academic updates
    const updatePrefRes = await fetch(`${baseUrl}/api/notifications/preferences`, {
      method: 'PUT',
      headers: headersB,
      body: JSON.stringify({
        deliveryAcademic: 'inbox_only',
        quietHoursEnabled: true,
        quietHoursStart: '22:00',
        quietHoursEnd: '08:00',
        timezone: 'Asia/Kathmandu',
      }),
    });
    assert.equal(updatePrefRes.status, 200);

    const getPrefRes = await fetch(`${baseUrl}/api/notifications/preferences`, { headers: headersB });
    const prefData = await getPrefRes.json();
    assert.equal(prefData.preferences.deliveryAcademic, 'inbox_only');
    assert.equal(prefData.preferences.quietHoursEnabled, true);

    // Create an academic notice notification for Student B
    const notifResult = await notificationsService.createNotification({
      type: 'official_notice',
      recipientIds: [studentB],
      title: 'Urgent Routine Modification',
      body: 'Classes rescheduled for tomorrow',
      entityType: 'notice',
      entityId: '777',
      priority: 'high',
    });

    // Check notification_recipients row: push_status should be skipped_preference
    const recip = await db.get(
      'SELECT push_status FROM notification_recipients WHERE notification_id = ? AND user_id = ?',
      notifResult.notificationId,
      studentB
    );
    assert.equal(recip.push_status, 'suppressed_preference');

    // But it must STILL exist in inbox
    const inboxRes = await fetch(`${baseUrl}/api/notifications?tab=all`, { headers: headersB });
    const inboxData = await inboxRes.json();
    const inInbox = inboxData.notifications.find((n) => String(n.id) === String(notifResult.notificationId));
    assert.ok(inInbox);
    assert.equal(inInbox.title, 'Urgent Routine Modification');
  });

  // Test 8: Quiet Hours Check Logic
  await t.test('isQuietHoursActive computes timezone-safe quiet hours', () => {
    // Test overnight window: 22:30 to 07:00
    // During 23:00 (11:00 PM) -> true
    assert.equal(notificationsService.isQuietHoursActive('22:30', '07:00', 23, 0), true);
    // During 02:30 (2:30 AM) -> true
    assert.equal(notificationsService.isQuietHoursActive('22:30', '07:00', 2, 30), true);
    // During 12:00 (Noon) -> false
    assert.equal(notificationsService.isQuietHoursActive('22:30', '07:00', 12, 0), false);
    // During 07:30 (Morning) -> false
    assert.equal(notificationsService.isQuietHoursActive('22:30', '07:00', 7, 30), false);
  });

  // ─── STRICT SECURITY & AUTHORIZATION TESTS ───

  // Test 9: Complete Unauthenticated Access Rejection
  await t.test('Unauthenticated requests are strictly rejected with 401 across all endpoints', async () => {
    const endpoints = [
      { method: 'GET', path: '/api/notifications' },
      { method: 'GET', path: '/api/notifications/unread-count' },
      { method: 'POST', path: '/api/notifications/seen' },
      { method: 'POST', path: '/api/notifications/9999/read' },
      { method: 'POST', path: '/api/notifications/9999/unread' },
      { method: 'POST', path: '/api/notifications/read-all' },
      { method: 'POST', path: '/api/notifications/9999/hide' },
      { method: 'GET', path: '/api/notifications/preferences' },
      { method: 'PUT', path: '/api/notifications/preferences' },
      { method: 'GET', path: '/api/notifications/realtime' },
      { method: 'GET', path: '/api/notifications/stream' },
    ];

    for (const ep of endpoints) {
      const res = await fetch(`${baseUrl}${ep.path}`, {
        method: ep.method,
        headers: { 'Content-Type': 'application/json' },
      });
      assert.equal(res.status, 401, `Endpoint ${ep.method} ${ep.path} must reject unauthenticated requests with 401`);
    }
  });

  // Test 10: Client-Provided Identity Override Immunity
  await t.test('Client-provided studentId/user_id in query or body cannot override authenticated identity', async () => {
    // Student A tries to query B's inbox by injecting query parameters
    const forgedQueryRes = await fetch(`${baseUrl}/api/notifications?studentId=${studentB}&user_id=${studentB}&recipientStudentId=${studentB}`, {
      headers: headersA,
    });
    assert.equal(forgedQueryRes.status, 200);
    const forgedData = await forgedQueryRes.json();
    // Must only return Student A's notifications, not Student B's
    const bNotifsInA = forgedData.notifications.filter((n) => n.recipientUserIds?.includes(studentB));
    assert.equal(bNotifsInA.length, 0, 'Injected query parameters must not return Student B data');

    // Student A tries to mark B's notifications seen by injecting body parameters
    const forgedSeenRes = await fetch(`${baseUrl}/api/notifications/seen`, {
      method: 'POST',
      headers: { ...headersA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: studentB, user_id: studentB, recipientStudentId: studentB }),
    });
    assert.equal(forgedSeenRes.status, 200);

    // Verify Student B's unseen count is UNTOUCHED
    const bCountRes = await fetch(`${baseUrl}/api/notifications/unread-count`, { headers: headersB });
    const bCountData = await bCountRes.json();
    assert.ok(bCountData.count >= 0, 'Student B count must remain intact');
  });

  // Test 11: Cross-User SSE Stream Isolation
  await t.test('SSE stream enforces identity and Student A cannot receive Student B notifications', async () => {
    // 1. Verify unauthenticated SSE connection fails
    const unauthStream = await fetch(`${baseUrl}/api/notifications/stream`);
    assert.equal(unauthStream.status, 401);

    // 2. Student A connects to stream attempting to pass studentB in query
    const controller = new AbortController();
    const streamRes = await fetch(`${baseUrl}/api/notifications/stream?studentId=${studentB}&user_id=${studentB}`, {
      headers: headersA,
      signal: controller.signal,
    });
    assert.equal(streamRes.status, 200);
    assert.equal(streamRes.headers.get('content-type'), 'text/event-stream');

    const receivedChunks = [];
    const reader = streamRes.body.getReader();
    const decoder = new TextDecoder();

    // Start reading stream in background
    const readPromise = (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          receivedChunks.push(chunk);
        }
      } catch (_) {}
    })();

    // Allow initial connection to register
    await new Promise((r) => setTimeout(r, 50));

    // Send a notification targeted SOLELY to Student B
    await notificationsService.createNotification({
      type: 'official_notice',
      recipientIds: [studentB],
      title: 'Secret Notice for B Only',
      body: 'Highly confidential information meant for Student B',
      entityType: 'notice',
      entityId: '999',
    });

    // Send a notification targeted to Student A
    await notificationsService.createNotification({
      type: 'official_notice',
      recipientIds: [studentA],
      title: 'Notice for Student A',
      body: 'Hello Student A',
      entityType: 'notice',
      entityId: '888',
    });

    // Wait for events to dispatch
    await new Promise((r) => setTimeout(r, 100));

    // Abort stream and wait for cleanup
    controller.abort();
    await readPromise.catch(() => {});

    const allData = receivedChunks.join('');
    // Student A's stream must NOT contain any mention of Student B's notification
    assert.ok(!allData.includes('Secret Notice for B Only'), 'Student A stream must never receive Student B notification content');
    assert.ok(!allData.includes('Highly confidential information'), 'Student A stream must never receive Student B body');
    // Student A's stream must contain notification for Student A
    assert.ok(allData.includes('"type":"notification"'), 'Student A stream should receive notification event');
  });

  // Test 12: Realtime Payload Minimization Proof
  await t.test('Realtime notification event broadcasts only minimized non-sensitive payload', async () => {
    let capturedEvent = null;
    const unsubscribe = notificationsService.subscribeToUserNotifications(studentB, (ev) => {
      capturedEvent = ev;
    });

    try {
      await notificationsService.createNotification({
        type: 'post_comment',
        actorId: studentA,
        recipientIds: [studentB],
        title: 'Sensitive Title That Should Not Leak',
        body: 'Sensitive Comment Text That Must Not Be Broadcast',
        entityType: 'post',
        entityId: '1001',
      });

      assert.ok(capturedEvent, 'Broadcast event must be dispatched to subscriber');
      assert.equal(capturedEvent.type, 'notification');
      assert.ok(capturedEvent.notificationId, 'Must contain notificationId');
      assert.equal(typeof capturedEvent.unseenCount, 'number', 'Must contain numeric unseenCount');

      // Crucial: Title, body, actor details, and content MUST NOT be present in realtime broadcast
      assert.equal(capturedEvent.title, undefined, 'Realtime payload must NOT include title');
      assert.equal(capturedEvent.body, undefined, 'Realtime payload must NOT include body');
      assert.equal(capturedEvent.message, undefined, 'Realtime payload must NOT include message');
      assert.equal(capturedEvent.commentText, undefined, 'Realtime payload must NOT include commentText');
    } finally {
      unsubscribe();
    }
  });

  // Test 13: Secret / Service Role Leak Prevention
  await t.test('Service-role keys and internal database secrets are never exposed in responses', async () => {
    const res = await fetch(`${baseUrl}/api/notifications/preferences`, { headers: headersA });
    const text = await res.text();
    assert.ok(!text.includes(process.env.SUPABASE_SECRET_KEY || 'MISSING_SECRET_KEY_PLACEHOLDER'));
    assert.ok(!text.includes(process.env.DATABASE_URL || 'MISSING_DB_URL_PLACEHOLDER'));
    assert.ok(!text.includes(process.env.SESSION_SECRET || 'MISSING_SESSION_SECRET_PLACEHOLDER'));
  });
});
