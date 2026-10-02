const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const app = require('../server');
const db = require('../db');
const push = require('../lib/push-notifications');

test('Atomic Material Upload & Batch Notification Semantics', async (t) => {
  // Disable immediate synchronous dispatch to verify raw enqueued outbox states
  process.env.DISABLE_IMMEDIATE_PUSH_DISPATCH = '1';
  t.after(() => { delete process.env.DISABLE_IMMEDIATE_PUSH_DISPATCH; });

  await db.initSchema();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(() => {
    server.close();
  });

  const ts = Date.now();
  const teacherId = `TEACHER_${ts}`;
  const studentS2Id = `STUDENT_S2_${ts}`;
  const studentS4Id = `STUDENT_S4_${ts}`;

  // Clean outbox for these test accounts
  await db.run("DELETE FROM push_notification_outbox WHERE recipient_student_id LIKE 'STUDENT_%' OR recipient_student_id LIKE 'TEACHER_%'");

  // Insert teacher and students
  for (const s of [
    { id: teacherId, name: 'Prof. Sharma', role: 'teacher', semester: 'Semester 2' },
    { id: studentS2Id, name: 'Student Sem 2', role: 'student', semester: 'Semester 2' },
    { id: studentS4Id, name: 'Student Sem 4', role: 'student', semester: 'Semester 4' },
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

  // Issue mobile bearer tokens
  const teacherToken = `tok_${teacherId}_${ts}`;
  const studentToken = `tok_${studentS2Id}_${ts}`;
  const expiresAt = new Date(Date.now() + 86400000).toISOString();

  await db.run('INSERT INTO mobile_tokens (token, studentId, createdAt, expiresAt) VALUES (?, ?, ?, ?)', teacherToken, teacherId, new Date().toISOString(), expiresAt);
  await db.run('INSERT INTO mobile_tokens (token, studentId, createdAt, expiresAt) VALUES (?, ?, ?, ?)', studentToken, studentS2Id, new Date().toISOString(), expiresAt);

  // -------------------------------------------------------------
  // Test 1: Empty upload -> 400 Bad Request, 0 DB records, 0 notifications
  // -------------------------------------------------------------
  await t.test('1. Empty upload produces 0 DB records and 0 push notifications', async () => {
    const formData = new FormData();
    formData.append('semester', 'Semester 2');
    formData.append('subject', 'Database Systems');

    const res = await fetch(`${baseUrl}/api/files/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${teacherToken}`,
      },
      body: formData,
    });

    assert.equal(res.status, 400, 'Empty upload should fail with HTTP 400');
    const json = await res.json();
    assert.ok(json.message.includes('No file was uploaded'));

    const outbox = await db.all(
      "SELECT id FROM push_notification_outbox WHERE recipient_student_id = ?",
      studentS2Id
    );
    assert.equal(outbox.length, 0, 'No notification should be created when no files are uploaded');
  });

  // -------------------------------------------------------------
  // Test 2: Single file upload -> exactly 1 material push notification
  // -------------------------------------------------------------
  await t.test('2. Single file upload creates 1 DB record and exactly 1 material notification', async () => {
    const formData = new FormData();
    const blob = new Blob(['Dummy PDF Content for Test 2'], { type: 'application/pdf' });
    formData.append('files', blob, 'Single_Note_Ch1.pdf');
    formData.append('title', 'Unit 1 Overview');
    formData.append('semester', 'Semester 2');
    formData.append('subject', 'Database Systems');
    formData.append('chapter', 'Unit 1: Intro');

    const res = await fetch(`${baseUrl}/api/files/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${teacherToken}`,
      },
      body: formData,
    });

    assert.equal(res.status, 200, 'Upload should succeed');
    const json = await res.json();
    assert.equal(json.count, 1);
    assert.ok(json.fileId);

    // Verify 1 notification row for studentS2Id
    const outbox = await db.all(
      "SELECT id, payload_json, idempotency_key FROM push_notification_outbox WHERE recipient_student_id = ? AND event_type = 'material' AND event_id = ?",
      studentS2Id, String(json.fileId)
    );
    assert.equal(outbox.length, 1, 'Should create 1 notification row for Semester 2 student');

    const payload = typeof outbox[0].payload_json === 'string' ? JSON.parse(outbox[0].payload_json) : outbox[0].payload_json;
    assert.equal(payload.data.type, 'material');
    assert.equal(payload.data.fileId, json.fileId);

    // Verify uploader did not receive push
    const uploaderOutbox = await db.all(
      "SELECT id FROM push_notification_outbox WHERE recipient_student_id = ? AND event_type = 'material' AND event_id = ?",
      teacherId, String(json.fileId)
    );
    assert.equal(uploaderOutbox.length, 0, 'Teacher uploader must not receive notification');
  });

  // -------------------------------------------------------------
  // Test 3: Multi-file batch upload (3 files) -> ONE batch notification, not 3
  // -------------------------------------------------------------
  await t.test('3. Multi-file batch upload persists 3 files and creates ONE batch notification', async () => {
    const batchId = `batch_${Date.now()}_abc123`;
    const formData = new FormData();

    const blob1 = new Blob(['PDF Content 1'], { type: 'application/pdf' });
    const blob2 = new Blob(['PDF Content 2'], { type: 'application/pdf' });
    const blob3 = new Blob(['PPTX Content 3'], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });

    formData.append('files', blob1, 'DBMS_Unit4.pdf');
    formData.append('files', blob2, 'DBMS_Unit5.pdf');
    formData.append('files', blob3, 'Normalization_Slides.pptx');

    formData.append('fileTitles', JSON.stringify(['DBMS Unit 4', 'DBMS Unit 5', 'Normalization Slides']));
    formData.append('batchId', batchId);
    formData.append('semester', 'Semester 2');
    formData.append('subject', 'Database Systems');
    formData.append('chapter', 'Unit 4: Normalization');

    const res = await fetch(`${baseUrl}/api/files/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${teacherToken}`,
      },
      body: formData,
    });

    assert.equal(res.status, 200, 'Batch upload should succeed');
    const json = await res.json();
    assert.equal(json.count, 3, 'Should have persisted 3 files');
    assert.equal(json.files.length, 3);

    // Verify DB records have individual clean titles
    assert.equal(json.files[0].title, 'DBMS Unit 4');
    assert.equal(json.files[1].title, 'DBMS Unit 5');
    assert.equal(json.files[2].title, 'Normalization Slides');

    // Verify studentS2Id received exactly ONE batch notification for the entire batch
    const outboxRows = await db.all(
      "SELECT id, payload_json, idempotency_key FROM push_notification_outbox WHERE recipient_student_id = ? AND event_type = 'material' AND event_id = ?",
      studentS2Id, batchId
    );
    assert.equal(outboxRows.length, 1, 'Teacher multi-file upload must create ONE batch notification, not 3 pushes');

    const batchPayload = typeof outboxRows[0].payload_json === 'string'
      ? JSON.parse(outboxRows[0].payload_json)
      : outboxRows[0].payload_json;

    assert.equal(batchPayload.data.type, 'material_batch');
    assert.equal(batchPayload.data.batchId, batchId);
    assert.equal(batchPayload.data.materialCount, 3);
    assert.deepEqual(batchPayload.data.fileIds, json.files.map(f => Number(f.id)));
    assert.equal(outboxRows[0].idempotency_key, `material-batch:${batchId}:${studentS2Id}`);

    // Verify uploader is excluded
    const uploaderRows = await db.all(
      "SELECT id FROM push_notification_outbox WHERE recipient_student_id = ? AND event_type = 'material' AND event_id = ?",
      teacherId, batchId
    );
    assert.equal(uploaderRows.length, 0, 'Uploader must not receive batch notification');

    // Verify other semester (Semester 4) student is excluded
    const s4Rows = await db.all(
      "SELECT id FROM push_notification_outbox WHERE recipient_student_id = ? AND event_type = 'material' AND event_id = ?",
      studentS4Id, batchId
    );
    assert.equal(s4Rows.length, 0, 'Semester 4 student must not receive Semester 2 batch notification');
  });

  // -------------------------------------------------------------
  // Test 4: Idempotent batch retry -> zero duplicate push outbox entries
  // -------------------------------------------------------------
  await t.test('4. Duplicate batch enqueue with same batchId does not duplicate outbox entries', async () => {
    const testBatchId = `retry_batch_${Date.now()}`;
    const files = [
      { id: 9001, originalName: 'A.pdf', title: 'A' },
      { id: 9002, originalName: 'B.pdf', title: 'B' }
    ];

    const first = await push.enqueueMaterialBatchPush(db, {
      batchId: testBatchId,
      files,
      semester: 'Semester 2',
      subject: 'Database Systems',
      chapter: 'Unit 1',
      uploaderStudentId: teacherId
    });
    assert.ok(first.enqueuedCount >= 1);

    const retry = await push.enqueueMaterialBatchPush(db, {
      batchId: testBatchId,
      files,
      semester: 'Semester 2',
      subject: 'Database Systems',
      chapter: 'Unit 1',
      uploaderStudentId: teacherId
    });

    const rows = await db.all(
      "SELECT id FROM push_notification_outbox WHERE recipient_student_id = ? AND event_type = 'material' AND event_id = ?",
      studentS2Id, testBatchId
    );
    assert.equal(rows.length, 1, 'Retry with same batchId must not create duplicate notifications');
  });
});
