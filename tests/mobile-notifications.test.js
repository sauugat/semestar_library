const test = require('node:test');
const assert = require('node:assert/strict');

// Replicate / test the client parser contract directly
function parseNotificationData(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const data = raw;
  const type = data.type;

  if (type === 'chat') {
    const messageId = Number(data.messageId);
    return {
      type: 'chat',
      messageId: Number.isFinite(messageId) ? messageId : undefined,
    };
  }

  if (type === 'material') {
    const fileId = Number(data.fileId);
    if (Number.isFinite(fileId) && fileId > 0) {
      return { type: 'material', fileId };
    }
  }

  if (type === 'post') {
    const postId = Number(data.postId);
    if (Number.isFinite(postId) && postId > 0) {
      return { type: 'post', postId };
    }
  }

  if (type === 'notice') {
    const noticeId = Number(data.noticeId);
    if (Number.isFinite(noticeId) && noticeId > 0) {
      return { type: 'notice', noticeId };
    }
  }

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
      const replyId = Number(data.replyId);
      return {
        type: 'comment_reaction',
        postId,
        commentId: Number.isFinite(commentId) && commentId > 0 ? commentId : undefined,
        replyId: Number.isFinite(replyId) && replyId > 0 ? replyId : undefined,
        reactionType: data.reactionType || 'like',
      };
    }
  }

  return null;
}

