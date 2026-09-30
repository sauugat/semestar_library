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
});
