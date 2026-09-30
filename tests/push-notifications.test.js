const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db');
const push = require('../lib/push-notifications');

test('Push Notifications Foundation (Phase A)', async (t) => {
  await db.initSchema();

  await t.test('isValidExpoPushToken correctly validates formats', () => {
    assert.equal(push.isValidExpoPushToken('ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]'), true);
    assert.equal(push.isValidExpoPushToken('ExpoPushToken[xxxxxxxxxxxxxxxxxxxxxx]'), true);
    assert.equal(push.isValidExpoPushToken('12345678-1234-1234-1234-123456789012'), true);
    assert.equal(push.isValidExpoPushToken('invalid-token'), false);
    assert.equal(push.isValidExpoPushToken(''), false);
    assert.equal(push.isValidExpoPushToken(null), false);
  });

  await t.test('Device token registration, multi-device, and atomic reassignment on account switch', async () => {
    const studentA = 'TEST-STUDENT-A-' + Date.now();
    const studentB = 'TEST-STUDENT-B-' + Date.now();

    // Ensure students exist in DB
    if (db.isPostgres) {
      await db.run('INSERT INTO students (studentId, name, role, passwordHash) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING', studentA, 'Alice', 'student', 'test_hash');
      await db.run('INSERT INTO students (studentId, name, role, passwordHash) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING', studentB, 'Bob', 'student', 'test_hash');
    } else {
      await db.run('INSERT OR IGNORE INTO students (studentId, name, role, passwordHash) VALUES (?, ?, ?, ?)', studentA, 'Alice', 'student', 'test_hash');
      await db.run('INSERT OR IGNORE INTO students (studentId, name, role, passwordHash) VALUES (?, ?, ?, ?)', studentB, 'Bob', 'student', 'test_hash');
    }

    const tokenPhone = `ExponentPushToken[phone_${Date.now()}]`;
    const tokenTablet = `ExponentPushToken[tablet_${Date.now()}]`;

    // 1. Student A registers iPhone
    await push.registerDeviceToken(db, {
      studentId: studentA,
      expoPushToken: tokenPhone,
      platform: 'ios',
      deviceName: 'iPhone 15 Pro',
    });

    // 2. Student A registers iPad (multi-device)
    await push.registerDeviceToken(db, {
      studentId: studentA,
      expoPushToken: tokenTablet,
      platform: 'ios',
      deviceName: 'iPad Air',
    });

    const tokensA = await db.all('SELECT expo_push_token, device_name FROM student_device_tokens WHERE student_id = ?', studentA);
    assert.equal(tokensA.length, 2, 'Student A should have 2 registered devices');

    // 3. Shared phone: Student B logs in on iPhone (tokenPhone)
    // Must atomically reassign tokenPhone to Student B and break association with Student A
    await push.registerDeviceToken(db, {
      studentId: studentB,
      expoPushToken: tokenPhone,
      platform: 'ios',
      deviceName: 'iPhone 15 Pro (Bob)',
    });

    const updatedTokensA = await db.all('SELECT expo_push_token FROM student_device_tokens WHERE student_id = ?', studentA);
    const tokensB = await db.all('SELECT expo_push_token, device_name FROM student_device_tokens WHERE student_id = ?', studentB);

    assert.equal(updatedTokensA.length, 1, 'Student A should now only have 1 device (iPad)');
    assert.equal(updatedTokensA[0].expo_push_token, tokenTablet);

    assert.equal(tokensB.length, 1, 'Student B should now own the iPhone');
    assert.equal(tokensB[0].expo_push_token, tokenPhone);
    assert.equal(tokensB[0].device_name, 'iPhone 15 Pro (Bob)');

    // 4. Unregister device token
    const unregResult = await push.unregisterDeviceToken(db, {
      studentId: studentB,
      expoPushToken: tokenPhone,
    });
    assert.equal(unregResult.success, true);
    assert.equal(unregResult.changes, 1);

    const tokensBAfter = await db.all('SELECT expo_push_token FROM student_device_tokens WHERE student_id = ?', studentB);
    assert.equal(tokensBAfter.length, 0, 'Student B should have 0 devices after unregistering');
  });

  await t.test('Student notification preferences CRUD and default fallback', async () => {
    const student = 'TEST-PREFS-' + Date.now();
    if (db.isPostgres) {
      await db.run('INSERT INTO students (studentId, name, role, passwordHash) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING', student, 'Pref Student', 'student', 'test_hash');
    } else {
      await db.run('INSERT OR IGNORE INTO students (studentId, name, role, passwordHash) VALUES (?, ?, ?, ?)', student, 'Pref Student', 'student', 'test_hash');
    }

    // 1. Defaults when unconfigured
    const defaults = await push.getNotificationPreferences(db, student);
    assert.deepEqual(defaults, {
      muteChat: false,
      notifyNotes: true,
      notifyPosts: true,
      notifyNotices: true,
      hideLockscreenPreview: true,
    });

    // 2. Custom preferences update
    const updated = await push.updateNotificationPreferences(db, student, {
      muteChat: true,
      notifyNotes: false,
      notifyPosts: true,
      notifyNotices: true,
      hideLockscreenPreview: false,
    });

    assert.equal(updated.muteChat, true);
    assert.equal(updated.notifyNotes, false);
    assert.equal(updated.hideLockscreenPreview, false);

    // 3. Verify retrieval
    const retrieved = await push.getNotificationPreferences(db, student);
    assert.equal(retrieved.muteChat, true);
    assert.equal(retrieved.notifyNotes, false);
    assert.equal(retrieved.notifyPosts, true);
  });

  await t.test('Push notification outbox enforces idempotency and duplicate prevention', async () => {
    const student = 'TEST-OUTBOX-' + Date.now();
    if (db.isPostgres) {
      await db.run('INSERT INTO students (studentId, name, role, passwordHash) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING', student, 'Outbox Student', 'student', 'test_hash');
    } else {
      await db.run('INSERT OR IGNORE INTO students (studentId, name, role, passwordHash) VALUES (?, ?, ?, ?)', student, 'Outbox Student', 'student', 'test_hash');
    }

    const idempotencyKey = `chat:9999:${student}`;

    // 1. Initial enqueue
    const res1 = await push.enqueuePushNotification(db, {
      eventType: 'chat',
      eventId: '9999',
      recipientStudentId: student,
      payload: { title: 'Semester Library', body: 'New message' },
      idempotencyKey,
    });
    assert.equal(res1.enqueued, true);

    // 2. Duplicate retry attempt with the exact same idempotency key
    const res2 = await push.enqueuePushNotification(db, {
      eventType: 'chat',
      eventId: '9999',
      recipientStudentId: student,
      payload: { title: 'Semester Library', body: 'New message retry' },
      idempotencyKey,
    });

    // Count should be strictly 1
    const rows = await db.all('SELECT id FROM push_notification_outbox WHERE idempotency_key = ?', idempotencyKey);
    assert.equal(rows.length, 1, 'Duplicate retry with same idempotency_key must be suppressed');
  });

  await t.test('processPushOutbox skips notifications when student has muted chat', async () => {
    const student = 'TEST-MUTED-' + Date.now();
    if (db.isPostgres) {
      await db.run('INSERT INTO students (studentId, name, role, passwordHash) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING', student, 'Muted Student', 'student', 'test_hash');
    } else {
      await db.run('INSERT OR IGNORE INTO students (studentId, name, role, passwordHash) VALUES (?, ?, ?, ?)', student, 'Muted Student', 'student', 'test_hash');
    }

    // Set mute_chat = true
    await push.updateNotificationPreferences(db, student, { muteChat: true });

    // Enqueue chat notification
    const key = `chat:8888:${student}`;
    await push.enqueuePushNotification(db, {
      eventType: 'chat',
      eventId: '8888',
      recipientStudentId: student,
      payload: { title: 'Semester Library', body: 'Test Mute' },
      idempotencyKey: key,
    });

    const result = await push.processPushOutbox(db, { limit: 10, recipientStudentId: student });
    assert.equal(result.skipped >= 1, true, 'Outbox job should be marked skipped due to mute preference');

    const job = await db.get('SELECT status FROM push_notification_outbox WHERE idempotency_key = ?', key);
    assert.equal(job.status, 'skipped');
  });
});