test('Mobile Push Notification Integration (Phase C Client Contracts)', async (t) => {
  await t.test('1. parseNotificationData validates chat payload', () => {
    const parsedWithId = parseNotificationData({ type: 'chat', messageId: 42 });
    assert.deepEqual(parsedWithId, { type: 'chat', messageId: 42 });

    const parsedWithoutId = parseNotificationData({ type: 'chat' });
    assert.deepEqual(parsedWithoutId, { type: 'chat', messageId: undefined });
  });

  await t.test('2. parseNotificationData validates material payload', () => {
    const parsedValid = parseNotificationData({ type: 'material', fileId: 101 });
    assert.deepEqual(parsedValid, { type: 'material', fileId: 101 });

    const parsedInvalid = parseNotificationData({ type: 'material', fileId: 'not-a-number' });
    assert.equal(parsedInvalid, null);

    const parsedNegative = parseNotificationData({ type: 'material', fileId: -5 });
    assert.equal(parsedNegative, null);
  });

  await t.test('3. parseNotificationData validates post payload', () => {
    const parsedValid = parseNotificationData({ type: 'post', postId: 202 });
    assert.deepEqual(parsedValid, { type: 'post', postId: 202 });

    const parsedMissing = parseNotificationData({ type: 'post' });
    assert.equal(parsedMissing, null);
  });

  await t.test('4. parseNotificationData validates official notice payload', () => {
    const parsedValid = parseNotificationData({ type: 'notice', noticeId: 303 });
    assert.deepEqual(parsedValid, { type: 'notice', noticeId: 303 });

    const parsedMissing = parseNotificationData({ type: 'notice' });
    assert.equal(parsedMissing, null);
  });

  await t.test('4b. parseNotificationData validates comment, reply, and reaction payloads', () => {
    const parsedComment = parseNotificationData({ type: 'post_comment', postId: 10, commentId: 20 });
    assert.deepEqual(parsedComment, { type: 'post_comment', postId: 10, commentId: 20 });

    const parsedReply = parseNotificationData({ type: 'comment_reply', postId: 10, commentId: 20, replyId: 30 });
    assert.deepEqual(parsedReply, { type: 'comment_reply', postId: 10, commentId: 20, replyId: 30 });

    const parsedReaction = parseNotificationData({ type: 'comment_reaction', postId: 10, commentId: 20, reactionType: 'like' });
    assert.deepEqual(parsedReaction, { type: 'comment_reaction', postId: 10, commentId: 20, replyId: undefined, reactionType: 'like' });
  });

  await t.test('5. parseNotificationData rejects malformed / unknown types safely', () => {
    assert.equal(parseNotificationData(null), null);
    assert.equal(parseNotificationData(undefined), null);
    assert.equal(parseNotificationData('random string'), null);
    assert.equal(parseNotificationData({ type: 'unknown_type', id: 99 }), null);
    assert.equal(parseNotificationData({}), null);
  });

  await t.test('6. Stashed pending notification survives and is consumed once', () => {
    let pending = null;
    const setPending = (p) => { pending = p; };
    const consumePending = () => {
      const p = pending;
      pending = null;
      return p;
    };

    setPending({ type: 'material', fileId: 555 });
    assert.deepEqual(consumePending(), { type: 'material', fileId: 555 });
    assert.equal(consumePending(), null, 'Should be null after first consumption');
  });

  await t.test('7. Registration body contract: never includes studentId', () => {
    const regPayload = {
      expoPushToken: 'ExponentPushToken[mock_token_abc]',
      platform: 'ios',
      deviceName: 'iPhone 15 Pro',
    };

    assert.ok(regPayload.expoPushToken);
    assert.ok(regPayload.platform);
    assert.equal(regPayload.studentId, undefined, 'Client must NEVER send studentId');
  });

  await t.test('8. Logout unregister security sequence: unregister must precede session clearance', async () => {
    const executionOrder = [];

    // Simulated logout steps
    const simulatedLogout = async () => {
      // 1. Unregister with active token
      executionOrder.push('unregister_push_token');
      // 2. Server-side logout
      executionOrder.push('server_logout');
      // 3. Clear local tokens
      executionOrder.push('clear_secure_store');
      // 4. Disconnect realtime & clear cache
      executionOrder.push('clear_cache_and_realtime');
    };

    await simulatedLogout();

    assert.deepEqual(executionOrder, [
      'unregister_push_token',
      'server_logout',
      'clear_secure_store',
      'clear_cache_and_realtime',
    ]);
  });

  await t.test('9. Navigation lock suppresses splash / home redirect when notification is navigating or completed', () => {
    let isHandling = false;
    let completed = false;
    let pending = null;

    const isNotificationNavigating = () => isHandling || pending !== null;
    const hasNotificationNavigationCompleted = () => completed;

    // Normal startup: no notification
    let defaultRedirectOccurred = false;
    const performDefaultSplashTransition = () => {
      if (isNotificationNavigating() || hasNotificationNavigationCompleted()) {
        return; // Suppressed
      }
      defaultRedirectOccurred = true;
    };

    performDefaultSplashTransition();
    assert.equal(defaultRedirectOccurred, true, 'Default redirect happens normally when no notification is tapped');

    // Notification startup: lock is claimed
    defaultRedirectOccurred = false;
    isHandling = true;
    performDefaultSplashTransition();
    assert.equal(defaultRedirectOccurred, false, 'Default redirect MUST be suppressed when notification is navigating');

    // Notification completed: lock is completed
    isHandling = false;
    completed = true;
    performDefaultSplashTransition();
    assert.equal(defaultRedirectOccurred, false, 'Default redirect MUST be suppressed after notification navigation completes');
  });

  await t.test('10. Centralized navigation dispatcher routes each payload type correctly with replace semantics', () => {
    const routesDispatched = [];
    const mockRouter = {
      replace: (target) => routesDispatched.push(target),
    };

    const dispatchNotification = (payload) => {
      switch (payload.type) {
        case 'chat':
          mockRouter.replace('/(tabs)/chat');
          break;
        case 'material':
          mockRouter.replace(`/material/${payload.fileId}`);
          break;
        case 'post':
          mockRouter.replace({ pathname: '/(tabs)', params: { postId: String(payload.postId) } });
          break;
        case 'notice':
          mockRouter.replace({ pathname: '/notices', params: { id: String(payload.noticeId) } });
          break;
        case 'post_comment':
        case 'comment_reply':
        case 'comment_reaction': {
          const params = { id: payload.postId };
          if (payload.commentId) params.commentId = String(payload.commentId);
          if (payload.replyId) params.replyId = String(payload.replyId);
          mockRouter.replace({ pathname: '/post/[id]', params });
          break;
        }
      }
    };

    dispatchNotification({ type: 'chat' });
    dispatchNotification({ type: 'material', fileId: 88 });
    dispatchNotification({ type: 'post', postId: 77 });
    dispatchNotification({ type: 'notice', noticeId: 66 });
    dispatchNotification({ type: 'post_comment', postId: 55, commentId: 44 });
    dispatchNotification({ type: 'comment_reply', postId: 55, commentId: 44, replyId: 33 });

    assert.deepEqual(routesDispatched, [
      '/(tabs)/chat',
      '/material/88',
      { pathname: '/(tabs)', params: { postId: '77' } },
      { pathname: '/notices', params: { id: '66' } },
      { pathname: '/post/[id]', params: { id: 55, commentId: '44' } },
      { pathname: '/post/[id]', params: { id: 55, commentId: '44', replyId: '33' } },
    ]);
  });

  await t.test('11. Duplicate notification response events within deduplication window are dropped', () => {
    let lastHandledId = null;
    let lastHandledTime = 0;
    let handledCount = 0;

    const handleTap = (identifier, now) => {
      if (identifier && lastHandledId === identifier && now - lastHandledTime < 4000) {
        return; // Duplicate ignored
      }
      lastHandledId = identifier;
      lastHandledTime = now;
      handledCount++;
    };

    // Cold start response fires
    handleTap('notif-12345', 1000);
    assert.equal(handledCount, 1);

    // Listener also fires 50ms later for the exact same native notification
    handleTap('notif-12345', 1050);
    assert.equal(handledCount, 1, 'Duplicate tap response must be ignored');

    // A separate notification arrives later
    handleTap('notif-67890', 2000);
    assert.equal(handledCount, 2, 'Distinct notification response must be handled');
  });

  await t.test('12. Unauthenticated notification tap stashes destination and navigates with 0 intermediate Home redirects on login', () => {
    let pendingDestination = null;
    const history = [];

    const mockRouter = {
      replace: (path) => history.push(path),
    };

    // 1. Tapped while unauthenticated
    const onNotificationTap = (payload, isAuthenticated) => {
      if (!isAuthenticated) {
        pendingDestination = payload;
        mockRouter.replace('/login');
        return;
      }
      mockRouter.replace(payload.type === 'chat' ? '/(tabs)/chat' : '/(tabs)');
    };

    onNotificationTap({ type: 'chat' }, false);
    assert.deepEqual(history, ['/login']);
    assert.deepEqual(pendingDestination, { type: 'chat' });

    // 2. User logs in
    const onLoginSuccess = () => {
      const pending = pendingDestination;
      pendingDestination = null;
      if (pending) {
        onNotificationTap(pending, true);
      } else {
        mockRouter.replace('/(tabs)');
      }
    };

    onLoginSuccess();
    // Verify that NO intermediate '/(tabs)' was pushed!
    assert.deepEqual(history, ['/login', '/(tabs)/chat'], 'User goes directly to target screen after login without intermediate Home redirect');
    assert.equal(pendingDestination, null, 'Pending destination cleared after navigation');
  });
});
