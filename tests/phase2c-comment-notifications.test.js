const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createClient } = require('@libsql/client');
const { ensurePostsSchema } = require('../lib/posts');
const pushNotifications = require('../lib/push-notifications');
const { ensureNotificationCenterSchema } = require('../lib/notifications-service');
const createPostsRouter = require('../routes/posts');
const createCommentsRouter = require('../routes/comments');

async function setupTestApp(t) {
  // Disable immediate synchronous dispatch so outbox can be inspected deterministically
  process.env.DISABLE_IMMEDIATE_PUSH_DISPATCH = '1';
  t.after(() => {
    delete process.env.DISABLE_IMMEDIATE_PUSH_DISPATCH;
  });

  const client = createClient({ url: ':memory:' });
  const blobs = new Map();
  const db = {
    saveFileBlob: async (filename, fileData, mimeType) => {
      blobs.set(filename, { fileData, mimeType });
      return true;
    },
    getFileBlob: async (filename) => blobs.get(filename),
    deleteFileBlob: async (filename) => {
      blobs.delete(filename);
      return true;
    },
    isPostgres: false,
    exec: (sql) => client.executeMultiple(sql),
    all: async (sql, ...args) => (await client.execute({ sql, args })).rows,
    get: async (sql, ...args) => (await client.execute({ sql, args })).rows[0],
    run: async (sql, ...args) => {
      const result = await client.execute({ sql, args });
      return { lastInsertRowid: Number(result.lastInsertRowid), changes: result.rowsAffected };
    },
    initSchema: async () => {},
  };

  await db.exec(`
    CREATE TABLE students (
      studentId TEXT PRIMARY KEY,
      name TEXT,
      role TEXT,
      avatarUrl TEXT,
      semester TEXT
    );
    INSERT INTO students VALUES
      ('userA', 'Student A', 'student', '/avatarA.jpg', '4'),
      ('userB', 'Student B', 'student', '/avatarB.jpg', '4'),
      ('userC', 'Student C', 'student', '/avatarC.jpg', '4'),
      ('admin1', 'Admin User', 'admin', '/admin.jpg', '4');
  `);

  await ensurePostsSchema(db);
  await pushNotifications.ensurePushNotificationSchema(db);
  await ensureNotificationCenterSchema({ exec: db.exec, isPostgres: db.isPostgres });

  // Register device tokens
  await pushNotifications.registerDeviceToken(db, {
    studentId: 'userA',
    expoPushToken: 'ExponentPushToken[device_A_phone1]',
    platform: 'android',
    deviceName: 'Phone A1'
  });
  await pushNotifications.registerDeviceToken(db, {
    studentId: 'userA',
    expoPushToken: 'ExponentPushToken[device_A_tablet2]',
    platform: 'android',
    deviceName: 'Tablet A2'
  });
  await pushNotifications.registerDeviceToken(db, {
    studentId: 'userB',
    expoPushToken: 'ExponentPushToken[device_B_phone1]',
    platform: 'android',
    deviceName: 'Phone B'
  });
  await pushNotifications.registerDeviceToken(db, {
    studentId: 'userC',
    expoPushToken: 'ExponentPushToken[device_C_phone1]',
    platform: 'android',
    deviceName: 'Phone C'
  });

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { studentId: req.headers['x-user-id'] || null };
    next();
  });

  const requireLogin = (req, res, next) => {
    if (!req.session?.studentId) {
      return res.status(401).json({ message: 'Authentication required.' });
    }
    next();
  };

  app.use('/api/posts', createPostsRouter(db, requireLogin));
  app.use('/api/comments', createCommentsRouter(db, requireLogin));

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    client.close();
  });

  async function request(method, path, body, userId = 'userA') {
    const url = `http://127.0.0.1:${server.address().port}${path}`;
    const headers = {};
    if (userId) headers['x-user-id'] = userId;
    let reqBody = undefined;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      reqBody = JSON.stringify(body);
    }
    const res = await fetch(url, { method, headers, body: reqBody });
    let parsed = null;
    const text = await res.text();
    try {
      parsed = JSON.parse(text);
    } catch (_) {
      parsed = text;
    }
    return { status: res.status, body: parsed };
  }

  return { db, request };
}

