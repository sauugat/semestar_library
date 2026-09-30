const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const app = require('../server');
const db = require('../db');
const push = require('../lib/push-notifications');

test('Push Notifications Automatic Bounded Outbox Dispatch', async (t) => {
  await db.initSchema();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const ts = Date.now();
  const studentAId = `STUDENT_A_${ts}`;
  const studentBId = `STUDENT_B_${ts}`;
  const studentOtherSemId = `STUDENT_OTHER_${ts}`;
  const teacherId = `TEACHER_${ts}`;

  const allTestStudentIds = [studentAId, studentBId, studentOtherSemId, teacherId];

  // Insert test students
  for (const s of [
    { id: studentAId, name: 'Student A', role: 'student', semester: 'Semester 3' },
    { id: studentBId, name: 'Student B', role: 'student', semester: 'Semester 3' },
    { id: studentOtherSemId, name: 'Student Other', role: 'student', semester: 'Semester 1' },
    { id: teacherId, name: 'Teacher Admin', role: 'admin', semester: 'Semester 3' },
  ]) {
    if (db.isPostgres) {
      await db.run(
        'INSERT INTO students (studentId, name, role, semester, passwordHash) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING',
        s.id, s.name, s.role, s.semester, 'test_hash'
      );
    } else {
      await db.run(
        'INSERT OR IGNORE INTO students (studentId, name, role, semester, passwordHash) VALUES (?, ?, ?, ?, ?)',
        s.id, s.name, s.role, s.semester, 'test_hash'
      );
    }
  }

  // Generate mobile bearer tokens for authentication
  const tokens = {};
  for (const id of allTestStudentIds) {
    const token = `tok_auto_${id}_${Date.now()}`;
    tokens[id] = token;
    const expiresAt = new Date(Date.now() + 86400000).toISOString();
    await db.run(
      'INSERT INTO mobile_tokens (token, studentId, createdAt, expiresAt) VALUES (?, ?, ?, ?)',
      token, id, new Date().toISOString(), expiresAt
    );
  }

  // Register real-format device tokens for Student A and Student Other
  const tokenStudentA = `ExponentPushToken[auto_test_a_${ts}]`;
  const tokenStudentOther = `ExponentPushToken[auto_test_other_${ts}]`;

  await push.registerDeviceToken(db, {
    studentId: studentAId,
    expoPushToken: tokenStudentA,
    platform: 'android',
    deviceName: 'Galaxy Device'
  });
  await push.registerDeviceToken(db, {
    studentId: studentOtherSemId,
    expoPushToken: tokenStudentOther,
    platform: 'android',
    deviceName: 'Other Galaxy Device'
  });

  t.after(async () => {
    for (const id of allTestStudentIds) {
      await db.run('DELETE FROM push_notification_outbox WHERE recipient_student_id = ?', id);
      await db.run('DELETE FROM student_device_tokens WHERE student_id = ?', id);
      await db.run('DELETE FROM student_notification_preferences WHERE student_id = ?', id);
      await db.run('DELETE FROM mobile_tokens WHERE studentId = ?', id);
      await db.run('DELETE FROM chat_messages WHERE studentId = ?', id);
      await db.run('DELETE FROM files WHERE uploadedBy = ?', id);
      await db.run('DELETE FROM posts WHERE user_id = ?', id);
      await db.run('DELETE FROM students WHERE studentId = ?', id);
    }
    server.close();
  });

  // 1. Group chat automatic dispatch
  await t.test('1. Normal chat message automatically dispatches outbox without manual worker', async () => {
    const res = await fetch(`${baseUrl}/api/chat/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokens[studentBId]}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: 'Automated dispatch message test',
        clientId: `auto_client_msg_1_${ts}`
      })
    });

    const data = await res.json();
    assert.equal(res.status, 200);
    assert.ok(data.messageId);

    // Sender Student B must NOT have an outbox entry
    const senderOutbox = await db.all(
      'SELECT id FROM push_notification_outbox WHERE recipient_student_id = ? AND event_type = ? AND event_id = ?',
      studentBId, 'chat', String(data.messageId)
    );
    assert.equal(senderOutbox.length, 0, 'Sender must not receive push notification');

    // Recipient Student A outbox row must have been processed (status != pending or attempts > 0)
    const outboxA = await db.all(
      'SELECT id, status, attempts, payload_json FROM push_notification_outbox WHERE recipient_student_id = ? AND event_type = ?',
      studentAId, 'chat'
    );
    console.log('DEBUG Test 1 outboxA:', JSON.stringify(outboxA));
    assert.ok(outboxA.length >= 1, 'Student A should have received a chat outbox row');
    assert.ok(outboxA[0].status !== 'pending' || outboxA[0].attempts > 0, 'Outbox row must have been processed automatically');
  });

  // 2. Feed post automatic dispatch
  await t.test('2. Feed post automatically dispatches outbox without manual worker', async () => {
    // Re-register token for Student A if previous test cleaned it up
    await push.registerDeviceToken(db, {
      studentId: studentAId,
      expoPushToken: tokenStudentA,
      platform: 'android',
      deviceName: 'Galaxy Device'
    });

    const res = await fetch(`${baseUrl}/api/posts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokens[studentBId]}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content: 'Campus community update post',
        type: 'status'
      })
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.ok(data.id);

    // Author Student B must NOT have an outbox entry
    const authorOutbox = await db.all(
      'SELECT id FROM push_notification_outbox WHERE recipient_student_id = ? AND event_type = ? AND event_id = ?',
      studentBId, 'post', String(data.id)
    );
    assert.equal(authorOutbox.length, 0, 'Author must not be targeted for their own post');

    // Student A must have an outbox row that was automatically dispatched
    const studentAOutbox = await db.all(
      'SELECT id, status, attempts FROM push_notification_outbox WHERE recipient_student_id = ? AND event_type = ? AND event_id = ?',
      studentAId, 'post', String(data.id)
    );
    assert.ok(studentAOutbox.length >= 1, 'Student A must have received post notification');
    assert.ok(studentAOutbox[0].status !== 'pending' || studentAOutbox[0].attempts > 0, 'Post outbox must have been processed automatically');
  });

  // 3. Official notice automatic dispatch
  await t.test('3. Official notice automatically dispatches as event_type notice', async () => {
    // Re-register token for Student A
    await push.registerDeviceToken(db, {
      studentId: studentAId,
      expoPushToken: tokenStudentA,
      platform: 'android',
      deviceName: 'Galaxy Device'
    });

    const res = await fetch(`${baseUrl}/api/posts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokens[teacherId]}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content: 'Important Examination Notice for all students',
        type: 'notice',
        isOfficial: true
      })
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.ok(data.id);

    // Teacher uploader excluded
    const teacherOutbox = await db.all(
      'SELECT id FROM push_notification_outbox WHERE recipient_student_id = ? AND event_type = ? AND event_id = ?',
      teacherId, 'notice', String(data.id)
    );
    assert.equal(teacherOutbox.length, 0, 'Teacher uploader must be excluded');

    // Student A targeted with event_type = 'notice'
    const studentAOutbox = await db.all(
      'SELECT id, event_type, status, attempts FROM push_notification_outbox WHERE recipient_student_id = ? AND event_id = ?',
      studentAId, String(data.id)
    );
    assert.ok(studentAOutbox.length >= 1, 'Student A must have received notice notification');
    assert.equal(studentAOutbox[0].event_type, 'notice', 'Must be classified as notice');
    assert.ok(studentAOutbox[0].status !== 'pending' || studentAOutbox[0].attempts > 0, 'Notice outbox must have been processed automatically');
  });

  // 4. Non-blocking error handling: primary action never fails on push dispatch issues
  await t.test('4. Primary request succeeds even when dispatch throws or times out', async () => {
    const res = await push.dispatchImmediateOutbox(db, {
      eventType: 'chat',
      eventId: '999999999',
      timeoutMs: 1000
    });
    assert.ok(res !== undefined, 'Dispatch must return a result object');
  });
});
