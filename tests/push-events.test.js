const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const app = require('../server');
const db = require('../db');
const push = require('../lib/push-notifications');

test('Push Notifications Integration & Event Hooks (Phase B)', async (t) => {
  // Disable immediate synchronous dispatch to test isolated enqueue & coalescing queue states before manual worker
  process.env.DISABLE_IMMEDIATE_PUSH_DISPATCH = '1';
  t.after(() => { delete process.env.DISABLE_IMMEDIATE_PUSH_DISPATCH; });

  await db.initSchema();
  // Clean up any stale test records from previous runs
  await db.run("DELETE FROM push_notification_outbox WHERE recipient_student_id LIKE 'STUDENT_%' OR recipient_student_id LIKE 'MUTED_%' OR recipient_student_id LIKE 'SENDER_%' OR recipient_student_id LIKE 'ADMIN_%'");

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const ts = Date.now();
  const senderId = `SENDER_${ts}`;
  const studentS2Id = `STUDENT_S2_${ts}`;
  const studentS4Id = `STUDENT_S4_${ts}`;
  const mutedStudentId = `MUTED_S2_${ts}`;
  const adminId = `ADMIN_${ts}`;

  const allTestStudentIds = [senderId, studentS2Id, studentS4Id, mutedStudentId, adminId];

  // Insert test students
  for (const s of [
    { id: senderId, name: 'Sender User', role: 'student', semester: 'Semester 2' },
    { id: studentS2Id, name: 'Student Sem 2', role: 'student', semester: 'Semester 2' },
    { id: studentS4Id, name: 'Student Sem 4', role: 'student', semester: 'Semester 4' },
    { id: mutedStudentId, name: 'Muted Sem 2', role: 'student', semester: 'Semester 2' },
    { id: adminId, name: 'Admin User', role: 'admin', semester: 'Semester 1' },
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

  // Set notification preferences for muted student
  await push.updateNotificationPreferences(db, mutedStudentId, { muteChat: true });

  // Generate mobile bearer tokens for authentication
  const tokens = {};
  for (const id of allTestStudentIds) {
    const token = `tok_${id}_${Date.now()}`;
    tokens[id] = token;
    const expiresAt = new Date(Date.now() + 86400000).toISOString();
    await db.run(
      'INSERT INTO mobile_tokens (token, studentId, createdAt, expiresAt) VALUES (?, ?, ?, ?)',
      token, id, new Date().toISOString(), expiresAt
    );
  }

  // Register device tokens for students to verify outbox delivery and preference skipping
  await push.registerDeviceToken(db, {
    studentId: studentS2Id,
    expoPushToken: `ExponentPushToken[s2_${ts}]`,
    platform: 'android',
    deviceName: 'Pixel 8'
  });
  await push.registerDeviceToken(db, {
    studentId: studentS4Id,
    expoPushToken: `ExponentPushToken[s4_${ts}]`,
    platform: 'android',
    deviceName: 'Pixel 8'
  });
  await push.registerDeviceToken(db, {
    studentId: mutedStudentId,
    expoPushToken: `ExponentPushToken[muted_${ts}]`,
    platform: 'ios',
    deviceName: 'iPhone Muted'
  });

  t.after(async () => {
    // Clean up outbox items created by tests
    const p = allTestStudentIds.map(() => '?').join(',');
    await db.run(`DELETE FROM push_notification_outbox WHERE recipient_student_id IN (${p})`, ...allTestStudentIds).catch(() => {});
    await db.run(`DELETE FROM student_device_tokens WHERE student_id IN (${p})`, ...allTestStudentIds).catch(() => {});
    await db.run(`DELETE FROM student_notification_preferences WHERE student_id IN (${p})`, ...allTestStudentIds).catch(() => {});
    await db.run(`DELETE FROM mobile_tokens WHERE studentId IN (${p})`, ...allTestStudentIds).catch(() => {});
    await db.run(`DELETE FROM chat_messages WHERE studentId IN (${p})`, ...allTestStudentIds).catch(() => {});
    await db.run(`DELETE FROM files WHERE uploadedBy IN (${p})`, ...allTestStudentIds).catch(() => {});
    await db.run(`DELETE FROM posts WHERE user_id IN (${p})`, ...allTestStudentIds).catch(() => {});
    await db.run(`DELETE FROM students WHERE studentId IN (${p})`, ...allTestStudentIds).catch(() => {});
    server.close();
    setTimeout(() => {
      process.exit(0);
    }, 500);
  });

  // -------------------------------------------------------------
  // 1. Group Chat Tests
  // -------------------------------------------------------------
  await t.test('1. Group chat push: enqueues outbox, excludes sender, throttles rapid messages, respects muted chat', async () => {
    // Initial message from senderId
    const res1 = await fetch(`${baseUrl}/api/chat/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokens[senderId]}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: 'Hello group chat!',
        clientId: `client_msg_1_${ts}`
      })
    });

    const data1 = await res1.json();
    assert.equal(res1.status, 200, 'Chat message should save successfully');
    assert.ok(data1.messageId, 'Message ID should be returned');
    const msgId1 = data1.messageId;

    // Check outbox for sender: sender gets NO push event
    const senderOutbox = await db.all(
      'SELECT id FROM push_notification_outbox WHERE recipient_student_id = ? AND event_type = ? AND event_id = ?',
      senderId, 'chat', String(msgId1)
    );
    assert.equal(senderOutbox.length, 0, 'Sender must NOT receive a push notification for their own message');

    // Check outbox for studentS2: must have received pending outbox row
    const s2Outbox1 = await db.all(
      'SELECT id, payload_json, status, idempotency_key FROM push_notification_outbox WHERE recipient_student_id = ? AND event_type = ?',
      studentS2Id, 'chat'
    );
    assert.ok(s2Outbox1.length >= 1, 'Eligible recipient should have a pending chat outbox entry');
    const row1 = s2Outbox1[0];
    const payload1 = typeof row1.payload_json === 'string' ? JSON.parse(row1.payload_json) : row1.payload_json;
    assert.equal(payload1.title, 'BIT Group Chat');
    assert.equal(payload1.body, 'Sender User: Hello group chat!');
    assert.equal(payload1.data.type, 'chat');
    assert.equal(payload1.data.messageId, msgId1);
    assert.equal(payload1.groupKey, 'chat_group_bit');
    assert.equal(payload1.collapseId, undefined);
    assert.equal(payload1.tag, `chat_msg_${msgId1}`);

    // Duplicate retry attempt with the exact same messageId: must not duplicate outbox jobs
    const retryEnqueue = await push.enqueueChatPushWithThrottle(db, {
      messageId: msgId1,
      senderStudentId: senderId,
      senderName: 'Sender User',
      text: 'Hello group chat!'
    });
    assert.equal(retryEnqueue.enqueuedCount, 0, 'Duplicate retry for same messageId must not duplicate outbox rows');
    const s2OutboxAfterRetry = await db.all(
      'SELECT id FROM push_notification_outbox WHERE recipient_student_id = ? AND event_type = ? AND event_id = ?',
      studentS2Id, 'chat', String(msgId1)
    );
    assert.equal(s2OutboxAfterRetry.length, 1, 'Same messageId must not duplicate outbox row');

    // Rapid second message from sender: creates immediate notification update without delay or generic counter
    const res2 = await fetch(`${baseUrl}/api/chat/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokens[senderId]}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: 'Rapid follow-up message!',
        clientId: `client_msg_2_${ts}`
      })
    });
    const data2 = await res2.json();
    assert.equal(res2.status, 200);

    const s2OutboxAll = await db.all(
      'SELECT id, payload_json, status FROM push_notification_outbox WHERE recipient_student_id = ? AND event_type = ? AND status = ? ORDER BY id ASC',
      studentS2Id, 'chat', 'pending'
    );
    assert.equal(s2OutboxAll.length, 2, 'Rapid messages must create immediate notification updates in outbox');
    const msg2Payload = typeof s2OutboxAll[1].payload_json === 'string'
      ? JSON.parse(s2OutboxAll[1].payload_json)
      : s2OutboxAll[1].payload_json;
    assert.equal(msg2Payload.title, 'BIT Group Chat');
    assert.equal(msg2Payload.body, 'Sender User: Rapid follow-up message!');
    assert.equal(msg2Payload.groupKey, 'chat_group_bit');
    assert.equal(msg2Payload.collapseId, undefined);
    assert.equal(msg2Payload.tag, `chat_msg_${data2.messageId}`);

    // Delivery architecture test: process outbox and verify muted student preference is respected
    const processResult = await push.processPushOutbox(db, { recipientStudentId: mutedStudentId, limit: 10 });
    assert.ok(processResult.processed >= 1);

    // The muted student's chat notification must have been marked 'skipped'
    const mutedRow = await db.get(
      'SELECT status FROM push_notification_outbox WHERE recipient_student_id = ? AND event_type = ?',
      mutedStudentId, 'chat'
    );
    assert.ok(mutedRow, 'Muted student outbox row should exist');
    assert.equal(mutedRow.status, 'skipped', 'Outbox delivery architecture must skip muted chat notifications');
  });

  // -------------------------------------------------------------
  // 2. Material / Notes Upload Tests
  // -------------------------------------------------------------
  await t.test('2. Material upload push: correct semester audience, unauthorized semester excluded, uploader excluded', async () => {
    // Uploader (senderId, Semester 2) uploads a Semester 2 note via record-upload endpoint
    const recordPayload = {
      files: [{
        storedName: `note_s2_${ts}.pdf`,
        originalName: 'Discrete_Structures_Ch1.pdf',
        size: 10240,
        token: null // direct mock insert
      }],
      title: 'Chapter 1: Propositional Logic',
      semester: 'Semester 2',
      subject: 'Discrete Structures',
      chapter: 'Chapter 1'
    };

    // We invoke enqueueMaterialPush directly to test audience filtering cleanly with mocked fileId
    const mockFileResult = await db.run(`
      INSERT INTO files (storedName, originalName, title, semester, subject, chapter, uploadedBy, sizeBytes, uploadedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, `note_s2_${ts}.pdf`, 'Discrete_Structures_Ch1.pdf', 'Chapter 1: Propositional Logic', 'Semester 2', 'Discrete Structures', 'Chapter 1', senderId, 10240, new Date().toISOString());

    const fileId = mockFileResult.lastInsertRowid;
    assert.ok(fileId, 'File record inserted');

    const enqueueRes = await push.enqueueMaterialPush(db, {
      fileId,
      originalName: 'Discrete_Structures_Ch1.pdf',
      title: 'Chapter 1: Propositional Logic',
      semester: 'Semester 2',
      subject: 'Discrete Structures',
      uploaderStudentId: senderId
    });

    assert.ok(enqueueRes.enqueuedCount >= 1, 'Should have enqueued notifications for Semester 2 students');

    // 1. Semester 2 student (studentS2Id) MUST have received material push outbox row
    const s2Material = await db.all(
      'SELECT id, payload_json, idempotency_key FROM push_notification_outbox WHERE recipient_student_id = ? AND event_type = ? AND event_id = ?',
      studentS2Id, 'material', String(fileId)
    );
    assert.equal(s2Material.length, 1, 'Semester 2 student should receive material notification');
    const matPayload = typeof s2Material[0].payload_json === 'string' ? JSON.parse(s2Material[0].payload_json) : s2Material[0].payload_json;
    assert.ok(matPayload.title === 'Discrete Structures' || matPayload.title === 'New Study Material');
    assert.ok(matPayload.body.includes('Discrete Structures') || matPayload.title.includes('Discrete Structures') || matPayload.body.includes('Unit 1'));
    assert.equal(matPayload.data.type, 'material');
    assert.equal(matPayload.data.fileId, fileId);
    assert.equal(s2Material[0].idempotency_key, `material:${fileId}:${studentS2Id}`);

    // 2. Semester 4 student (studentS4Id) must NOT have received material push outbox row
    const s4Material = await db.all(
      'SELECT id FROM push_notification_outbox WHERE recipient_student_id = ? AND event_type = ? AND event_id = ?',
      studentS4Id, 'material', String(fileId)
    );
    assert.equal(s4Material.length, 0, 'Unauthorized semester (Semester 4) student must NOT receive Semester 2 material notification');

    // 3. Uploader (senderId) must NOT have received material push outbox row
    const uploaderMaterial = await db.all(
      'SELECT id FROM push_notification_outbox WHERE recipient_student_id = ? AND event_type = ? AND event_id = ?',
      senderId, 'material', String(fileId)
    );
    assert.equal(uploaderMaterial.length, 0, 'Uploader must be excluded from material notification');

    // 4. Duplicate upload enqueue retry: idempotency prevents duplicate outbox entries
    const retryEnqueue = await push.enqueueMaterialPush(db, {
      fileId,
      originalName: 'Discrete_Structures_Ch1.pdf',
      title: 'Chapter 1: Propositional Logic',
      semester: 'Semester 2',
      subject: 'Discrete Structures',
      uploaderStudentId: senderId
    });
    const s2MaterialAfterRetry = await db.all(
      'SELECT id FROM push_notification_outbox WHERE recipient_student_id = ? AND event_type = ? AND event_id = ?',
      studentS2Id, 'material', String(fileId)
    );
    assert.equal(s2MaterialAfterRetry.length, 1, 'Duplicate material enqueue must not duplicate outbox entries');
  });

  // -------------------------------------------------------------
  // 2b. Multi-File Batch Material Push Tests
  // -------------------------------------------------------------
  await t.test('2b. Multi-file batch push: 1 batch notification for N files, handles partial failures & idempotency', async () => {
    const tsBatch = Date.now();
    const batchId = `test_batch_${tsBatch}`;

    // Case 1: Batch of 3 files persisted
    const f1Res = await db.run(`
      INSERT INTO files (storedName, originalName, title, semester, subject, chapter, uploadedBy, sizeBytes, uploadedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, `batch_f1_${tsBatch}.pdf`, 'DBMS_Unit4.pdf', 'DBMS Unit 4', 'Semester 2', 'Database Management Systems', 'Unit 4: Normalization', senderId, 2400000, new Date().toISOString());

    const f2Res = await db.run(`
      INSERT INTO files (storedName, originalName, title, semester, subject, chapter, uploadedBy, sizeBytes, uploadedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, `batch_f2_${tsBatch}.pdf`, 'DBMS_Unit5.pdf', 'DBMS Unit 5', 'Semester 2', 'Database Management Systems', 'Unit 4: Normalization', senderId, 3100000, new Date().toISOString());

    const f3Res = await db.run(`
      INSERT INTO files (storedName, originalName, title, semester, subject, chapter, uploadedBy, sizeBytes, uploadedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, `batch_f3_${tsBatch}.pptx`, 'Normalization_Slides.pptx', 'Normalization Slides', 'Semester 2', 'Database Management Systems', 'Unit 4: Normalization', senderId, 5800000, new Date().toISOString());

    const batchFiles = [
      { id: f1Res.lastInsertRowid, originalName: 'DBMS_Unit4.pdf', title: 'DBMS Unit 4' },
      { id: f2Res.lastInsertRowid, originalName: 'DBMS_Unit5.pdf', title: 'DBMS Unit 5' },
      { id: f3Res.lastInsertRowid, originalName: 'Normalization_Slides.pptx', title: 'Normalization Slides' }
    ];

    // Enqueue batch push
    const batchEnqueueRes = await push.enqueueMaterialBatchPush(db, {
      batchId,
      files: batchFiles,
      semester: 'Semester 2',
      subject: 'Database Management Systems',
      chapter: 'Unit 4: Normalization',
      uploaderStudentId: senderId,
      uploaderName: 'Prof. Sharma'
    });

    assert.ok(batchEnqueueRes.enqueuedCount >= 1, 'Should enqueue batch push notification');

    // Verify exactly ONE notification row was created for studentS2Id (NOT 3 separate pushes!)
    const s2BatchRows = await db.all(
      'SELECT id, payload_json, idempotency_key FROM push_notification_outbox WHERE recipient_student_id = ? AND event_type = ? AND event_id = ?',
      studentS2Id, 'material', batchId
    );
    assert.equal(s2BatchRows.length, 1, 'Semester 2 student should receive exactly 1 batch notification, not 3');

    const batchPayload = typeof s2BatchRows[0].payload_json === 'string'
      ? JSON.parse(s2BatchRows[0].payload_json)
      : s2BatchRows[0].payload_json;

    assert.equal(batchPayload.title, 'Database Management Systems');
    assert.ok(batchPayload.body.includes('3 new files') || batchPayload.body.includes('3 new study materials'));
    assert.equal(batchPayload.data.type, 'material_batch');
    assert.equal(batchPayload.data.batchId, batchId);
    assert.equal(batchPayload.data.materialCount, 3);
    assert.deepEqual(batchPayload.data.fileIds, batchFiles.map(f => Number(f.id)));
    assert.equal(s2BatchRows[0].idempotency_key, `material-batch:${batchId}:${studentS2Id}`);

    // Verify uploader is excluded
    const uploaderBatchRows = await db.all(
      'SELECT id FROM push_notification_outbox WHERE recipient_student_id = ? AND event_type = ? AND event_id = ?',
      senderId, 'material', batchId
    );
    assert.equal(uploaderBatchRows.length, 0, 'Uploader must not receive notification');

    // Verify other semester student is excluded
    const s4BatchRows = await db.all(
      'SELECT id FROM push_notification_outbox WHERE recipient_student_id = ? AND event_type = ? AND event_id = ?',
      studentS4Id, 'material', batchId
    );
    assert.equal(s4BatchRows.length, 0, 'Semester 4 student must not receive Semester 2 batch notification');

    // Case 2: Idempotent retry with same batchId does NOT create duplicate outbox entries
    const retryBatchRes = await push.enqueueMaterialBatchPush(db, {
      batchId,
      files: batchFiles,
      semester: 'Semester 2',
      subject: 'Database Management Systems',
      chapter: 'Unit 4: Normalization',
      uploaderStudentId: senderId,
      uploaderName: 'Prof. Sharma'
    });
    const s2BatchRowsAfterRetry = await db.all(
      'SELECT id FROM push_notification_outbox WHERE recipient_student_id = ? AND event_type = ? AND event_id = ?',
      studentS2Id, 'material', batchId
    );
    assert.equal(s2BatchRowsAfterRetry.length, 1, 'Retry must not duplicate batch notifications');

    // Case 3: Empty files array yields 0 notifications
    const emptyRes = await push.enqueueMaterialBatchPush(db, {
      batchId: 'empty_batch',
      files: [],
      semester: 'Semester 2',
      subject: 'Database Management Systems',
      uploaderStudentId: senderId
    });
    assert.equal(emptyRes.enqueuedCount, 0, 'Empty upload batch must produce 0 notifications');
  });

  // -------------------------------------------------------------
  // 3. Feed Post Tests
  // -------------------------------------------------------------
  await t.test('3. Feed post push: enqueues for students, excludes author, idempotency works', async () => {
    const postRes = await fetch(`${baseUrl}/api/posts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokens[studentS2Id]}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content: 'Check out the new study guide for midterms!',
        type: 'status'
      })
    });

    const postData = await postRes.json();
    assert.equal(postRes.status, 201, 'Post should be created successfully');
    assert.ok(postData.id, 'Post ID should be returned');
    const postId = postData.id;

    // 1. Author (studentS2Id) must be excluded
    const authorPostOutbox = await db.all(
      'SELECT id FROM push_notification_outbox WHERE recipient_student_id = ? AND event_type = ? AND event_id = ?',
      studentS2Id, 'post', String(postId)
    );
    assert.equal(authorPostOutbox.length, 0, 'Author must be excluded from post push notifications');

    // 2. Other students (studentS4Id, senderId) should have received post notification
    const recipientPostOutbox = await db.all(
      'SELECT id, payload_json, idempotency_key FROM push_notification_outbox WHERE recipient_student_id = ? AND event_type = ? AND event_id = ?',
      studentS4Id, 'post', String(postId)
    );
    assert.equal(recipientPostOutbox.length, 1, 'Other students should receive post notification');
    const postPayload = typeof recipientPostOutbox[0].payload_json === 'string'
      ? JSON.parse(recipientPostOutbox[0].payload_json)
      : recipientPostOutbox[0].payload_json;
    assert.ok(postPayload.title === 'Student Sem 2' || postPayload.title === 'New Post');
    assert.equal(postPayload.data.type, 'post');
    assert.equal(postPayload.data.postId, postId);
    assert.equal(recipientPostOutbox[0].idempotency_key, `post:${postId}:${studentS4Id}`);
  });

  // -------------------------------------------------------------
  // 4. Official Notice Tests
  // -------------------------------------------------------------
  await t.test('4. Official notice push: published by admin/CR, enqueues notice ONLY, no duplicate normal post push', async () => {
    // 1. Role validation check: normal student cannot publish official notice
    const studentNoticeRes = await fetch(`${baseUrl}/api/posts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokens[studentS2Id]}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content: 'Fake official notice by student',
        type: 'notice',
        official: true
      })
    });
    assert.equal(studentNoticeRes.status, 403, 'Unauthorized student should be forbidden from publishing official notice');

    // 2. Admin publishes official notice
    const adminNoticeRes = await fetch(`${baseUrl}/api/posts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokens[adminId]}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content: 'Campus library will be closed this Friday for maintenance.',
        type: 'notice',
        official: true
      })
    });
    const noticeData = await adminNoticeRes.json();
    assert.equal(adminNoticeRes.status, 201, 'Admin official notice should be created successfully');
    assert.ok(noticeData.id, 'Notice post ID should be returned');
    assert.equal(noticeData.is_official, true, 'is_official flag should be true');
    const noticeId = noticeData.id;

    // 3. Publisher (adminId) must be excluded
    const adminOutbox = await db.all(
      'SELECT id FROM push_notification_outbox WHERE recipient_student_id = ? AND event_id = ?',
      adminId, String(noticeId)
    );
    assert.equal(adminOutbox.length, 0, 'Publisher must be excluded from notice push notifications');

    // 4. Critical duplicate prevention: must have notice event ONLY, NEVER post event for same notice
    const recipientNoticeOutbox = await db.all(
      'SELECT id, event_type, payload_json, idempotency_key FROM push_notification_outbox WHERE recipient_student_id = ? AND event_id = ?',
      studentS2Id, String(noticeId)
    );
    assert.equal(recipientNoticeOutbox.length, 1, 'Should have exactly one notification event for official notice');
    assert.equal(recipientNoticeOutbox[0].event_type, 'notice', 'Event type must be notice');

    const noticePayload = typeof recipientNoticeOutbox[0].payload_json === 'string'
      ? JSON.parse(recipientNoticeOutbox[0].payload_json)
      : recipientNoticeOutbox[0].payload_json;
    assert.ok(
      noticePayload.title.includes('Admin') ||
      noticePayload.title.includes('Official') ||
      noticePayload.title.includes('Semester Library'),
      'Notice title must reflect publisher name or official publisher'
    );
    assert.equal(noticePayload.data.type, 'notice');
    assert.equal(noticePayload.data.noticeId, noticeId);
    assert.equal(recipientNoticeOutbox[0].idempotency_key, `notice:${noticeId}:${studentS2Id}`);

    // Verify NO normal 'post' event exists for this notice ID
    const normalPostCheck = await db.all(
      'SELECT id FROM push_notification_outbox WHERE recipient_student_id = ? AND event_type = ? AND event_id = ?',
      studentS2Id, 'post', String(noticeId)
    );
    assert.equal(normalPostCheck.length, 0, 'Official notice must NEVER generate a normal post notification');
  });

  // -------------------------------------------------------------
  // 5. Failure Isolation Test
  // -------------------------------------------------------------
  await t.test('5. Failure isolation: push enqueue failure does not cause primary action to fail', async () => {
    // Temporarily point db.run to throw when inserting into push_notification_outbox
    const originalRun = db.run;
    db.run = async (sql, ...params) => {
      if (typeof sql === 'string' && sql.includes('push_notification_outbox')) {
        throw new Error('Simulated database outbox failure');
      }
      return originalRun.apply(db, [sql, ...params]);
    };

    try {
      const chatRes = await fetch(`${baseUrl}/api/chat/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokens[senderId]}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: 'Message during push failure',
          clientId: `isolated_fail_${ts}`
        })
      });

      assert.equal(chatRes.status, 200, 'Chat message must still succeed even if push outbox enqueue throws');
      const chatData = await chatRes.json();
      assert.ok(chatData.messageId, 'Message must be saved in database');
    } finally {
      db.run = originalRun;
    }
  });
});