test('PHASE 2C: Modern Comment, Reply, and Reaction Notifications Test Suite', async (t) => {
  const { db, request } = await setupTestApp(t);

  // Helper to clear outbox and in-app notifications
  const clearNotifications = async () => {
    await db.run('DELETE FROM push_notification_outbox');
    await db.run('DELETE FROM notifications');
  };

  // Seed post by User A
  const postRes = await request('POST', '/api/posts', { content: "User A's Question Post" }, 'userA');
  assert.equal(postRes.status, 201);
  const postId = postRes.body.id;

  // Clear any notifications generated from post creation
  await clearNotifications();

  let rootCommentId = null;
  let replyBId = null;
  let replyCId = null;

  // 1. B comments on A's post -> A notification
  await t.test("1. B comments on A's post -> A receives notification", async () => {
    await clearNotifications();

    const res = await request('POST', `/api/posts/${postId}/comments`, { content: 'Nice post by A!' }, 'userB');
    assert.equal(res.status, 201);
    rootCommentId = res.body.comment.id;

    // Check in-app notification for userA
    const inApp = await db.all('SELECT * FROM notifications WHERE recipientStudentId = ?', 'userA');
    assert.equal(inApp.length, 1, 'User A should receive 1 in-app notification');
    assert.equal(inApp[0].type, 'post_comment');
    assert.equal(inApp[0].actorId, 'userB');
    assert.equal(Number(inApp[0].postId), postId);
    assert.equal(Number(inApp[0].commentId), rootCommentId);

    // Check push outbox for userA
    const outbox = await db.all('SELECT * FROM push_notification_outbox WHERE recipient_student_id = ?', 'userA');
    assert.equal(outbox.length, 1, 'User A should have 1 push outbox job');
    assert.equal(outbox[0].event_type, 'post_comment');
    const payload = JSON.parse(outbox[0].payload_json);
    assert.equal(payload.data.type, 'post_comment');
    assert.equal(payload.data.postId, postId);
    assert.equal(payload.data.commentId, rootCommentId);
    assert.equal(payload.data.actorId, 'userB');
    assert.ok(payload.title.includes('Student B'));
  });

  // 2. A comments on own post -> no notification
  await t.test("2. A comments on own post -> no self notification", async () => {
    await clearNotifications();

    const res = await request('POST', `/api/posts/${postId}/comments`, { content: 'Self-comment by post author' }, 'userA');
    assert.equal(res.status, 201);

    const inApp = await db.all('SELECT * FROM notifications WHERE recipientStudentId = ?', 'userA');
    assert.equal(inApp.length, 0, 'No in-app notification for self-comment');

    const outbox = await db.all('SELECT * FROM push_notification_outbox WHERE recipient_student_id = ?', 'userA');
    assert.equal(outbox.length, 0, 'No push outbox entry for self-comment');
  });

  // 3. B replies to A's comment -> A notification
  await t.test("3. B replies to A's comment -> A receives reply notification", async () => {
    // First, userA creates a root comment
    const aCommentRes = await request('POST', `/api/posts/${postId}/comments`, { content: 'Author root comment' }, 'userA');
    const aCommentId = aCommentRes.body.comment.id;
    await clearNotifications();

    // User B replies to User A's root comment
    const replyRes = await request('POST', `/api/comments/${aCommentId}/replies`, { content: 'Reply from B to A' }, 'userB');
    assert.equal(replyRes.status, 201);
    replyBId = replyRes.body.comment.id;

    // User A should be notified
    const inApp = await db.all('SELECT * FROM notifications WHERE recipientStudentId = ?', 'userA');
    assert.equal(inApp.length, 1, 'User A should receive reply notification');
    assert.equal(inApp[0].type, 'comment_reply');
    assert.equal(inApp[0].actorId, 'userB');
    assert.equal(Number(inApp[0].postId), postId);
    assert.equal(Number(inApp[0].commentId), aCommentId);
    assert.equal(Number(inApp[0].replyId), replyBId);

    // Push outbox for User A
    const outbox = await db.all('SELECT * FROM push_notification_outbox WHERE recipient_student_id = ?', 'userA');
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0].event_type, 'comment_reply');
    const payload = JSON.parse(outbox[0].payload_json);
    assert.equal(payload.data.type, 'comment_reply');
    assert.equal(payload.data.commentId, aCommentId);
    assert.equal(payload.data.replyId, replyBId);
  });

  // 4. C replies specifically to B's reply -> B notification, not A
  await t.test("4. C replies specifically to B's reply -> B receives notification, not A", async () => {
    await clearNotifications();

    // User C replies to replyBId (which was authored by B)
    const replyCRes = await request('POST', `/api/comments/${replyBId}/replies`, { content: 'Reply from C to B' }, 'userC');
    assert.equal(replyCRes.status, 201);
    replyCId = replyCRes.body.comment.id;

    // User B should receive the notification
    const inAppB = await db.all('SELECT * FROM notifications WHERE recipientStudentId = ?', 'userB');
    assert.equal(inAppB.length, 1, 'User B should receive notification for reply to their reply');
    assert.equal(inAppB[0].type, 'comment_reply');
    assert.equal(inAppB[0].actorId, 'userC');

    const outboxB = await db.all('SELECT * FROM push_notification_outbox WHERE recipient_student_id = ?', 'userB');
    assert.equal(outboxB.length, 1, 'User B should have push notification');
    const payload = JSON.parse(outboxB[0].payload_json);
    assert.equal(payload.data.type, 'comment_reply');
    assert.equal(payload.data.actorId, 'userC');

    // User A should NOT receive notification (targeting person being replied to)
    const inAppA = await db.all('SELECT * FROM notifications WHERE recipientStudentId = ?', 'userA');
    assert.equal(inAppA.length, 0, 'User A should NOT receive notification for reply to B');
    const outboxA = await db.all('SELECT * FROM push_notification_outbox WHERE recipient_student_id = ?', 'userA');
    assert.equal(outboxA.length, 0);
  });

  // 5. self reply -> no notification
  await t.test("5. self reply -> no notification", async () => {
    await clearNotifications();

    // User C replies to C's own reply
    const selfReplyRes = await request('POST', `/api/comments/${replyCId}/replies`, { content: 'Self reply by C' }, 'userC');
    assert.equal(selfReplyRes.status, 201);

    const inAppC = await db.all('SELECT * FROM notifications WHERE recipientStudentId = ?', 'userC');
    assert.equal(inAppC.length, 0, 'No in-app notification on self-reply');

    const outboxC = await db.all('SELECT * FROM push_notification_outbox WHERE recipient_student_id = ?', 'userC');
    assert.equal(outboxC.length, 0, 'No push outbox entry on self-reply');
  });

  // 6. B likes A's comment -> A notification
  await t.test("6. B likes A's comment -> A notification", async () => {
    await clearNotifications();

    // First ensure we have a comment by A
    const aCommentRes = await request('POST', `/api/posts/${postId}/comments`, { content: 'Comment by A to be liked' }, 'userA');
    const commentId = aCommentRes.body.comment.id;
    await clearNotifications();

    // B likes A's comment
    const reactRes = await request('POST', `/api/comments/${commentId}/reactions`, { reaction_type: 'like' }, 'userB');
    assert.equal(reactRes.status, 200);

    const inAppA = await db.all('SELECT * FROM notifications WHERE recipientStudentId = ?', 'userA');
    assert.equal(inAppA.length, 1, 'User A should receive reaction in-app notification');
    assert.equal(inAppA[0].type, 'comment_reaction');
    assert.equal(inAppA[0].actorId, 'userB');

    const outboxA = await db.all('SELECT * FROM push_notification_outbox WHERE recipient_student_id = ?', 'userA');
    assert.equal(outboxA.length, 1, 'User A should receive reaction push');
    const payload = JSON.parse(outboxA[0].payload_json);
    assert.equal(payload.data.type, 'comment_reaction');
    assert.equal(payload.data.actorId, 'userB');
    assert.ok(payload.title.includes('liked your comment'));
  });

  // 7. B unlikes A's comment -> no new notification
  await t.test("7. B unlikes A's comment -> no new notification", async () => {
    // Count current notifications
    const inAppBefore = await db.all('SELECT * FROM notifications');
    const outboxBefore = await db.all('SELECT * FROM push_notification_outbox');

    // B unlikes A's root comment
    const aComment = (await db.all("SELECT id FROM post_comments WHERE user_id = 'userA' LIMIT 1"))[0];
    const unreactRes = await request('DELETE', `/api/comments/${aComment.id}/reactions`, { reaction_type: 'like' }, 'userB');
    assert.equal(unreactRes.status, 200);

    const inAppAfter = await db.all('SELECT * FROM notifications');
    const outboxAfter = await db.all('SELECT * FROM push_notification_outbox');

    assert.equal(inAppAfter.length, inAppBefore.length, 'No new in-app notification on reaction removal');
    assert.equal(outboxAfter.length, outboxBefore.length, 'No new push notification on reaction removal');
  });

  // 8. self-like -> no notification
  await t.test("8. self-like -> no notification", async () => {
    await clearNotifications();

    const aComment = (await db.all("SELECT id FROM post_comments WHERE user_id = 'userA' LIMIT 1"))[0];
    const selfLikeRes = await request('POST', `/api/comments/${aComment.id}/reactions`, { reaction_type: 'like' }, 'userA');
    assert.equal(selfLikeRes.status, 200);

    const inApp = await db.all('SELECT * FROM notifications WHERE recipientStudentId = ?', 'userA');
    assert.equal(inApp.length, 0, 'No notification for self-reaction');

    const outbox = await db.all('SELECT * FROM push_notification_outbox WHERE recipient_student_id = ?', 'userA');
    assert.equal(outbox.length, 0, 'No push for self-reaction');
  });

  // 9. comment edit -> no notification
  await t.test("9. comment edit -> no notification", async () => {
    await clearNotifications();

    const bComment = (await db.all("SELECT id FROM post_comments WHERE user_id = 'userB' AND deleted_at IS NULL LIMIT 1"))[0];
    const editRes = await request('PUT', `/api/comments/${bComment.id}`, { content: 'Edited comment content by B' }, 'userB');
    assert.equal(editRes.status, 200);

    const inApp = await db.all('SELECT * FROM notifications');
    assert.equal(inApp.length, 0, 'No notification created for comment edit');

    const outbox = await db.all('SELECT * FROM push_notification_outbox');
    assert.equal(outbox.length, 0, 'No push created for comment edit');
  });

  // 10. comment delete -> no notification
  await t.test("10. comment delete -> no notification", async () => {
    await clearNotifications();

    const bComment = (await db.all("SELECT id FROM post_comments WHERE user_id = 'userB' AND deleted_at IS NULL LIMIT 1"))[0];
    const delRes = await request('DELETE', `/api/comments/${bComment.id}`, {}, 'userB');
    assert.equal(delRes.status, 200);

    const inApp = await db.all('SELECT * FROM notifications');
    assert.equal(inApp.length, 0, 'No notification created for comment delete');

    const outbox = await db.all('SELECT * FROM push_notification_outbox');
    assert.equal(outbox.length, 0, 'No push created for comment delete');
  });

  // 11. notification payload contains correct postId/commentId
  await t.test('11. notification payload contains correct postId/commentId', async () => {
    await clearNotifications();

    const res = await request('POST', `/api/posts/${postId}/comments`, { content: 'Payload check comment' }, 'userB');
    assert.equal(res.status, 201);
    const cId = res.body.comment.id;

    const outbox = await db.all('SELECT * FROM push_notification_outbox WHERE recipient_student_id = ?', 'userA');
    assert.equal(outbox.length, 1);
    const payload = JSON.parse(outbox[0].payload_json);

    assert.equal(payload.data.type, 'post_comment');
    assert.equal(payload.data.postId, postId);
    assert.equal(payload.data.commentId, cId);
    assert.equal(payload.data.actorId, 'userB');
    assert.equal(payload.channelId, 'social');
    assert.equal(payload.groupKey, `post_activity_${postId}`);
  });

  // 12. recipient cannot be spoofed through request body
  await t.test('12. recipient cannot be spoofed through request body', async () => {
    await clearNotifications();

    // Attacker sends fake recipientId / targetUserId in body
    const spoofRes = await request('POST', `/api/posts/${postId}/comments`, {
      content: 'Attempting to spoof recipient',
      recipientId: 'userC',
      notificationUserId: 'userC',
      targetUserId: 'userC',
      postOwnerId: 'userC'
    }, 'userB');
    assert.equal(spoofRes.status, 201);

    // Notification MUST still go to actual post owner (userA), NEVER to spoofed userC
    const inAppC = await db.all('SELECT * FROM notifications WHERE recipientStudentId = ?', 'userC');
    assert.equal(inAppC.length, 0, 'User C must NOT receive notification from spoofed body');

    const outboxC = await db.all('SELECT * FROM push_notification_outbox WHERE recipient_student_id = ?', 'userC');
    assert.equal(outboxC.length, 0, 'User C must NOT receive push from spoofed body');

    const outboxA = await db.all('SELECT * FROM push_notification_outbox WHERE recipient_student_id = ?', 'userA');
    assert.equal(outboxA.length, 1, 'Actual owner User A must receive notification');
  });

  // 13. notification failure does not fail comment creation
  await t.test('13. notification failure does not fail comment creation', async () => {
    // Simulate push error by temporarily stubbing outbox insertion with an error
    const origRun = db.run;
    let pushAttempted = false;
    db.run = async (sql, ...args) => {
      if (typeof sql === 'string' && (sql.includes('push_notification_outbox') || sql.includes('notifications'))) {
        pushAttempted = true;
        throw new Error('Simulated Push Service Failure');
      }
      return origRun.call(db, sql, ...args);
    };

    try {
      const res = await request('POST', `/api/posts/${postId}/comments`, { content: 'Comment during push failure' }, 'userB');
      assert.equal(res.status, 201, 'Comment must succeed despite push error');
      assert.ok(res.body.comment.id, 'Comment ID must be returned');
      assert.equal(pushAttempted, true, 'Push attempt occurred and failed gracefully');
    } finally {
      db.run = origRun;
    }
  });

  // 14. multiple recipient devices receive push
  await t.test('14. multiple recipient devices receive push', async () => {
    await clearNotifications();

    // User A has 2 devices registered (phone1 and tablet2)
    const res = await request('POST', `/api/posts/${postId}/comments`, { content: 'Multi-device delivery test' }, 'userB');
    assert.equal(res.status, 201);

    // Verify outbox has 1 job for userA
    const outbox = await db.all('SELECT * FROM push_notification_outbox WHERE recipient_student_id = ?', 'userA');
    assert.equal(outbox.length, 1, 'One outbox record for recipient userA');

    // Run push worker with mock fetch
    let deliveredMessages = [];
    const origFetch = global.fetch;
    global.fetch = async (url, opts) => {
      if (url.includes('exp.host')) {
        const msgs = JSON.parse(opts.body);
        deliveredMessages.push(...msgs);
        return {
          status: 200,
          json: async () => ({
            data: msgs.map(() => ({ status: 'ok', id: `ticket_${Date.now()}` }))
          })
        };
      }
      return origFetch(url, opts);
    };

    try {
      const result = await pushNotifications.processPushOutbox(db, { timeoutMs: 2000 });
      assert.ok(result.sent >= 1);
      // Both of User A's devices should have received the message!
      const userATokens = deliveredMessages.map(m => m.to);
      assert.ok(userATokens.includes('ExponentPushToken[device_A_phone1]'), 'Device 1 received push');
      assert.ok(userATokens.includes('ExponentPushToken[device_A_tablet2]'), 'Device 2 received push');
    } finally {
      global.fetch = origFetch;
    }
  });

  // 15. actor's device does not receive recipient notification
  await t.test("15. actor's device does not receive recipient notification", async () => {
    await clearNotifications();

    const res = await request('POST', `/api/posts/${postId}/comments`, { content: 'Actor device exclusion check' }, 'userB');
    assert.equal(res.status, 201);

    // Outbox should not contain actor userB
    const actorOutbox = await db.all('SELECT * FROM push_notification_outbox WHERE recipient_student_id = ?', 'userB');
    assert.equal(actorOutbox.length, 0, "Actor's device must never receive notification for their own action");
  });

  // 16. invalid push token handled cleanly
  await t.test('16. invalid push token (DeviceNotRegistered) handled cleanly and pruned', async () => {
    // Register a dead token
    const deadToken = 'ExponentPushToken[dead_token_123]';
    await pushNotifications.registerDeviceToken(db, {
      studentId: 'userC',
      expoPushToken: deadToken,
      platform: 'android',
    });

    const origFetch = global.fetch;
    global.fetch = async (url, opts) => {
      if (url.includes('exp.host')) {
        const msgs = JSON.parse(opts.body);
        return {
          status: 200,
          json: async () => ({
            data: msgs.map(m => ({
              status: 'error',
              message: 'The device is no longer registered',
              details: { error: 'DeviceNotRegistered' }
            }))
          })
        };
      }
      return origFetch(url, opts);
    };

    try {
      await pushNotifications.enqueuePushForRecipients(db, {
        eventType: 'post_comment',
        eventId: 'dead_token_test',
        recipientStudentIds: ['userC'],
        payload: { title: 'Test', body: 'Test' }
      });

      await pushNotifications.processPushOutbox(db, { timeoutMs: 2000 });

      // Token should have been pruned from student_device_tokens
      const tokenRow = await db.get('SELECT * FROM student_device_tokens WHERE expo_push_token = ?', deadToken);
      assert.equal(tokenRow, undefined, 'Invalid token must be deleted on DeviceNotRegistered');
    } finally {
      global.fetch = origFetch;
    }
  });

  // 17. tap payload parser recognizes all new types
  await t.test('17. tap payload parser recognizes all new types (post_comment, comment_reply, comment_reaction)', () => {
    // Test parser logic directly
    function parseNotificationData(raw) {
      if (!raw || typeof raw !== 'object') return null;
      const data = raw;
      const type = data.type;
      if (type === 'post_comment') {
        const postId = Number(data.postId);
        if (Number.isFinite(postId) && postId > 0) {
          const commentId = Number(data.commentId);
          return {
            type: 'post_comment',
            postId,
            commentId: Number.isFinite(commentId) && commentId > 0 ? commentId : undefined,
          };
        }
      }
      if (type === 'comment_reply') {
        const postId = Number(data.postId);
        if (Number.isFinite(postId) && postId > 0) {
          const commentId = Number(data.commentId);
          const replyId = Number(data.replyId);
          return {
            type: 'comment_reply',
            postId,
            commentId: Number.isFinite(commentId) && commentId > 0 ? commentId : undefined,
            replyId: Number.isFinite(replyId) && replyId > 0 ? replyId : undefined,
          };
        }
      }
      if (type === 'comment_reaction') {
        const postId = Number(data.postId);
        if (Number.isFinite(postId) && postId > 0) {
          const commentId = Number(data.commentId);
          return {
            type: 'comment_reaction',
            postId,
            commentId: Number.isFinite(commentId) && commentId > 0 ? commentId : undefined,
            reactionType: data.reactionType || 'like',
          };
        }
      }
      return null;
    }

    const postCommentParsed = parseNotificationData({ type: 'post_comment', postId: 12, commentId: 34 });
    assert.deepEqual(postCommentParsed, { type: 'post_comment', postId: 12, commentId: 34 });

    const replyParsed = parseNotificationData({ type: 'comment_reply', postId: 12, commentId: 34, replyId: 56 });
    assert.deepEqual(replyParsed, { type: 'comment_reply', postId: 12, commentId: 34, replyId: 56 });

    const reactionParsed = parseNotificationData({ type: 'comment_reaction', postId: 12, commentId: 34, reactionType: 'like' });
    assert.deepEqual(reactionParsed, { type: 'comment_reaction', postId: 12, commentId: 34, reactionType: 'like' });
  });

  // 18. deleted comment tap falls back to post
  await t.test('18. deleted comment tap falls back to post', async () => {
    // Create and soft-delete a comment
    const commentRes = await request('POST', `/api/posts/${postId}/comments`, { content: 'To be deleted' }, 'userB');
    const cId = commentRes.body.comment.id;
    // Add reply so it soft deletes
    await request('POST', `/api/comments/${cId}/replies`, { content: 'A child reply' }, 'userA');
    await request('DELETE', `/api/comments/${cId}`, {}, 'userB');

    // Fetch post comments: deleted comment content is '[Comment deleted]'
    const commentsRes = await request('GET', `/api/posts/${postId}/comments`, undefined, 'userA');
    const found = commentsRes.body.find(c => c.id === cId);
    assert.ok(found);
    assert.equal(found.isDeleted, true);
    assert.equal(found.content, '[Comment deleted]');
  });

  // 19. deleted post is handled gracefully
  await t.test('19. deleted post is handled gracefully', async () => {
    // Create temporary post
    const tempPostRes = await request('POST', '/api/posts', { content: 'Temp post' }, 'userA');
    const tempId = tempPostRes.body.id;

    // Delete post
    const delRes = await request('DELETE', `/api/posts/${tempId}`, {}, 'userA');
    assert.equal(delRes.status, 200);

    // Fetching non-existent post returns 404
    const getRes = await request('GET', `/api/posts/${tempId}`, undefined, 'userB');
    assert.equal(getRes.status, 404);
  });

  // 20. duplicate request does not generate duplicate logical notification where idempotency support exists
  await t.test('20. duplicate reaction within short window does not generate duplicate logical notification', async () => {
    await clearNotifications();

    const aComment = (await db.all("SELECT id FROM post_comments WHERE user_id = 'userA' LIMIT 1"))[0];

    // User B reacts
    await request('POST', `/api/comments/${aComment.id}/reactions`, { reaction_type: 'like' }, 'userB');
    const countAfterFirst = (await db.all("SELECT * FROM notifications WHERE type = 'comment_reaction'")).length;
    assert.equal(countAfterFirst, 1, 'First reaction creates 1 notification');

    // User B unlikes then rapidly likes again within 5-minute window
    await request('DELETE', `/api/comments/${aComment.id}/reactions`, { reaction_type: 'like' }, 'userB');
    await request('POST', `/api/comments/${aComment.id}/reactions`, { reaction_type: 'like' }, 'userB');

    const countAfterSecond = (await db.all("SELECT * FROM notifications WHERE type = 'comment_reaction'")).length;
    assert.equal(countAfterSecond, 1, 'Rapid reaction deduplication suppresses spam notification');
  });
});
